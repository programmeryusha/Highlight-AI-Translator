import type { Capture, ChatMessage, ContextLensUser, Message } from "../types";

const BACKEND_URL = "https://web-production-223b1.up.railway.app";
const CONTENT_SCRIPT_FILE = "src/content/content.js";
const INJECTABLE_URL_PATTERN = /^https?:\/\//i;
const DEFAULT_SAVE_TRIGGERS = { bubble: true, contextMenu: true };
const DEEP_DIVE_CAPTURE_IDS_KEY = "deep_dive_capture_ids";
const EXACT_DUPLICATE_WINDOW_MS = 60_000;
const REMOTE_CAPTURE_SIGNATURES_KEY = "remote_capture_signatures";
const REMOTE_SYNC_COMPLETED_AT_KEY = "remote_sync_completed_at";
const REMOTE_SYNC_FRESH_MS = 15 * 60_000;

interface RemoteCapture {
  id: string;
  text: string;
  context: string;
  url?: string;
  title?: string;
  image_data?: string | null;
  explanation: string | null;
  saved_at: string;
  fsrs_stability?: number;
  fsrs_difficulty?: number;
  fsrs_lapses?: number;
  fsrs_state?: "new" | "learning" | "reviewing" | "relearning";
  fsrs_due_at?: string;
  fsrs_last_reviewed_at?: string | null;
  fsrs_review_count?: number;
}

interface CaptureFallback {
  text?: string;
  context?: string;
  imageData?: string;
  url?: string;
  title?: string;
}

interface SyncOptions {
  force?: boolean;
}

function normalizePageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

function normalizeTextForDuplicate(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findExactRecentDuplicate(captures: Capture[], text: string, url: string, now = Date.now()): Capture | null {
  const normalizedText = normalizeTextForDuplicate(text);
  const normalizedUrl = normalizePageUrl(url);
  if (!normalizedText || !normalizedUrl) return null;
  return captures.find((capture) => {
    if (capture.imageData) return false;
    if (normalizePageUrl(capture.url) !== normalizedUrl) return false;
    if (normalizeTextForDuplicate(capture.text) !== normalizedText) return false;
    return now - new Date(capture.savedAt).getTime() <= EXACT_DUPLICATE_WINDOW_MS;
  }) ?? null;
}

function captureSyncSignature(capture: Capture): string {
  const imageData = capture.imageData ?? "";
  const imageKind = imageData.startsWith("data:")
    ? "data"
    : imageData
      ? "remote"
      : "none";

  return JSON.stringify({
    text: capture.text,
    context: capture.context,
    url: capture.url,
    title: capture.title,
    explanation: capture.explanation ?? "",
    savedAt: capture.savedAt,
    fsrsStability: capture.fsrsStability ?? 0,
    fsrsDifficulty: capture.fsrsDifficulty ?? 5,
    fsrsLapses: capture.fsrsLapses ?? 0,
    fsrsState: capture.fsrsState ?? "new",
    fsrsDueAt: capture.fsrsDueAt ?? capture.savedAt,
    fsrsLastReviewedAt: capture.fsrsLastReviewedAt ?? null,
    fsrsReviewCount: capture.fsrsReviewCount ?? 0,
    imageKind,
    imageSize: imageKind === "data" ? imageData.length : 0,
  });
}

async function markCapturesSynced(captures: Capture[]): Promise<void> {
  if (captures.length === 0) return;
  const storage = await chrome.storage.local.get(REMOTE_CAPTURE_SIGNATURES_KEY);
  const signatures: Record<string, string> = storage[REMOTE_CAPTURE_SIGNATURES_KEY] ?? {};
  captures.forEach((capture) => {
    signatures[capture.id] = captureSyncSignature(capture);
  });
  await chrome.storage.local.set({ [REMOTE_CAPTURE_SIGNATURES_KEY]: signatures });
}

function errorMessage(error: unknown): string {
  if (error instanceof TypeError && /fetch|network|failed/i.test(error.message)) {
    return "Network error: Could not reach the ContextLens backend. Check the connection and backend deployment.";
  }
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
        const requestId = parsed.request_id ?? parsed.requestId;
        const code = parsed.code ?? parsed.status ?? res.status;
        const message = parsed.detail ?? parsed.message ?? parsed.error?.message ?? parsed.error?.type;
        const diagnostic = [
          `HTTP ${res.status}`,
          code && String(code) !== String(res.status) ? `code ${code}` : "",
          requestId ? `request ${requestId}` : "",
        ].filter(Boolean).join(" • ");
        detail = [diagnostic, message].filter(Boolean).join(" — ") || body;
      } catch {
        detail = body;
      }
    }
  } catch {
    // Ignore secondary failures while reporting the primary HTTP status.
  }

  const shortDetail = detail ? detail.slice(0, 240) : `HTTP ${res.status}`;
  throw new Error(`${label}: ${shortDetail}`);
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

