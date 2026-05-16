import type { ChatMessage, Message } from "../types";

const CONTENT_SCRIPT_VERSION = "2026-05-16-save-chip-dismiss-v1";
const contextLensGlobal = globalThis as typeof globalThis & {
  __contextLensContentLoaded?: boolean;
  __contextLensContentVersion?: string;
  __contextLensCleanup?: () => void;
};

if (contextLensGlobal.__contextLensContentVersion !== CONTENT_SCRIPT_VERSION) {
  contextLensGlobal.__contextLensCleanup?.();
  contextLensGlobal.__contextLensContentLoaded = true;
  contextLensGlobal.__contextLensContentVersion = CONTENT_SCRIPT_VERSION;
  initContextLensContentScript();
}

let deepDiveStylesInjected = false;
function ensureDeepDiveStyles() {
  if (deepDiveStylesInjected) return;
  deepDiveStylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    @keyframes clDeepDiveGlow {
      0%   { filter: drop-shadow(0 0 0px  rgba(99,102,241,0));    }
      50%  { filter: drop-shadow(0 0 14px rgba(99,102,241,0.75)); }
      100% { filter: drop-shadow(0 0 7px  rgba(99,102,241,0.45)); }
    }
    .cl-deep-dive-glow   { animation: clDeepDiveGlow 1.5s ease-in-out infinite; }
    .cl-deep-dive-active { filter: drop-shadow(0 0 6px rgba(99,102,241,0.4)); }
  `;
  document.head.appendChild(style);
}

function initContextLensContentScript() {
let widget: HTMLElement | null = null;
let widgetMode: "bubble" | "input" | null = null;
let widgetDeepDiveActive = false;
let widgetDevModel = "gemini-2.5-flash";
let appMode: "language_learning" | "student" = "language_learning";

chrome.storage.local.get("app_mode", (r) => { appMode = r.app_mode ?? "language_learning"; });
chrome.storage.onChanged.addListener((changes) => {
  if (changes.app_mode) appMode = changes.app_mode.newValue ?? "language_learning";
});

const DEV_MODELS_LIST = [
  { label: "Haiku",   key: "haiku" },
  { label: "Sonnet",  key: "sonnet" },
  { label: "Opus",    key: "opus" },
  { label: "GPT 5.5", key: "gpt-5.5" },
  { label: "4o",      key: "gpt-4o" },
  { label: "G3 Pro",  key: "gemini-3-pro" },
  { label: "2.5F",    key: "gemini-2.5-flash" },
  { label: "G3F",     key: "gemini-3-flash" },
] as const;
let skipNextMouseup = false;
let widgetOutsideHandler: ((event: MouseEvent) => void) | null = null;
let selectionCheckTimer: number | null = null;
let pointerIsDown = false;
let lastSelectionAnchor: { clientX: number; clientY: number; detail: number; timestamp: number } | null = null;
let suppressSaveBubbleUntil = 0;
const SAVE_BUBBLE_DELAY_MS = 190;
const SAVE_BUBBLE_DISMISS_SUPPRESS_MS = 700;
const cleanupTasks: Array<() => void> = [];

// Floating camera button
let cameraBtn: HTMLElement | null = null;

function appendToPage(element: HTMLElement) {
  (document.body ?? document.documentElement).appendChild(element);
}

function sendRuntimeMessage<T>(message: Message): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response as T);
    });
  });
}

function getShowAnswerImmediately(callback: (enabled: boolean) => void) {
  chrome.storage.local.get(["answer_immediate", "screenshot_triggers"], (result) => {
    if (result.answer_immediate === undefined && result.screenshot_triggers === undefined) {
      callback(true);
      return;
    }
    callback(Boolean(result.answer_immediate || result.screenshot_triggers?.immediate));
  });
}

function getVisualViewportRect() {
  const viewport = window.visualViewport;
  return {
    left: Math.max(0, Math.floor(viewport?.offsetLeft ?? 0)),
    top: Math.max(0, Math.floor(viewport?.offsetTop ?? 0)),
    width: viewportWidth(),
    height: viewportHeight(),
  };
}

function fixedViewportX(clientX: number) {
  return clientX + (window.visualViewport?.offsetLeft ?? 0);
}

function fixedViewportY(clientY: number) {
  return clientY + (window.visualViewport?.offsetTop ?? 0);
}

function panelTopFor(preferredTop: number, maxHeight: number) {
  const rect = getVisualViewportRect();
  const minTop = rect.top + 8;
  const maxTop = rect.top + Math.max(0, rect.height - maxHeight - 8);
  return Math.max(minTop, Math.min(preferredTop, maxTop));
}

function viewportWidth() {
  return Math.max(1, Math.floor(window.visualViewport?.width ?? window.innerWidth));
}

function viewportHeight() {
  return Math.max(1, Math.floor(window.visualViewport?.height ?? window.innerHeight));
}

function clampLeftToViewport(preferredLeft: number, width: number) {
  const rect = getVisualViewportRect();
  const minLeft = rect.left + 8;
  const maxLeft = rect.left + Math.max(0, rect.width - width - 8);
  return Math.max(minLeft, Math.min(preferredLeft, maxLeft));
}

function panelWidthFor(maxWidth = 560, minWidth = 220) {
  const available = Math.max(1, viewportWidth() - 24);
  return Math.max(Math.min(minWidth, available), Math.min(maxWidth, available));
}

function trapScroll(element: HTMLElement) {
  element.addEventListener("wheel", (event) => {
    const canScroll = element.scrollHeight > element.clientHeight;
    const atTop = element.scrollTop <= 0;
    const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 1;

    if (!canScroll || (event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) {
      event.preventDefault();
    }
    event.stopPropagation();
  }, { passive: false });
}

function autosizeTextarea(textarea: HTMLTextAreaElement, maxHeight = 120) {
  textarea.style.height = "auto";
  const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

function createCameraButton() {
  if (cameraBtn) return;
  cameraBtn = document.createElement("div");
  cameraBtn.title = "Screenshot to explain";
  cameraBtn.textContent = "📷";
  cameraBtn.setAttribute("style", `
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 44px;
    height: 44px;
    background: #1a1a2e;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 50%;
    font-size: 20px;
    line-height: 44px;
    text-align: center;
    cursor: pointer;
    z-index: 2147483646;
    box-shadow: 0 2px 12px rgba(0,0,0,0.3);
    user-select: none;
    transition: transform 0.1s;
  `);
  cameraBtn.addEventListener("mouseenter", () => { cameraBtn!.style.transform = "scale(1.1)"; });
  cameraBtn.addEventListener("mouseleave", () => { cameraBtn!.style.transform = "scale(1)"; });
  cameraBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "TAKE_SCREENSHOT" } as Message);
  });
  appendToPage(cameraBtn);
}

function removeCameraButton() {
  if (cameraBtn) { cameraBtn.remove(); cameraBtn = null; }
}

// Show/hide camera button based on settings
function syncCameraButton() {
  chrome.storage.local.get("screenshot_triggers", (result) => {
    const triggers = result.screenshot_triggers ?? { floatingButton: true, shortcut: true };
    if (triggers.floatingButton) createCameraButton();
    else removeCameraButton();
  });
}

syncCameraButton();

const storageChangeHandler = (changes: Record<string, chrome.storage.StorageChange>) => {
  if (changes.screenshot_triggers) syncCameraButton();
};
chrome.storage.onChanged.addListener(storageChangeHandler);
cleanupTasks.push(() => chrome.storage.onChanged.removeListener(storageChangeHandler));

function removeWidget() {
  if (widgetOutsideHandler) {
    document.removeEventListener("mousedown", widgetOutsideHandler, true);
    widgetOutsideHandler = null;
  }
  if (widget) {
    widget.remove();
    widget = null;
  }
  widgetMode = null;
  widgetDeepDiveActive = false;
}

function showSaveBubble(x: number, y: number, selectedText: string) {
  if (widgetMode === "input") return;
  removeWidget();
  widgetMode = "bubble";

  widget = document.createElement("div");
  widget.textContent = "Save";
  widget.setAttribute(
    "style",
    `
    position: fixed;
    left: ${x}px;
    top: ${y - 48}px;
    transform: translate(-50%, 3px);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 68px;
    height: 30px;
    box-sizing: border-box;
    background: rgba(38, 39, 52, 0.9);
    color: #d8dbe8;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 13px;
    line-height: 1;
    font-weight: 650;
    padding: 0 13px;
    border-radius: 999px;
    cursor: pointer;
    z-index: 2147483647;
    box-shadow: 0 4px 14px rgba(15,15,24,0.18);
    user-select: none;
    border: 1px solid rgba(255,255,255,0.12);
    backdrop-filter: blur(8px);
    opacity: 0;
    transition: opacity 120ms ease, transform 120ms ease, background 120ms ease;
  `
  );

  widget.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    skipNextMouseup = true;
    showContextInput(x, y, selectedText);
  });

  appendToPage(widget);
  requestAnimationFrame(() => {
    if (!widget || widgetMode !== "bubble") return;
    widget.style.opacity = "1";
    widget.style.transform = "translate(-50%, 0)";
  });
}

function showContextInput(x: number, y: number, selectedText: string) {
  removeWidget();
  widgetMode = "input";

  const widgetWidth = panelWidthFor();
  const left = clampLeftToViewport(x - widgetWidth / 2, widgetWidth);
  const top = panelTopFor(y - 110, 132);

  widget = document.createElement("div");
  widget.setAttribute(
    "style",
    `
    position: fixed;
    left: ${left}px;
    top: ${top}px;
    background: #1a1a2e;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    z-index: 2147483647;
    width: ${widgetWidth}px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    overflow: hidden;
  `
  );

  const preview = document.createElement("div");
  const previewText = selectedText.length > 60 ? selectedText.slice(0, 60) + "…" : selectedText;
  preview.textContent = `"${previewText}"`;
  preview.setAttribute(
    "style",
    `
    font-size: 13px;
    color: #6366f1;
    padding: 8px 12px 6px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `
  );

  const input = document.createElement("textarea");
  input.dir = "auto";
  input.rows = 1;
  input.placeholder = "Any specific part of the text you don't understand?";
  input.setAttribute(
    "style",
    `
    display: block;
    width: 100%;
    min-height: 54px;
    max-height: 120px;
    background: transparent;
    border: none;
    outline: none;
    color: #e2e8f0;
    font-size: 18px;
    line-height: 1.4;
    padding: 14px 16px;
    box-sizing: border-box;
    resize: none;
    font-family: inherit;
  `
  );
  autosizeTextarea(input);
  trapScroll(input);

  let submitted = false;
  let analogyText = "";
  let analogyLoading = false;

  function styleExpandedWidget() {
    if (!widget) return;
    const maxHeight = Math.min(560, viewportHeight() - 24);
    const expandedTop = panelTopFor(top, maxHeight);
    widget.setAttribute(
      "style",
      `
      position: fixed;
      left: ${left}px;
      top: ${expandedTop}px;
      background: rgba(30,30,40,0.96);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 10px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      z-index: 2147483647;
      width: ${widgetWidth}px;
      max-height: ${maxHeight}px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      overflow: hidden;
      box-sizing: border-box;
      padding: 14px;
      display: flex;
      flex-direction: column;
    `
    );
  }

  function renderLoading() {
    if (!widget) return;
    styleExpandedWidget();
    const status = document.createElement("div");
    status.textContent = "Saving and analyzing…";
    status.setAttribute("style", "color:#cbd5e1;font-size:16px;line-height:1.6;");
    widget.replaceChildren(status);
  }

  function renderError(error: string) {
    if (!widget) return;
    styleExpandedWidget();
    const message = document.createElement("div");
    message.textContent = error;
    message.setAttribute("style", "color:#fecaca;font-size:16px;line-height:1.6;margin-bottom:12px;");
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Done";
    closeBtn.setAttribute("style", "background:#6366f1;color:#fff;border:none;border-radius:7px;padding:8px 13px;font-size:13px;font-weight:600;cursor:pointer;");
    closeBtn.addEventListener("click", removeWidget);
    widget.replaceChildren(message, closeBtn);
  }

  function renderConversation(captureId: string, messages: ChatMessage[], loading = false, loadingText = "Thinking…") {
    if (!widget) return;
    styleExpandedWidget();
    const listMaxHeight = Math.max(160, Math.min(560, viewportHeight() - 24) - 92);

    const list = document.createElement("div");
    list.setAttribute("style", `max-height:${listMaxHeight}px;overflow-y:auto;padding-right:4px;margin-bottom:12px;`);
    trapScroll(list);

    messages.forEach((message) => {
      const label = document.createElement("div");
      label.textContent = message.role === "assistant" ? "AI" : "You";
      label.setAttribute("style", "color:#94a3b8;font-size:11px;font-weight:700;margin:0 0 4px;");

      const body = document.createElement("div");
      body.textContent = message.content;
      body.setAttribute("style", `
        color: ${message.role === "assistant" ? "#e2e8f0" : "#cbd5e1"};
        font-size: ${message.role === "assistant" ? "16px" : "14px"};
        line-height: 1.65;
        margin-bottom: 12px;
        white-space: pre-wrap;
      `);

      list.appendChild(label);
      list.appendChild(body);
    });

    if (loading) {
      const label = document.createElement("div");
      label.textContent = "AI";
      label.setAttribute("style", "color:#94a3b8;font-size:11px;font-weight:700;margin:0 0 4px;");
      const body = document.createElement("div");
      body.textContent = loadingText;
      body.setAttribute("style", "color:#94a3b8;font-size:14px;font-style:italic;line-height:1.65;margin-bottom:12px;");
      list.appendChild(label);
      list.appendChild(body);
    }

    const followupInput = document.createElement("textarea");
    followupInput.dir = "auto";
    followupInput.rows = 1;
    followupInput.placeholder = "Ask a follow-up…";
    followupInput.disabled = loading;
    followupInput.setAttribute("style", `
      flex: 1;
      min-width: 0;
      min-height: 36px;
      max-height: 120px;
      background: transparent;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 7px;
      color: #e2e8f0;
      font-size: 14px;
      line-height: 1.45;
      outline: none;
      padding: 8px 10px;
      resize: none;
      font-family: inherit;
    `);
    autosizeTextarea(followupInput);
    trapScroll(followupInput);

    const askBtn = document.createElement("button");
    askBtn.textContent = "Ask";
    askBtn.disabled = loading;
    askBtn.setAttribute("style", `
      background: #6366f1;
      color: #fff;
      border: none;
      border-radius: 7px;
      padding: 8px 13px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      opacity: ${loading ? "0.55" : "1"};
    `);

    const doneBtn = document.createElement("button");
    doneBtn.textContent = "Done";
    doneBtn.setAttribute("style", `
      background: rgba(255,255,255,0.08);
      color: #e2e8f0;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 7px;
      padding: 8px 12px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    `);
    doneBtn.addEventListener("click", removeWidget);

    const row = document.createElement("div");
    row.setAttribute("style", "display:flex;gap:8px;align-items:center;");
    row.appendChild(followupInput);
    row.appendChild(askBtn);
    row.appendChild(doneBtn);

    function askFollowup() {
      const question = followupInput.value.trim();
      if (!question || loading) return;
      const nextMessages: ChatMessage[] = [...messages, { role: "user", content: question }];
      renderConversation(captureId, nextMessages, true, widgetDeepDiveActive ? "Thinking through a deeper answer…" : "Thinking…");
      sendRuntimeMessage<{ reply: string; messages: ChatMessage[] }>({ type: "ASK_FOLLOWUP", captureId, question, deepDive: widgetDeepDiveActive })
        .then((response) => renderConversation(captureId, response.messages ?? [...nextMessages, { role: "assistant", content: response.reply }]))
        .catch((error) => renderConversation(captureId, [...nextMessages, { role: "assistant", content: error.message }]));
    }

    followupInput.addEventListener("input", () => autosizeTextarea(followupInput));
    followupInput.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        askFollowup();
      }
      if (event.key === "Escape") removeWidget();
    });
    askBtn.addEventListener("click", askFollowup);

    const renderChildren: Node[] = [list];

    if (!loading && !widgetDeepDiveActive && messages.length === 1 && messages[0].role === "assistant") {
      const deepDiveBtn = document.createElement("button");
      deepDiveBtn.textContent = "✦ Deep Dive";
      deepDiveBtn.setAttribute("style", `
        align-self: flex-end;
        background: transparent;
        color: #818cf8;
        border: 1px solid rgba(99,102,241,0.4);
        border-radius: 6px;
        padding: 5px 10px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        margin-bottom: 10px;
        letter-spacing: 0.02em;
      `);
      deepDiveBtn.addEventListener("click", () => {
        widgetDeepDiveActive = true;
        ensureDeepDiveStyles();
        renderConversation(captureId, messages, true, "Thinking through a deeper answer…");
        widget?.classList.add("cl-deep-dive-glow");
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Deep Dive timed out. Please try again.")), 90_000)
        );
        Promise.race([
          sendRuntimeMessage<{ explanation: string; messages: ChatMessage[] }>({ type: "DEEP_DIVE", captureId }),
          timeout,
        ])
          .then((response) => {
            widget?.classList.remove("cl-deep-dive-glow");
            widget?.classList.add("cl-deep-dive-active");
            renderConversation(captureId, response.messages ?? [{ role: "assistant", content: response.explanation }]);
          })
          .catch((error: Error) => {
            widget?.classList.remove("cl-deep-dive-glow");
            widgetDeepDiveActive = false;
            if (error.message === "DEEP_DIVE_LIMIT_REACHED") {
              renderConversation(captureId, [...messages, {
                role: "assistant" as const,
                content: "Deep Dive is in beta — you've used all your free sessions. We'll open up more as we grow. Thanks for being an early explorer.",
              }]);
            } else {
              renderConversation(captureId, messages);
            }
          });
      });
      renderChildren.push(deepDiveBtn);
    }

    if (appMode === "student" && !loading && messages.length === 1 && messages[0].role === "assistant") {
      if (analogyLoading) {
        const analogyStatus = document.createElement("div");
        analogyStatus.textContent = "Finding an analogy…";
        analogyStatus.setAttribute("style", "color:#94a3b8;font-size:13px;font-style:italic;margin-bottom:10px;align-self:flex-start;");
        renderChildren.push(analogyStatus);
      } else if (analogyText) {
        const analogyBox = document.createElement("div");
        analogyBox.textContent = analogyText;
        analogyBox.setAttribute("style", `
          background: rgba(251,191,36,0.08);
          border: 1px solid rgba(251,191,36,0.2);
          border-radius: 7px;
          color: #fbbf24;
          font-size: 14px;
          line-height: 1.6;
          padding: 9px 11px;
          margin-bottom: 10px;
        `);
        renderChildren.push(analogyBox);
      } else {
        const analogyBtn = document.createElement("button");
        analogyBtn.textContent = "💡 Analogy";
        analogyBtn.setAttribute("style", `
          align-self: flex-start;
          background: transparent;
          color: #fbbf24;
          border: 1px solid rgba(251,191,36,0.35);
          border-radius: 6px;
          padding: 5px 10px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          margin-bottom: 10px;
          letter-spacing: 0.02em;
        `);
        analogyBtn.addEventListener("click", () => {
          analogyLoading = true;
          renderConversation(captureId, messages, false);
          sendRuntimeMessage<{ analogy: string }>({ type: "ANALOGY", text: messages[0].content, model: widgetDevModel })
            .then((response) => { analogyText = response.analogy; analogyLoading = false; renderConversation(captureId, messages, false); })
            .catch(() => { analogyLoading = false; renderConversation(captureId, messages, false); });
        });
        renderChildren.push(analogyBtn);
      }
    }

    if (!loading && messages.length === 1 && messages[0].role === "assistant") {
      const devRow = document.createElement("div");
      devRow.setAttribute("style", `
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 5px;
        margin-bottom: 10px;
        padding-top: 8px;
        border-top: 1px solid rgba(255,255,255,0.06);
      `);
      const devLabel = document.createElement("span");
      devLabel.textContent = "DEV";
      devLabel.setAttribute("style", "color:#475569;font-size:10px;font-weight:700;letter-spacing:0.08em;margin-right:2px;");
      devRow.appendChild(devLabel);
      DEV_MODELS_LIST.forEach(({ label, key }) => {
        const btn = document.createElement("button");
        btn.textContent = label;
        const isActive = key === widgetDevModel;
        btn.setAttribute("style", `
          background: ${isActive ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.04)"};
          color: ${isActive ? "#a5b4fc" : "#64748b"};
          border: 1px solid ${isActive ? "rgba(99,102,241,0.45)" : "rgba(255,255,255,0.08)"};
          border-radius: 4px;
          padding: 3px 7px;
          font-size: 11px;
          font-weight: 600;
          cursor: ${isActive ? "default" : "pointer"};
          font-family: inherit;
        `);
        btn.addEventListener("click", () => {
          if (key === widgetDevModel) return;
          widgetDevModel = key;
          widgetDeepDiveActive = false;
          analogyText = "";
          analogyLoading = false;
          widget?.classList.remove("cl-deep-dive-glow", "cl-deep-dive-active");
          renderConversation(captureId, messages, true, `Testing ${label}…`);
          sendRuntimeMessage<{ explanation: string }>({ type: "DEV_EXPLAIN", captureId, model: key })
            .then((response) => renderConversation(captureId, [{ role: "assistant", content: response.explanation }]))
            .catch((error: Error) => renderConversation(captureId, [{ role: "assistant", content: `[${label} error] ${error.message}` }]));
        });
        devRow.appendChild(btn);
      });
      renderChildren.push(devRow);
    }

    renderChildren.push(row);
    widget.replaceChildren(...renderChildren);
    list.scrollTop = list.scrollHeight;
    setTimeout(() => followupInput.focus(), 50);
  }

  function doSave(closeAfterSave = false) {
    if (submitted) {
      if (closeAfterSave) removeWidget();
      return;
    }
    submitted = true;
    const context = input.value.trim();
    const message: Message = {
      type: "SAVE_HIGHLIGHT",
      text: selectedText,
      url: location.href,
      title: document.title,
      context,
    };
    window.getSelection()?.removeAllRanges();

    if (closeAfterSave) {
      chrome.runtime.sendMessage(message);
      removeWidget();
      return;
    }

    getShowAnswerImmediately((immediate) => {
      if (!immediate) {
        chrome.runtime.sendMessage(message);
        removeWidget();
        return;
      }

      renderLoading();
      sendRuntimeMessage<{ captureId: string; explanation: string }>(message)
        .then((response) => renderConversation(response.captureId, [{ role: "assistant", content: response.explanation }]))
        .catch((error) => renderError(error.message));
    });
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSave();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      removeWidget();
    }
    e.stopPropagation();
  });
  input.addEventListener("input", () => autosizeTextarea(input));

  widget.appendChild(preview);
  widget.appendChild(input);
  appendToPage(widget);

  setTimeout(() => {
    input.focus();
    widgetOutsideHandler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!widget || widget.contains(target)) return;
      doSave(true);
    };
    document.addEventListener("mousedown", widgetOutsideHandler, true);
  }, 50);
}

// Crop overlay state
let cropOverlay: HTMLElement | null = null;
type CropOverlayElement = HTMLElement & { __contextLensCleanup?: () => void };

function lockPageScroll() {
  const elements = [document.documentElement, document.body].filter((element): element is HTMLElement => Boolean(element));
  const snapshots = elements.map((element) => ({
    element,
    overflowX: element.style.overflowX,
    overflowY: element.style.overflowY,
    overscrollBehaviorX: element.style.overscrollBehaviorX,
    overscrollBehaviorY: element.style.overscrollBehaviorY,
  }));

  elements.forEach((element) => {
    element.style.overflowX = "hidden";
    element.style.overflowY = "hidden";
    element.style.overscrollBehaviorX = "none";
    element.style.overscrollBehaviorY = "none";
  });

  return () => {
    snapshots.forEach(({ element, overflowX, overflowY, overscrollBehaviorX, overscrollBehaviorY }) => {
      element.style.overflowX = overflowX;
      element.style.overflowY = overflowY;
      element.style.overscrollBehaviorX = overscrollBehaviorX;
      element.style.overscrollBehaviorY = overscrollBehaviorY;
    });
  };
}

function removeCropOverlay() {
  (cropOverlay as CropOverlayElement | null)?.__contextLensCleanup?.();
  if (cropOverlay) { cropOverlay.remove(); cropOverlay = null; }
  if (cameraBtn) cameraBtn.style.display = "";
}

function showCropOverlay(screenshotDataUrl: string) {
  removeCropOverlay();
  if (cameraBtn) cameraBtn.style.display = "none";

  cropOverlay = document.createElement("div");
  cropOverlay.setAttribute("style", `
    position: fixed;
    left: 0;
    top: 0;
    width: ${viewportWidth()}px;
    height: ${viewportHeight()}px;
    z-index: 2147483647;
    cursor: crosshair;
    user-select: none;
    overflow: hidden;
    contain: layout style paint;
    box-sizing: border-box;
    direction: ltr;
    text-align: left;
    touch-action: none;
  `);
  const cropCleanupTasks: Array<() => void> = [lockPageScroll()];
  (cropOverlay as CropOverlayElement).__contextLensCleanup = () => {
    while (cropCleanupTasks.length) {
      try {
        cropCleanupTasks.pop()?.();
      } catch {
        // Keep restoring the page even if one cleanup step fails.
      }
    }
  };

  function syncCropOverlayToViewport() {
    if (!cropOverlay) return;
    const rect = getVisualViewportRect();
    cropOverlay.style.left = `${rect.left}px`;
    cropOverlay.style.top = `${rect.top}px`;
    cropOverlay.style.width = `${rect.width}px`;
    cropOverlay.style.height = `${rect.height}px`;
  }

  syncCropOverlayToViewport();
  window.visualViewport?.addEventListener("resize", syncCropOverlayToViewport);
  window.visualViewport?.addEventListener("scroll", syncCropOverlayToViewport);
  window.addEventListener("resize", syncCropOverlayToViewport);
  cropCleanupTasks.push(() => {
    window.visualViewport?.removeEventListener("resize", syncCropOverlayToViewport);
    window.visualViewport?.removeEventListener("scroll", syncCropOverlayToViewport);
    window.removeEventListener("resize", syncCropOverlayToViewport);
  });

  cropOverlay.addEventListener("wheel", (event) => {
    event.preventDefault();
    event.stopPropagation();
  }, { passive: false });
  cropOverlay.addEventListener("touchmove", (event) => {
    event.preventDefault();
    event.stopPropagation();
  }, { passive: false });

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;display:block;box-sizing:border-box;";
  cropOverlay.appendChild(canvas);

  appendToPage(cropOverlay);

  const img = new Image();
  img.onload = () => {
    if (!cropOverlay || !canvas.isConnected) return;
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);

    let dragStart: { x: number; y: number } | null = null;
    let selection: { x: number; y: number; w: number; h: number } | null = null;
    let contextPanel: HTMLElement | null = null;
    let contextPanelOutsideHandler: ((event: MouseEvent) => void) | null = null;
    let contextPanelSubmitted = false;
    let contextPanelLeft = 8;
    let contextPanelTop = 8;
    let contextPanelWidth = panelWidthFor();
    let panelDeepDiveActive = false;
    let panelDevModel = "gemini-2.5-flash";
    let panelAnalogyText = "";
    let panelAnalogyLoading = false;

    function removeContextPanelOutsideHandler() {
      if (!contextPanelOutsideHandler) return;
      document.removeEventListener("mousedown", contextPanelOutsideHandler, true);
      contextPanelOutsideHandler = null;
    }

    function removeContextPanel() {
      removeContextPanelOutsideHandler();
      contextPanel?.remove();
      contextPanel = null;
    }

    function closeContextPanelOnOutsideClick() {
      removeContextPanelOutsideHandler();
      setTimeout(() => {
        contextPanelOutsideHandler = (event: MouseEvent) => {
          const target = event.target as Node;
          if (!contextPanel || contextPanel.contains(target)) return;
          removeCropOverlay();
        };
        document.addEventListener("mousedown", contextPanelOutsideHandler, true);
      }, 0);
    }

    cropCleanupTasks.push(removeContextPanelOutsideHandler);

    function getPos(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height),
      };
    }

    function redraw() {
      ctx.drawImage(img, 0, 0);
      if (selection) {
        ctx.strokeStyle = "rgba(99,102,241,0.95)";
        ctx.lineWidth = 2;
        ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 1;
        ctx.strokeRect(selection.x + 2, selection.y + 2, Math.max(selection.w - 4, 0), Math.max(selection.h - 4, 0));
      }
    }

    function cropSelection(): string | null {
      if (!selection) return null;
      const offscreen = document.createElement("canvas");
      offscreen.width = selection.w;
      offscreen.height = selection.h;
      const offCtx = offscreen.getContext("2d")!;
      offCtx.drawImage(img, selection.x, selection.y, selection.w, selection.h, 0, 0, selection.w, selection.h);
      return offscreen.toDataURL("image/png");
    }

    function styleAnswerPanel() {
      if (!contextPanel) return;
      contextPanelWidth = panelWidthFor();
      const maxHeight = Math.min(560, viewportHeight() - 24);
      const top = panelTopFor(contextPanelTop, maxHeight);
      contextPanel.setAttribute("style", `
        position: fixed;
        left: ${contextPanelLeft}px;
        top: ${top}px;
        background: rgba(30,30,40,0.96);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 10px;
        padding: 14px;
        width: ${contextPanelWidth}px;
        max-height: ${maxHeight}px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        z-index: 2147483647;
        cursor: default;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        direction: ltr;
        text-align: left;
      `);
    }

    function renderLoadingPanel(text = "Analyzing…") {
      if (!contextPanel) return;
      styleAnswerPanel();
      const status = document.createElement("div");
      status.textContent = text;
      status.setAttribute("style", "color:#cbd5e1;font-size:14px;line-height:1.6;");
      contextPanel.replaceChildren(status);
    }

    function renderErrorPanel(error: string) {
      if (!contextPanel) return;
      styleAnswerPanel();
      const message = document.createElement("div");
      message.textContent = error;
      message.setAttribute("style", "color:#fecaca;font-size:14px;line-height:1.6;margin-bottom:12px;");
      const closeBtn = document.createElement("button");
      closeBtn.textContent = "Close";
      closeBtn.setAttribute("style", "background:#6366f1;color:#fff;border:none;border-radius:6px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;");
      closeBtn.addEventListener("click", removeCropOverlay);
      contextPanel.replaceChildren(message, closeBtn);
    }

    function renderConversationPanel(captureId: string, messages: ChatMessage[], loading = false, loadingText = "Thinking…") {
      if (!contextPanel) return;
      styleAnswerPanel();
      const listMaxHeight = Math.max(160, Math.min(560, viewportHeight() - 24) - 92);

      const list = document.createElement("div");
      list.setAttribute("style", `max-height:${listMaxHeight}px;overflow-y:auto;padding-right:4px;margin-bottom:12px;`);
      trapScroll(list);

      messages.forEach((message) => {
        const label = document.createElement("div");
        label.textContent = message.role === "assistant" ? "AI" : "You";
        label.setAttribute("style", "color:#94a3b8;font-size:11px;font-weight:600;margin:0 0 3px;");

        const body = document.createElement("div");
        body.textContent = message.content;
        body.setAttribute("style", `
          color: ${message.role === "assistant" ? "#e2e8f0" : "#cbd5e1"};
          font-size: ${message.role === "assistant" ? "16px" : "14px"};
          line-height: 1.65;
          margin-bottom: 12px;
          white-space: pre-wrap;
        `);

        list.appendChild(label);
        list.appendChild(body);
      });

      if (loading) {
        const label = document.createElement("div");
        label.textContent = "AI";
        label.setAttribute("style", "color:#94a3b8;font-size:11px;font-weight:600;margin:0 0 3px;");
        const body = document.createElement("div");
        body.textContent = loadingText;
        body.setAttribute("style", "color:#94a3b8;font-size:14px;font-style:italic;line-height:1.65;margin-bottom:12px;");
        list.appendChild(label);
        list.appendChild(body);
      }

      const input = document.createElement("textarea");
      input.dir = "auto";
      input.rows = 1;
      input.placeholder = "Ask a follow-up…";
      input.disabled = loading;
      input.setAttribute("style", `
        flex: 1;
        min-width: 0;
        min-height: 36px;
        max-height: 120px;
        background: transparent;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 7px;
        color: #e2e8f0;
        font-size: 14px;
        line-height: 1.45;
        outline: none;
        padding: 8px 10px;
        resize: none;
        font-family: inherit;
      `);
      autosizeTextarea(input);
      trapScroll(input);

      const askBtn = document.createElement("button");
      askBtn.textContent = "Ask";
      askBtn.disabled = loading;
      askBtn.setAttribute("style", `
        background: #6366f1;
        color: #fff;
        border: none;
        border-radius: 7px;
        padding: 8px 13px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        opacity: ${loading ? "0.55" : "1"};
      `);

      const closeBtn = document.createElement("button");
      closeBtn.textContent = "Done";
      closeBtn.setAttribute("style", `
        background: rgba(255,255,255,0.08);
        color: #e2e8f0;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 7px;
        padding: 8px 12px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      `);
      closeBtn.addEventListener("click", removeCropOverlay);

      const row = document.createElement("div");
      row.setAttribute("style", "display:flex;gap:8px;align-items:center;");
      row.appendChild(input);
      row.appendChild(askBtn);
      row.appendChild(closeBtn);

      function askFollowup() {
        const question = input.value.trim();
        if (!question || loading) return;
        const nextMessages: ChatMessage[] = [...messages, { role: "user", content: question }];
        renderConversationPanel(captureId, nextMessages, true, panelDeepDiveActive ? "Thinking through a deeper answer…" : "Thinking…");
        sendRuntimeMessage<{ reply: string; messages: ChatMessage[] }>({ type: "ASK_FOLLOWUP", captureId, question, deepDive: panelDeepDiveActive })
          .then((response) => renderConversationPanel(captureId, response.messages ?? [...nextMessages, { role: "assistant", content: response.reply }]))
          .catch((error) => renderConversationPanel(captureId, [...nextMessages, { role: "assistant", content: error.message }]));
      }

      input.addEventListener("input", () => autosizeTextarea(input));
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          askFollowup();
        }
        if (event.key === "Escape") removeCropOverlay();
      });
      askBtn.addEventListener("click", askFollowup);

      const panelChildren: Node[] = [list];

      if (!loading && !panelDeepDiveActive && messages.length === 1 && messages[0].role === "assistant") {
        const deepDiveBtn = document.createElement("button");
        deepDiveBtn.textContent = "✦ Deep Dive";
        deepDiveBtn.setAttribute("style", `
          align-self: flex-end;
          background: transparent;
          color: #818cf8;
          border: 1px solid rgba(99,102,241,0.4);
          border-radius: 6px;
          padding: 5px 10px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          margin-bottom: 10px;
          letter-spacing: 0.02em;
        `);
        deepDiveBtn.addEventListener("click", () => {
          panelDeepDiveActive = true;
          ensureDeepDiveStyles();
          renderConversationPanel(captureId, messages, true, "Thinking through a deeper answer…");
          contextPanel?.classList.add("cl-deep-dive-glow");
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Deep Dive timed out. Please try again.")), 90_000)
          );
          Promise.race([
            sendRuntimeMessage<{ explanation: string; messages: ChatMessage[] }>({ type: "DEEP_DIVE", captureId }),
            timeout,
          ])
            .then((response) => {
              contextPanel?.classList.remove("cl-deep-dive-glow");
              contextPanel?.classList.add("cl-deep-dive-active");
              renderConversationPanel(captureId, response.messages ?? [{ role: "assistant", content: response.explanation }]);
            })
            .catch((error: Error) => {
              contextPanel?.classList.remove("cl-deep-dive-glow");
              panelDeepDiveActive = false;
              if (error.message === "DEEP_DIVE_LIMIT_REACHED") {
                renderConversationPanel(captureId, [...messages, {
                  role: "assistant" as const,
                  content: "Deep Dive is in beta — you've used all your free sessions. We'll open up more as we grow. Thanks for being an early explorer.",
                }]);
              } else {
                renderConversationPanel(captureId, messages);
              }
            });
        });
        panelChildren.push(deepDiveBtn);
      }

      if (appMode === "student" && !loading && messages.length === 1 && messages[0].role === "assistant") {
        if (panelAnalogyLoading) {
          const analogyStatus = document.createElement("div");
          analogyStatus.textContent = "Finding an analogy…";
          analogyStatus.setAttribute("style", "color:#94a3b8;font-size:13px;font-style:italic;margin-bottom:10px;align-self:flex-start;");
          panelChildren.push(analogyStatus);
        } else if (panelAnalogyText) {
          const analogyBox = document.createElement("div");
          analogyBox.textContent = panelAnalogyText;
          analogyBox.setAttribute("style", `
            background: rgba(251,191,36,0.08);
            border: 1px solid rgba(251,191,36,0.2);
            border-radius: 7px;
            color: #fbbf24;
            font-size: 14px;
            line-height: 1.6;
            padding: 9px 11px;
            margin-bottom: 10px;
          `);
          panelChildren.push(analogyBox);
        } else {
          const analogyBtn = document.createElement("button");
          analogyBtn.textContent = "💡 Analogy";
          analogyBtn.setAttribute("style", `
            align-self: flex-start;
            background: transparent;
            color: #fbbf24;
            border: 1px solid rgba(251,191,36,0.35);
            border-radius: 6px;
            padding: 5px 10px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            margin-bottom: 10px;
            letter-spacing: 0.02em;
          `);
          analogyBtn.addEventListener("click", () => {
            panelAnalogyLoading = true;
            renderConversationPanel(captureId, messages, false);
            sendRuntimeMessage<{ analogy: string }>({ type: "ANALOGY", text: messages[0].content, model: panelDevModel })
              .then((response) => { panelAnalogyText = response.analogy; panelAnalogyLoading = false; renderConversationPanel(captureId, messages, false); })
              .catch(() => { panelAnalogyLoading = false; renderConversationPanel(captureId, messages, false); });
          });
          panelChildren.push(analogyBtn);
        }
      }

      if (!loading && messages.length === 1 && messages[0].role === "assistant") {
        const devRow = document.createElement("div");
        devRow.setAttribute("style", `
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 5px;
          margin-bottom: 10px;
          padding-top: 8px;
          border-top: 1px solid rgba(255,255,255,0.06);
        `);
        const devLabel = document.createElement("span");
        devLabel.textContent = "DEV";
        devLabel.setAttribute("style", "color:#475569;font-size:10px;font-weight:700;letter-spacing:0.08em;margin-right:2px;");
        devRow.appendChild(devLabel);
        DEV_MODELS_LIST.forEach(({ label, key }) => {
          const btn = document.createElement("button");
          btn.textContent = label;
          const isActive = key === panelDevModel;
          btn.setAttribute("style", `
            background: ${isActive ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.04)"};
            color: ${isActive ? "#a5b4fc" : "#64748b"};
            border: 1px solid ${isActive ? "rgba(99,102,241,0.45)" : "rgba(255,255,255,0.08)"};
            border-radius: 4px;
            padding: 3px 7px;
            font-size: 11px;
            font-weight: 600;
            cursor: ${isActive ? "default" : "pointer"};
            font-family: inherit;
          `);
          btn.addEventListener("click", () => {
            if (key === panelDevModel) return;
            panelDevModel = key;
            panelDeepDiveActive = false;
            panelAnalogyText = "";
            panelAnalogyLoading = false;
            contextPanel?.classList.remove("cl-deep-dive-glow", "cl-deep-dive-active");
            renderConversationPanel(captureId, messages, true, `Testing ${label}…`);
            sendRuntimeMessage<{ explanation: string }>({ type: "DEV_EXPLAIN", captureId, model: key })
              .then((response) => renderConversationPanel(captureId, [{ role: "assistant", content: response.explanation }]))
              .catch((error: Error) => renderConversationPanel(captureId, [{ role: "assistant", content: `[${label} error] ${error.message}` }]));
          });
          devRow.appendChild(btn);
        });
        panelChildren.push(devRow);
      }

      panelChildren.push(row);
      contextPanel.replaceChildren(...panelChildren);
      list.scrollTop = list.scrollHeight;
      setTimeout(() => input.focus(), 50);
      closeContextPanelOnOutsideClick();
    }

    function cropAndSend(context: string) {
      if (contextPanelSubmitted) return;
      contextPanelSubmitted = true;
      removeContextPanelOutsideHandler();
      const croppedDataUrl = cropSelection();
      if (!croppedDataUrl) return;

      getShowAnswerImmediately((immediate) => {
        if (!immediate) {
          chrome.runtime.sendMessage({ type: "SAVE_SCREENSHOT", imageData: croppedDataUrl, context } as Message);
          removeCropOverlay();
          return;
        }

        renderLoadingPanel();
        sendRuntimeMessage<{ captureId: string; explanation: string }>({ type: "EXPLAIN_SCREENSHOT", imageData: croppedDataUrl, context })
          .then((response) => renderConversationPanel(response.captureId, [{ role: "assistant", content: response.explanation }]))
          .catch((error) => renderErrorPanel(error.message));
      });
    }

    function showContextPanel(sel: { x: number; y: number; w: number; h: number }) {
      removeContextPanel();
      contextPanelSubmitted = false;
      canvas.style.cursor = "default";
      cropOverlay!.style.cursor = "default";
      contextPanelWidth = panelWidthFor();

      // Position panel below the selection; fall back above if no space
      const canvasRect = canvas.getBoundingClientRect();
      const scaleX = canvasRect.width / canvas.width;
      const scaleY = canvasRect.height / canvas.height;

      const visibleViewport = getVisualViewportRect();
      const selBottom = fixedViewportY(canvasRect.top + (sel.y + sel.h) * scaleY);
      const selTop = fixedViewportY(canvasRect.top + sel.y * scaleY);
      const selCenterX = fixedViewportX(canvasRect.left + (sel.x + sel.w / 2) * scaleX);
      const panelH = 154;
      const MARGIN = 10;

      contextPanelLeft = clampLeftToViewport(selCenterX - contextPanelWidth / 2, contextPanelWidth);
      if (selBottom + MARGIN + panelH <= visibleViewport.top + visibleViewport.height - 8) {
        contextPanelTop = selBottom + MARGIN;
      } else if (selTop - MARGIN - panelH >= visibleViewport.top + 8) {
        contextPanelTop = selTop - MARGIN - panelH;
      } else {
        contextPanelTop = panelTopFor(selBottom + MARGIN, panelH);
      }

      contextPanel = document.createElement("div");
      contextPanel.setAttribute("style", `
        position: fixed;
        left: ${contextPanelLeft}px;
        top: ${contextPanelTop}px;
        background: rgba(30,30,40,0.92);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 10px;
        width: ${contextPanelWidth}px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        z-index: 2147483647;
        cursor: default;
        overflow: hidden;
        box-sizing: border-box;
        direction: ltr;
        text-align: left;
      `);

      const header = document.createElement("div");
      header.setAttribute("style", `
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 12px 6px;
        border-bottom: 1px solid rgba(255,255,255,0.06);
      `);

      const preview = document.createElement("div");
      preview.textContent = "Screenshot";
      preview.setAttribute("style", `
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        color: #6366f1;
      `);

      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "Cancel";
      cancelBtn.title = "Cancel screenshot";
      cancelBtn.setAttribute("style", `
        background: transparent;
        color: #cbd5e1;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 6px;
        padding: 6px 10px;
        font-size: 12px;
        line-height: 1;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
        flex-shrink: 0;
      `);

      const input = document.createElement("textarea");
      input.dir = "auto";
      input.rows = 1;
      input.placeholder = "Any specific part of the screenshot you don't understand?";
      input.setAttribute("style", `
        display: block;
        width: 100%;
        min-height: 82px;
        max-height: 120px;
        background: transparent;
        border: none;
        color: #e2e8f0;
        font-size: 18px;
        line-height: 1.4;
        outline: none;
        padding: 22px 32px;
        resize: none;
        font-family: inherit;
        box-sizing: border-box;
      `);
      autosizeTextarea(input);
      trapScroll(input);

      function doSave() {
        cropAndSend(input.value.trim());
      }

      cancelBtn.addEventListener("click", () => {
        removeContextPanelOutsideHandler();
        removeCropOverlay();
      });

      input.addEventListener("input", () => autosizeTextarea(input));
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          doSave();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          removeCropOverlay();
        }
      });

      header.appendChild(preview);
      header.appendChild(cancelBtn);
      contextPanel.appendChild(header);
      contextPanel.appendChild(input);
      cropOverlay!.appendChild(contextPanel);
      contextPanelTop = panelTopFor(contextPanelTop, contextPanel.getBoundingClientRect().height || 154);
      contextPanel.style.top = `${contextPanelTop}px`;

      setTimeout(() => {
        input.focus();
        contextPanelOutsideHandler = (event: MouseEvent) => {
          const target = event.target as Node;
          if (!contextPanel || contextPanel.contains(target)) return;
          doSave();
        };
        document.addEventListener("mousedown", contextPanelOutsideHandler, true);
      }, 50);
    }

    canvas.addEventListener("mousedown", (e) => {
      if (contextPanel) return;
      e.preventDefault();
      dragStart = getPos(e);
      selection = null;
      redraw();
    });

    canvas.addEventListener("mousemove", (e) => {
      if (!dragStart || contextPanel) return;
      const pos = getPos(e);
      selection = {
        x: Math.min(dragStart.x, pos.x),
        y: Math.min(dragStart.y, pos.y),
        w: Math.abs(pos.x - dragStart.x),
        h: Math.abs(pos.y - dragStart.y),
      };
      redraw();
    });

    canvas.addEventListener("mouseup", () => {
      if (!selection || selection.w < 10 || selection.h < 10) { dragStart = null; selection = null; removeCropOverlay(); return; }
      dragStart = null;
      canvas.style.cursor = "default";
      cropOverlay!.style.cursor = "default";
      showContextPanel(selection);
    });
  };
  img.src = screenshotDataUrl;
}

// Listen for context menu trigger from service worker
const runtimeMessageHandler = (message: Message) => {
  if (message.type === "SHOW_CONTEXT_INPUT") {
    const rect = getVisualViewportRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    showContextInput(x, y, message.text);
  }
  if (message.type === "SHOW_CROP_OVERLAY") {
    showCropOverlay(message.imageData);
  }
};
chrome.runtime.onMessage.addListener(runtimeMessageHandler);
cleanupTasks.push(() => chrome.runtime.onMessage.removeListener(runtimeMessageHandler));

// Show Save bubble (or immediate context input) on text selection
type RectLike = Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">;
type SelectionAnchor = { clientX: number; clientY: number };

function isInContextLensUi(target: EventTarget | null) {
  if (!(target instanceof Node)) return false;
  return Boolean(
    (widget && widget.contains(target)) ||
    (cropOverlay && cropOverlay.contains(target)) ||
    (cameraBtn && cameraBtn.contains(target))
  );
}

function targetElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function isPageEditableTarget(target: EventTarget | null) {
  const element = targetElement(target);
  if (!element || isInContextLensUi(element)) return false;

  const editable = element.closest("input, textarea, select, [contenteditable], [role='textbox']");
  if (!editable) return false;

  if (editable instanceof HTMLInputElement) {
    return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(editable.type);
  }

  if (editable instanceof HTMLTextAreaElement || editable instanceof HTMLSelectElement) return true;
  if (editable.getAttribute("role") === "textbox") return true;
  return (editable as HTMLElement).isContentEditable;
}

function pageHasTypingFocus(target?: EventTarget | null) {
  return isPageEditableTarget(target ?? null) || isPageEditableTarget(document.activeElement);
}

function clearSelectionCheckTimer() {
  if (selectionCheckTimer === null) return;
  window.clearTimeout(selectionCheckTimer);
  selectionCheckTimer = null;
}

function suppressSaveBubble(ms = SAVE_BUBBLE_DISMISS_SUPPRESS_MS) {
  suppressSaveBubbleUntil = performance.now() + ms;
  clearSelectionCheckTimer();
}

function saveBubbleSuppressed() {
  return performance.now() < suppressSaveBubbleUntil;
}

function firstUsableRect(rects: DOMRectList | DOMRect[]) {
  return Array.from(rects).find((rect) => rect.width >= 0 && rect.height > 0);
}

function visibleSelectionRects(range: Range) {
  return Array.from(range.getClientRects()).filter((rect) => (
    rect.width > 1 &&
    rect.height > 1 &&
    rect.bottom > 0 &&
    rect.top < viewportHeight() &&
    rect.right > 0 &&
    rect.left < viewportWidth()
  ));
}

function collapsedRangeRect(range: Range, toStart: boolean): RectLike | null {
  const collapsed = range.cloneRange();
  collapsed.collapse(toStart);
  return firstUsableRect(collapsed.getClientRects()) ?? collapsed.getBoundingClientRect();
}

function unionRects(rects: RectLike[]): RectLike {
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function rectDistanceSquared(rect: RectLike, point: SelectionAnchor) {
  const x = Math.max(rect.left, Math.min(point.clientX, rect.right));
  const y = Math.max(rect.top, Math.min(point.clientY, rect.bottom));
  return (point.clientX - x) ** 2 + (point.clientY - y) ** 2;
}

function groupRectsByLine(rects: RectLike[]) {
  const groups: RectLike[][] = [];
  const sortedRects = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);

  sortedRects.forEach((rect) => {
    const group = groups.find((candidate) => {
      const groupRect = unionRects(candidate);
      return Math.abs(rect.top - groupRect.top) <= Math.max(4, rect.height * 0.35, groupRect.height * 0.35);
    });
    if (group) group.push(rect);
    else groups.push([rect]);
  });

  return groups;
}

function rangeAnchorRect(range: Range, anchor?: SelectionAnchor): RectLike | null {
  const rects = visibleSelectionRects(range);
  if (rects.length > 0) {
    const lineGroups = groupRectsByLine(rects);
    if (anchor) {
      const closestLine = lineGroups
        .map((group) => ({ group, rect: unionRects(group) }))
        .sort((a, b) => rectDistanceSquared(a.rect, anchor) - rectDistanceSquared(b.rect, anchor))[0];
      return closestLine ? closestLine.rect : unionRects(rects);
    }
    return unionRects(lineGroups[0] ?? rects);
  }

  const startRect = collapsedRangeRect(range, true);
  const endRect = collapsedRangeRect(range, false);
  const sameLineTolerance = Math.max(8, Math.min(startRect?.height ?? 0, endRect?.height ?? 0) * 0.75);

  if (
    startRect &&
    endRect &&
    Math.abs(startRect.top - endRect.top) <= sameLineTolerance &&
    Math.abs(startRect.left - endRect.left) > 1
  ) {
    const left = Math.min(startRect.left, endRect.left);
    const right = Math.max(startRect.left, endRect.left);
    const top = Math.min(startRect.top, endRect.top);
    const bottom = Math.max(startRect.bottom, endRect.bottom);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  const fallback = range.getBoundingClientRect();
  if (fallback.width > 1 && fallback.height > 1) return fallback;
  return null;
}

function extractSelectionText(selection: Selection): string {
  const raw = selection.toString().trim();
  if (!raw) return "";

  // If text is ONLY tatweel/kashida (ـ) characters plus whitespace, the site is likely
  // using a Quran calligraphy font where a single placeholder character renders as Arabic.
  // Try aria-label attributes on elements within the selection as a fallback.
  if (/^[ـ\s]+$/.test(raw) && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const el = container instanceof Element ? container : container.parentElement;
    if (el) {
      const labels: string[] = [];
      el.querySelectorAll("[aria-label]").forEach((candidate) => {
        if (range.intersectsNode(candidate)) {
          const label = candidate.getAttribute("aria-label");
          if (label?.trim()) labels.push(label.trim());
        }
      });
      if (labels.length > 0) return labels.join(" ");
      // Fall back to the ancestor's own aria-label if nothing inside matched
      let cur: Element | null = el;
      while (cur && cur !== document.body) {
        const label = cur.getAttribute("aria-label") || cur.getAttribute("data-text");
        if (label?.trim()) return label.trim();
        cur = cur.parentElement;
      }
    }
  }

  return raw;
}

function scheduleSelectionCheck(event?: MouseEvent, removeWhenEmpty = false, delay = SAVE_BUBBLE_DELAY_MS) {
  if (saveBubbleSuppressed()) return;
  if (widgetMode === "input" || isInContextLensUi(event?.target ?? null)) return;
  if (pageHasTypingFocus(event?.target ?? null)) {
    if (widgetMode === "bubble") removeWidget();
    return;
  }
  const recentAnchor = lastSelectionAnchor && performance.now() - lastSelectionAnchor.timestamp < 1000
    ? lastSelectionAnchor
    : null;
  const anchor = event
    ? { clientX: event.clientX, clientY: event.clientY, detail: event.detail }
    : recentAnchor;
  clearSelectionCheckTimer();
  selectionCheckTimer = window.setTimeout(() => {
    selectionCheckTimer = null;
    if (saveBubbleSuppressed()) return;
    if (widgetMode === "input") return;
    if (pageHasTypingFocus()) {
      if (widgetMode === "bubble") removeWidget();
      return;
    }
    const selection = window.getSelection();
    const text = selection ? extractSelectionText(selection) : "";

    if (text.length > 0 && selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = rangeAnchorRect(range, anchor && anchor.detail >= 2 ? anchor : undefined);
      if (!rect) return;
      const x = fixedViewportX(rect.left + rect.width / 2);
      const y = fixedViewportY(rect.top);

      chrome.storage.local.get("save_triggers", (result) => {
        const triggers = result.save_triggers ?? { bubble: true, contextMenu: true };
        if (triggers.bubble) {
          showSaveBubble(x, y, text);
        }
      });
    } else if (removeWhenEmpty) {
      const target = event?.target as HTMLElement | undefined;
      if (widget && (!target || !widget.contains(target))) {
        removeWidget();
      }
    }
  }, delay);
}

const documentMousedownHandler = (event: MouseEvent) => {
  pointerIsDown = true;
  const target = event.target;
  const clickedWidget = target instanceof Node && Boolean(widget?.contains(target));

  if (widgetMode === "bubble" && widget && (!clickedWidget || isPageEditableTarget(target))) {
    removeWidget();
    suppressSaveBubble();
  }

  if (!isInContextLensUi(target)) return;
  clearSelectionCheckTimer();
};
document.addEventListener("mousedown", documentMousedownHandler, true);
cleanupTasks.push(() => document.removeEventListener("mousedown", documentMousedownHandler, true));

const documentMouseupHandler = (event: MouseEvent) => {
  pointerIsDown = false;
  lastSelectionAnchor = {
    clientX: event.clientX,
    clientY: event.clientY,
    detail: event.detail,
    timestamp: performance.now(),
  };
  if (skipNextMouseup) { skipNextMouseup = false; return; }
  if (saveBubbleSuppressed()) return;
  scheduleSelectionCheck(event, true, event.detail >= 3 ? SAVE_BUBBLE_DELAY_MS + 40 : SAVE_BUBBLE_DELAY_MS);
};
document.addEventListener("mouseup", documentMouseupHandler, true);
cleanupTasks.push(() => document.removeEventListener("mouseup", documentMouseupHandler, true));

const selectionChangeHandler = () => {
  if (pointerIsDown || widgetMode === "input") return;
  if (saveBubbleSuppressed()) return;
  if (pageHasTypingFocus()) {
    if (widgetMode === "bubble") removeWidget();
    return;
  }
  scheduleSelectionCheck(undefined, false, SAVE_BUBBLE_DELAY_MS + 40);
};
document.addEventListener("selectionchange", selectionChangeHandler);
cleanupTasks.push(() => document.removeEventListener("selectionchange", selectionChangeHandler));

const documentKeydownHandler = (e: KeyboardEvent) => {
  if (widgetMode === "bubble" && pageHasTypingFocus(e.target)) removeWidget();
  if (e.key === "Escape") { removeWidget(); removeCropOverlay(); }
};
document.addEventListener("keydown", documentKeydownHandler);
cleanupTasks.push(() => document.removeEventListener("keydown", documentKeydownHandler));

contextLensGlobal.__contextLensCleanup = () => {
  removeWidget();
  removeCropOverlay();
  removeCameraButton();
  while (cleanupTasks.length) cleanupTasks.pop()?.();
};
}
