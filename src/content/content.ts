import type { ChatMessage, Message } from "../types";

const CONTENT_SCRIPT_VERSION = "2026-05-17-camera-visual-viewport-v1";
const DEFAULT_ACCENT_COLOR = "#2563eb";
type ThemeName = "light" | "dark";
const contextLensGlobal = globalThis as typeof globalThis & {
  __contextLensContentLoaded?: boolean;
  __contextLensContentVersion?: string;
  __contextLensCleanup?: () => void;
};

function normalizeHexColor(value: unknown, fallback = DEFAULT_ACCENT_COLOR): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`;
  return fallback;
}

function rgbTriplet(hex: string): string {
  const color = normalizeHexColor(hex);
  return `${parseInt(color.slice(1, 3), 16)}, ${parseInt(color.slice(3, 5), 16)}, ${parseInt(color.slice(5, 7), 16)}`;
}

function colorWithAlpha(hex: string, alpha: number): string {
  return `rgba(${rgbTriplet(hex)}, ${alpha})`;
}

function textOnColor(hex: string): string {
  const color = normalizeHexColor(hex);
  const red = parseInt(color.slice(1, 3), 16) / 255;
  const green = parseInt(color.slice(3, 5), 16) / 255;
  const blue = parseInt(color.slice(5, 7), 16) / 255;
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.62 ? "#1f2933" : "#fff";
}

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
      0%   { filter: drop-shadow(0 0 0px  rgba(var(--contextlens-accent-rgb, 37, 99, 235), 0));    }
      50%  { filter: drop-shadow(0 0 14px rgba(var(--contextlens-accent-rgb, 37, 99, 235), 0.75)); }
      100% { filter: drop-shadow(0 0 7px  rgba(var(--contextlens-accent-rgb, 37, 99, 235), 0.45)); }
    }
    .cl-deep-dive-glow   { animation: clDeepDiveGlow 1.5s ease-in-out infinite; }
    .cl-deep-dive-active { filter: drop-shadow(0 0 6px rgba(var(--contextlens-accent-rgb, 37, 99, 235), 0.4)); }
  `;
  document.head.appendChild(style);
}

function initContextLensContentScript() {
let widget: HTMLElement | null = null;
let widgetMode: "bubble" | "input" | null = null;
let widgetDeepDiveActive = false;
let appMode: "language_learning" | "student" = "language_learning";
let appearanceTheme: ThemeName = "light";
let accentColor = DEFAULT_ACCENT_COLOR;
let skipNextMouseup = false;
let widgetOutsideHandler: ((event: MouseEvent) => void) | null = null;
let selectionCheckTimer: number | null = null;
let pointerIsDown = false;
let lastSelectionAnchor: { clientX: number; clientY: number; detail: number; timestamp: number } | null = null;
let suppressSaveBubbleUntil = 0;
const SAVE_BUBBLE_DISMISS_SUPPRESS_MS = 700;
const cleanupTasks: Array<() => void> = [];

function isThemeName(value: unknown): value is ThemeName {
  return value === "light" || value === "dark";
}

function applyAppearance(theme: unknown, accent: unknown) {
  appearanceTheme = isThemeName(theme) ? theme : "light";
  accentColor = normalizeHexColor(accent);
  document.documentElement.style.setProperty("--contextlens-accent-rgb", rgbTriplet(accentColor));
}

function uiColors() {
  const dark = appearanceTheme === "dark";
  return {
    panel: dark ? "rgba(30,30,40,0.96)" : "rgba(255,255,255,0.98)",
    panelSoft: dark ? "rgba(30,30,40,0.92)" : "rgba(255,255,255,0.94)",
    border: dark ? "rgba(255,255,255,0.14)" : "rgba(55,53,47,0.16)",
    faintBorder: dark ? "rgba(255,255,255,0.08)" : "rgba(55,53,47,0.09)",
    text: dark ? "#e8e8ef" : "#2f2e2b",
    userText: dark ? "#cbd5e1" : "#504f4a",
    muted: dark ? "#9ca3af" : "#7b7770",
    subtle: dark ? "rgba(255,255,255,0.08)" : "rgba(55,53,47,0.06)",
    shadow: dark ? "0 4px 20px rgba(0,0,0,0.4)" : "0 6px 24px rgba(15,15,15,0.16)",
    accent: accentColor,
    accentSoft: colorWithAlpha(accentColor, 0.16),
    accentBorder: colorWithAlpha(accentColor, 0.38),
    accentText: textOnColor(accentColor),
    error: dark ? "#fecaca" : "#b91c1c",
  };
}

chrome.storage.local.get(["app_mode", "theme", "accent_color"], (r) => {
  appMode = r.app_mode ?? "language_learning";
  applyAppearance(r.theme, r.accent_color);
});

const appearanceStorageHandler = (changes: Record<string, chrome.storage.StorageChange>) => {
  if (changes.app_mode) appMode = changes.app_mode.newValue ?? "language_learning";
  if (changes.theme || changes.accent_color) {
    applyAppearance(
      changes.theme?.newValue ?? appearanceTheme,
      changes.accent_color?.newValue ?? accentColor,
    );
  }
};
chrome.storage.onChanged.addListener(appearanceStorageHandler);
cleanupTasks.push(() => chrome.storage.onChanged.removeListener(appearanceStorageHandler));

// Floating camera button
let cameraBtn: HTMLElement | null = null;
let cameraButtonHoverScale = 1;
let cameraButtonPositionFrame: number | null = null;
const CAMERA_BUTTON_SIZE = 44;
const CAMERA_BUTTON_MARGIN = 18;

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

function appendMarkdownText(container: HTMLElement, text: string) {
  const lines = text.split("\n");
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) container.appendChild(document.createElement("br"));
    line.split(/\*\*(.*?)\*\*/g).forEach((part, partIndex) => {
      if (!part) return;
      if (partIndex % 2 === 1) {
        const strong = document.createElement("strong");
        strong.textContent = part;
        strong.style.fontWeight = "800";
        strong.style.color = "inherit";
        container.appendChild(strong);
      } else {
        container.appendChild(document.createTextNode(part));
      }
    });
  });
}

