import type { Capture, Message } from "../types";

// Backend URL — update this once deployed to Railway
const BACKEND_URL = "https://contextlens-api.railway.app";

// Open dashboard when extension icon is clicked
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

async function takeScreenshot() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
  chrome.tabs.sendMessage(tab.id, { type: "SHOW_CROP_OVERLAY", imageData: dataUrl }).catch(() => {});
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
  if (reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/welcome/welcome.html") });
  }
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "save-highlight",
      title: "Save to ContextLens",
      contexts: ["selection"],
    });
  });
});

// Toggle context menu when save_triggers setting changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.save_triggers) {
    const triggers = changes.save_triggers.newValue ?? { bubble: true, contextMenu: true };
    chrome.contextMenus.removeAll(() => {
      if (triggers.contextMenu) {
        chrome.contextMenus.create({
          id: "save-highlight",
          title: "Save to ContextLens",
          contexts: ["selection"],
        });
      }
    });
  }
});

// Handle context menu click — send back to content script to show the widget
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "save-highlight" && info.selectionText && tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      type: "SHOW_CONTEXT_INPUT",
      text: info.selectionText,
    }).catch(() => {});
  }
});

// Handle messages from content script and crop page
chrome.runtime.onMessage.addListener((message: Message) => {
  if (message.type === "SAVE_HIGHLIGHT") {
    saveHighlight(message.text, message.url, message.title, message.context);
  }
  if (message.type === "TAKE_SCREENSHOT") {
    takeScreenshot();
  }
  if (message.type === "SAVE_SCREENSHOT") {
    saveScreenshot(message.imageData, message.context);
  }
});

// Fetch explanation — uses user's own key if set, otherwise backend
async function fetchExplanation(text: string, context: string, imageBase64?: string): Promise<string> {
  const { anthropic_api_key: userKey } = await chrome.storage.local.get("anthropic_api_key");

  if (userKey) {
    // User's own key — call Anthropic directly
    if (imageBase64) {
      const prompt = context
        ? `The user doesn't understand "${context}" in this image. Explain it clearly in 1-3 sentences in English. Plain text only, no markdown.`
        : "Explain what is shown in this image in 1-3 sentences in English. Be clear and concise. Plain text only, no markdown.";
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": userKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 300,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: imageBase64 } },
            { type: "text", text: prompt },
          ]}],
        }),
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      return data.content?.[0]?.text?.trim().replace(/^#+\s*/gm, "") ?? "";
    } else {
      const truncated = text.length > 400 ? text.slice(0, 400) + "…" : text;
      const prompt = context
        ? `The user highlighted this text:\n"${truncated}"\n\nThey specifically don't understand: "${context}"\n\nExplain what "${context}" means in the context of the sentence above. Be brief and clear — 1-2 sentences max. Always respond in English. Plain text only, no markdown.`
        : `The user highlighted this text:\n"${truncated}"\n\nExplain what it means in 1-2 sentences. Be brief and clear. Always respond in English. Plain text only, no markdown.`;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": userKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 200,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      return data.content?.[0]?.text?.trim().replace(/^#+\s*/gm, "").trim() ?? "";
    }
  } else {
    // No user key — call backend
    const res = await fetch(`${BACKEND_URL}/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, context, image_base64: imageBase64 ?? null }),
    });
    if (!res.ok) throw new Error(`Backend error: ${res.status}`);
    const data = await res.json();
    return data.explanation ?? "";
  }
}

async function saveScreenshot(imageData: string, context: string) {
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

  const storage = await chrome.storage.local.get("captures");
  const captures: Capture[] = storage.captures ?? [];
  captures.unshift(capture);
  await chrome.storage.local.set({ captures });

  try {
    const base64 = imageData.split(",")[1];
    const explanation = await fetchExplanation("", context, base64);
    const updated = await chrome.storage.local.get("captures");
    const updatedCaptures: Capture[] = updated.captures ?? [];
    const idx = updatedCaptures.findIndex((c) => c.id === id);
    if (idx !== -1) {
      updatedCaptures[idx].explanation = explanation;
      updatedCaptures[idx].status = "done";
      await chrome.storage.local.set({ captures: updatedCaptures });
    }
  } catch {
    const updated = await chrome.storage.local.get("captures");
    const updatedCaptures: Capture[] = updated.captures ?? [];
    const idx = updatedCaptures.findIndex((c) => c.id === id);
    if (idx !== -1) {
      updatedCaptures[idx].status = "error";
      await chrome.storage.local.set({ captures: updatedCaptures });
    }
  }
}

async function saveHighlight(text: string, url: string, title: string, context: string) {
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

  const storage = await chrome.storage.local.get("captures");
  const captures: Capture[] = storage.captures ?? [];
  captures.unshift(capture);
  await chrome.storage.local.set({ captures });

  try {
    const explanation = await fetchExplanation(text, context);
    const updated = await chrome.storage.local.get("captures");
    const updatedCaptures: Capture[] = updated.captures ?? [];
    const idx = updatedCaptures.findIndex((c) => c.id === id);
    if (idx !== -1) {
      updatedCaptures[idx].explanation = explanation;
      updatedCaptures[idx].status = "done";
      await chrome.storage.local.set({ captures: updatedCaptures });
    }
  } catch {
    const updated = await chrome.storage.local.get("captures");
    const updatedCaptures: Capture[] = updated.captures ?? [];
    const idx = updatedCaptures.findIndex((c) => c.id === id);
    if (idx !== -1) {
      updatedCaptures[idx].status = "error";
      await chrome.storage.local.set({ captures: updatedCaptures });
    }
  }
}
