import type { Capture, ChatMessage, Message } from "../types";

const BACKEND_URL = "https://web-production-223b1.up.railway.app";
const CONTENT_SCRIPT_FILE = "src/content/content.js";
const INJECTABLE_URL_PATTERN = /^https?:\/\//i;
const DEFAULT_SAVE_TRIGGERS = { bubble: true, contextMenu: true };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || "Unknown error");
}

async function throwResponseError(label: string, res: Response): Promise<never> {
  let detail = "";
  try {
    const body = await res.text();
    if (body) {
      try {
        const parsed = JSON.parse(body);
        detail = parsed.detail ?? parsed.error?.message ?? parsed.error?.type ?? body;
      } catch {
        detail = body;
      }
    }
  } catch {
    // Ignore secondary failures while reporting the primary HTTP status.
  }

  const shortDetail = detail ? ` — ${detail.slice(0, 240)}` : "";
  throw new Error(`${label}: ${res.status}${shortDetail}`);
}

// Open dashboard when extension icon is clicked
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

void injectIntoOpenTabs();

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.remove("anthropic_api_key");
  injectIntoOpenTabs();
});

function canInjectIntoUrl(url?: string): boolean {
  return Boolean(url && INJECTABLE_URL_PATTERN.test(url));
}

async function injectContentScript(tabId: number, url?: string): Promise<boolean> {
  if (!canInjectIntoUrl(url)) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE],
    });
    return true;
  } catch {
    return false;
  }
}

async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => {
    if (!tab.id) return Promise.resolve(false);
    return injectContentScript(tab.id, tab.url);
  }));
}

function registerContextMenu(enabled: boolean) {
  chrome.contextMenus.removeAll(() => {
    if (!enabled) return;
    chrome.contextMenus.create({
      id: "save-highlight",
      title: "Save to ContextLens",
      contexts: ["selection"],
    });
  });
}

async function syncContextMenu() {
  const { save_triggers } = await chrome.storage.local.get("save_triggers");
  const triggers = save_triggers ?? DEFAULT_SAVE_TRIGGERS;
  registerContextMenu(triggers.contextMenu);
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  await injectContentScript(tabId, tab.url);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    injectContentScript(tabId, tab.url);
  }
});

async function takeScreenshot() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "SHOW_CROP_OVERLAY", imageData: dataUrl });
  } catch {
    const injected = await injectContentScript(tab.id, tab.url);
    if (injected) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "SHOW_CROP_OVERLAY", imageData: dataUrl });
        return;
      } catch {
        // Fall through to the standalone crop page.
      }
    }
    await chrome.storage.session.set({ pending_screenshot: dataUrl });
    chrome.tabs.create({ url: chrome.runtime.getURL("src/crop/crop.html") });
  }
}

// Screenshot shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "screenshot") return;
  const { screenshot_triggers } = await chrome.storage.local.get("screenshot_triggers");
  const triggers = screenshot_triggers ?? { floatingButton: true, shortcut: true };
  if (!triggers.shortcut) return;
  await takeScreenshot();
});

// Register context menu on install + open welcome page on first install
chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.storage.local.remove("anthropic_api_key");
  injectIntoOpenTabs();
  if (reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/welcome/welcome.html") });
  }
  syncContextMenu();
});

// Toggle context menu when save_triggers setting changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.save_triggers) {
    const triggers = changes.save_triggers.newValue ?? DEFAULT_SAVE_TRIGGERS;
    registerContextMenu(triggers.contextMenu);
  }
});

// Handle context menu click — send back to content script to show the widget
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "save-highlight" && info.selectionText && tab?.id) {
    const message = {
      type: "SHOW_CONTEXT_INPUT",
      text: info.selectionText,
    };

    chrome.tabs.sendMessage(tab.id, message).catch(async () => {
      const injected = await injectContentScript(tab.id!, tab.url);
      if (injected) {
        await chrome.tabs.sendMessage(tab.id!, message).catch(() => {});
      }
    });
  }
});

// Handle messages from content script and crop page
chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === "SAVE_HIGHLIGHT") {
    saveHighlight(message.text, message.url, message.title, message.context)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: errorMessage(error) }));
    return true;
  }
  if (message.type === "TAKE_SCREENSHOT") {
    void takeScreenshot();
  }
  if (message.type === "SAVE_SCREENSHOT") {
    void saveScreenshot(message.imageData, message.context);
  }
  if (message.type === "EXPLAIN_SCREENSHOT") {
    explainAndSaveScreenshot(message.imageData, message.context)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: errorMessage(error) }));
    return true;
  }
  if (message.type === "ASK_FOLLOWUP") {
    askFollowup(message.captureId, message.question)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: errorMessage(error) }));
    return true;
  }
});