function updateCameraButtonPosition() {
  cameraButtonPositionFrame = null;
  if (!cameraBtn) return;

  const viewport = window.visualViewport;
  const scale = Math.max(0.1, viewport?.scale ?? 1);
  const visibleLeft = viewport?.offsetLeft ?? 0;
  const visibleTop = viewport?.offsetTop ?? 0;
  const visibleWidth = viewport?.width ?? window.innerWidth;
  const visibleHeight = viewport?.height ?? window.innerHeight;
  const inverseScale = 1 / scale;
  const visibleButtonSize = CAMERA_BUTTON_SIZE * inverseScale * cameraButtonHoverScale;
  const left = Math.max(
    visibleLeft + 4,
    visibleLeft + visibleWidth - visibleButtonSize - CAMERA_BUTTON_MARGIN,
  );
  const top = Math.max(
    visibleTop + 4,
    visibleTop + visibleHeight - visibleButtonSize - CAMERA_BUTTON_MARGIN,
  );

  cameraBtn.style.left = `${Math.round(left)}px`;
  cameraBtn.style.top = `${Math.round(top)}px`;
  cameraBtn.style.transform = `scale(${inverseScale * cameraButtonHoverScale})`;
}

function queueCameraButtonPosition() {
  if (cameraButtonPositionFrame !== null) return;
  cameraButtonPositionFrame = window.requestAnimationFrame(updateCameraButtonPosition);
}

function createCameraButton() {
  if (cameraBtn) return;
  const colors = uiColors();
  cameraBtn = document.createElement("div");
  cameraBtn.title = "Screenshot to explain";
  cameraBtn.textContent = "📷";
  cameraBtn.setAttribute("style", `
    position: fixed;
    left: 0;
    top: 0;
    width: ${CAMERA_BUTTON_SIZE}px;
    height: ${CAMERA_BUTTON_SIZE}px;
    background: ${colors.panel};
    border: 1px solid ${colors.border};
    border-radius: 50%;
    font-size: 20px;
    line-height: ${CAMERA_BUTTON_SIZE}px;
    text-align: center;
    cursor: pointer;
    z-index: 2147483646;
    box-shadow: 0 2px 12px rgba(0,0,0,0.3);
    user-select: none;
    transform-origin: top left;
    transition: transform 0.1s;
  `);
  cameraBtn.addEventListener("mouseenter", () => {
    cameraButtonHoverScale = 1.1;
    queueCameraButtonPosition();
  });
  cameraBtn.addEventListener("mouseleave", () => {
    cameraButtonHoverScale = 1;
    queueCameraButtonPosition();
  });
  cameraBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "TAKE_SCREENSHOT" } as Message);
  });
  appendToPage(cameraBtn);
  queueCameraButtonPosition();
}