async function takeScreenshot(scrollX?: number, scrollY?: number) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
  const overlayMessage = { type: "SHOW_CROP_OVERLAY", imageData: dataUrl, scrollX, scrollY };
  try {
    await chrome.tabs.sendMessage(tab.id, overlayMessage);
  } catch {
    const injected = await injectContentScript(tab.id, tab.url);
    if (injected) {
      try {
        await chrome.tabs.sendMessage(tab.id, overlayMessage);
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
    saveHighlight(message.text, message.url, message.title, message.context, message.replaceCaptureId)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: errorMessage(error) }));
    return true;
  }
  if (message.type === "TAKE_SCREENSHOT") {
    void takeScreenshot(message.scrollX, message.scrollY);
  }
  if (message.type === "SAVE_SCREENSHOT") {
    void saveScreenshot(message.imageData, message.context);
  }
  if (message.type === "EXPLAIN_SCREENSHOT") {
    explainAndSaveScreenshot(message.imageData, message.context, message.replaceCaptureId)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: errorMessage(error) }));
    return true;
  }
  if (message.type === "RETRY_CAPTURE") {
    retryCapture(message.captureId)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: errorMessage(error) }));
    return true;
  }
  if (message.type === "ASK_FOLLOWUP") {
    askFollowup(message.captureId, message.question, Boolean(message.deepDive), {
      text: message.fallbackText,
      context: message.fallbackContext,
      imageData: message.fallbackImageData,
      url: message.fallbackUrl,
      title: message.fallbackTitle,
    })
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
  if (message.type === "SIGN_IN_OR_SIGN_UP") {
    signInOrSignUp(message.email, message.password)
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
    deepDive(message.captureId, {
      text: message.fallbackText,
      context: message.fallbackContext,
      imageData: message.fallbackImageData,
      url: message.fallbackUrl,
      title: message.fallbackTitle,
    })
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
    syncCapturesWithRemote(undefined, { force: true })
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
  if (message.type === "REVIEW_FLASHCARDS") {
    reviewFlashcardsRemote(message.ids, message.rating)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: errorMessage(error) }));
    return true;
  }
  if (message.type === "FORGOT_PASSWORD") {
    forgotPassword(message.email)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
    return true;
  }
  if (message.type === "RESET_PASSWORD") {
    resetPassword(message.email, message.code, message.newPassword)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
    return true;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "contextlens-explain-stream") return;

  let disconnected = false;
  port.onDisconnect.addListener(() => {
    disconnected = true;
  });

  function post(message: Record<string, unknown>) {
    if (!disconnected) port.postMessage(message);
  }

  port.onMessage.addListener((message: Record<string, unknown>) => {
    if (message.type === "SAVE_HIGHLIGHT_STREAM") {
      saveHighlightStream(
        String(message.text ?? ""),
        String(message.url ?? ""),
        String(message.title ?? ""),
        String(message.context ?? ""),
        typeof message.replaceCaptureId === "string" ? message.replaceCaptureId : undefined,
        (captureId) => post({ type: "started", captureId }),
        (chunk) => post({ type: "chunk", text: chunk }),
      )
        .then((result) => post({ type: "done", ...result }))
        .catch((error) => post({ type: "error", error: errorMessage(error) }));
      return;
    }

    if (message.type === "ASK_FOLLOWUP_STREAM") {
      askFollowupStream(
        String(message.captureId ?? ""),
        String(message.question ?? ""),
        Boolean(message.deepDive),
        {
          text: typeof message.fallbackText === "string" ? message.fallbackText : undefined,
          context: typeof message.fallbackContext === "string" ? message.fallbackContext : undefined,
          imageData: typeof message.fallbackImageData === "string" ? message.fallbackImageData : undefined,
          url: typeof message.fallbackUrl === "string" ? message.fallbackUrl : undefined,
          title: typeof message.fallbackTitle === "string" ? message.fallbackTitle : undefined,
        },
        (chunk) => post({ type: "chunk", text: chunk }),
      )
        .then((result) => post({ type: "done", ...result }))
        .catch((error) => post({ type: "error", error: errorMessage(error) }));
      return;
    }

    if (message.type === "DEEP_DIVE_STREAM") {
      deepDiveStream(
        String(message.captureId ?? ""),
        {
          text: typeof message.fallbackText === "string" ? message.fallbackText : undefined,
          context: typeof message.fallbackContext === "string" ? message.fallbackContext : undefined,
          imageData: typeof message.fallbackImageData === "string" ? message.fallbackImageData : undefined,
          url: typeof message.fallbackUrl === "string" ? message.fallbackUrl : undefined,
          title: typeof message.fallbackTitle === "string" ? message.fallbackTitle : undefined,
        },
        (chunk) => post({ type: "chunk", text: chunk }),
      )
        .then((result) => post({ type: "done", ...result }))
        .catch((error) => post({ type: "error", error: errorMessage(error) }));
      return;
    }

    if (message.type === "EXPLAIN_SCREENSHOT_STREAM") {
      explainAndSaveScreenshotStream(
        String(message.imageData ?? ""),
        String(message.context ?? ""),
        (captureId) => post({ type: "started", captureId }),
        (chunk) => post({ type: "chunk", text: chunk }),
      )
        .then((result) => post({ type: "done", ...result }))
        .catch((error) => post({ type: "error", error: errorMessage(error) }));
    }
  });
});