async function fetchExplanation(text: string, context: string, imageBase64?: string): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, context, image_base64: imageBase64 ?? null }),
  });
  if (!res.ok) await throwResponseError("Backend error", res);
  const data = await res.json();
  return data.explanation ?? "";
}

async function addCapture(capture: Capture) {
  const storage = await chrome.storage.local.get("captures");
  const captures: Capture[] = storage.captures ?? [];
  captures.unshift(capture);
  await chrome.storage.local.set({ captures });
}

async function updateCapture(id: string, patch: Partial<Capture>): Promise<Capture | null> {
  const updated = await chrome.storage.local.get("captures");
  const captures: Capture[] = updated.captures ?? [];
  const idx = captures.findIndex((c) => c.id === id);
  if (idx === -1) return null;

  captures[idx] = { ...captures[idx], ...patch };
  if (patch.errorMessage === undefined) {
    delete captures[idx].errorMessage;
  }

  await chrome.storage.local.set({ captures });
  return captures[idx];
}

async function createPendingScreenshot(imageData: string, context: string): Promise<string> {
  const id = crypto.randomUUID();
  const capture: Capture = {
    id,
    text: "[Screenshot]",
    context,
    url: "",
    title: "Screenshot",
    savedAt: new Date().toISOString(),
    explanation: null,
    status: "pending",
    imageData,
  };

  await addCapture(capture);
  return id;
}

async function seedChat(captureId: string, explanation: string) {
  const key = `chat_${captureId}`;
  const storage = await chrome.storage.local.get(key);
  const existing: ChatMessage[] = storage[key] ?? [];
  if (existing.length > 0) return;
  await chrome.storage.local.set({ [key]: [{ role: "assistant", content: explanation }] satisfies ChatMessage[] });
}

async function explainAndSaveScreenshot(imageData: string, context: string): Promise<{ captureId: string; explanation: string }> {
  const id = await createPendingScreenshot(imageData, context);

  try {
    const base64 = imageData.split(",")[1];
    const explanation = await fetchExplanation("", context, base64);
    await updateCapture(id, { explanation, status: "done", errorMessage: undefined });
    await seedChat(id, explanation);
    return { captureId: id, explanation };
  } catch (error) {
    console.error("ContextLens failed to explain screenshot", error);
    await updateCapture(id, { status: "error", errorMessage: errorMessage(error) });
    throw error;
  }
}

async function saveScreenshot(imageData: string, context: string) {
  await explainAndSaveScreenshot(imageData, context).catch(() => {});
}

async function askFollowup(captureId: string, question: string): Promise<{ reply: string; messages: ChatMessage[] }> {
  const key = `chat_${captureId}`;
  const storage = await chrome.storage.local.get(["captures", key]);
  const captures: Capture[] = storage.captures ?? [];
  const capture = captures.find((c) => c.id === captureId);
  if (!capture) throw new Error("Saved item not found.");

  const prior: ChatMessage[] = storage[key] ?? (capture.explanation ? [{ role: "assistant", content: capture.explanation }] : []);
  const updated: ChatMessage[] = [...prior, { role: "user", content: question }];
  const transcript = updated
    .slice(-8)
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n");
  const source = [
    `Saved item: ${capture.text}`,
    capture.context ? `Original context note: ${capture.context}` : "",
    `Conversation so far:\n${transcript}`,
  ].filter(Boolean).join("\n\n");
  const imageBase64 = capture.imageData?.split(",")[1];
  const reply = await fetchExplanation(source, question, imageBase64);
  const messages: ChatMessage[] = [...updated, { role: "assistant", content: reply }];
  await chrome.storage.local.set({ [key]: messages });
  return { reply, messages };
}

async function saveHighlight(text: string, url: string, title: string, context: string): Promise<{ captureId: string; explanation: string }> {
  const id = crypto.randomUUID();
  const capture: Capture = {
    id,
    text,
    context,
    url,
    title,
    savedAt: new Date().toISOString(),
    explanation: null,
    status: "pending",
  };

  await addCapture(capture);

  try {
    const explanation = await fetchExplanation(text, context);
    await updateCapture(id, { explanation, status: "done", errorMessage: undefined });
    await seedChat(id, explanation);
    return { captureId: id, explanation };
  } catch (error) {
    console.error("ContextLens failed to explain highlight", error);
    await updateCapture(id, { status: "error", errorMessage: errorMessage(error) });
    throw error;
  }
}