function removeCameraButton() {
  if (cameraBtn) { cameraBtn.remove(); cameraBtn = null; }
  cameraButtonHoverScale = 1;
  if (cameraButtonPositionFrame !== null) {
    window.cancelAnimationFrame(cameraButtonPositionFrame);
    cameraButtonPositionFrame = null;
  }
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

const cameraViewportHandler = () => queueCameraButtonPosition();
window.visualViewport?.addEventListener("resize", cameraViewportHandler);
window.visualViewport?.addEventListener("scroll", cameraViewportHandler);
window.addEventListener("resize", cameraViewportHandler);
window.addEventListener("scroll", cameraViewportHandler, true);
window.addEventListener("orientationchange", cameraViewportHandler);
cleanupTasks.push(() => {
  window.visualViewport?.removeEventListener("resize", cameraViewportHandler);
  window.visualViewport?.removeEventListener("scroll", cameraViewportHandler);
  window.removeEventListener("resize", cameraViewportHandler);
  window.removeEventListener("scroll", cameraViewportHandler, true);
  window.removeEventListener("orientationchange", cameraViewportHandler);
});

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
  const colors = uiColors();

  widget = document.createElement("div");
  widget.textContent = "Save";
  widget.setAttribute(
    "style",
    `
    position: fixed;
    left: ${x}px;
    top: ${y - 34}px;
    transform: translate(-50%, 2px);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 52px;
    height: 25px;
    box-sizing: border-box;
    background: ${appearanceTheme === "dark" ? "rgba(38, 39, 52, 0.84)" : "rgba(255,255,255,0.92)"};
    color: ${colors.text};
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 12px;
    line-height: 1;
    font-weight: 650;
    padding: 0 10px;
    border-radius: 999px;
    cursor: pointer;
    z-index: 2147483647;
    box-shadow: ${appearanceTheme === "dark" ? "0 3px 10px rgba(15,15,24,0.16)" : "0 3px 10px rgba(15,15,15,0.10)"};
    user-select: none;
    border: 1px solid ${colors.border};
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
  const colors = uiColors();

  const widgetWidth = panelWidthFor();
  let left = clampLeftToViewport(x - widgetWidth / 2, widgetWidth);
  let top = panelTopFor(y - 110, 132);

  widget = document.createElement("div");
  widget.setAttribute(
    "style",
    `
    position: fixed;
    left: ${left}px;
    top: ${top}px;
    background: ${colors.panel};
    border: 1px solid ${colors.border};
    border-radius: 10px;
    box-shadow: ${colors.shadow};
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
    color: ${colors.accent};
    padding: 8px 12px 6px;
    border-bottom: 1px solid ${colors.faintBorder};
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
    color: ${colors.text};
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
    const colors = uiColors();
    const maxHeight = Math.min(560, viewportHeight() - 24);
    widget.setAttribute(
      "style",
      `
      position: fixed;
      left: ${left}px;
      top: ${top}px;
      background: ${colors.panel};
      border: 1px solid ${colors.border};
      border-radius: 10px;
      box-shadow: ${colors.shadow};
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
    const colors = uiColors();
    const status = document.createElement("div");
    status.textContent = "Saving and analyzing…";
    status.setAttribute("style", `color:${colors.text};font-size:16px;line-height:1.6;`);
    widget.replaceChildren(status);
  }

  function renderError(error: string) {
    if (!widget) return;
    styleExpandedWidget();
    const colors = uiColors();
    const message = document.createElement("div");
    message.textContent = error;
    message.setAttribute("style", `color:${colors.error};font-size:16px;line-height:1.6;margin-bottom:12px;`);
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Done";
    closeBtn.setAttribute("style", `background:${colors.accent};color:${colors.accentText};border:none;border-radius:7px;padding:8px 13px;font-size:13px;font-weight:600;cursor:pointer;`);
    closeBtn.addEventListener("click", removeWidget);
    widget.replaceChildren(message, closeBtn);
  }

  function renderConversation(captureId: string, messages: ChatMessage[], loading = false, loadingText = "Thinking…") {
    if (!widget) return;
    styleExpandedWidget();
    const colors = uiColors();
    const listMaxHeight = Math.max(120, Math.min(560, viewportHeight() - 24) - 140);

    // Drag handle
    const dragHandle = document.createElement("div");
    dragHandle.setAttribute("style", `
      cursor: grab;
      height: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: -14px -14px 10px -14px;
      border-bottom: 1px solid ${colors.faintBorder};
      flex-shrink: 0;
      user-select: none;
    `);
    const dragDots = document.createElement("span");
    dragDots.textContent = "···";
    dragDots.setAttribute("style", `color:${colors.muted};font-size:13px;letter-spacing:4px;line-height:1;`);
    dragHandle.appendChild(dragDots);

    dragHandle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startLeft = left;
      const startTop = top;
      dragHandle.style.cursor = "grabbing";

      const onMove = (ev: MouseEvent) => {
        const maxHeight = Math.min(560, viewportHeight() - 24);
        left = Math.max(8, Math.min(viewportWidth() - widgetWidth - 8, startLeft + ev.clientX - startX));
        top = Math.max(8, Math.min(viewportHeight() - maxHeight - 8, startTop + ev.clientY - startY));
        if (widget) { widget.style.left = `${left}px`; widget.style.top = `${top}px`; }
      };
      const onUp = () => {
        dragHandle.style.cursor = "grab";
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("mouseup", onUp, true);
      };
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("mouseup", onUp, true);
    });

    // Original text snippet
    const SOURCE_LIMIT = 120;
    const sourceBlock = document.createElement("div");
    sourceBlock.setAttribute("style", `
      font-size: 12px;
      color: ${colors.muted};
      line-height: 1.5;
      margin-bottom: 10px;
      flex-shrink: 0;
    `);
    if (selectedText.length <= SOURCE_LIMIT) {
      sourceBlock.textContent = `"${selectedText}"`;
    } else {
      let srcExpanded = false;
      const textSpan = document.createElement("span");
      textSpan.textContent = `"${selectedText.slice(0, SOURCE_LIMIT)}…"`;
      const toggleBtn = document.createElement("button");
      toggleBtn.textContent = "more";
      toggleBtn.setAttribute("style", `background:none;border:none;color:${colors.accent};font-size:11px;cursor:pointer;padding:0 0 0 4px;font-family:inherit;`);
      toggleBtn.addEventListener("click", () => {
        srcExpanded = !srcExpanded;
        textSpan.textContent = srcExpanded ? `"${selectedText}"` : `"${selectedText.slice(0, SOURCE_LIMIT)}…"`;
        toggleBtn.textContent = srcExpanded ? "less" : "more";
      });
      sourceBlock.appendChild(textSpan);
      sourceBlock.appendChild(toggleBtn);
    }

    const list = document.createElement("div");
    list.setAttribute("style", `max-height:${listMaxHeight}px;overflow-y:auto;padding-right:4px;margin-bottom:12px;`);
    trapScroll(list);

    messages.forEach((message) => {
      const label = document.createElement("div");
      label.textContent = message.role === "assistant" ? "AI" : "You";
      label.setAttribute("style", `color:${colors.muted};font-size:11px;font-weight:700;margin:0 0 4px;`);

      const body = document.createElement("div");
      appendMarkdownText(body, message.content);
      body.setAttribute("style", `
        color: ${message.role === "assistant" ? colors.text : colors.userText};
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
      label.setAttribute("style", `color:${colors.muted};font-size:11px;font-weight:700;margin:0 0 4px;`);
      const body = document.createElement("div");
      body.textContent = loadingText;
      body.setAttribute("style", `color:${widgetDeepDiveActive ? colors.accent : colors.muted};font-size:14px;font-style:italic;line-height:1.65;margin-bottom:12px;`);
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
      border: 1px solid ${colors.border};
      border-radius: 7px;
      color: ${colors.text};
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
      background: ${colors.accent};
      color: ${colors.accentText};
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
      background: ${colors.subtle};
      color: ${colors.text};
      border: 1px solid ${colors.border};
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
    const actionRow = document.createElement("div");
    actionRow.setAttribute("style", `
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    `);
    let analogyBox: HTMLElement | null = null;

    if (appMode === "student" && !loading && messages.length === 1 && messages[0].role === "assistant") {
      if (analogyLoading) {
        const analogyStatus = document.createElement("div");
        analogyStatus.textContent = "Finding an analogy…";
        analogyStatus.setAttribute("style", `color:${colors.muted};font-size:13px;font-style:italic;`);
        actionRow.appendChild(analogyStatus);
      } else if (analogyText) {
        analogyBox = document.createElement("div");
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
          letter-spacing: 0.02em;
        `);
        analogyBtn.addEventListener("click", () => {
          analogyLoading = true;
          renderConversation(captureId, messages, false);
          sendRuntimeMessage<{ analogy: string }>({ type: "ANALOGY", text: messages[0].content })
            .then((response) => { analogyText = response.analogy; analogyLoading = false; renderConversation(captureId, messages, false); })
            .catch(() => { analogyLoading = false; renderConversation(captureId, messages, false); });
        });
        actionRow.appendChild(analogyBtn);
      }
    }

    if (!loading && !widgetDeepDiveActive && messages.length === 1 && messages[0].role === "assistant") {
      const deepDiveBtn = document.createElement("button");
      deepDiveBtn.textContent = "✦ Deep Dive";
      deepDiveBtn.setAttribute("style", `
        background: ${colors.accentSoft};
        color: ${colors.accent};
        border: 1px solid ${colors.accentBorder};
        border-radius: 6px;
        padding: 5px 10px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
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
      actionRow.appendChild(deepDiveBtn);
    }

    if (actionRow.childNodes.length > 0) renderChildren.push(actionRow);
    if (analogyBox) renderChildren.push(analogyBox);

    renderChildren.push(row);
    widget.replaceChildren(dragHandle, sourceBlock, ...renderChildren);
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
        ctx.strokeStyle = colorWithAlpha(accentColor, 0.95);
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
      const colors = uiColors();
      contextPanelWidth = panelWidthFor();
      const maxHeight = Math.min(560, viewportHeight() - 24);
      const top = panelTopFor(contextPanelTop, maxHeight);
      contextPanel.setAttribute("style", `
        position: fixed;
        left: ${contextPanelLeft}px;
        top: ${top}px;
        background: ${colors.panel};
        backdrop-filter: blur(8px);
        border: 1px solid ${colors.border};
        border-radius: 10px;
        padding: 14px;
        width: ${contextPanelWidth}px;
        max-height: ${maxHeight}px;
        box-shadow: ${colors.shadow};
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
      const colors = uiColors();
      const status = document.createElement("div");
      status.textContent = text;
      status.setAttribute("style", `color:${colors.text};font-size:14px;line-height:1.6;`);
      contextPanel.replaceChildren(status);
    }

    function renderErrorPanel(error: string) {
      if (!contextPanel) return;
      styleAnswerPanel();
      const colors = uiColors();
      const message = document.createElement("div");
      message.textContent = error;
      message.setAttribute("style", `color:${colors.error};font-size:14px;line-height:1.6;margin-bottom:12px;`);
      const closeBtn = document.createElement("button");
      closeBtn.textContent = "Close";
      closeBtn.setAttribute("style", `background:${colors.accent};color:${colors.accentText};border:none;border-radius:6px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;`);
      closeBtn.addEventListener("click", removeCropOverlay);
      contextPanel.replaceChildren(message, closeBtn);
    }

    function renderConversationPanel(captureId: string, messages: ChatMessage[], loading = false, loadingText = "Thinking…") {
      if (!contextPanel) return;
      styleAnswerPanel();
      const colors = uiColors();
      const listMaxHeight = Math.max(160, Math.min(560, viewportHeight() - 24) - 92);

      const list = document.createElement("div");
      list.setAttribute("style", `max-height:${listMaxHeight}px;overflow-y:auto;padding-right:4px;margin-bottom:12px;`);
      trapScroll(list);

      messages.forEach((message) => {
        const label = document.createElement("div");
        label.textContent = message.role === "assistant" ? "AI" : "You";
        label.setAttribute("style", `color:${colors.muted};font-size:11px;font-weight:600;margin:0 0 3px;`);

        const body = document.createElement("div");
        appendMarkdownText(body, message.content);
        body.setAttribute("style", `
          color: ${message.role === "assistant" ? colors.text : colors.userText};
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
        label.setAttribute("style", `color:${colors.muted};font-size:11px;font-weight:600;margin:0 0 3px;`);
        const body = document.createElement("div");
        body.textContent = loadingText;
        body.setAttribute("style", `color:${panelDeepDiveActive ? colors.accent : colors.muted};font-size:14px;font-style:italic;line-height:1.65;margin-bottom:12px;`);
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
        border: 1px solid ${colors.border};
        border-radius: 7px;
        color: ${colors.text};
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
        background: ${colors.accent};
        color: ${colors.accentText};
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
        background: ${colors.subtle};
        color: ${colors.text};
        border: 1px solid ${colors.border};
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
      const actionRow = document.createElement("div");
      actionRow.setAttribute("style", `
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 10px;
      `);
      let analogyBox: HTMLElement | null = null;

      if (appMode === "student" && !loading && messages.length === 1 && messages[0].role === "assistant") {
        if (panelAnalogyLoading) {
          const analogyStatus = document.createElement("div");
          analogyStatus.textContent = "Finding an analogy…";
          analogyStatus.setAttribute("style", `color:${colors.muted};font-size:13px;font-style:italic;`);
          actionRow.appendChild(analogyStatus);
        } else if (panelAnalogyText) {
          analogyBox = document.createElement("div");
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
            letter-spacing: 0.02em;
          `);
          analogyBtn.addEventListener("click", () => {
            panelAnalogyLoading = true;
            renderConversationPanel(captureId, messages, false);
            sendRuntimeMessage<{ analogy: string }>({ type: "ANALOGY", text: messages[0].content })
              .then((response) => { panelAnalogyText = response.analogy; panelAnalogyLoading = false; renderConversationPanel(captureId, messages, false); })
              .catch(() => { panelAnalogyLoading = false; renderConversationPanel(captureId, messages, false); });
          });
          actionRow.appendChild(analogyBtn);
        }
      }

      if (!loading && !panelDeepDiveActive && messages.length === 1 && messages[0].role === "assistant") {
        const deepDiveBtn = document.createElement("button");
        deepDiveBtn.textContent = "✦ Deep Dive";
        deepDiveBtn.setAttribute("style", `
          background: ${colors.accentSoft};
          color: ${colors.accent};
          border: 1px solid ${colors.accentBorder};
          border-radius: 6px;
          padding: 5px 10px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
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
        actionRow.appendChild(deepDiveBtn);
      }

      if (actionRow.childNodes.length > 0) panelChildren.push(actionRow);
      if (analogyBox) panelChildren.push(analogyBox);

      panelChildren.push(row);
      contextPanel.replaceChildren(...panelChildren);
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
      const colors = uiColors();

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
        background: ${colors.panelSoft};
        backdrop-filter: blur(8px);
        border: 1px solid ${colors.border};
        border-radius: 10px;
        width: ${contextPanelWidth}px;
        box-shadow: ${colors.shadow};
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
        border-bottom: 1px solid ${colors.faintBorder};
      `);

      const preview = document.createElement("div");
      preview.textContent = "Screenshot";
      preview.setAttribute("style", `
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        color: ${colors.accent};
      `);

      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "Cancel";
      cancelBtn.title = "Cancel screenshot";
      cancelBtn.setAttribute("style", `
        background: transparent;
        color: ${colors.text};
        border: 1px solid ${colors.border};
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
        color: ${colors.text};
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

function editableTextControl(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
  const element = targetElement(target);
  if (!element || isInContextLensUi(element)) return null;

  const editable = element.closest("input, textarea");
  if (editable instanceof HTMLTextAreaElement) return editable;
  if (editable instanceof HTMLInputElement && !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(editable.type)) {
    return editable;
  }
  return null;
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

function selectedEditableControlText(target?: EventTarget | null): { text: string; rect: RectLike } | null {
  const control = editableTextControl(target ?? null) ?? editableTextControl(document.activeElement);
  if (!control) return null;

  const start = control.selectionStart ?? 0;
  const end = control.selectionEnd ?? 0;
  if (start === end) return null;

  const text = control.value.slice(Math.min(start, end), Math.max(start, end)).trim();
  if (!text) return null;

  const rect = control.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1) return null;
  return { text, rect };
}

function selectedPageText(anchor?: SelectionAnchor, target?: EventTarget | null): { text: string; rect: RectLike } | null {
  const selection = window.getSelection();
  const text = selection ? extractSelectionText(selection) : "";

  if (text.length > 0 && selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const rect = rangeAnchorRect(range, anchor);
    if (rect) return { text, rect };
  }

  return selectedEditableControlText(target);
}

function scheduleSelectionCheck(event?: MouseEvent, removeWhenEmpty = false) {
  if (saveBubbleSuppressed()) return;
  if (widgetMode === "input" || isInContextLensUi(event?.target ?? null)) return;
  const recentAnchor = lastSelectionAnchor && performance.now() - lastSelectionAnchor.timestamp < 1000
    ? lastSelectionAnchor
    : null;
  const anchor = event
    ? { clientX: event.clientX, clientY: event.clientY, detail: event.detail }
    : recentAnchor;
  clearSelectionCheckTimer();
  if (saveBubbleSuppressed()) return;
  if (widgetMode === "input") return;
  const selected = selectedPageText(anchor && anchor.detail >= 2 ? anchor : undefined, event?.target ?? null);

  if (selected) {
    const x = fixedViewportX(selected.rect.left + selected.rect.width / 2);
    const y = fixedViewportY(selected.rect.top);

    chrome.storage.local.get("save_triggers", (result) => {
      const triggers = result.save_triggers ?? { bubble: true, contextMenu: true };
      if (triggers.bubble) {
        showSaveBubble(x, y, selected.text);
      }
    });
  } else if (pageHasTypingFocus(event?.target ?? null)) {
    if (widgetMode === "bubble") removeWidget();
  } else if (removeWhenEmpty) {
    const target = event?.target as HTMLElement | undefined;
    if (widget && (!target || !widget.contains(target))) {
      removeWidget();
    }
  }
}

const documentMousedownHandler = (event: MouseEvent) => {
  pointerIsDown = true;
  const target = event.target;
  const clickedWidget = target instanceof Node && Boolean(widget?.contains(target));

  const clickedEditable = isPageEditableTarget(target);
  if (widgetMode === "bubble" && widget && (!clickedWidget || clickedEditable)) {
    removeWidget();
    if (event.detail <= 1 && !clickedEditable) {
      suppressSaveBubble();
    }
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
  scheduleSelectionCheck(event, true);
};
document.addEventListener("mouseup", documentMouseupHandler, true);
cleanupTasks.push(() => document.removeEventListener("mouseup", documentMouseupHandler, true));

const selectionChangeHandler = () => {
  if (pointerIsDown || widgetMode === "input") return;
  if (saveBubbleSuppressed()) return;
  scheduleSelectionCheck(undefined, false);
};
document.addEventListener("selectionchange", selectionChangeHandler);
cleanupTasks.push(() => document.removeEventListener("selectionchange", selectionChangeHandler));

const documentKeydownHandler = (e: KeyboardEvent) => {
  if (widgetMode === "bubble" && pageHasTypingFocus(e.target)) removeWidget();
  if (e.key === "Escape") { removeWidget(); removeCropOverlay(); }
};
document.addEventListener("keydown", documentKeydownHandler);
cleanupTasks.push(() => document.removeEventListener("keydown", documentKeydownHandler));

const documentInputHandler = (event: Event) => {
  if (widgetMode === "bubble" && pageHasTypingFocus(event.target)) removeWidget();
};
document.addEventListener("input", documentInputHandler, true);
cleanupTasks.push(() => document.removeEventListener("input", documentInputHandler, true));

contextLensGlobal.__contextLensCleanup = () => {
  removeWidget();
  removeCropOverlay();
  removeCameraButton();
  while (cleanupTasks.length) cleanupTasks.pop()?.();
};
}
