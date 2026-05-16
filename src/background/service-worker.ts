import type { Capture, ChatMessage, ContextLensUser, Message } from "../types";

const BACKEND_URL = "https://web-production-223b1.up.railway.app";
const CONTENT_SCRIPT_FILE = "src/content/content.js";
const INJECTABLE_URL_PATTERN = /^https?:\/\//i;
const DEFAULT_SAVE_TRIGGERS = { bubble: true, contextMenu: true };
const DEEP_DIVE_CAPTURE_IDS_KEY = "deep_dive_capture_ids";

interface RemoteCapture {
  id: string;
  text: string;
  context: string;
  url?: string;
  title?: string;
  image_data?: string | null;
  explanation: string | null;
  saved_at: string;
}

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

void injectIntoOpenTabs();
void syncCapturesWithRemote().catch((error) => {
  console.warn("ContextLens remote sync skipped", error);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.remove("anthropic_api_key");
  injectIntoOpenTabs();
  void syncCapturesWithRemote().catch((error) => {
    console.warn("ContextLens remote sync skipped", error);
  });
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
    askFollowup(message.captureId, message.question, Boolean(message.deepDive))
      .then(sendResponse)
      .catch((error) => sendResponse({ error: errorMessage(error) }));
    return true;
  }
  if (message.type === "SIGN_UP") {
    signUp(message.email, message.password)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
    return true;
  }
  if (message.type === "SIGN_IN") {
    signIn(message.email, message.password)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
    return true;
  }
  if (message.type === "SIGN_OUT") {
    signOut()
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
    return true;
  }
  if (message.type === "DELETE_ACCOUNT") {
    deleteAccount()
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
    return true;
  }
  if (message.type === "DEEP_DIVE") {
    deepDive(message.captureId)
      .then(sendResponse)
      .catch((err: unknown) => sendResponse({ error: errorMessage(err) }));
    return true;
  }
  if (message.type === "ANALOGY") {
    generateAnalogy(message.text)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
    return true;
  }
  if (message.type === "SYNC_REMOTE_CAPTURES") {
    syncCapturesWithRemote()
      .then(sendResponse)
      .catch((error) => sendResponse({ error: errorMessage(error) }));
    return true;
  }
  if (message.type === "DELETE_REMOTE_CAPTURES") {
    deleteRemoteCaptures(message.ids)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: errorMessage(error) }));
    return true;
  }
});

async function getAppMode(): Promise<string> {
  const storage = await chrome.storage.local.get("app_mode");
  return storage.app_mode ?? "language_learning";
}

async function fetchExplanation(text: string, context: string, imageBase64?: string, deepDive = false): Promise<string> {
  const account = deepDive ? await getAccount() : null;
  const mode = deepDive ? "language_learning" : await getAppMode();
  const body: Record<string, unknown> = { text, context, image_base64: imageBase64 ?? null, mode };
  if (deepDive) {
    body.deep_dive = true;
    body.token = account?.token ?? null;
  }
  const res = await fetch(`${BACKEND_URL}/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429) {
    const data = await res.json().catch(() => ({}));
    if (data.detail === "deep_dive_limit_reached") throw new Error("DEEP_DIVE_LIMIT_REACHED");
  }
  if (!res.ok) await throwResponseError("Backend error", res);
  const data = await res.json();
  return data.explanation ?? "";
}

async function getAccount(): Promise<ContextLensUser | null> {
  const storage = await chrome.storage.local.get("contextlens_user");
  return storage.contextlens_user ?? null;
}

function remoteToCapture(remote: RemoteCapture): Capture {
  return {
    id: remote.id,
    text: remote.text,
    context: remote.context,
    url: remote.url ?? "",
    title: remote.title ?? "",
    savedAt: remote.saved_at,
    explanation: remote.explanation,
    status: "done",
    imageData: remote.image_data ?? undefined,
  };
}

function captureToRemotePayload(capture: Capture, token: string) {
  return {
    token,
    id: capture.id,
    text: capture.text,
    context: capture.context,
    url: capture.url,
    title: capture.title,
    image_data: capture.imageData ?? null,
    explanation: capture.explanation,
    saved_at: capture.savedAt,
  };
}

async function signUp(email: string, password: string): Promise<ContextLensUser> {
  const res = await fetch(`${BACKEND_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  if (!res.ok) await throwResponseError("Sign up error", res);
  const data = await res.json();
  const account: ContextLensUser = { email: data.email, token: data.token };
  await chrome.storage.local.set({ contextlens_user: account });
  await syncCapturesWithRemote(account);
  return account;
}

async function signIn(email: string, password: string): Promise<ContextLensUser> {
  const res = await fetch(`${BACKEND_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  if (!res.ok) await throwResponseError("Sign in error", res);
  const data = await res.json();
  const account: ContextLensUser = { email: data.email, token: data.token };
  await chrome.storage.local.set({ contextlens_user: account });
  await syncCapturesWithRemote(account);
  return account;
}

async function signOut(): Promise<void> {
  await chrome.storage.local.remove("contextlens_user");
}

async function deleteAccount(): Promise<{ deleted: boolean }> {
  const account = await getAccount();
  if (!account) throw new Error("No account is signed in.");

  const res = await fetch(`${BACKEND_URL}/auth/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: account.token }),
  });
  if (!res.ok) await throwResponseError("Delete account error", res);
  await chrome.storage.local.remove("contextlens_user");
  return { deleted: true };
}

async function saveCaptureRemote(capture: Capture): Promise<void> {
  if (capture.status !== "done") return;
  const account = await getAccount();
  if (!account) return;

  const res = await fetch(`${BACKEND_URL}/captures`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(captureToRemotePayload(capture, account.token)),
  });
  if (!res.ok) await throwResponseError("Sync error", res);
}