async function getAppMode(): Promise<string> {
  const storage = await chrome.storage.local.get("app_mode");
  return storage.app_mode ?? "language_learning";
}

async function fetchExplanation(
  text: string,
  context: string,
  imageBase64?: string,
  deepDive = false,
  messages: ChatMessage[] = [],
): Promise<string> {
  const account = deepDive ? await getAccount() : null;
  const mode = deepDive ? "language_learning" : await getAppMode();
  const body: Record<string, unknown> = { text, context, image_base64: imageBase64 ?? null, mode };
  if (messages.length > 0) {
    body.messages = messages.slice(-8);
  }
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

async function fetchExplanationStream(
  text: string,
  context: string,
  imageBase64: string | undefined,
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
  deepDive = false,
): Promise<string> {
  const account = deepDive ? await getAccount() : null;
  const mode = deepDive ? "language_learning" : await getAppMode();
  const body: Record<string, unknown> = { text, context, image_base64: imageBase64 ?? null, mode };
  if (messages.length > 0) {
    body.messages = messages.slice(-8);
  }
  if (deepDive) {
    body.deep_dive = true;
    body.token = account?.token ?? null;
  }

  const res = await fetch(`${BACKEND_URL}/explain/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429) {
    const data = await res.json().catch(() => ({}));
    if (data.detail === "deep_dive_limit_reached") throw new Error("DEEP_DIVE_LIMIT_REACHED");
  }
  if (!res.ok) await throwResponseError("Backend error", res);
  if (!res.body) return fetchExplanation(text, context, imageBase64, deepDive, messages);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final = "";
  let streamed = "";

  function consumeLine(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line) as { type?: string; text?: string };
    if (event.type === "chunk" && event.text) {
      streamed += event.text;
      onChunk(event.text);
    } else if (event.type === "done") {
      final = event.text ?? streamed;
    } else if (event.type === "error") {
      throw new Error(event.text || "Streaming explanation failed.");
    }
  }

  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(consumeLine);
    }
    if (done) break;
  }

  if (buffer.trim()) consumeLine(buffer);
  return final || streamed;
}

async function getAccount(): Promise<ContextLensUser | null> {
  const storage = await chrome.storage.local.get("contextlens_user");
  return storage.contextlens_user ?? null;
}

function remoteToCapture(remote: RemoteCapture): Capture {
  const imageData = remote.image_data?.startsWith("/")
    ? `${BACKEND_URL}${remote.image_data}`
    : remote.image_data ?? undefined;

  return {
    id: remote.id,
    text: remote.text,
    context: remote.context,
    url: remote.url ?? "",
    title: remote.title ?? "",
    savedAt: remote.saved_at,
    explanation: remote.explanation,
    status: "done",
    imageData,
    fsrsStability: remote.fsrs_stability ?? 0,
    fsrsDifficulty: remote.fsrs_difficulty ?? 5,
    fsrsLapses: remote.fsrs_lapses ?? 0,
    fsrsState: remote.fsrs_state ?? "new",
    fsrsDueAt: remote.fsrs_due_at ?? remote.saved_at,
    fsrsLastReviewedAt: remote.fsrs_last_reviewed_at ?? null,
    fsrsReviewCount: remote.fsrs_review_count ?? 0,
  };
}

function captureToRemotePayload(capture: Capture, token: string) {
  const payload: Record<string, unknown> = {
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
  if (capture.fsrsStability !== undefined) payload.fsrs_stability = capture.fsrsStability;
  if (capture.fsrsDifficulty !== undefined) payload.fsrs_difficulty = capture.fsrsDifficulty;
  if (capture.fsrsLapses !== undefined) payload.fsrs_lapses = capture.fsrsLapses;
  if (capture.fsrsState !== undefined) payload.fsrs_state = capture.fsrsState;
  if (capture.fsrsDueAt !== undefined) payload.fsrs_due_at = capture.fsrsDueAt;
  if (capture.fsrsLastReviewedAt !== undefined) payload.fsrs_last_reviewed_at = capture.fsrsLastReviewedAt;
  if (capture.fsrsReviewCount !== undefined) payload.fsrs_review_count = capture.fsrsReviewCount;
  return payload;
}

async function signUp(email: string, password: string): Promise<ContextLensUser> {
  return authRequest(["/auth/signup"], "Sign up error", email, password);
}

async function signIn(email: string, password: string): Promise<ContextLensUser> {
  return authRequest(["/auth/login", "/auth/signin", "/auth/sign-in"], "Sign in error", email, password);
}

async function authRequest(paths: string[], label: string, email: string, password: string): Promise<ContextLensUser> {
  let sawNotFound = false;
  for (const path of paths) {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    });
    if (res.status === 404 && paths.length > 1) {
      sawNotFound = true;
      continue;
    }
    if (!res.ok) await throwResponseError(label, res);
    const data = await res.json();
    return storeAccount(data.email, data.token);
  }
  throw new Error(sawNotFound ? `${label}: auth endpoint not found. Please update the backend deployment.` : label);
}

async function storeAccount(email: string, token: string): Promise<ContextLensUser> {
  const account: ContextLensUser = { email, token };
  await chrome.storage.local.set({ contextlens_user: account });
  void syncCapturesWithRemote(account, { force: true }).catch((error) => {
    console.warn("ContextLens post-login sync skipped", error);
  });
  return account;
}

async function signInOrSignUp(email: string, password: string): Promise<ContextLensUser> {
  try {
    return await signIn(email, password);
  } catch (signInError) {
    try {
      return await signUp(email, password);
    } catch (signUpError) {
      const signupMessage = errorMessage(signUpError);
      if (/cannot be used|deleted|blocked/i.test(signupMessage)) throw signUpError;
      if (/already registered|already exists/i.test(signupMessage)) {
        throw new Error("Wrong password. Try again or reset it.");
      }
      throw signInError;
    }
  }
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
  await markCapturesSynced([capture]);
}

async function saveCaptureRemoteBestEffort(capture: Capture): Promise<void> {
  try {
    await saveCaptureRemote(capture);
  } catch (syncError) {
    console.warn("ContextLens remote save skipped", syncError);
  }
}

async function fetchRemoteCaptures(token: string): Promise<Capture[]> {
  const res = await fetch(`${BACKEND_URL}/captures?token=${encodeURIComponent(token)}`);
  if (!res.ok) await throwResponseError("Sync error", res);
  const remote: RemoteCapture[] = await res.json();
  return remote.map(remoteToCapture);
}

async function syncCapturesWithRemote(accountOverride?: ContextLensUser, options: SyncOptions = {}): Promise<{ synced: number }> {
  const account = accountOverride ?? await getAccount();
  if (!account) return { synced: 0 };

  const storage = await chrome.storage.local.get(["captures", REMOTE_CAPTURE_SIGNATURES_KEY, REMOTE_SYNC_COMPLETED_AT_KEY]);
  const lastSync = Number(storage[REMOTE_SYNC_COMPLETED_AT_KEY] ?? 0);
  if (!options.force && lastSync && Date.now() - lastSync < REMOTE_SYNC_FRESH_MS) {
    return { synced: 0 };
  }

  const localCaptures: Capture[] = storage.captures ?? [];
  const signatures: Record<string, string> = storage[REMOTE_CAPTURE_SIGNATURES_KEY] ?? {};
  const uploadable = localCaptures.filter((capture) => (
    capture.status === "done"
      && signatures[capture.id] !== captureSyncSignature(capture)
  ));
  const uploaded: Capture[] = [];
  await Promise.all(uploadable.map(async (capture) => {
    await saveCaptureRemote(capture);
    uploaded.push(capture);
  }).map((promise) => promise.catch((error) => {
    console.warn("ContextLens remote save skipped", error);
  })));

  const remoteCaptures = await fetchRemoteCaptures(account.token);
  const merged = new Map<string, Capture>();
  remoteCaptures.forEach((capture) => merged.set(capture.id, capture));
  localCaptures.forEach((capture) => {
    if (!merged.has(capture.id)) {
      merged.set(capture.id, capture);
    } else {
      const remote = merged.get(capture.id)!;
      // Local base64 (data: prefix) never expires — always prefer it over presigned URLs
      const imageData = capture.imageData?.startsWith("data:")
        ? capture.imageData
        : (remote.imageData ?? capture.imageData);
      merged.set(capture.id, { ...remote, imageData });
    }
  });
  const captures = Array.from(merged.values()).sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  const nextSignatures = { ...signatures };
  [...remoteCaptures, ...uploaded].forEach((capture) => {
    nextSignatures[capture.id] = captureSyncSignature(capture);
  });
  Object.keys(nextSignatures).forEach((id) => {
    if (!merged.has(id)) delete nextSignatures[id];
  });
  await chrome.storage.local.set({
    captures,
    [REMOTE_CAPTURE_SIGNATURES_KEY]: nextSignatures,
    [REMOTE_SYNC_COMPLETED_AT_KEY]: Date.now(),
  });
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
  const storage = await chrome.storage.local.get(REMOTE_CAPTURE_SIGNATURES_KEY);
  const signatures: Record<string, string> = storage[REMOTE_CAPTURE_SIGNATURES_KEY] ?? {};
  ids.forEach((id) => delete signatures[id]);
  await chrome.storage.local.set({ [REMOTE_CAPTURE_SIGNATURES_KEY]: signatures });
  return await res.json();
}

async function reviewFlashcardsRemote(ids: string[], rating: "again" | "hard" | "good" | "easy"): Promise<{ captures: Capture[] }> {
  const account = await getAccount();
  if (!account || ids.length === 0) return { captures: [] };

  const res = await fetch(`${BACKEND_URL}/captures/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: account.token, ids, rating }),
  });
  if (!res.ok) await throwResponseError("Review sync error", res);
  const remote: RemoteCapture[] = await res.json();
  const captures = remote.map(remoteToCapture);
  await markCapturesSynced(captures);
  return { captures };
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