async function fetchRemoteCaptures(token: string): Promise<Capture[]> {
  const res = await fetch(`${BACKEND_URL}/captures?token=${encodeURIComponent(token)}`);
  if (!res.ok) await throwResponseError("Sync error", res);
  const remote: RemoteCapture[] = await res.json();
  return remote.map(remoteToCapture);
}

async function syncCapturesWithRemote(accountOverride?: ContextLensUser): Promise<{ synced: number }> {
  const account = accountOverride ?? await getAccount();
  if (!account) return { synced: 0 };

  const storage = await chrome.storage.local.get("captures");
  const localCaptures: Capture[] = storage.captures ?? [];
  const uploadable = localCaptures.filter((capture) => capture.status === "done");
  await Promise.all(uploadable.map((capture) => saveCaptureRemote(capture).catch((error) => {
    console.warn("ContextLens remote save skipped", error);
  })));

  const remoteCaptures = await fetchRemoteCaptures(account.token);
  const merged = new Map<string, Capture>();
  remoteCaptures.forEach((capture) => merged.set(capture.id, capture));
  localCaptures.forEach((capture) => {
    if (!merged.has(capture.id)) merged.set(capture.id, capture);
  });
  const captures = Array.from(merged.values()).sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  await chrome.storage.local.set({ captures });
  return { synced: remoteCaptures.length };
}

async function deleteRemoteCaptures(ids: string[]): Promise<{ deleted: number }> {
  const account = await getAccount();
  if (!account || ids.length === 0) return { deleted: 0 };

  const res = await fetch(`${BACKEND_URL}/captures/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: account.token, ids }),
  });
  if (!res.ok) await throwResponseError("Delete sync error", res);
  return await res.json();
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

async function getDeepDiveCaptureIds(): Promise<Set<string>> {
  const storage = await chrome.storage.local.get(DEEP_DIVE_CAPTURE_IDS_KEY);
  return new Set(storage[DEEP_DIVE_CAPTURE_IDS_KEY] ?? []);
}

async function isDeepDiveCapture(captureId: string): Promise<boolean> {
  return (await getDeepDiveCaptureIds()).has(captureId);
}

async function markDeepDiveCapture(captureId: string): Promise<void> {
  const ids = await getDeepDiveCaptureIds();
  ids.add(captureId);
  await chrome.storage.local.set({ [DEEP_DIVE_CAPTURE_IDS_KEY]: Array.from(ids) });
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
    const capture = await updateCapture(id, { explanation, status: "done", errorMessage: undefined });
    if (capture) {
      void saveCaptureRemote(capture).catch((syncError) => {
        console.warn("ContextLens remote save skipped", syncError);
      });
    }
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

async function askFollowup(captureId: string, question: string, deepDiveRequested = false): Promise<{ reply: string; messages: ChatMessage[] }> {
  const key = `chat_${captureId}`;
  const storage = await chrome.storage.local.get(["captures", key]);
  const captures: Capture[] = storage.captures ?? [];
  const capture = captures.find((c) => c.id === captureId);

  const prior: ChatMessage[] = storage[key] ?? (capture?.explanation ? [{ role: "assistant", content: capture.explanation }] : []);
  if (!capture && prior.length === 0) throw new Error("Saved item not found.");

  const updated: ChatMessage[] = [...prior, { role: "user", content: question }];
  const transcript = updated
    .slice(-8)
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n");
  const source = capture
    ? [
        `Saved item: ${capture.text}`,
        capture.context ? `Original context note: ${capture.context}` : "",
        `Conversation so far:\n${transcript}`,
      ].filter(Boolean).join("\n\n")
    : transcript;
  const imageBase64 = capture?.imageData?.split(",")[1];
  const useDeepDive = deepDiveRequested || await isDeepDiveCapture(captureId);
  const reply = await fetchExplanation(source, question, imageBase64, useDeepDive);
  if (useDeepDive) await markDeepDiveCapture(captureId);
  const messages: ChatMessage[] = [...updated, { role: "assistant", content: reply }];
  await chrome.storage.local.set({ [key]: messages });
  return { reply, messages };
}

async function deepDive(captureId: string): Promise<{ explanation: string; messages: ChatMessage[] }> {
  const storage = await chrome.storage.local.get(["captures", `chat_${captureId}`]);
  const captures: Capture[] = storage.captures ?? [];
  const capture = captures.find((c) => c.id === captureId);
  if (!capture) throw new Error("Saved item not found.");

  const imageBase64 = capture.imageData?.split(",")[1];
  const explanation = await fetchExplanation(capture.text, capture.context, imageBase64, true);

  await updateCapture(captureId, { explanation });
  await markDeepDiveCapture(captureId);

  const chatKey = `chat_${captureId}`;
  const messages: ChatMessage[] = [{ role: "assistant", content: explanation }];
  await chrome.storage.local.set({ [chatKey]: messages });

  return { explanation, messages };
}

async function generateAnalogy(text: string): Promise<{ analogy: string }> {
  const mode = await getAppMode();
  const body: Record<string, unknown> = { text, context: "", analogy: true, mode };
  const res = await fetch(`${BACKEND_URL}/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwResponseError("Analogy error", res);
  const data = await res.json();
  return { analogy: data.explanation ?? "" };
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
    const capture = await updateCapture(id, { explanation, status: "done", errorMessage: undefined });
    if (capture) {
      void saveCaptureRemote(capture).catch((syncError) => {
        console.warn("ContextLens remote save skipped", syncError);
      });
    }
    await seedChat(id, explanation);
    return { captureId: id, explanation };
  } catch (error) {
    console.error("ContextLens failed to explain highlight", error);
    await updateCapture(id, { status: "error", errorMessage: errorMessage(error) });
    throw error;
  }
}