async function waitForCaptureResult(captureId: string): Promise<{ captureId: string; explanation: string }> {
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const storage = await chrome.storage.local.get("captures");
    const captures: Capture[] = storage.captures ?? [];
    const capture = captures.find((candidate) => candidate.id === captureId);
    if (!capture) break;
    if (capture.status === "done" && capture.explanation) return { captureId, explanation: capture.explanation };
    if (capture.status === "error") throw new Error(capture.errorMessage || "The earlier save failed.");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { captureId, explanation: "Already saved a moment ago. The first answer is still being prepared." };
}

function captureHasAttachedData(capture: Capture, setCaptureIds: Set<string>, deepDiveIds: Set<string>): number {
  let score = 0;
  if (capture.explanation) score += 3;
  if (capture.status === "done") score += 1;
  if (setCaptureIds.has(capture.id)) score += 3;
  if (deepDiveIds.has(capture.id)) score += 2;
  return score;
}

function chooseMergeBase(existing: Capture, incoming: Capture, setCaptureIds: Set<string>, deepDiveIds: Set<string>): Capture {
  const existingScore = captureHasAttachedData(existing, setCaptureIds, deepDiveIds);
  const incomingScore = captureHasAttachedData(incoming, setCaptureIds, deepDiveIds);
  if (existingScore !== incomingScore) return existingScore > incomingScore ? existing : incoming;
  return normalizeTextForDuplicate(incoming.text).length > normalizeTextForDuplicate(existing.text).length ? incoming : existing;
}

async function saveMergedHighlight(existingId: string, incoming: Capture): Promise<{ captureId: string; explanation: string }> {
  const storage = await chrome.storage.local.get(["captures", "flashcard_sets", DEEP_DIVE_CAPTURE_IDS_KEY, `chat_${existingId}`]);
  const captures: Capture[] = storage.captures ?? [];
  const idx = captures.findIndex((capture) => capture.id === existingId);
  if (idx === -1) {
    await addCapture(incoming);
    return explainPendingHighlight(incoming);
  }

  const sets = Array.isArray(storage.flashcard_sets) ? storage.flashcard_sets : [];
  const setCaptureIds = new Set<string>();
  sets.forEach((set: { captureIds?: unknown }) => {
    if (Array.isArray(set.captureIds)) {
      set.captureIds.forEach((id) => { if (typeof id === "string") setCaptureIds.add(id); });
    }
  });
  const deepDiveIds = new Set<string>(storage[DEEP_DIVE_CAPTURE_IDS_KEY] ?? []);
  const existing = captures[idx];
  const base = chooseMergeBase(existing, incoming, setCaptureIds, deepDiveIds);
  const earliestSavedAt = new Date(existing.savedAt) <= new Date(incoming.savedAt) ? existing.savedAt : incoming.savedAt;
  const merged: Capture = {
    ...base,
    id: existing.id,
    savedAt: earliestSavedAt,
    context: base.context || incoming.context || existing.context,
    title: base.title || incoming.title || existing.title,
    url: base.url || incoming.url || existing.url,
  };

  if (base.id === incoming.id && !incoming.explanation) {
    merged.explanation = null;
    merged.status = "pending";
    delete merged.errorMessage;
  }

  captures[idx] = merged;
  await chrome.storage.local.set({ captures });

  if (merged.status === "done" && merged.explanation) {
    void saveCaptureRemoteBestEffort(merged);
    await seedChat(existing.id, merged.explanation);
    return { captureId: existing.id, explanation: merged.explanation };
  }

  return explainPendingHighlight(merged);
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

async function createPendingScreenshot(imageData: string, context: string, captureId?: string): Promise<string> {
  const id = captureId ?? crypto.randomUUID();

  if (captureId) {
    const existing = await updateCapture(captureId, {
      text: "[Screenshot]",
      context,
      url: "",
      title: "Screenshot",
      explanation: null,
      status: "pending",
      errorMessage: undefined,
      imageData,
    });
    if (existing) return captureId;
  }

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

function latestAssistantContent(messages: ChatMessage[]): string | null {
  for (const message of [...messages].reverse()) {
    if (message.role === "assistant" && message.content.trim()) return message.content;
  }
  return null;
}

async function restoreCaptureFromFallback(captureId: string, fallback: CaptureFallback, messages: ChatMessage[]): Promise<Capture | undefined> {
  const text = fallback.imageData ? "[Screenshot]" : fallback.text?.trim();
  if (!text && !fallback.imageData) return undefined;

  const capture: Capture = {
    id: captureId,
    text: text || "[Saved item]",
    context: fallback.context?.trim() ?? "",
    url: fallback.url ?? "",
    title: fallback.title ?? "",
    savedAt: new Date().toISOString(),
    explanation: latestAssistantContent(messages),
    status: "done",
    imageData: fallback.imageData,
  };
  await addCapture(capture);
  return capture;
}

async function explainAndSaveScreenshot(imageData: string, context: string, replaceCaptureId?: string): Promise<{ captureId: string; explanation: string }> {
  const id = await createPendingScreenshot(imageData, context, replaceCaptureId);

  try {
    const base64 = imageData.split(",")[1];
    const explanation = await fetchExplanation("", context, base64);
    const capture = await updateCapture(id, { explanation, status: "done", errorMessage: undefined });
    if (capture) {
      await saveCaptureRemoteBestEffort(capture);
    }
    await seedChat(id, explanation);
    return { captureId: id, explanation };
  } catch (error) {
    console.error("ContextLens failed to explain screenshot", error);
    await updateCapture(id, { status: "error", errorMessage: errorMessage(error) });
    throw error;
  }
}

async function explainAndSaveScreenshotStream(
  imageData: string,
  context: string,
  onStart: (captureId: string) => void,
  onChunk: (chunk: string) => void,
): Promise<{ captureId: string; explanation: string }> {
  const id = await createPendingScreenshot(imageData, context);
  onStart(id);

  try {
    const base64 = imageData.split(",")[1];
    const explanation = await fetchExplanationStream("", context, base64, [], onChunk);
    const capture = await updateCapture(id, { explanation, status: "done", errorMessage: undefined });
    if (capture) {
      await saveCaptureRemoteBestEffort(capture);
    }
    await seedChat(id, explanation);
    return { captureId: id, explanation };
  } catch (error) {
    console.error("ContextLens failed to stream screenshot explanation", error);
    await updateCapture(id, { status: "error", errorMessage: errorMessage(error) });
    throw error;
  }
}

async function saveScreenshot(imageData: string, context: string) {
  await explainAndSaveScreenshot(imageData, context).catch(() => {});
}

async function askFollowup(captureId: string, question: string, _deepDiveRequested = false, fallback: CaptureFallback = {}): Promise<{ reply: string; messages: ChatMessage[] }> {
  const key = `chat_${captureId}`;
  const storage = await chrome.storage.local.get(["captures", key]);
  const captures: Capture[] = storage.captures ?? [];
  let capture = captures.find((c) => c.id === captureId);

  const prior: ChatMessage[] = storage[key] ?? (capture?.explanation ? [{ role: "assistant", content: capture.explanation }] : []);
  if (!capture) capture = await restoreCaptureFromFallback(captureId, fallback, prior);
  if (!capture && prior.length === 0) throw new Error("Saved item not found.");

  const updated: ChatMessage[] = [...prior, { role: "user", content: question }];
  const fallbackImageBase64 = fallback.imageData?.split(",")[1];
  const imageBase64 = capture?.imageData?.split(",")[1] ?? fallbackImageBase64;
  const reply = await fetchExplanation(
    capture?.imageData ? "" : capture?.text ?? fallback.text ?? "",
    capture?.context ?? fallback.context ?? "",
    imageBase64,
    false,
    updated,
  );
  const messages: ChatMessage[] = [...updated, { role: "assistant", content: reply }];
  await chrome.storage.local.set({ [key]: messages });
  return { reply, messages };
}

async function askFollowupStream(
  captureId: string,
  question: string,
  _deepDiveRequested = false,
  fallback: CaptureFallback = {},
  onChunk: (chunk: string) => void,
): Promise<{ reply: string; messages: ChatMessage[] }> {
  const key = `chat_${captureId}`;
  const storage = await chrome.storage.local.get(["captures", key]);
  const captures: Capture[] = storage.captures ?? [];
  let capture = captures.find((c) => c.id === captureId);

  const prior: ChatMessage[] = storage[key] ?? (capture?.explanation ? [{ role: "assistant", content: capture.explanation }] : []);
  if (!capture) capture = await restoreCaptureFromFallback(captureId, fallback, prior);
  if (!capture && prior.length === 0) throw new Error("Saved item not found.");

  const updated: ChatMessage[] = [...prior, { role: "user", content: question }];
  const fallbackImageBase64 = fallback.imageData?.split(",")[1];
  const imageBase64 = capture?.imageData?.split(",")[1] ?? fallbackImageBase64;
  const reply = await fetchExplanationStream(
    capture?.imageData ? "" : capture?.text ?? fallback.text ?? "",
    capture?.context ?? fallback.context ?? "",
    imageBase64,
    updated,
    onChunk,
  );

  const messages: ChatMessage[] = [...updated, { role: "assistant", content: reply }];
  await chrome.storage.local.set({ [key]: messages });
  return { reply, messages };
}

async function retryCapture(captureId: string): Promise<{ captureId: string; explanation: string }> {
  const storage = await chrome.storage.local.get("captures");
  const captures: Capture[] = storage.captures ?? [];
  const capture = captures.find((c) => c.id === captureId);
  if (!capture) throw new Error("Saved item not found.");

  await updateCapture(captureId, { status: "pending", errorMessage: undefined });

  try {
    const imageBase64 = capture.imageData?.split(",")[1];
    const explanation = await fetchExplanation(capture.imageData ? "" : capture.text, capture.context, imageBase64);
    const updated = await updateCapture(captureId, { explanation, status: "done", errorMessage: undefined });
    if (updated) {
      if (updated.imageData) await saveCaptureRemoteBestEffort(updated);
      else void saveCaptureRemoteBestEffort(updated);
    }
    await seedChat(captureId, explanation);
    return { captureId, explanation };
  } catch (error) {
    console.error("ContextLens failed to retry capture", error);
    await updateCapture(captureId, { status: "error", errorMessage: errorMessage(error) });
    throw error;
  }
}

async function deepDive(captureId: string, fallback: CaptureFallback = {}): Promise<{ explanation: string; messages: ChatMessage[] }> {
  const storage = await chrome.storage.local.get(["captures", `chat_${captureId}`]);
  const captures: Capture[] = storage.captures ?? [];
  let capture = captures.find((c) => c.id === captureId);
  const chatKey = `chat_${captureId}`;
  const prior: ChatMessage[] = storage[chatKey] ?? (capture?.explanation ? [{ role: "assistant", content: capture.explanation }] : []);
  if (!capture) capture = await restoreCaptureFromFallback(captureId, fallback, prior);
  if (!capture && prior.length === 0) throw new Error("Saved item not found.");

  const fallbackImageBase64 = fallback.imageData?.split(",")[1];
  const imageBase64 = capture?.imageData?.split(",")[1] ?? fallbackImageBase64;
  const hasFollowup = prior.some((message) => message.role === "user");
  const explanation = await fetchExplanation(
    capture?.imageData ? "" : capture?.text ?? fallback.text ?? "",
    capture?.context ?? fallback.context ?? "",
    imageBase64,
    true,
    hasFollowup || !capture ? prior : [],
  );

  if (capture) await updateCapture(captureId, { explanation, status: "done", errorMessage: undefined });
  await markDeepDiveCapture(captureId);

  const messages: ChatMessage[] = hasFollowup
    ? [...prior, { role: "assistant", content: explanation }]
    : [{ role: "assistant", content: explanation }];
  await chrome.storage.local.set({ [chatKey]: messages });

  return { explanation, messages };
}

async function deepDiveStream(
  captureId: string,
  fallback: CaptureFallback = {},
  onChunk: (chunk: string) => void,
): Promise<{ explanation: string; messages: ChatMessage[] }> {
  const storage = await chrome.storage.local.get(["captures", `chat_${captureId}`]);
  const captures: Capture[] = storage.captures ?? [];
  let capture = captures.find((c) => c.id === captureId);
  const chatKey = `chat_${captureId}`;
  const prior: ChatMessage[] = storage[chatKey] ?? (capture?.explanation ? [{ role: "assistant", content: capture.explanation }] : []);
  if (!capture) capture = await restoreCaptureFromFallback(captureId, fallback, prior);
  if (!capture && prior.length === 0) throw new Error("Saved item not found.");

  const fallbackImageBase64 = fallback.imageData?.split(",")[1];
  const imageBase64 = capture?.imageData?.split(",")[1] ?? fallbackImageBase64;
  const hasFollowup = prior.some((message) => message.role === "user");
  const explanation = await fetchExplanationStream(
    capture?.imageData ? "" : capture?.text ?? fallback.text ?? "",
    capture?.context ?? fallback.context ?? "",
    imageBase64,
    hasFollowup || !capture ? prior : [],
    onChunk,
    true,
  );

  if (capture) await updateCapture(captureId, { explanation, status: "done", errorMessage: undefined });
  await markDeepDiveCapture(captureId);

  const messages: ChatMessage[] = hasFollowup
    ? [...prior, { role: "assistant", content: explanation }]
    : [{ role: "assistant", content: explanation }];
  await chrome.storage.local.set({ [chatKey]: messages });

  return { explanation, messages };
}

async function forgotPassword(email: string): Promise<{ sent: boolean }> {
  const res = await fetch(`${BACKEND_URL}/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
  if (!res.ok) await throwResponseError("Forgot password error", res);
  return res.json();
}

async function resetPassword(email: string, code: string, newPassword: string): Promise<ContextLensUser> {
  const res = await fetch(`${BACKEND_URL}/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase(), code, new_password: newPassword }),
  });
  if (!res.ok) await throwResponseError("Reset password error", res);
  const data = await res.json();
  return storeAccount(data.email, data.token);
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


async function explainPendingHighlight(capture: Capture): Promise<{ captureId: string; explanation: string }> {
  const id = capture.id;
  try {
    const explanation = await fetchExplanation(capture.text, capture.context);
    const updated = await updateCapture(id, { explanation, status: "done", errorMessage: undefined });
    if (updated) {
      void saveCaptureRemoteBestEffort(updated);
    }
    await seedChat(id, explanation);
    return { captureId: id, explanation };
  } catch (error) {
    console.error("ContextLens failed to explain highlight", error);
    await updateCapture(id, { status: "error", errorMessage: errorMessage(error) });
    throw error;
  }
}

async function saveHighlight(text: string, url: string, title: string, context: string, replaceCaptureId?: string): Promise<{ captureId: string; explanation: string }> {
  const storage = await chrome.storage.local.get("captures");
  const captures: Capture[] = storage.captures ?? [];
  const duplicate = replaceCaptureId ? null : findExactRecentDuplicate(captures, text, url);
  if (duplicate) return waitForCaptureResult(duplicate.id);

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

  if (replaceCaptureId) return saveMergedHighlight(replaceCaptureId, capture);

  await addCapture(capture);
  return explainPendingHighlight(capture);
}

async function saveHighlightStream(
  text: string,
  url: string,
  title: string,
  context: string,
  replaceCaptureId: string | undefined,
  onStart: (captureId: string) => void,
  onChunk: (chunk: string) => void,
): Promise<{ captureId: string; explanation: string }> {
  const storage = await chrome.storage.local.get("captures");
  const captures: Capture[] = storage.captures ?? [];
  const duplicate = replaceCaptureId ? null : findExactRecentDuplicate(captures, text, url);
  if (duplicate) {
    onStart(duplicate.id);
    return waitForCaptureResult(duplicate.id);
  }

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

  if (replaceCaptureId) {
    onStart(replaceCaptureId);
    return saveMergedHighlight(replaceCaptureId, capture);
  }

  await addCapture(capture);
  onStart(id);

  try {
    const explanation = await fetchExplanationStream(capture.text, capture.context, undefined, [], onChunk);
    const updated = await updateCapture(id, { explanation, status: "done", errorMessage: undefined });
    if (updated) {
      void saveCaptureRemoteBestEffort(updated);
    }
    await seedChat(id, explanation);
    return { captureId: id, explanation };
  } catch (error) {
    console.error("ContextLens failed to stream highlight explanation", error);
    await updateCapture(id, { status: "error", errorMessage: errorMessage(error) });
    throw error;
  }
}
