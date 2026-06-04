import type { Capture, ChatMessage, Message } from "../types";

const CONTENT_SCRIPT_VERSION = "2026-06-04-calm-stream-v1";
const DEFAULT_ACCENT_COLOR = "#38bdf8";
const LATIN_FONT_STACK = "'Satoshi',ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
const ARABIC_FONT_STACK = "'Noto Naskh Arabic','Noto Sans Arabic',Tahoma,Arial,serif";
const HONORIFIC_MARK = "ﷺ";
const SCREENSHOT_PREVIEW_MAX_WIDTH = 760;
const SCREENSHOT_PREVIEW_MAX_HEIGHT = 520;
const SCREENSHOT_PREVIEW_QUALITY = 0.82;
const DEEP_DIVE_FIRST_PAINT_DELAY_MS = 250;
const DEEP_DIVE_FIRST_PAINT_MIN_CHARS = 140;
type ThemeName = "light" | "dark";
type ScreenshotCrop = { imageData: string; imagePreviewData?: string };
type StreamMessage =
  | { type: "SAVE_HIGHLIGHT_STREAM"; text: string; url: string; title: string; context: string; replaceCaptureId?: string }
  | { type: "EXPLAIN_SCREENSHOT_STREAM"; imageData: string; imagePreviewData?: string; context: string }
  | { type: "ASK_FOLLOWUP_STREAM"; captureId: string; question: string; deepDive?: boolean; fallbackText?: string; fallbackContext?: string; fallbackImageData?: string; fallbackImagePreviewData?: string; fallbackUrl?: string; fallbackTitle?: string }
  | { type: "DEEP_DIVE_STREAM"; captureId: string; fallbackText?: string; fallbackContext?: string; fallbackImageData?: string; fallbackImagePreviewData?: string; fallbackUrl?: string; fallbackTitle?: string };
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

function isAuthRefreshRequiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /sign in again to refresh|invalid token|authentication required|http\s*40[13]|unauthorized/i.test(message);
}

function rgbTriplet(hex: string): string {
  const color = normalizeHexColor(hex);
  return `${parseInt(color.slice(1, 3), 16)}, ${parseInt(color.slice(3, 5), 16)}, ${parseInt(color.slice(5, 7), 16)}`;
}

function colorWithAlpha(hex: string, alpha: number): string {
  return `rgba(${rgbTriplet(hex)}, ${alpha})`;
}

function createScreenshotPreviewData(source: HTMLCanvasElement): string | undefined {
  if (source.width <= 0 || source.height <= 0) return undefined;
  const scale = Math.min(
    1,
    SCREENSHOT_PREVIEW_MAX_WIDTH / source.width,
    SCREENSHOT_PREVIEW_MAX_HEIGHT / source.height,
  );
  const preview = document.createElement("canvas");
  preview.width = Math.max(1, Math.round(source.width * scale));
  preview.height = Math.max(1, Math.round(source.height * scale));
  const ctx = preview.getContext("2d");
  if (!ctx) return undefined;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, preview.width, preview.height);
  try {
    return preview.toDataURL("image/webp", SCREENSHOT_PREVIEW_QUALITY);
  } catch {
    return undefined;
  }
}

function relativeLuminance(hex: string): number {
  const c = normalizeHexColor(hex);
  const lin = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(parseInt(c.slice(1, 3), 16) / 255)
       + 0.7152 * lin(parseInt(c.slice(3, 5), 16) / 255)
       + 0.0722 * lin(parseInt(c.slice(5, 7), 16) / 255);
}

function tooDarkForDarkMode(hex: string): boolean {
  return relativeLuminance(hex) < 0.05;
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

let baseStylesInjected = false;
function ensureBaseStyles() {
  if (baseStylesInjected) return;
  baseStylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    @keyframes clDeepDiveGlow {
      0%   { filter: drop-shadow(0 0 0px  rgba(var(--contextlens-accent-rgb, 37, 99, 235), 0));    }
      50%  { filter: drop-shadow(0 0 14px rgba(var(--contextlens-accent-rgb, 37, 99, 235), 0.75)); }
      100% { filter: drop-shadow(0 0 7px  rgba(var(--contextlens-accent-rgb, 37, 99, 235), 0.45)); }
    }
    .cl-deep-dive-glow   { animation: clDeepDiveGlow 1.5s ease-in-out infinite; }
    .cl-deep-dive-active { filter: drop-shadow(0 0 6px rgba(var(--contextlens-accent-rgb, 37, 99, 235), 0.4)); }
    [data-contextlens-ui]:focus-visible,
    [data-contextlens-ui] :focus-visible {
      outline: 2px solid rgb(var(--contextlens-accent-rgb, 37, 99, 235)) !important;
      outline-offset: 2px !important;
    }
    .cl-scroll {
      scrollbar-width: thin;
      scrollbar-color: rgba(148,163,184,0.55) transparent;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
    }
    .cl-scroll::-webkit-scrollbar              { width: 3px; }
    .cl-scroll::-webkit-scrollbar-track        { background: transparent; }
    .cl-scroll::-webkit-scrollbar-thumb        { background: rgba(148,163,184,0.55); border-radius: 2px; }
    .cl-scroll::-webkit-scrollbar-thumb:hover  { background: rgba(148,163,184,0.72); }
  `;
  document.head.appendChild(style);

  if (!document.querySelector('[data-cl-font]')) {
    fetch("https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap")
      .then((r) => r.text())
      .then((css) => {
        if (document.querySelector("[data-cl-font]")) return;
        const fontStyle = document.createElement("style");
        fontStyle.setAttribute("data-cl-font", "1");
        fontStyle.textContent = css;
        document.head.appendChild(fontStyle);
      })
      .catch(() => {});
  }
}

let deepDiveStylesInjected = false;
function ensureDeepDiveStyles() {
  ensureBaseStyles();
  if (deepDiveStylesInjected) return;
  deepDiveStylesInjected = true;
}

function initContextLensContentScript() {
let widget: HTMLElement | null = null;
let widgetMode: "bubble" | "input" | null = null;
let widgetDeepDiveActive = false;
let activeWidgetStreamSession = 0;
let cardFontSize: "sm" | "md" | "lg" = "md";
let appearanceTheme: ThemeName = "light";
let accentColor = DEFAULT_ACCENT_COLOR;
let skipNextMouseup = false;
let widgetOutsideHandler: ((event: MouseEvent) => void) | null = null;
let selectionCheckTimer: number | null = null;
let pointerIsDown = false;
let lastSelectionAnchor: { clientX: number; clientY: number; detail: number; timestamp: number } | null = null;
let suppressSaveBubbleUntil = 0;

function nextWidgetStreamSession() {
  activeWidgetStreamSession += 1;
  return activeWidgetStreamSession;
}

function isWidgetStreamCurrent(session: number) {
  return activeWidgetStreamSession === session;
}

function invalidateWidgetStream(session: number) {
  if (activeWidgetStreamSession === session) activeWidgetStreamSession += 1;
}
const SAVE_BUBBLE_DISMISS_SUPPRESS_MS = 700;
const cleanupTasks: Array<() => void> = [];

function isThemeName(value: unknown): value is ThemeName {
  return value === "light" || value === "dark";
}

function applyAppearance(theme: unknown, accent: unknown) {
  appearanceTheme = isThemeName(theme) ? theme : "light";
  const resolved = normalizeHexColor(accent);
  accentColor = appearanceTheme === "dark" && tooDarkForDarkMode(resolved) ? DEFAULT_ACCENT_COLOR : resolved;
  document.documentElement.style.setProperty("--contextlens-accent-rgb", rgbTriplet(accentColor));
}

function uiColors() {
  const dark = appearanceTheme === "dark";
  return {
    panel: dark ? "#1a1a1a" : "rgba(255,255,255,0.98)",
    panelSoft: dark ? "#1c1c1c" : "rgba(255,255,255,0.96)",
    border: dark ? "rgba(255,255,255,0.14)" : "rgba(55,53,47,0.16)",
    faintBorder: dark ? "rgba(255,255,255,0.08)" : "rgba(55,53,47,0.09)",
    text: dark ? "#e8e8e8" : "#2f2e2b",
    userText: dark ? "#d7d7d7" : "#504f4a",
    muted: dark ? "#a7a7a7" : "#7b7770",
    subtle: dark ? "rgba(255,255,255,0.08)" : "rgba(55,53,47,0.06)",
    shadow: dark ? "0 4px 20px rgba(0,0,0,0.4)" : "0 6px 24px rgba(15,15,15,0.16)",
    accent: accentColor,
    accentSoft: colorWithAlpha(accentColor, 0.16),
    accentBorder: colorWithAlpha(accentColor, 0.38),
    accentText: textOnColor(accentColor),
    error: dark ? "#fecaca" : "#b91c1c",
  };
}
type UiColors = ReturnType<typeof uiColors>;

function neutralActionColors(colors: UiColors) {
  const dark = appearanceTheme === "dark";
  return {
    background: colors.subtle,
    color: colors.text,
    border: colors.border,
    hoverBackground: dark ? "rgba(255,255,255,0.12)" : "rgba(55,53,47,0.1)",
    hoverBorder: dark ? "rgba(255,255,255,0.24)" : "rgba(55,53,47,0.24)",
  };
}

function analogyActionColors() {
  const dark = appearanceTheme === "dark";
  return {
    text: dark ? "#fbbf24" : "#92400e",
    background: dark ? "rgba(251,191,36,0.08)" : "rgba(146,64,14,0.08)",
    hoverBackground: dark ? "rgba(251,191,36,0.13)" : "rgba(146,64,14,0.12)",
    border: dark ? "rgba(251,191,36,0.24)" : "rgba(146,64,14,0.28)",
    buttonBorder: dark ? "rgba(251,191,36,0.35)" : "rgba(146,64,14,0.4)",
    hoverButtonBorder: dark ? "rgba(251,191,36,0.5)" : "rgba(146,64,14,0.55)",
  };
}

chrome.storage.local.get(["overlay_theme", "accent_color", "card_font_size"], (r) => {
  cardFontSize = r.card_font_size ?? "md";
  applyAppearance(r.overlay_theme ?? "dark", r.accent_color);
});

const appearanceStorageHandler = (changes: Record<string, chrome.storage.StorageChange>) => {
  if (changes.card_font_size) cardFontSize = changes.card_font_size.newValue ?? "md";
  if (changes.overlay_theme || changes.accent_color) {
    applyAppearance(
      changes.overlay_theme?.newValue ?? appearanceTheme,
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
const CAMERA_BUTTON_SELECTOR = '[data-contextlens-ui="true"][title="Screenshot to explain"]';

function appendToPage(element: HTMLElement) {
  element.setAttribute("data-contextlens-ui", "true");
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

const STREAM_DISCONNECTED_MESSAGE = "Explanation stream disconnected.";

function streamRuntimeMessage<T>(
  message: StreamMessage,
  handlers: {
    onStart?: (captureId: string) => void;
    onChunk?: (chunk: string) => void;
  } = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: "contextlens-explain-stream" });
    let settled = false;

    port.onMessage.addListener((event: Record<string, unknown>) => {
      if (event.type === "started" && typeof event.captureId === "string") {
        handlers.onStart?.(event.captureId);
        return;
      }
      if (event.type === "chunk" && typeof event.text === "string") {
        handlers.onChunk?.(event.text);
        return;
      }
      if (event.type === "done") {
        settled = true;
        port.disconnect();
        resolve(event as T);
        return;
      }
      if (event.type === "error") {
        settled = true;
        port.disconnect();
        reject(new Error(typeof event.error === "string" ? event.error : "Streaming explanation failed."));
      }
    });

    port.onDisconnect.addListener(() => {
      if (settled) return;
      settled = true;
      reject(new Error(STREAM_DISCONNECTED_MESSAGE));
    });

    port.postMessage(message);
  });
}

function latestMessageHasAssistantContent(messages: ChatMessage[]) {
  const latest = messages[messages.length - 1];
  return latest?.role === "assistant" && latest.content.trim().length > 0;
}

function deepDiveDisplayMessages(messages: ChatMessage[], assistantContent = ""): ChatMessage[] {
  const userMessages = messages.filter((message) => message.role === "user");
  return assistantContent.trim()
    ? [...userMessages, { role: "assistant", content: assistantContent }]
    : userMessages;
}

function stopUiEventPropagation(event: Event) {
  event.stopPropagation();
}

function isolateContextLensUiEvents(element: HTMLElement) {
  ["mousedown", "mouseup", "click", "dblclick", "pointerdown", "pointerup", "touchstart", "touchend"].forEach((eventName) => {
    element.addEventListener(eventName, stopUiEventPropagation);
  });
}

function actionButtonClick(button: HTMLButtonElement, handler: (event: MouseEvent) => void) {
  button.type = "button";
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    handler(event);
  });
}

type StreamRenderScheduler = ((text: string) => void) & {
  cancel: () => void;
  finish: (afterStreamPaint: () => void) => void;
};

type StreamRenderOptions = {
  firstPaintDelayMs?: number;
  firstPaintMinChars?: number;
};

function createStreamRenderScheduler(render: (text: string) => void, options: StreamRenderOptions = {}): StreamRenderScheduler {
  let frame: number | null = null;
  let finalFrame: number | null = null;
  let finishing: (() => void) | null = null;
  let latestText: string | null = null;
  let hasPainted = false;
  let firstPaintTimer: number | null = null;

  const clearFirstPaintTimer = () => {
    if (firstPaintTimer === null) return;
    window.clearTimeout(firstPaintTimer);
    firstPaintTimer = null;
  };

  const requestPump = (force = false) => {
    const delayMs = options.firstPaintDelayMs ?? 0;
    const minChars = options.firstPaintMinChars ?? 0;
    if (!force && !hasPainted && delayMs > 0 && (latestText?.length ?? 0) < minChars) {
      if (firstPaintTimer === null) {
        firstPaintTimer = window.setTimeout(() => {
          firstPaintTimer = null;
          requestPump(true);
        }, delayMs);
      }
      return;
    }

    clearFirstPaintTimer();
    if (frame !== null) return;
    frame = requestAnimationFrame(pump);
  };

  const pump = () => {
    frame = null;
    const next = latestText;
    latestText = null;
    if (next !== null) {
      hasPainted = true;
      render(next);
    }

    if (latestText !== null) {
      requestPump();
      return;
    }

    const finish = finishing;
    finishing = null;
    if (finish) {
      finalFrame = requestAnimationFrame(() => {
        finalFrame = null;
        finish();
      });
    }
  };

  const schedule = ((text: string) => {
    if (latestText === text) return;
    latestText = text;
    requestPump();
  }) as StreamRenderScheduler;

  schedule.cancel = () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    if (finalFrame !== null) {
      cancelAnimationFrame(finalFrame);
      finalFrame = null;
    }
    clearFirstPaintTimer();
    latestText = null;
    finishing = null;
  };

  schedule.finish = (afterStreamPaint) => {
    finishing = afterStreamPaint;
    if (latestText !== null || frame !== null) {
      requestPump(true);
      return;
    }

    finishing = null;
    afterStreamPaint();
  };

  return schedule;
}

function appendMessageBody(container: HTMLElement, message: ChatMessage, index: number, messages: ChatMessage[], loading: boolean) {
  const isStreamingAssistant = loading && message.role === "assistant" && index === messages.length - 1;
  if (isStreamingAssistant) {
    appendBidiText(container, message.content);
    return;
  }

  appendMarkdownText(container, message.content, index === 0, false);
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

function expandedPanelMaxHeight(limit = 560) {
  return Math.max(96, Math.min(limit, viewportHeight() - 24));
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

function overlayPositionAwayFromRect(
  target: { left: number; top: number; right: number; bottom: number; width: number; height: number },
  width: number,
  height: number,
  fallbackX: number,
  fallbackY: number,
) {
  const viewport = getVisualViewportRect();
  const gap = 14;
  const left = fixedViewportX(target.left);
  const right = fixedViewportX(target.right);
  const top = fixedViewportY(target.top);
  const bottom = fixedViewportY(target.bottom);
  const centerY = top + target.height / 2;
  const centerX = left + target.width / 2;

  if (viewport.left + viewport.width - right >= width + gap + 8) {
    return { left: clampLeftToViewport(right + gap, width), top: panelTopFor(centerY - height / 2, height) };
  }
  if (left - viewport.left >= width + gap + 8) {
    return { left: clampLeftToViewport(left - width - gap, width), top: panelTopFor(centerY - height / 2, height) };
  }
  if (viewport.top + viewport.height - bottom >= height + gap + 8) {
    return { left: clampLeftToViewport(centerX - width / 2, width), top: panelTopFor(bottom + gap, height) };
  }
  if (top - viewport.top >= height + gap + 8) {
    return { left: clampLeftToViewport(centerX - width / 2, width), top: panelTopFor(top - height - gap, height) };
  }

  return {
    left: clampLeftToViewport(fallbackX - width / 2, width),
    top: panelTopFor(fallbackY - height - gap, height),
  };
}

type DragBounds = { left: number; top: number; width: number; height: number };

function elementDragState(element: HTMLElement, fallback: { left: number; top: number }) {
  const styleLeft = Number.parseFloat(element.style.left);
  const styleTop = Number.parseFloat(element.style.top);
  const position = {
    left: Number.isFinite(styleLeft) ? styleLeft : fallback.left,
    top: Number.isFinite(styleTop) ? styleTop : fallback.top,
  };
  const viewport = getVisualViewportRect();

  return {
    position,
    bounds: viewport,
  };
}

function clampDraggedOverlay(preferredLeft: number, preferredTop: number, width: number, height: number, bounds: DragBounds) {
  const minVisibleX = Math.min(width, Math.max(96, Math.min(bounds.width - 16, 180)));
  const minVisibleY = Math.min(height, Math.max(56, Math.min(bounds.height - 16, 120)));
  const minLeft = bounds.left + minVisibleX - width;
  const maxLeft = bounds.left + bounds.width - minVisibleX;
  const minTop = bounds.top + minVisibleY - height;
  const maxTop = bounds.top + bounds.height - minVisibleY;
  return {
    left: Math.max(minLeft, Math.min(preferredLeft, maxLeft)),
    top: Math.max(minTop, Math.min(preferredTop, maxTop)),
  };
}

function panelWidthFor(maxWidth = 560, minWidth = 220) {
  const available = Math.max(1, viewportWidth() - 24);
  return Math.max(Math.min(minWidth, available), Math.min(maxWidth, available));
}

function firstStrongTextDirection(value: string): "ltr" | "rtl" | "auto" {
  for (const character of value.trim()) {
    if (/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u.test(character)) return "rtl";
    if (/[A-Za-z\u00C0-\u024F]/u.test(character)) return "ltr";
  }
  return "auto";
}

function hasRtlText(value: string): boolean {
  return /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u.test(value);
}

function syncTextareaDirection(textarea: HTMLTextAreaElement) {
  const direction = firstStrongTextDirection(textarea.value);
  textarea.dir = direction;
  textarea.style.textAlign = direction === "rtl" ? "right" : "left";
}

function trapScroll(element: HTMLElement) {
  element.addEventListener("wheel", (event) => {
    if (event.ctrlKey) return;

    const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
    if (maxTop <= 0) return;

    const deltaY = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? event.deltaY * 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? event.deltaY * element.clientHeight
        : event.deltaY;

    const nextTop = Math.max(0, Math.min(maxTop, element.scrollTop + deltaY));
    if (nextTop !== element.scrollTop) {
      element.scrollTop = nextTop;
    }

    event.preventDefault();
    event.stopPropagation();
  }, { passive: false });
}

type ConversationScrollState = {
  top: number;
  atBottom: boolean;
  pendingAnchor: "none" | "latest-user" | "latest-assistant";
  autoFollow: boolean;
  streaming: boolean;
  streamBottomFollow: boolean;
  programmaticScroll: boolean;
  lastTouchY: number | null;
};

function createConversationScrollState(): ConversationScrollState {
  return {
    top: 0,
    atBottom: false,
    pendingAnchor: "none",
    autoFollow: false,
    streaming: false,
    streamBottomFollow: false,
    programmaticScroll: false,
    lastTouchY: null,
  };
}

function conversationMaxScrollTop(element: HTMLElement) {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function rememberConversationScroll(state: ConversationScrollState, element: HTMLElement | null) {
  if (!element) return;
  const maxTop = conversationMaxScrollTop(element);
  if (!state.programmaticScroll && state.autoFollow && element.scrollTop + 8 < state.top) {
    state.autoFollow = false;
  }
  state.top = Math.max(0, Math.min(element.scrollTop, maxTop));
  state.atBottom = maxTop > 0 && maxTop - element.scrollTop <= 16;
  if (state.streaming && !state.programmaticScroll) {
    state.streamBottomFollow = state.atBottom;
  }
}

function setConversationScrollTop(state: ConversationScrollState, element: HTMLElement, top: number) {
  state.programmaticScroll = true;
  element.scrollTop = top;
  rememberConversationScroll(state, element);
  window.setTimeout(() => {
    state.programmaticScroll = false;
  }, 0);
}

function startConversationAutoFollow(state: ConversationScrollState, anchor: ConversationScrollState["pendingAnchor"]) {
  state.pendingAnchor = anchor;
  state.autoFollow = true;
}

function stopConversationAutoFollow(state: ConversationScrollState) {
  state.autoFollow = false;
}

function beginConversationStream(state: ConversationScrollState, element: HTMLElement | null) {
  if (element) {
    rememberConversationScroll(state, element);
  } else {
    state.top = 0;
    state.atBottom = false;
  }
  state.pendingAnchor = "none";
  state.autoFollow = false;
  state.streaming = true;
  state.streamBottomFollow = false;
}

function endConversationStream(state: ConversationScrollState) {
  state.streaming = false;
  state.streamBottomFollow = false;
}

function trackConversationScroll(state: ConversationScrollState, element: HTMLElement) {
  element.addEventListener("scroll", () => rememberConversationScroll(state, element), { passive: true });
  element.addEventListener("wheel", (event) => {
    if (event.deltaY < 0) stopConversationAutoFollow(state);
  }, { passive: true });
  element.addEventListener("touchstart", (event) => {
    state.lastTouchY = event.touches[0]?.clientY ?? null;
  }, { passive: true });
  element.addEventListener("touchmove", (event) => {
    const currentY = event.touches[0]?.clientY;
    if (currentY !== undefined && state.lastTouchY !== null && currentY > state.lastTouchY) {
      stopConversationAutoFollow(state);
    }
    state.lastTouchY = currentY ?? state.lastTouchY;
  }, { passive: true });
}

function restoreConversationScroll(
  state: ConversationScrollState,
  element: HTMLElement,
  targets: { latestUser: HTMLElement | null; latestAssistant: HTMLElement | null },
  options: { preserveBottom?: boolean } = {},
) {
  const maxTop = conversationMaxScrollTop(element);
  const preserveBottom = options.preserveBottom ?? true;
  const anchorTarget = state.pendingAnchor === "latest-user"
    ? targets.latestUser
    : state.pendingAnchor === "latest-assistant"
      ? targets.latestAssistant
      : null;
  if (anchorTarget) {
    setConversationScrollTop(state, element, Math.max(0, Math.min(anchorTarget.offsetTop - 12, maxTop)));
    state.pendingAnchor = "none";
  } else if (preserveBottom && state.autoFollow) {
    setConversationScrollTop(state, element, maxTop);
  } else if (preserveBottom && state.atBottom) {
    setConversationScrollTop(state, element, maxTop);
  } else {
    setConversationScrollTop(state, element, Math.max(0, Math.min(state.top, maxTop)));
  }
}

const streamingBodyText = new WeakMap<HTMLElement, string>();

function updateStreamingAssistantBody(
  root: HTMLElement | null,
  listName: "widget" | "screenshot",
  state: ConversationScrollState,
  text: string,
) {
  const list = root?.querySelector<HTMLElement>(`[data-cl-conversation-list="${listName}"]`);
  const body = list?.querySelector<HTMLElement>('[data-cl-stream-assistant-body="1"]');
  if (!list || !body) return false;

  const previous = streamingBodyText.get(body) ?? "";
  if (text.startsWith(previous)) {
    appendBidiText(body, text.slice(previous.length));
  } else {
    body.replaceChildren();
    appendBidiText(body, text);
  }
  streamingBodyText.set(body, text);
  if (state.streamBottomFollow) {
    setConversationScrollTop(state, list, conversationMaxScrollTop(list));
  }
  return true;
}

function autosizeTextarea(textarea: HTMLTextAreaElement, maxHeight = 120) {
  textarea.style.height = "auto";
  const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

const TERM_DEF_RE = /^\*\*(.+?)\*\*\s*[—–-]\s*(.+)$/;
const ARABIC_CHAR = "\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";
const ARABIC_RUN_GLUE = "\\u0660-\\u0669\\u06F0-\\u06F90-9\\s\\u200c\\u200d.,;:!?،؛؟'\"()[\\]{}\\-–—/\\\\";
const ARABIC_RUN_RE = new RegExp(
  `([${ARABIC_CHAR}](?:[${ARABIC_CHAR}${ARABIC_RUN_GLUE}]*[${ARABIC_CHAR}\\u0660-\\u0669\\u06F0-\\u06F90-9])?[.,;:!?،؛؟)]*)`,
  "gu",
);
type HardWordEntry = { term: string; definition: string };

function appendBidiText(container: HTMLElement, text: string) {
  let start = 0;

  function appendArabicRun(run: string) {
    run.split(new RegExp(`(${HONORIFIC_MARK})`, "g")).forEach((chunk) => {
      if (!chunk) return;
      if (chunk === HONORIFIC_MARK) {
        const honorific = document.createElement("span");
        honorific.dir = "rtl";
        honorific.lang = "ar";
        honorific.className = "cl-honorific";
        honorific.style.cssText = `display:inline-block;direction:rtl;unicode-bidi:isolate;font-family:${ARABIC_FONT_STACK};font-size:0.86em;font-weight:650;line-height:1;margin-inline:0.16em;vertical-align:0.18em;`;
        honorific.textContent = chunk;
        container.appendChild(honorific);
        return;
      }
      if (!/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u.test(chunk)) {
        container.appendChild(document.createTextNode(chunk));
        return;
      }
      const arabic = document.createElement("bdi");
      arabic.dir = "rtl";
      arabic.lang = "ar";
      arabic.className = "cl-ar";
      arabic.style.cssText = `direction:rtl;unicode-bidi:isolate;font-family:${ARABIC_FONT_STACK};font-size:1.16em;line-height:1.85;`;
      arabic.textContent = chunk;
      container.appendChild(arabic);
    });
  }

  for (const match of text.matchAll(ARABIC_RUN_RE)) {
    const index = match.index ?? 0;
    if (index > start) {
      container.appendChild(document.createTextNode(text.slice(start, index)));
    }

    appendArabicRun(match[0]);
    start = index + match[0].length;
  }

  if (start < text.length) {
    container.appendChild(document.createTextNode(text.slice(start)));
  }
}

function hardWordEntries(text: string): HardWordEntry[] {
  return text
    .split("\n")
    .map((line) => line.match(TERM_DEF_RE))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({ term: match[1], definition: match[2] }));
}

function appendHardWordRows(container: HTMLElement, entries: HardWordEntry[]) {
  entries.forEach(({ term, definition }) => {
    const termRow = document.createElement("div");
    termRow.style.cssText = "margin:10px 0 0;";

    const termEl = document.createElement("div");
    termEl.style.cssText = `font-weight:700;font-family:${ARABIC_FONT_STACK};font-size:1.08em;line-height:1.83;`;
    appendBidiText(termEl, term);

    const defEl = document.createElement("div");
    defEl.style.cssText = "font-weight:400;line-height:1.7;padding-left:2px;";
    appendBidiText(defEl, definition);

    termRow.appendChild(termEl);
    termRow.appendChild(defEl);
    container.appendChild(termRow);
  });
}

const LABEL_RE = /^(Line \d+|Arabic\/source|Meaning|Direct|Plain meaning):(.*)/;
const SILENT_LABELS = new Set(["Arabic/source", "Meaning"]);
const LABEL_DISPLAY: Record<string, string> = { "Direct": "Direct meaning" };
const MEANING_LABELS = new Set(["Meaning", "Direct", "Plain meaning"]);

function appendInlineMarkdown(container: HTMLElement, text: string) {
  text.split(/(\*\*[^*\n]+?\*\*|\*[^*\n]+?\*)/g).forEach((part) => {
    if (!part) return;
    if (part.startsWith("**") && part.endsWith("**")) {
      const strong = document.createElement("strong");
      strong.style.fontWeight = "700";
      strong.style.color = "inherit";
      appendBidiText(strong, part.slice(2, -2));
      container.appendChild(strong);
    } else if (part.startsWith("*") && part.endsWith("*")) {
      const emphasis = document.createElement("em");
      emphasis.style.fontStyle = "italic";
      emphasis.style.color = "inherit";
      appendBidiText(emphasis, part.slice(1, -1));
      container.appendChild(emphasis);
    } else {
      appendBidiText(container, part);
    }
  });
}

function appendMarkdownText(container: HTMLElement, text: string, renderChips = true, showHardWords = false): HTMLElement | null {
  const lines = text.split("\n");
  let lastWasInline = false;
  let hardWordsDiv: HTMLElement | null = null;
  const colors = uiColors();

  lines.forEach((line) => {
    const stripped = line.startsWith("* ") ? line.slice(2) : line;
    const match = renderChips ? stripped.match(TERM_DEF_RE) : null;

    if (match) {
      lastWasInline = false;
      const [, term, definition] = match;

      if (!hardWordsDiv) {
        hardWordsDiv = document.createElement("div");
        hardWordsDiv.style.cssText = `display:${showHardWords ? "block" : "none"};margin-top:8px;`;
        container.appendChild(hardWordsDiv);
      }

      appendHardWordRows(hardWordsDiv, [{ term, definition }]);
    } else {
      if (lastWasInline) container.appendChild(document.createElement("br"));
      lastWasInline = true;

      const labelMatch = stripped.match(LABEL_RE);
      if (labelMatch) {
        const [, label, rawBody] = labelMatch;
        const body = rawBody.trim();

        if (label === "Arabic/source") {
          if (body) {
            const isRtl = hasRtlText(body);
            const source = document.createElement("div");
            source.setAttribute("style", `
              color:${colors.text};
              direction:${isRtl ? "rtl" : "ltr"};
              font-family:${isRtl ? ARABIC_FONT_STACK : "inherit"};
              font-size:1.06em;
              font-weight:650;
              line-height:1.9;
              margin:5px 0 8px;
              text-align:${isRtl ? "right" : "left"};
            `);
            appendBidiText(source, body);
            container.appendChild(source);
          }
          lastWasInline = false;
        } else if (MEANING_LABELS.has(label)) {
          if (body) {
            const row = document.createElement("div");
            row.setAttribute("style", "margin:3px 0 8px;line-height:1.68;");
            const labelSpan = document.createElement("span");
            labelSpan.style.cssText = `font-weight:700;color:${colors.muted};font-size:0.78em;letter-spacing:0.05em;text-transform:uppercase;`;
            labelSpan.textContent = (LABEL_DISPLAY[label] ?? label) + ":";
            const textSpan = document.createElement("span");
            textSpan.style.cssText = `color:${colors.userText};font-size:0.94em;font-weight:400;`;
            textSpan.appendChild(document.createTextNode(" "));
            appendInlineMarkdown(textSpan, body);
            row.appendChild(labelSpan);
            row.appendChild(textSpan);
            container.appendChild(row);
          } else {
            lastWasInline = false;
          }
          lastWasInline = false;
        } else if (SILENT_LABELS.has(label)) {
          if (body) appendBidiText(container, body);
          else lastWasInline = false;
        } else {
          const labelSpan = document.createElement("span");
          labelSpan.style.cssText = `font-weight:700;color:${colors.muted};font-size:0.8em;letter-spacing:0.05em;text-transform:uppercase;`;
          labelSpan.textContent = (LABEL_DISPLAY[label] ?? label) + ":";
          container.appendChild(labelSpan);
          if (body) appendBidiText(container, body);
        }
      } else {
        appendInlineMarkdown(container, stripped);
      }
    }
  });

  return hardWordsDiv;
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

function removeOrphanCameraButtons() {
  document.querySelectorAll(CAMERA_BUTTON_SELECTOR).forEach((element) => {
    if (element !== cameraBtn) element.remove();
  });
}

function createCameraButton() {
  if (cameraBtn) return;
  removeOrphanCameraButtons();
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
    box-shadow: 0 1px 5px rgba(0,0,0,0.18);
    user-select: none;
    transform-origin: top left;
    transition: transform 0.1s;
  `);
  cameraBtn.addEventListener("mouseenter", () => {
    if (cameraBtn) cameraBtn.style.filter = "brightness(1.08)";
  });
  cameraBtn.addEventListener("mouseleave", () => {
    if (cameraBtn) cameraBtn.style.filter = "";
  });
  cameraBtn.addEventListener("click", (event) => {
    rememberScreenshotCursorPoint(event);
    cameraBtn!.style.display = "none";
    requestScreenshotCapture(80);
  });
  appendToPage(cameraBtn);
  queueCameraButtonPosition();
}

function removeCameraButton() {
  if (cameraBtn) { cameraBtn.remove(); cameraBtn = null; }
  removeOrphanCameraButtons();
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
  activeWidgetStreamSession += 1;
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

function saveBubblePlacement(target: RectLike, bounds: RectLike, anchor: SelectionAnchor | null) {
  const mobile = viewportWidth() <= 600;
  const width = mobile ? 76 : 86;
  const height = mobile ? 32 : 34;
  const gap = 14;
  const viewport = getVisualViewportRect();
  const anchorX = anchor
    ? Math.max(bounds.left, Math.min(anchor.clientX, bounds.right))
    : target.left + target.width / 2;
  const targetCenterY = target.top + target.height / 2;
  const boundsCenterY = bounds.top + bounds.height / 2;
  const preferAbove = targetCenterY <= boundsCenterY;
  const aboveTop = bounds.top - gap - height;
  const belowTop = bounds.bottom + gap;
  const minTop = viewport.top + 8;
  const maxTop = viewport.top + Math.max(0, viewport.height - height - 8);
  const canAbove = aboveTop >= minTop;
  const canBelow = belowTop <= maxTop;
  const top = preferAbove
    ? (canAbove ? aboveTop : canBelow ? belowTop : Math.max(minTop, Math.min(aboveTop, maxTop)))
    : (canBelow ? belowTop : canAbove ? aboveTop : Math.max(minTop, Math.min(belowTop, maxTop)));

  return {
    left: Math.max(viewport.left + 8, Math.min(anchorX - width / 2, viewport.left + viewport.width - width - 8)),
    top,
    width,
    height,
    anchorX,
    anchorY: preferAbove ? bounds.top : bounds.bottom,
  };
}

function showSaveBubble(target: RectLike, bounds: RectLike, selectedText: string, anchor: SelectionAnchor | null) {
  if (widgetMode === "input") return;
  removeWidget();
  widgetMode = "bubble";

  const mobile = viewportWidth() <= 600;
  const placement = saveBubblePlacement(target, bounds, anchor);
  const btnHeight  = placement.height;
  const btnPad     = mobile ? "0 13px" : "0 15px";
  const btnFont    = mobile ? "14.5px" : "15.5px";

  widget = document.createElement("div");
  widget.textContent = "Ask";
  widget.setAttribute(
    "style",
    `
    position: fixed;
    left: ${placement.left}px;
    top: ${placement.top}px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: ${btnHeight}px;
    width: ${placement.width}px;
    box-sizing: border-box;
    background: #202231;
    color: #f5f6ff;
    font-family: ${LATIN_FONT_STACK};
    font-size: ${btnFont};
    line-height: 1;
    font-weight: 700;
    padding: ${btnPad};
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.12);
    cursor: pointer;
    z-index: 2147483647;
    box-shadow: 0 5px 14px rgba(0,0,0,0.24);
    user-select: none;
    opacity: 0;
    transition: opacity 120ms ease, box-shadow 120ms ease, background 120ms ease;
  `
  );

  widget.addEventListener("mouseenter", () => {
    if (!widget) return;
    widget.style.background = "#282b3d";
    widget.style.boxShadow = "0 6px 16px rgba(0,0,0,0.28)";
  });
  widget.addEventListener("mouseleave", () => {
    if (!widget) return;
    widget.style.background = "#202231";
    widget.style.boxShadow = "0 5px 14px rgba(0,0,0,0.24)";
  });

  widget.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    skipNextMouseup = true;
    showContextInput(placement.anchorX, placement.anchorY, selectedText);
  });

  appendToPage(widget);
  requestAnimationFrame(() => {
    if (!widget || widgetMode !== "bubble") return;
    widget.style.opacity = "1";
  });
}

function showContextInput(x: number, y: number, selectedText: string) {
  removeWidget();
  widgetMode = "input";
  ensureBaseStyles();
  const colors = uiColors();

  let widgetWidth = panelWidthFor();
  let widgetHeight = 0;
  const selectionForPlacement = selectedPageText()?.rect ?? null;
  let userPlacedWidget = false;
  let widgetHasSettledFromSelection = false;
  const initialPosition = selectionForPlacement
    ? overlayPositionAwayFromRect(selectionForPlacement, widgetWidth, 132, x, y)
    : { left: clampLeftToViewport(x - widgetWidth / 2, widgetWidth), top: panelTopFor(y - 138, 132) };
  let left = initialPosition.left;
  let top = initialPosition.top;

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
    font-family: ${LATIN_FONT_STACK};
    direction: ltr;
    text-align: left;
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
    color: ${accentColor};
    padding: 8px 12px 6px;
    border-bottom: 1px solid ${colors.faintBorder};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: grab;
    user-select: none;
    touch-action: none;
  `
  );
  preview.title = "Drag overlay";

  preview.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    userPlacedWidget = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const drag = widget
      ? elementDragState(widget, { left, top })
      : { position: { left, top }, bounds: { left: 0, top: 0, width: viewportWidth(), height: viewportHeight() } };
    const startLeft = drag.position.left;
    const startTop = drag.position.top;
    preview.style.cursor = "grabbing";

    const onMove = (ev: MouseEvent) => {
      const dragHeight = Math.min(widget?.getBoundingClientRect().height || 132, expandedPanelMaxHeight());
      const next = clampDraggedOverlay(startLeft + ev.clientX - startX, startTop + ev.clientY - startY, widgetWidth, dragHeight, drag.bounds);
      left = next.left;
      top = next.top;
      if (widget) {
        widget.style.left = `${left}px`;
        widget.style.top = `${top}px`;
      }
    };
    const onUp = () => {
      preview.style.cursor = "grab";
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  });

  const input = document.createElement("textarea");
  input.className = "cl-scroll";
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
    text-align: left;
    unicode-bidi: plaintext;
  `
  );
  autosizeTextarea(input);
  syncTextareaDirection(input);
  trapScroll(input);

  let submitted = false;
  let submitting = false;
  let hardWordsOpen = false;
  let analogyText = "";
  let analogyLoading = false;
  const widgetConversationScroll = createConversationScrollState();

  function styleExpandedWidget() {
    if (!widget) return;
    const colors = uiColors();
    const maxH = expandedPanelMaxHeight();
    const actualHeight = widget.getBoundingClientRect().height;
    const heightForClamp = widgetHeight > 0
      ? Math.min(widgetHeight, maxH)
      : actualHeight > 0
        ? Math.min(actualHeight, maxH)
        : maxH;
    left = clampLeftToViewport(left, widgetWidth);
    top = panelTopFor(top, heightForClamp);
    const heightCss = widgetHeight > 0
      ? `height: ${heightForClamp}px; max-height: ${maxH}px;`
      : `max-height: ${maxH}px;`;
    widget.setAttribute(
      "style",
      `
      position: fixed;
      left: ${left}px;
      top: ${top}px;
      background: ${colors.panel};
      backdrop-filter: blur(28px);
      border: 1px solid ${colors.border};
      border-radius: 10px;
      box-shadow: ${colors.shadow};
      z-index: 2147483647;
      width: ${widgetWidth}px;
      ${heightCss}
      font-family: ${LATIN_FONT_STACK};
      direction: ltr;
      text-align: left;
      overflow: hidden;
      box-sizing: border-box;
      padding: 8px 12px 12px;
      display: flex;
      flex-direction: column;
    `
    );
  }

  function settleExpandedWidgetPosition(lift = 0) {
    if (!widget) return;
    const maxH = expandedPanelMaxHeight();
    const actualHeight = widget.getBoundingClientRect().height;
    const heightForClamp = Math.min(actualHeight > 0 ? actualHeight : maxH, maxH);
    if (selectionForPlacement && !userPlacedWidget && !widgetHasSettledFromSelection) {
      const next = overlayPositionAwayFromRect(selectionForPlacement, widgetWidth, heightForClamp, x, y);
      left = next.left;
      top = next.top;
      widgetHasSettledFromSelection = true;
    } else {
      left = clampLeftToViewport(left, widgetWidth);
      top = panelTopFor(userPlacedWidget || widgetHasSettledFromSelection ? top : top - lift, heightForClamp);
    }
    widget.style.left = `${left}px`;
    widget.style.top = `${top}px`;
    widget.style.maxHeight = `${maxH}px`;
  }

  function addResizeHandles() {
    if (!widget) return;
    widget.querySelectorAll("[data-cl-resize]").forEach(el => el.remove());

    function makeHandle(cursor: string, edgeStyle: string, onResize: (dx: number, dy: number, sw: number, sh: number, sl: number, st: number) => void) {
      const handle = document.createElement("div");
      handle.setAttribute("data-cl-resize", "1");
      handle.setAttribute("style", `position:absolute;${edgeStyle}cursor:${cursor};z-index:2;`);
      handle.addEventListener("mousedown", (e: MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        userPlacedWidget = true;
        const sx = e.clientX, sy = e.clientY;
        const sw = widgetWidth;
        const sh = widgetHeight > 0 ? widgetHeight : (widget?.offsetHeight ?? 400);
        const sl = left, st = top;
        const mv = (ev: MouseEvent) => {
          onResize(ev.clientX - sx, ev.clientY - sy, sw, sh, sl, st);
          styleExpandedWidget();
          addResizeHandles();
        };
        const up = () => {
          document.removeEventListener("mousemove", mv, true);
          document.removeEventListener("mouseup", up, true);
        };
        document.addEventListener("mousemove", mv, true);
        document.addEventListener("mouseup", up, true);
      });
      widget!.appendChild(handle);
    }

    const minW = 220, maxW = Math.min(640, viewportWidth() - 16);
    const minH = 150, maxH = expandedPanelMaxHeight(720);
    const clampWidth = (width: number) => Math.max(minW, Math.min(maxW, width));
    const clampHeight = (height: number) => Math.max(minH, Math.min(maxH, height));
    const fromWest = (dx: number, sw: number, sl: number) => {
      const right = sl + sw;
      widgetWidth = clampWidth(sw - dx);
      left = clampLeftToViewport(right - widgetWidth, widgetWidth);
    };
    const fromNorth = (dy: number, sh: number, st: number) => {
      const bottom = st + sh;
      widgetHeight = clampHeight(sh - dy);
      top = panelTopFor(bottom - widgetHeight, widgetHeight);
    };
    const fromEast = (dx: number, sw: number) => { widgetWidth = clampWidth(sw + dx); };
    const fromSouth = (dy: number, sh: number) => { widgetHeight = clampHeight(sh + dy); };

    makeHandle("ew-resize", "top:8px;left:0;width:8px;height:calc(100% - 16px);", (dx, _dy, sw, _sh, sl) => fromWest(dx, sw, sl));
    makeHandle("ew-resize", "top:8px;right:0;width:8px;height:calc(100% - 16px);", (dx, _dy, sw) => fromEast(dx, sw));
    makeHandle("ns-resize", "top:0;left:8px;width:calc(100% - 16px);height:8px;", (_dx, dy, _sw, sh, _sl, st) => fromNorth(dy, sh, st));
    makeHandle("ns-resize", "bottom:0;left:8px;width:calc(100% - 16px);height:8px;", (_dx, dy, _sw, sh) => fromSouth(dy, sh));
    makeHandle("nwse-resize", "top:0;left:0;width:14px;height:14px;", (dx, dy, sw, sh, sl, st) => { fromWest(dx, sw, sl); fromNorth(dy, sh, st); });
    makeHandle("nesw-resize", "top:0;right:0;width:14px;height:14px;", (dx, dy, sw, sh, _sl, st) => { fromEast(dx, sw); fromNorth(dy, sh, st); });
    makeHandle("nesw-resize", "bottom:0;left:0;width:14px;height:14px;", (dx, dy, sw, sh, sl) => { fromWest(dx, sw, sl); fromSouth(dy, sh); });
    makeHandle("nwse-resize", "bottom:0;right:0;width:14px;height:14px;", (dx, dy, sw, sh) => { fromEast(dx, sw); fromSouth(dy, sh); });
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
    actionButtonClick(closeBtn, () => removeWidget());
    widget.replaceChildren(message, closeBtn);
  }

  function renderSignInRequired() {
    if (!widget) return;
    styleExpandedWidget();
    const colors = uiColors();
    const msg = document.createElement("div");
    msg.textContent = "Sign in to save highlights and get explanations.";
    msg.setAttribute("style", `color:${colors.text};font-size:14px;line-height:1.6;margin-bottom:14px;`);
    const signInBtn = document.createElement("button");
    signInBtn.textContent = "Sign In";
    signInBtn.setAttribute("style", `background:${colors.accent};color:${colors.accentText};border:none;border-radius:7px;padding:8px 14px;font-size:13px;font-weight:700;cursor:pointer;margin-right:8px;`);
    actionButtonClick(signInBtn, () => { chrome.runtime.openOptionsPage(); removeWidget(); });
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Dismiss";
    closeBtn.setAttribute("style", `background:${colors.subtle};color:${colors.text};border:1px solid ${colors.border};border-radius:7px;padding:8px 13px;font-size:13px;font-weight:600;cursor:pointer;`);
    actionButtonClick(closeBtn, () => removeWidget());
    const row = document.createElement("div");
    row.setAttribute("style", "display:flex;gap:0;");
    row.appendChild(signInBtn);
    row.appendChild(closeBtn);
    widget.replaceChildren(msg, row);
  }

  function renderSimilarSavePrompt(similar: Capture, onKeepBoth: () => void, onReplaceEarlier: () => void) {
    if (!widget) return;
    styleExpandedWidget();
    const colors = uiColors();
    const title = document.createElement("div");
    title.textContent = `This looks like a revised save from ${shortRelativeTime(similar.savedAt)}.`;
    title.setAttribute("style", `color:${colors.text};font-size:14px;line-height:1.45;font-weight:700;margin-bottom:6px;`);
    const detail = document.createElement("div");
    const previewText = similar.text.length > 110 ? `${similar.text.slice(0, 110).trim()}…` : similar.text;
    detail.textContent = `Earlier: "${previewText}"`;
    detail.setAttribute("style", `color:${colors.muted};font-size:12px;line-height:1.45;margin-bottom:12px;max-height:54px;overflow:hidden;`);
    const row = document.createElement("div");
    row.setAttribute("style", "display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;");
    const keepBtn = document.createElement("button");
    keepBtn.textContent = "Keep both";
    keepBtn.setAttribute("style", `background:${colors.subtle};color:${colors.text};border:1px solid ${colors.border};border-radius:7px;padding:8px 12px;font-size:13px;font-weight:700;cursor:pointer;`);
    keepBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onKeepBoth();
    });
    const replaceBtn = document.createElement("button");
    replaceBtn.textContent = "Keep this only";
    replaceBtn.setAttribute("style", `background:${colors.accent};color:${colors.accentText};border:none;border-radius:7px;padding:8px 12px;font-size:13px;font-weight:800;cursor:pointer;`);
    replaceBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onReplaceEarlier();
    });
    row.appendChild(keepBtn);
    row.appendChild(replaceBtn);
    widget.replaceChildren(title, detail, row);
  }

  function renderConversation(captureId: string, messages: ChatMessage[], loading = false, loadingText = "Thinking…") {
    if (!widget) return;
    rememberConversationScroll(widgetConversationScroll, widget.querySelector<HTMLElement>('[data-cl-conversation-list="widget"]'));
    styleExpandedWidget();
    const colors = uiColors();

    // Drag handle
    const dragHandle = document.createElement("div");
    dragHandle.setAttribute("style", `
      cursor: grab;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: -8px -12px 10px -12px;
      border-bottom: 1px solid ${colors.faintBorder};
      flex-shrink: 0;
      user-select: none;
      touch-action: none;
    `);
    dragHandle.title = "Drag overlay";
    const dragDots = document.createElement("span");
    dragDots.textContent = "···";
    dragDots.setAttribute("style", `color:${colors.muted};font-size:13px;letter-spacing:4px;line-height:1;`);
    dragHandle.appendChild(dragDots);

    dragHandle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      userPlacedWidget = true;
      const startX = e.clientX;
      const startY = e.clientY;
      const drag = widget
        ? elementDragState(widget, { left, top })
        : { position: { left, top }, bounds: { left: 0, top: 0, width: viewportWidth(), height: viewportHeight() } };
      const startLeft = drag.position.left;
      const startTop = drag.position.top;
      dragHandle.style.cursor = "grabbing";

      const onMove = (ev: MouseEvent) => {
        const dragHeight = Math.min(widget?.getBoundingClientRect().height || expandedPanelMaxHeight(), expandedPanelMaxHeight());
        const next = clampDraggedOverlay(startLeft + ev.clientX - startX, startTop + ev.clientY - startY, widgetWidth, dragHeight, drag.bounds);
        left = next.left;
        top = next.top;
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

    ensureBaseStyles();
    const list = document.createElement("div");
    list.className = "cl-scroll";
    list.setAttribute("data-cl-conversation-list", "widget");
    list.setAttribute("style", `flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overflow-anchor:none;scrollbar-gutter:stable;padding:0 12px 0 12px;margin:0 -4px 12px -4px;box-sizing:border-box;`);
    trapScroll(list);
    trackConversationScroll(widgetConversationScroll, list);

    const initialHardWords = messages.length === 1 && messages[0].role === "assistant"
      ? hardWordEntries(messages[0].content)
      : [];
    const focusedHardWords = hardWordsOpen && initialHardWords.length > 0;
    let latestAssistantBlock: HTMLElement | null = null;
    let latestUserBlock: HTMLElement | null = null;

    if (focusedHardWords) {
      const label = document.createElement("div");
      label.textContent = "Hard Words";
      label.setAttribute("style", `color:${colors.muted};font-size:11px;font-weight:700;margin:0 0 6px;`);
      const body = document.createElement("div");
      body.setAttribute("style", `
        color: ${colors.text};
        font-size: ${cardFontSize === "sm" ? "14px" : cardFontSize === "lg" ? "19px" : "16px"};
        line-height: 1.83;
        white-space: pre-wrap;
      `);
      appendHardWordRows(body, initialHardWords);
      list.appendChild(label);
      list.appendChild(body);
    } else {
      messages.forEach((message, index) => {
        const messageBlock = document.createElement("div");
        if (message.role === "user") {
          messageBlock.setAttribute("style", `border-left:2px solid ${colorWithAlpha(accentColor, 0.45)};padding-left:10px;margin:10px 0 12px;`);
          latestUserBlock = messageBlock;
        } else {
          latestAssistantBlock = messageBlock;
        }

        const label = document.createElement("div");
        label.textContent = message.role === "assistant" ? "AI" : "You";
        label.setAttribute("style", `color:${colors.muted};font-size:11px;font-weight:700;margin:0 0 4px;`);

        const body = document.createElement("div");
        if (loading && message.role === "assistant" && index === messages.length - 1) {
          body.setAttribute("data-cl-stream-assistant-body", "1");
          streamingBodyText.set(body, message.content);
        }
        appendMessageBody(body, message, index, messages, loading);
        const aiFontSize = cardFontSize === "sm" ? "14px" : cardFontSize === "lg" ? "19px" : "16px";
        const messageDirection = firstStrongTextDirection(message.content);
        const messageBaseDirection = messageDirection === "auto" ? "ltr" : messageDirection;
        body.setAttribute("style", `
          color: ${message.role === "assistant" ? colors.text : colors.userText};
          font-size: ${message.role === "assistant" ? aiFontSize : "14px"};
          line-height: 1.83;
          margin-bottom: 8px;
          max-width: 100%;
          overflow-wrap: break-word;
          white-space: pre-wrap;
          direction: ${message.role === "user" ? messageBaseDirection : "ltr"};
          text-align: ${message.role === "user" && messageBaseDirection === "rtl" ? "right" : "left"};
          unicode-bidi: ${message.role === "user" ? "plaintext" : "normal"};
        `);

        messageBlock.appendChild(label);
        messageBlock.appendChild(body);
        list.appendChild(messageBlock);
      });
    }

    const showLoadingIndicator = loading && !latestMessageHasAssistantContent(messages);
    if (showLoadingIndicator) {
      const loadingBlock = document.createElement("div");
      const label = document.createElement("div");
      label.textContent = "AI";
      label.setAttribute("style", `color:${colors.muted};font-size:11px;font-weight:700;margin:0 0 4px;`);
      const body = document.createElement("div");
      body.textContent = loadingText;
      body.setAttribute("style", `color:${widgetDeepDiveActive ? colors.accent : colors.muted};font-size:14px;font-style:italic;line-height:1.65;margin-bottom:12px;`);
      loadingBlock.appendChild(label);
      loadingBlock.appendChild(body);
      latestAssistantBlock = loadingBlock;
      list.appendChild(loadingBlock);
    }

    const followupInput = document.createElement("textarea");
    followupInput.className = "cl-scroll";
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
      text-align: left;
      unicode-bidi: plaintext;
    `);
    autosizeTextarea(followupInput);
    syncTextareaDirection(followupInput);
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
    actionButtonClick(doneBtn, () => removeWidget());

    const row = document.createElement("div");
    row.setAttribute("style", "display:flex;gap:8px;align-items:center;flex-shrink:0;");
    row.appendChild(followupInput);
    row.appendChild(askBtn);
    row.appendChild(doneBtn);

    function askFollowup() {
      const question = followupInput.value.trim();
      if (!question || loading) return;
      hardWordsOpen = false;
      const nextMessages: ChatMessage[] = [...messages, { role: "user", content: question }];
      beginConversationStream(widgetConversationScroll, widget?.querySelector<HTMLElement>('[data-cl-conversation-list="widget"]') ?? null);
      renderConversation(captureId, nextMessages, true, "Thinking…");
      const streamSession = nextWidgetStreamSession();
      let streamed = "";
      let streamRendered = false;
      const renderStream = createStreamRenderScheduler((text) => {
        if (!isWidgetStreamCurrent(streamSession)) return;
        if (!streamRendered || !updateStreamingAssistantBody(widget, "widget", widgetConversationScroll, text)) {
          renderConversation(captureId, [...nextMessages, { role: "assistant", content: text }], true, "Writing…");
          streamRendered = true;
        }
      });
      streamRuntimeMessage<{ reply: string; messages: ChatMessage[] }>({
        type: "ASK_FOLLOWUP_STREAM",
        captureId,
        question,
        deepDive: false,
        fallbackText: selectedText,
        fallbackContext: input.value.trim(),
        fallbackUrl: location.href,
        fallbackTitle: document.title,
      }, {
        onChunk: (chunk) => {
          if (!isWidgetStreamCurrent(streamSession)) return;
          streamed += chunk;
          renderStream(streamed);
        },
      })
        .then((response) => {
          if (!isWidgetStreamCurrent(streamSession)) return;
          renderStream.finish(() => {
            if (!isWidgetStreamCurrent(streamSession)) return;
            endConversationStream(widgetConversationScroll);
            renderConversation(captureId, response.messages ?? [...nextMessages, { role: "assistant", content: response.reply }]);
          });
        })
        .catch((error) => {
          if (!isWidgetStreamCurrent(streamSession)) return;
          invalidateWidgetStream(streamSession);
          renderStream.cancel();
          endConversationStream(widgetConversationScroll);
          renderConversation(captureId, [...nextMessages, { role: "assistant", content: error.message }]);
        });
    }

    followupInput.addEventListener("input", () => {
      syncTextareaDirection(followupInput);
      autosizeTextarea(followupInput);
    });
    followupInput.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        askFollowup();
      }
      if (event.key === "Escape") removeWidget();
    });
    actionButtonClick(askBtn, () => askFollowup());

    const renderChildren: Node[] = [list];
    const actionRow = document.createElement("div");
    actionRow.setAttribute("style", `
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      flex-shrink: 0;
      margin-top: 16px;
      margin-bottom: 16px;
    `);
    let analogyBox: HTMLElement | null = null;

    if (!loading && messages.length === 1 && messages[0].role === "assistant" && initialHardWords.length > 0) {
      const hwBtn = document.createElement("button");
      hwBtn.textContent = hardWordsOpen ? "Back" : "📘 Hard Words";
      const hardWordsColors = neutralActionColors(colors);
      const hwBase = `
        align-self: flex-start;
        background: ${hardWordsColors.background};
        color: ${hardWordsColors.color};
        border: 1px solid ${hardWordsColors.border};
        border-radius: 6px;
        padding: 5px 10px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        letter-spacing: 0.02em;
      `;
      hwBtn.setAttribute("style", hwBase);
      hwBtn.addEventListener("mouseenter", () => {
        hwBtn.style.background = hardWordsColors.hoverBackground;
        hwBtn.style.borderColor = hardWordsColors.hoverBorder;
      });
      hwBtn.addEventListener("mouseleave", () => {
        hwBtn.style.background = hardWordsColors.background;
        hwBtn.style.borderColor = hardWordsColors.border;
      });
      actionButtonClick(hwBtn, () => {
        hardWordsOpen = !hardWordsOpen;
        renderConversation(captureId, messages, false, loadingText);
      });
      actionRow.appendChild(hwBtn);
    }

    if (!loading && messages.length === 1 && messages[0].role === "assistant") {
      const analogyColors = analogyActionColors();
      if (analogyLoading) {
        const analogyStatus = document.createElement("div");
        analogyStatus.textContent = "Finding an analogy…";
        analogyStatus.setAttribute("style", `color:${colors.muted};font-size:13px;font-style:italic;`);
        actionRow.appendChild(analogyStatus);
      } else if (analogyText) {
        analogyBox = document.createElement("div");
        analogyBox.textContent = analogyText;
        analogyBox.setAttribute("style", `
          flex-shrink: 0;
          background: ${analogyColors.background};
          border: 1px solid ${analogyColors.border};
          border-radius: 7px;
          color: ${analogyColors.text};
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
          color: ${analogyColors.text};
          border: 1px solid ${analogyColors.buttonBorder};
          border-radius: 6px;
          padding: 5px 10px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          letter-spacing: 0.02em;
        `);
        analogyBtn.addEventListener("mouseenter", () => {
          analogyBtn.style.background = analogyColors.hoverBackground;
          analogyBtn.style.borderColor = analogyColors.hoverButtonBorder;
        });
        analogyBtn.addEventListener("mouseleave", () => {
          analogyBtn.style.background = "transparent";
          analogyBtn.style.borderColor = analogyColors.buttonBorder;
        });
        actionButtonClick(analogyBtn, () => {
          analogyLoading = true;
          renderConversation(captureId, messages, false);
          sendRuntimeMessage<{ analogy: string }>({ type: "ANALOGY", text: messages[0].content })
            .then((response) => { analogyText = response.analogy; analogyLoading = false; if (!widgetDeepDiveActive) renderConversation(captureId, messages, false); })
            .catch(() => { analogyLoading = false; if (!widgetDeepDiveActive) renderConversation(captureId, messages, false); });
        });
        actionRow.appendChild(analogyBtn);
      }
    }

    if (!loading && !widgetDeepDiveActive && messages.some((message) => message.role === "assistant")) {
      const deepDiveBtn = document.createElement("button");
      deepDiveBtn.textContent = "✦ Deep Dive";
      deepDiveBtn.setAttribute("style", `
        background: ${colorWithAlpha(accentColor, 0.06)};
        color: ${accentColor};
        border: 1px solid ${colorWithAlpha(accentColor, 0.35)};
        border-radius: 6px;
        padding: 5px 10px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        letter-spacing: 0.02em;
      `);
      deepDiveBtn.addEventListener("mouseenter", () => {
        deepDiveBtn.style.background = colorWithAlpha(accentColor, 0.12);
        deepDiveBtn.style.borderColor = colorWithAlpha(accentColor, 0.55);
      });
      deepDiveBtn.addEventListener("mouseleave", () => {
        deepDiveBtn.style.background = colorWithAlpha(accentColor, 0.06);
        deepDiveBtn.style.borderColor = colorWithAlpha(accentColor, 0.35);
      });
      actionButtonClick(deepDiveBtn, () => {
        widgetDeepDiveActive = true;
        analogyText = "";
        analogyLoading = false;
        ensureDeepDiveStyles();
        const deepDiveMessages = deepDiveDisplayMessages(messages);
        beginConversationStream(widgetConversationScroll, widget?.querySelector<HTMLElement>('[data-cl-conversation-list="widget"]') ?? null);
        renderConversation(captureId, deepDiveMessages, true, "Thinking through a deeper answer…");
        widget?.classList.add("cl-deep-dive-glow");
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Deep Dive timed out. Please try again.")), 90_000)
        );
        const streamSession = nextWidgetStreamSession();
        let streamed = "";
        let streamRendered = false;
        const renderStream = createStreamRenderScheduler((text) => {
          if (!isWidgetStreamCurrent(streamSession)) return;
          if (!streamRendered || !updateStreamingAssistantBody(widget, "widget", widgetConversationScroll, text)) {
            renderConversation(captureId, deepDiveDisplayMessages(messages, text), true, "Writing…");
            streamRendered = true;
          }
        }, {
          firstPaintDelayMs: DEEP_DIVE_FIRST_PAINT_DELAY_MS,
          firstPaintMinChars: DEEP_DIVE_FIRST_PAINT_MIN_CHARS,
        });
        Promise.race([
          streamRuntimeMessage<{ explanation: string; messages: ChatMessage[] }>({
            type: "DEEP_DIVE_STREAM",
            captureId,
            fallbackText: selectedText,
            fallbackContext: input.value.trim(),
            fallbackUrl: location.href,
            fallbackTitle: document.title,
          }, {
            onChunk: (chunk) => {
              if (!isWidgetStreamCurrent(streamSession)) return;
              streamed += chunk;
              renderStream(streamed);
            },
          }),
          timeout,
        ])
          .then((response) => {
            if (!isWidgetStreamCurrent(streamSession)) return;
            renderStream.finish(() => {
              if (!isWidgetStreamCurrent(streamSession)) return;
              widget?.classList.remove("cl-deep-dive-glow");
              widget?.classList.add("cl-deep-dive-active");
              endConversationStream(widgetConversationScroll);
              renderConversation(captureId, deepDiveDisplayMessages(response.messages ?? deepDiveMessages, response.explanation));
            });
          })
          .catch((error: Error) => {
            if (!isWidgetStreamCurrent(streamSession)) return;
            invalidateWidgetStream(streamSession);
            renderStream.cancel();
            widget?.classList.remove("cl-deep-dive-glow");
            widgetDeepDiveActive = false;
            endConversationStream(widgetConversationScroll);
            if (error.message === "DEEP_DIVE_LIMIT_REACHED") {
              renderConversation(captureId, deepDiveDisplayMessages(messages, "Deep Dive is in beta — you've used all your free sessions. We'll open up more as we grow. Thanks for being an early explorer."));
            } else {
              renderConversation(captureId, deepDiveDisplayMessages(messages, error.message || "Deep Dive could not load. Please try again."));
            }
          });
      });
      actionRow.appendChild(deepDiveBtn);
    }

    if (actionRow.childNodes.length > 0) renderChildren.push(actionRow);
    if (analogyBox) renderChildren.push(analogyBox);

    renderChildren.push(row);
    widget.replaceChildren(dragHandle, ...renderChildren);
    addResizeHandles();
    requestAnimationFrame(() => {
      settleExpandedWidgetPosition(!loading && messages.length === 1 ? Math.min(52, Math.max(28, viewportHeight() * 0.06)) : 0);
      addResizeHandles();
      restoreConversationScroll(widgetConversationScroll, list, { latestUser: latestUserBlock, latestAssistant: latestAssistantBlock }, { preserveBottom: !loading });
      if (!loading) stopConversationAutoFollow(widgetConversationScroll);
    });
    if (!loading) setTimeout(() => followupInput.focus({ preventScroll: true }), 50);
  }

  function submitSaveMessage(message: Extract<Message, { type: "SAVE_HIGHLIGHT" }>, closeAfterSave: boolean) {
    submitted = true;
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

      beginConversationStream(widgetConversationScroll, widget?.querySelector<HTMLElement>('[data-cl-conversation-list="widget"]') ?? null);
      renderLoading();
      const streamSession = nextWidgetStreamSession();
      let captureId = "";
      let streamed = "";
      let streamRendered = false;
      const renderStream = createStreamRenderScheduler((text) => {
        if (captureId && isWidgetStreamCurrent(streamSession)) {
          if (!streamRendered || !updateStreamingAssistantBody(widget, "widget", widgetConversationScroll, text)) {
            renderConversation(captureId, [{ role: "assistant", content: text }], true, "Writing…");
            streamRendered = true;
          }
        }
      });
      const streamMessage: StreamMessage = { ...message, type: "SAVE_HIGHLIGHT_STREAM" };
      streamRuntimeMessage<{ captureId: string; explanation: string }>(streamMessage, {
        onStart: (id) => {
          if (!isWidgetStreamCurrent(streamSession)) return;
          captureId = id;
          if (streamed) renderStream(streamed);
        },
        onChunk: (chunk) => {
          if (!isWidgetStreamCurrent(streamSession)) return;
          streamed += chunk;
          if (captureId) renderStream(streamed);
        },
      })
        .then((response) => {
          if (!isWidgetStreamCurrent(streamSession)) return;
          renderStream.finish(() => {
            if (!isWidgetStreamCurrent(streamSession)) return;
            endConversationStream(widgetConversationScroll);
            renderConversation(response.captureId, [{ role: "assistant", content: response.explanation }]);
          });
        })
        .catch((error) => {
          if (!isWidgetStreamCurrent(streamSession)) return;
          invalidateWidgetStream(streamSession);
          renderStream.cancel();
          endConversationStream(widgetConversationScroll);
          if (isAuthRefreshRequiredError(error)) {
            renderSignInRequired();
            return;
          }
          renderError(error.message);
        });
    });
  }

  function doSave(closeAfterSave = false, replaceCaptureId?: string, skipSimilarCheck = false) {
    if (submitted || submitting) {
      if (closeAfterSave) removeWidget();
      return;
    }
    submitting = true;

    chrome.storage.local.get("contextlens_user", (result) => {
      submitting = false;
      if (!result.contextlens_user) {
        if (closeAfterSave) { removeWidget(); return; }
        renderSignInRequired();
        return;
      }

      const context = input.value.trim();
      const message: Extract<Message, { type: "SAVE_HIGHLIGHT" }> = {
        type: "SAVE_HIGHLIGHT",
        text: selectedText,
        url: location.href,
        title: document.title,
        context,
        replaceCaptureId,
      };

      if (closeAfterSave || replaceCaptureId || skipSimilarCheck) {
        submitSaveMessage(message, closeAfterSave);
        return;
      }

      similarRecentSave(selectedText, location.href, context)
        .then((similar) => {
          if (!similar || submitted) {
            submitSaveMessage(message, closeAfterSave);
            return;
          }
          renderSimilarSavePrompt(
            similar,
            () => doSave(closeAfterSave, undefined, true),
            () => doSave(closeAfterSave, similar.id, true),
          );
        })
        .catch(() => submitSaveMessage(message, closeAfterSave));
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
  input.addEventListener("input", () => {
    syncTextareaDirection(input);
    autosizeTextarea(input);
  });

  widget.appendChild(preview);
  widget.appendChild(input);
  appendToPage(widget);

  setTimeout(() => {
    input.focus();
    widgetOutsideHandler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!widget || widget.contains(target)) return;
      removeWidget();
    };
    document.addEventListener("mousedown", widgetOutsideHandler, true);
  }, 50);
}

// Crop overlay state
let cropOverlay: HTMLElement | null = null;
let screenshotCapturePending = false;
let screenshotCaptureRequestId: number | null = null;
let screenshotCaptureSequence = 0;
const cancelledScreenshotCaptureIds = new Set<number>();
let screenshotRepositionTimer: number | null = null;
let screenshotRepositionCleanup: (() => void) | null = null;
let screenshotCursorResetCleanup: (() => void) | null = null;
let pendingScreenshotCancelCleanup: (() => void) | null = null;
let screenshotLastCursorPoint: { x: number; y: number } | null = null;
type CropOverlayElement = HTMLElement & { __contextLensCleanup?: () => void };

function clearScreenshotReposition() {
  if (screenshotRepositionTimer !== null) {
    window.clearTimeout(screenshotRepositionTimer);
    screenshotRepositionTimer = null;
  }
  screenshotRepositionCleanup?.();
  screenshotRepositionCleanup = null;
}

function clearPendingScreenshotCancel() {
  pendingScreenshotCancelCleanup?.();
  pendingScreenshotCancelCleanup = null;
}

function removeCropOverlay(showCamera = true) {
  const hadPendingScreenshotCapture = screenshotCapturePending || screenshotCaptureRequestId !== null;
  clearPendingScreenshotCancel();
  clearScreenshotCursorReset();
  if (showCamera) {
    if (screenshotCaptureRequestId !== null) cancelledScreenshotCaptureIds.add(screenshotCaptureRequestId);
    screenshotCapturePending = false;
    screenshotCaptureRequestId = null;
  }
  const overlay = cropOverlay as CropOverlayElement | null;
  overlay?.__contextLensCleanup?.();
  if (overlay) {
    overlay.remove();
    cropOverlay = null;
  }
  if (showCamera && cameraBtn) cameraBtn.style.display = "";
  if (showCamera && (overlay || hadPendingScreenshotCapture)) resetCursorAfterScreenshotMode();
}

function nextScreenshotCaptureId() {
  screenshotCaptureSequence = screenshotCaptureSequence >= Number.MAX_SAFE_INTEGER ? 1 : screenshotCaptureSequence + 1;
  return screenshotCaptureSequence;
}

function finishPendingScreenshotCapture(
  screenshotId: number,
  options: { markCancelled?: boolean; resetCursor?: boolean } = {},
) {
  if (screenshotCaptureRequestId !== screenshotId) return false;
  if (options.markCancelled) cancelledScreenshotCaptureIds.add(screenshotId);
  screenshotCapturePending = false;
  screenshotCaptureRequestId = null;
  clearPendingScreenshotCancel();
  if (cameraBtn) cameraBtn.style.display = "";
  if (options.resetCursor) resetCursorAfterScreenshotMode();
  return true;
}

function cancelPendingScreenshotCapture() {
  const screenshotId = screenshotCaptureRequestId;
  if (screenshotId === null || cropOverlay) return;
  finishPendingScreenshotCapture(screenshotId, { markCancelled: true, resetCursor: true });
}

function armPendingScreenshotCancel(screenshotId: number) {
  clearPendingScreenshotCancel();

  let armed = false;
  let armTimer: number | null = window.setTimeout(() => {
    armTimer = null;
    armed = true;
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeydown, true);
  }, 0);

  const isActiveRequest = () =>
    screenshotCapturePending && screenshotCaptureRequestId === screenshotId && !cropOverlay;

  function cleanup() {
    if (armTimer !== null) {
      window.clearTimeout(armTimer);
      armTimer = null;
    }
    if (armed) {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleKeydown, true);
      armed = false;
    }
    if (pendingScreenshotCancelCleanup === cleanup) pendingScreenshotCancelCleanup = null;
  }

  function handleClick(event: MouseEvent) {
    if (!isActiveRequest()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    rememberScreenshotCursorPoint(event);
    cancelPendingScreenshotCapture();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape" || !isActiveRequest()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancelPendingScreenshotCapture();
  }

  pendingScreenshotCancelCleanup = cleanup;
}

function requestScreenshotCapture(delay = 0) {
  const screenshotId = nextScreenshotCaptureId();
  cancelledScreenshotCaptureIds.delete(screenshotId);
  screenshotCapturePending = true;
  screenshotCaptureRequestId = screenshotId;
  armPendingScreenshotCancel(screenshotId);

  window.setTimeout(() => {
    if (screenshotCaptureRequestId !== screenshotId) return;
    chrome.runtime.sendMessage({
      type: "TAKE_SCREENSHOT",
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      screenshotId,
    } as Message, () => {
      if (!chrome.runtime.lastError || screenshotCaptureRequestId !== screenshotId) return;
      finishPendingScreenshotCapture(screenshotId, { markCancelled: true, resetCursor: true });
    });
  }, delay);

  window.setTimeout(() => {
    if (screenshotCaptureRequestId !== screenshotId || !screenshotCapturePending || cropOverlay || !cameraBtn) return;
    finishPendingScreenshotCapture(screenshotId, { markCancelled: true, resetCursor: true });
  }, 4000);
}

function rememberScreenshotCursorPoint(event: Pick<MouseEvent, "clientX" | "clientY">) {
  screenshotLastCursorPoint = { x: event.clientX, y: event.clientY };
}

function clearScreenshotCursorReset() {
  screenshotCursorResetCleanup?.();
  screenshotCursorResetCleanup = null;
}

function normalizedCursor(value: string) {
  const cursors = new Set([
    "alias", "all-scroll", "cell", "col-resize", "context-menu", "copy",
    "default", "e-resize", "ew-resize", "grab", "grabbing", "help", "move", "n-resize",
    "ne-resize", "nesw-resize", "no-drop", "not-allowed", "ns-resize", "nw-resize",
    "nwse-resize", "pointer", "progress", "row-resize", "s-resize", "se-resize", "sw-resize",
    "text", "vertical-text", "w-resize", "wait", "zoom-in", "zoom-out",
  ]);
  return cursors.has(value) ? value : "default";
}

function cursorAtLastScreenshotPoint() {
  const point = screenshotLastCursorPoint;
  const target = point ? document.elementFromPoint(point.x, point.y) : null;
  if (!(target instanceof Element)) return "default";

  let element: Element | null = target;
  while (element) {
    const cursor = getComputedStyle(element).cursor;
    if (cursor && cursor !== "auto") return normalizedCursor(cursor);
    element = element.parentElement;
  }

  return isPageEditableTarget(target) ? "text" : "default";
}

function resetCursorAfterScreenshotMode() {
  clearScreenshotCursorReset();

  const cursor = cursorAtLastScreenshotPoint();
  const style = document.createElement("style");
  style.setAttribute("data-contextlens-cursor-reset", "true");
  style.textContent = `html, body, body * { cursor: ${cursor} !important; }`;
  (document.head ?? document.documentElement).appendChild(style);

  const cleanup = () => {
    document.removeEventListener("pointermove", cleanup, true);
    document.removeEventListener("mousedown", cleanup, true);
    document.removeEventListener("wheel", cleanup, true);
    document.removeEventListener("touchstart", cleanup, true);
    document.removeEventListener("keydown", cleanup, true);
    window.removeEventListener("scroll", cleanup, true);
    style.remove();
    screenshotCursorResetCleanup = null;
  };

  screenshotCursorResetCleanup = cleanup;
  document.addEventListener("pointermove", cleanup, true);
  document.addEventListener("mousedown", cleanup, true);
  document.addEventListener("wheel", cleanup, true);
  document.addEventListener("touchstart", cleanup, true);
  document.addEventListener("keydown", cleanup, true);
  window.addEventListener("scroll", cleanup, true);
}

function recaptureScreenshotAfterScroll(delay = 450) {
  if (screenshotRepositionTimer !== null) window.clearTimeout(screenshotRepositionTimer);
  screenshotRepositionTimer = window.setTimeout(() => {
    screenshotRepositionTimer = null;
    screenshotRepositionCleanup?.();
    screenshotRepositionCleanup = null;
    if (cameraBtn) cameraBtn.style.display = "none";
    requestScreenshotCapture();
  }, delay);
}

function startScreenshotReposition(initialWheel?: WheelEvent) {
  clearScreenshotReposition();
  screenshotCapturePending = false;
  removeCropOverlay(false);
  if (cameraBtn) cameraBtn.style.display = "none";

  const schedule = () => recaptureScreenshotAfterScroll();
  const cancel = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    clearScreenshotReposition();
    if (cameraBtn) cameraBtn.style.display = "";
  };

  window.addEventListener("scroll", schedule, true);
  window.addEventListener("wheel", schedule, { capture: true, passive: true });
  window.addEventListener("touchend", schedule, true);
  window.addEventListener("keydown", cancel, true);
  screenshotRepositionCleanup = () => {
    window.removeEventListener("scroll", schedule, true);
    window.removeEventListener("wheel", schedule, true);
    window.removeEventListener("touchend", schedule, true);
    window.removeEventListener("keydown", cancel, true);
  };

  if (initialWheel) {
    window.scrollBy({ left: initialWheel.deltaX, top: initialWheel.deltaY, behavior: "auto" });
  }
  recaptureScreenshotAfterScroll();
}

function showCropOverlay(screenshotDataUrl: string, restoreScroll?: { x: number; y: number }, screenshotId?: number) {
  if (
    typeof screenshotId === "number"
    && (cancelledScreenshotCaptureIds.has(screenshotId)
      || (screenshotCaptureRequestId !== null && screenshotCaptureRequestId !== screenshotId))
  ) {
    return;
  }
  const hadPendingScreenshotCapture = screenshotCapturePending;
  clearScreenshotReposition();
  screenshotCapturePending = false;
  if (typeof screenshotId === "number") cancelledScreenshotCaptureIds.delete(screenshotId);
  screenshotCaptureRequestId = null;
  if (!hadPendingScreenshotCapture) screenshotLastCursorPoint = null;
  removeCropOverlay(false);
  if (cameraBtn) cameraBtn.style.display = "none";
  if (restoreScroll) window.scrollTo(restoreScroll.x, restoreScroll.y);

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
    touch-action: auto;
  `);
  const cropCleanupTasks: Array<() => void> = [];
  (cropOverlay as CropOverlayElement).__contextLensCleanup = () => {
    while (cropCleanupTasks.length) {
      try {
        cropCleanupTasks.pop()?.();
      } catch {
        // Keep restoring the page even if one cleanup step fails.
      }
    }
  };

  const overlayElement = cropOverlay;
  const trackScreenshotPointer = (event: PointerEvent) => rememberScreenshotCursorPoint(event);
  overlayElement.addEventListener("pointermove", trackScreenshotPointer);
  overlayElement.addEventListener("pointerdown", trackScreenshotPointer);
  overlayElement.addEventListener("pointerup", trackScreenshotPointer);
  cropCleanupTasks.push(() => {
    overlayElement.removeEventListener("pointermove", trackScreenshotPointer);
    overlayElement.removeEventListener("pointerdown", trackScreenshotPointer);
    overlayElement.removeEventListener("pointerup", trackScreenshotPointer);
  });

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

  let dragStart: { x: number; y: number } | null = null;
  let selection: { x: number; y: number; w: number; h: number } | null = null;
  let contextPanel: HTMLElement | null = null;
  let contextPanelOutsideHandler: ((event: MouseEvent) => void) | null = null;
  let contextPanelSubmitted = false;
  let contextPanelLeft = 8;
  let contextPanelTop = 8;
  let contextPanelWidth = panelWidthFor();
  let panelDeepDiveActive = false;
  let panelHardWordsOpen = false;
  let panelAnalogyText = "";
  let panelAnalogyLoading = false;
  let activePanelImageData = "";
  let activePanelContext = "";
  let activePanelStreamSession = 0;
  let userPlacedContextPanel = false;
  const contextPanelConversationScroll = createConversationScrollState();
  cropCleanupTasks.push(() => { activePanelStreamSession += 1; });

  function nextPanelStreamSession() {
    activePanelStreamSession += 1;
    return activePanelStreamSession;
  }

  function isPanelStreamCurrent(session: number) {
    return activePanelStreamSession === session;
  }

  function invalidatePanelStream(session: number) {
    if (activePanelStreamSession === session) activePanelStreamSession += 1;
  }

  cropOverlay.addEventListener("wheel", (event) => {
    if (event.target instanceof Element && event.target.closest(".cl-scroll")) return;
    if (dragStart || contextPanel) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    startScreenshotReposition(event);
  }, { passive: false });
  cropOverlay.addEventListener("touchmove", (event) => {
    if (event.target instanceof Element && event.target.closest(".cl-scroll")) return;
    if (dragStart || contextPanel) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    startScreenshotReposition();
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

    function getPos(e: Pick<MouseEvent, "clientX" | "clientY">) {
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

    function cropSelection(): ScreenshotCrop | null {
      if (!selection) return null;
      const offscreen = document.createElement("canvas");
      offscreen.width = selection.w;
      offscreen.height = selection.h;
      const offCtx = offscreen.getContext("2d")!;
      offCtx.drawImage(img, selection.x, selection.y, selection.w, selection.h, 0, 0, selection.w, selection.h);
      return {
        imageData: offscreen.toDataURL("image/png"),
        imagePreviewData: createScreenshotPreviewData(offscreen),
      };
    }

    function styleAnswerPanel() {
      if (!contextPanel) return;
      const colors = uiColors();
      contextPanelWidth = panelWidthFor();
      const maxHeight = expandedPanelMaxHeight();
      const actualHeight = contextPanel.getBoundingClientRect().height;
      const heightForClamp = actualHeight > 0 ? Math.min(actualHeight, maxHeight) : maxHeight;
      contextPanelLeft = clampLeftToViewport(contextPanelLeft, contextPanelWidth);
      contextPanelTop = panelTopFor(contextPanelTop, heightForClamp);
      contextPanel.setAttribute("style", `
        position: fixed;
        left: ${contextPanelLeft}px;
        top: ${contextPanelTop}px;
        background: ${colors.panel};
        backdrop-filter: blur(8px);
        border: 1px solid ${colors.border};
        border-radius: 10px;
        padding: 14px;
        width: ${contextPanelWidth}px;
        max-height: ${maxHeight}px;
        box-shadow: ${colors.shadow};
        font-family: ${LATIN_FONT_STACK};
        z-index: 2147483647;
        cursor: default;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        direction: ltr;
        text-align: left;
        overflow: hidden;
      `);
    }

    function settleAnswerPanelPosition(lift = 0) {
      if (!contextPanel) return;
      const maxHeight = expandedPanelMaxHeight();
      const actualHeight = contextPanel.getBoundingClientRect().height;
      const heightForClamp = Math.min(actualHeight > 0 ? actualHeight : maxHeight, maxHeight);
      contextPanelLeft = clampLeftToViewport(contextPanelLeft, contextPanelWidth);
      contextPanelTop = panelTopFor(userPlacedContextPanel ? contextPanelTop : contextPanelTop - lift, heightForClamp);
      contextPanel.style.left = `${contextPanelLeft}px`;
      contextPanel.style.top = `${contextPanelTop}px`;
      contextPanel.style.maxHeight = `${maxHeight}px`;
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
      actionButtonClick(closeBtn, () => removeCropOverlay());
      contextPanel.replaceChildren(message, closeBtn);
    }

    function renderSignInRequiredPanel() {
      if (!contextPanel) return;
      styleAnswerPanel();
      const colors = uiColors();
      const msg = document.createElement("div");
      msg.textContent = "Sign in to save screenshots and get explanations.";
      msg.setAttribute("style", `color:${colors.text};font-size:14px;line-height:1.6;margin-bottom:14px;`);
      const signInBtn = document.createElement("button");
      signInBtn.textContent = "Sign In";
      signInBtn.setAttribute("style", `background:${colors.accent};color:${colors.accentText};border:none;border-radius:7px;padding:8px 14px;font-size:13px;font-weight:700;cursor:pointer;margin-right:8px;`);
      actionButtonClick(signInBtn, () => { chrome.runtime.openOptionsPage(); removeCropOverlay(); });
      const closeBtn = document.createElement("button");
      closeBtn.textContent = "Dismiss";
      closeBtn.setAttribute("style", `background:${colors.subtle};color:${colors.text};border:1px solid ${colors.border};border-radius:7px;padding:8px 13px;font-size:13px;font-weight:600;cursor:pointer;`);
      actionButtonClick(closeBtn, () => removeCropOverlay());
      const row = document.createElement("div");
      row.setAttribute("style", "display:flex;gap:0;");
      row.appendChild(signInBtn);
      row.appendChild(closeBtn);
      contextPanel.replaceChildren(msg, row);
    }

      function renderConversationPanel(captureId: string, messages: ChatMessage[], loading = false, loadingText = "Thinking…") {
        if (!contextPanel) return;
        rememberConversationScroll(contextPanelConversationScroll, contextPanel.querySelector<HTMLElement>('[data-cl-conversation-list="screenshot"]'));
        styleAnswerPanel();
        const colors = uiColors();

        const dragHandle = document.createElement("div");
        dragHandle.setAttribute("style", `
          cursor: grab;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: -14px -14px 10px -14px;
          border-bottom: 1px solid ${colors.faintBorder};
          flex-shrink: 0;
          user-select: none;
          touch-action: none;
        `);
        dragHandle.title = "Drag overlay";
        const dragDots = document.createElement("span");
        dragDots.textContent = "···";
        dragDots.setAttribute("style", `color:${colors.muted};font-size:13px;letter-spacing:4px;line-height:1;`);
        dragHandle.appendChild(dragDots);
        dragHandle.addEventListener("mousedown", (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          userPlacedContextPanel = true;
          const startX = event.clientX;
          const startY = event.clientY;
          const drag = contextPanel
            ? elementDragState(contextPanel, { left: contextPanelLeft, top: contextPanelTop })
            : {
                position: { left: contextPanelLeft, top: contextPanelTop },
                bounds: { left: 0, top: 0, width: viewportWidth(), height: viewportHeight() },
              };
          const startLeft = drag.position.left;
          const startTop = drag.position.top;
          dragHandle.style.cursor = "grabbing";

          const onMove = (moveEvent: MouseEvent) => {
            const dragHeight = Math.min(contextPanel?.getBoundingClientRect().height || expandedPanelMaxHeight(), expandedPanelMaxHeight());
            const next = clampDraggedOverlay(
              startLeft + moveEvent.clientX - startX,
              startTop + moveEvent.clientY - startY,
              contextPanelWidth,
              dragHeight,
              drag.bounds,
            );
            contextPanelLeft = next.left;
            contextPanelTop = next.top;
            if (contextPanel) {
              contextPanel.style.left = `${contextPanelLeft}px`;
              contextPanel.style.top = `${contextPanelTop}px`;
            }
          };
          const onUp = () => {
            dragHandle.style.cursor = "grab";
            document.removeEventListener("mousemove", onMove, true);
            document.removeEventListener("mouseup", onUp, true);
          };
          document.addEventListener("mousemove", onMove, true);
          document.addEventListener("mouseup", onUp, true);
        });

        ensureBaseStyles();
      const list = document.createElement("div");
      list.className = "cl-scroll";
      list.setAttribute("data-cl-conversation-list", "screenshot");
      list.setAttribute("style", `flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overflow-anchor:none;scrollbar-gutter:stable;padding:0 12px 0 12px;margin:0 -4px 12px -4px;box-sizing:border-box;`);
      trapScroll(list);
      trackConversationScroll(contextPanelConversationScroll, list);

      const initialPanelHardWords = messages.length === 1 && messages[0].role === "assistant"
        ? hardWordEntries(messages[0].content)
        : [];
      const focusedPanelHardWords = panelHardWordsOpen && initialPanelHardWords.length > 0;
      let latestPanelAssistantBlock: HTMLElement | null = null;
      let latestPanelUserBlock: HTMLElement | null = null;

      if (focusedPanelHardWords) {
        const label = document.createElement("div");
        label.textContent = "Hard Words";
        label.setAttribute("style", `color:${colors.muted};font-size:11px;font-weight:600;margin:0 0 6px;`);
        const body = document.createElement("div");
        body.setAttribute("style", `
          color: ${colors.text};
          font-size: ${cardFontSize === "sm" ? "14px" : cardFontSize === "lg" ? "19px" : "16px"};
          line-height: 1.83;
          white-space: pre-wrap;
        `);
        appendHardWordRows(body, initialPanelHardWords);
        list.appendChild(label);
        list.appendChild(body);
      } else {
        messages.forEach((message, index) => {
          const messageBlock = document.createElement("div");
          if (message.role === "user") {
            messageBlock.setAttribute("style", `border-left:2px solid ${colorWithAlpha(accentColor, 0.45)};padding-left:10px;margin:10px 0 12px;`);
            latestPanelUserBlock = messageBlock;
          } else {
            latestPanelAssistantBlock = messageBlock;
          }

          const label = document.createElement("div");
          label.textContent = message.role === "assistant" ? "AI" : "You";
          label.setAttribute("style", `color:${colors.muted};font-size:11px;font-weight:600;margin:0 0 3px;`);

          const body = document.createElement("div");
          if (loading && message.role === "assistant" && index === messages.length - 1) {
            body.setAttribute("data-cl-stream-assistant-body", "1");
            streamingBodyText.set(body, message.content);
          }
          appendMessageBody(body, message, index, messages, loading);
          const aiFontSize = cardFontSize === "sm" ? "14px" : cardFontSize === "lg" ? "19px" : "16px";
          const messageDirection = firstStrongTextDirection(message.content);
          const messageBaseDirection = messageDirection === "auto" ? "ltr" : messageDirection;
          body.setAttribute("style", `
            color: ${message.role === "assistant" ? colors.text : colors.userText};
            font-size: ${message.role === "assistant" ? aiFontSize : "14px"};
            line-height: 1.83;
            margin-bottom: 12px;
            max-width: 100%;
            overflow-wrap: break-word;
            white-space: pre-wrap;
            direction: ${message.role === "user" ? messageBaseDirection : "ltr"};
            text-align: ${message.role === "user" && messageBaseDirection === "rtl" ? "right" : "left"};
            unicode-bidi: ${message.role === "user" ? "plaintext" : "normal"};
          `);

          messageBlock.appendChild(label);
          messageBlock.appendChild(body);
          list.appendChild(messageBlock);
        });
      }

      const showLoadingIndicator = loading && !latestMessageHasAssistantContent(messages);
      if (showLoadingIndicator) {
        const loadingBlock = document.createElement("div");
        const label = document.createElement("div");
        label.textContent = "AI";
        label.setAttribute("style", `color:${colors.muted};font-size:11px;font-weight:600;margin:0 0 3px;`);
        const body = document.createElement("div");
        body.textContent = loadingText;
        body.setAttribute("style", `color:${panelDeepDiveActive ? colors.accent : colors.muted};font-size:14px;font-style:italic;line-height:1.65;margin-bottom:12px;`);
        loadingBlock.appendChild(label);
        loadingBlock.appendChild(body);
        latestPanelAssistantBlock = loadingBlock;
        list.appendChild(loadingBlock);
      }

      const input = document.createElement("textarea");
      input.className = "cl-scroll";
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
        text-align: left;
        unicode-bidi: plaintext;
      `);
      autosizeTextarea(input);
      syncTextareaDirection(input);
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
      actionButtonClick(closeBtn, () => removeCropOverlay());

      const row = document.createElement("div");
      row.setAttribute("style", "display:flex;gap:8px;align-items:center;flex-shrink:0;");
      row.appendChild(input);
      row.appendChild(askBtn);
      row.appendChild(closeBtn);

      function askFollowup() {
        const question = input.value.trim();
        if (!question || loading) return;
        panelHardWordsOpen = false;
        const nextMessages: ChatMessage[] = [...messages, { role: "user", content: question }];
        beginConversationStream(contextPanelConversationScroll, contextPanel?.querySelector<HTMLElement>('[data-cl-conversation-list="screenshot"]') ?? null);
        renderConversationPanel(captureId, nextMessages, true, "Thinking…");
        const streamSession = nextPanelStreamSession();
        let streamed = "";
        let streamRendered = false;
        const renderStream = createStreamRenderScheduler((text) => {
          if (!isPanelStreamCurrent(streamSession)) return;
          if (!streamRendered || !updateStreamingAssistantBody(contextPanel, "screenshot", contextPanelConversationScroll, text)) {
            renderConversationPanel(captureId, [...nextMessages, { role: "assistant", content: text }], true, "Writing…");
            streamRendered = true;
          }
        });
        streamRuntimeMessage<{ reply: string; messages: ChatMessage[] }>({
          type: "ASK_FOLLOWUP_STREAM",
          captureId,
          question,
          deepDive: false,
          fallbackImageData: activePanelImageData,
          fallbackContext: activePanelContext,
          fallbackUrl: location.href,
          fallbackTitle: document.title,
        }, {
          onChunk: (chunk) => {
            if (!isPanelStreamCurrent(streamSession)) return;
            streamed += chunk;
            renderStream(streamed);
          },
        })
          .then((response) => {
            if (!isPanelStreamCurrent(streamSession)) return;
            renderStream.finish(() => {
              if (!isPanelStreamCurrent(streamSession)) return;
              endConversationStream(contextPanelConversationScroll);
              renderConversationPanel(captureId, response.messages ?? [...nextMessages, { role: "assistant", content: response.reply }]);
            });
          })
          .catch((error) => {
            if (!isPanelStreamCurrent(streamSession)) return;
            invalidatePanelStream(streamSession);
            renderStream.cancel();
            endConversationStream(contextPanelConversationScroll);
            renderConversationPanel(captureId, [...nextMessages, { role: "assistant", content: error.message }]);
          });
      }

      input.addEventListener("input", () => {
        syncTextareaDirection(input);
        autosizeTextarea(input);
      });
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          askFollowup();
        }
        if (event.key === "Escape") removeCropOverlay();
      });
      actionButtonClick(askBtn, () => askFollowup());

      const panelChildren: Node[] = [list];
      const actionRow = document.createElement("div");
      actionRow.setAttribute("style", `
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        flex-shrink: 0;
        margin-top: 16px;
        margin-bottom: 10px;
      `);
      let analogyBox: HTMLElement | null = null;

      if (!loading && messages.length === 1 && messages[0].role === "assistant" && initialPanelHardWords.length > 0) {
        const hwBtn = document.createElement("button");
        hwBtn.textContent = panelHardWordsOpen ? "Back" : "📘 Hard Words";
        const hardWordsColors = neutralActionColors(colors);
        const hwBase = `
          align-self: flex-start;
          background: ${hardWordsColors.background};
          color: ${hardWordsColors.color};
          border: 1px solid ${hardWordsColors.border};
          border-radius: 6px;
          padding: 5px 10px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          letter-spacing: 0.02em;
        `;
        hwBtn.setAttribute("style", hwBase);
        hwBtn.addEventListener("mouseenter", () => {
          hwBtn.style.background = hardWordsColors.hoverBackground;
          hwBtn.style.borderColor = hardWordsColors.hoverBorder;
        });
        hwBtn.addEventListener("mouseleave", () => {
          hwBtn.style.background = hardWordsColors.background;
          hwBtn.style.borderColor = hardWordsColors.border;
        });
        actionButtonClick(hwBtn, () => {
          panelHardWordsOpen = !panelHardWordsOpen;
          renderConversationPanel(captureId, messages, false, loadingText);
        });
        actionRow.appendChild(hwBtn);
      }

      if (!loading && messages.length === 1 && messages[0].role === "assistant") {
        const analogyColors = analogyActionColors();
        if (panelAnalogyLoading) {
          const analogyStatus = document.createElement("div");
          analogyStatus.textContent = "Finding an analogy…";
          analogyStatus.setAttribute("style", `color:${colors.muted};font-size:13px;font-style:italic;`);
          actionRow.appendChild(analogyStatus);
        } else if (panelAnalogyText) {
          analogyBox = document.createElement("div");
          analogyBox.textContent = panelAnalogyText;
          analogyBox.setAttribute("style", `
            flex-shrink: 0;
            background: ${analogyColors.background};
            border: 1px solid ${analogyColors.border};
            border-radius: 7px;
            color: ${analogyColors.text};
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
            color: ${analogyColors.text};
            border: 1px solid ${analogyColors.buttonBorder};
            border-radius: 6px;
            padding: 5px 10px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            letter-spacing: 0.02em;
          `);
          analogyBtn.addEventListener("mouseenter", () => {
            analogyBtn.style.background = analogyColors.hoverBackground;
            analogyBtn.style.borderColor = analogyColors.hoverButtonBorder;
          });
          analogyBtn.addEventListener("mouseleave", () => {
            analogyBtn.style.background = "transparent";
            analogyBtn.style.borderColor = analogyColors.buttonBorder;
          });
          actionButtonClick(analogyBtn, () => {
            panelAnalogyLoading = true;
            renderConversationPanel(captureId, messages, false);
            sendRuntimeMessage<{ analogy: string }>({ type: "ANALOGY", text: messages[0].content })
              .then((response) => { panelAnalogyText = response.analogy; panelAnalogyLoading = false; if (!panelDeepDiveActive) renderConversationPanel(captureId, messages, false); })
              .catch(() => { panelAnalogyLoading = false; if (!panelDeepDiveActive) renderConversationPanel(captureId, messages, false); });
          });
          actionRow.appendChild(analogyBtn);
        }
      }

      if (!loading && !panelDeepDiveActive && messages.some((message) => message.role === "assistant")) {
        const deepDiveBtn = document.createElement("button");
        deepDiveBtn.textContent = "✦ Deep Dive";
        deepDiveBtn.setAttribute("style", `
          background: ${colorWithAlpha(accentColor, 0.06)};
          color: ${accentColor};
          border: 1px solid ${colorWithAlpha(accentColor, 0.35)};
          border-radius: 6px;
          padding: 5px 10px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          letter-spacing: 0.02em;
        `);
        deepDiveBtn.addEventListener("mouseenter", () => {
          deepDiveBtn.style.background = colorWithAlpha(accentColor, 0.12);
          deepDiveBtn.style.borderColor = colorWithAlpha(accentColor, 0.55);
        });
        deepDiveBtn.addEventListener("mouseleave", () => {
          deepDiveBtn.style.background = colorWithAlpha(accentColor, 0.06);
          deepDiveBtn.style.borderColor = colorWithAlpha(accentColor, 0.35);
        });
        actionButtonClick(deepDiveBtn, () => {
          panelDeepDiveActive = true;
          panelAnalogyText = "";
          panelAnalogyLoading = false;
          ensureDeepDiveStyles();
          const deepDiveMessages = deepDiveDisplayMessages(messages);
          beginConversationStream(contextPanelConversationScroll, contextPanel?.querySelector<HTMLElement>('[data-cl-conversation-list="screenshot"]') ?? null);
          renderConversationPanel(captureId, deepDiveMessages, true, "Thinking through a deeper answer…");
          contextPanel?.classList.add("cl-deep-dive-glow");
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Deep Dive timed out. Please try again.")), 90_000)
          );
          const streamSession = nextPanelStreamSession();
          let streamed = "";
          let streamRendered = false;
          const renderStream = createStreamRenderScheduler((text) => {
            if (!isPanelStreamCurrent(streamSession)) return;
            if (!streamRendered || !updateStreamingAssistantBody(contextPanel, "screenshot", contextPanelConversationScroll, text)) {
              renderConversationPanel(captureId, deepDiveDisplayMessages(messages, text), true, "Writing…");
              streamRendered = true;
            }
          }, {
            firstPaintDelayMs: DEEP_DIVE_FIRST_PAINT_DELAY_MS,
            firstPaintMinChars: DEEP_DIVE_FIRST_PAINT_MIN_CHARS,
          });
          Promise.race([
            streamRuntimeMessage<{ explanation: string; messages: ChatMessage[] }>({
              type: "DEEP_DIVE_STREAM",
              captureId,
              fallbackImageData: activePanelImageData,
              fallbackContext: activePanelContext,
              fallbackUrl: location.href,
              fallbackTitle: document.title,
            }, {
              onChunk: (chunk) => {
                if (!isPanelStreamCurrent(streamSession)) return;
                streamed += chunk;
                renderStream(streamed);
              },
            }),
            timeout,
          ])
            .then((response) => {
              if (!isPanelStreamCurrent(streamSession)) return;
              renderStream.finish(() => {
                if (!isPanelStreamCurrent(streamSession)) return;
                contextPanel?.classList.remove("cl-deep-dive-glow");
                contextPanel?.classList.add("cl-deep-dive-active");
                endConversationStream(contextPanelConversationScroll);
                renderConversationPanel(captureId, deepDiveDisplayMessages(response.messages ?? deepDiveMessages, response.explanation));
              });
            })
            .catch((error: Error) => {
              if (!isPanelStreamCurrent(streamSession)) return;
              invalidatePanelStream(streamSession);
              renderStream.cancel();
              contextPanel?.classList.remove("cl-deep-dive-glow");
              panelDeepDiveActive = false;
              endConversationStream(contextPanelConversationScroll);
              if (error.message === "DEEP_DIVE_LIMIT_REACHED") {
                renderConversationPanel(captureId, deepDiveDisplayMessages(messages, "Deep Dive is in beta — you've used all your free sessions. We'll open up more as we grow. Thanks for being an early explorer."));
              } else {
                renderConversationPanel(captureId, deepDiveDisplayMessages(messages, error.message || "Deep Dive could not load. Please try again."));
              }
            });
        });
        actionRow.appendChild(deepDiveBtn);
      }

      if (actionRow.childNodes.length > 0) panelChildren.push(actionRow);
      if (analogyBox) panelChildren.push(analogyBox);

      panelChildren.push(row);
      contextPanel.replaceChildren(dragHandle, ...panelChildren);
      requestAnimationFrame(() => {
        settleAnswerPanelPosition(!loading && messages.length === 1 ? Math.min(52, Math.max(28, viewportHeight() * 0.06)) : 0);
        restoreConversationScroll(contextPanelConversationScroll, list, { latestUser: latestPanelUserBlock, latestAssistant: latestPanelAssistantBlock }, { preserveBottom: !loading });
        if (!loading) stopConversationAutoFollow(contextPanelConversationScroll);
      });
      if (!loading) setTimeout(() => input.focus({ preventScroll: true }), 50);
      closeContextPanelOnOutsideClick();
    }

    function cropAndSend(context: string) {
      if (contextPanelSubmitted) return;
      const crop = cropSelection();
      if (!crop) return;

      chrome.storage.local.get("contextlens_user", (result) => {
        if (!result.contextlens_user) {
          contextPanelSubmitted = false;
          renderSignInRequiredPanel();
          return;
        }

        contextPanelSubmitted = true;
        activePanelImageData = crop.imageData;
        activePanelContext = context;
        removeContextPanelOutsideHandler();

        getShowAnswerImmediately((immediate) => {
          if (!immediate) {
            chrome.runtime.sendMessage({ type: "SAVE_SCREENSHOT", imageData: crop.imageData, imagePreviewData: crop.imagePreviewData, context } as Message);
            removeCropOverlay();
            return;
          }

          beginConversationStream(contextPanelConversationScroll, contextPanel?.querySelector<HTMLElement>('[data-cl-conversation-list="screenshot"]') ?? null);
          renderLoadingPanel();
          const streamSession = nextPanelStreamSession();
          let captureId = "";
          let streamed = "";
          let streamRendered = false;
          const renderStream = createStreamRenderScheduler((text) => {
            if (captureId && isPanelStreamCurrent(streamSession)) {
              if (!streamRendered || !updateStreamingAssistantBody(contextPanel, "screenshot", contextPanelConversationScroll, text)) {
                renderConversationPanel(captureId, [{ role: "assistant", content: text }], true, "Writing…");
                streamRendered = true;
              }
            }
          });
          streamRuntimeMessage<{ captureId: string; explanation: string }>({ type: "EXPLAIN_SCREENSHOT_STREAM", imageData: crop.imageData, imagePreviewData: crop.imagePreviewData, context }, {
            onStart: (id) => {
              if (!isPanelStreamCurrent(streamSession)) return;
              captureId = id;
              if (streamed) renderStream(streamed);
            },
            onChunk: (chunk) => {
              if (!isPanelStreamCurrent(streamSession)) return;
              streamed += chunk;
              if (captureId) renderStream(streamed);
            },
          })
            .then((response) => {
              if (!isPanelStreamCurrent(streamSession)) return;
              renderStream.finish(() => {
                if (!isPanelStreamCurrent(streamSession)) return;
                endConversationStream(contextPanelConversationScroll);
                renderConversationPanel(response.captureId, [{ role: "assistant", content: response.explanation }]);
              });
            })
            .catch((error) => {
              if (!isPanelStreamCurrent(streamSession)) return;
              invalidatePanelStream(streamSession);
              renderStream.cancel();
              endConversationStream(contextPanelConversationScroll);
              if (isAuthRefreshRequiredError(error)) {
                contextPanelSubmitted = false;
                renderSignInRequiredPanel();
                return;
              }
              renderErrorPanel(error.message);
            });
        });
      });
    }

    function showContextPanel(sel: { x: number; y: number; w: number; h: number }) {
      removeContextPanel();
      contextPanelSubmitted = false;
      ensureBaseStyles();
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
      isolateContextLensUiEvents(contextPanel);
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
        font-family: ${LATIN_FONT_STACK};
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
        cursor: grab;
        user-select: none;
        touch-action: none;
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
      preview.title = "Drag overlay";

      header.title = "Drag overlay";
      header.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        if (e.target instanceof Element && e.target.closest("button")) return;
        e.preventDefault();
        e.stopPropagation();
        userPlacedContextPanel = true;
        const startX = e.clientX;
        const startY = e.clientY;
        const drag = contextPanel
          ? elementDragState(contextPanel, { left: contextPanelLeft, top: contextPanelTop })
          : {
              position: { left: contextPanelLeft, top: contextPanelTop },
              bounds: { left: 0, top: 0, width: viewportWidth(), height: viewportHeight() },
            };
        const startLeft = drag.position.left;
        const startTop = drag.position.top;
        header.style.cursor = "grabbing";

        const onMove = (ev: MouseEvent) => {
          const dragHeight = Math.min(contextPanel?.getBoundingClientRect().height || panelH, expandedPanelMaxHeight());
          const next = clampDraggedOverlay(startLeft + ev.clientX - startX, startTop + ev.clientY - startY, contextPanelWidth, dragHeight, drag.bounds);
          contextPanelLeft = next.left;
          contextPanelTop = next.top;
          if (contextPanel) {
            contextPanel.style.left = `${contextPanelLeft}px`;
            contextPanel.style.top = `${contextPanelTop}px`;
          }
        };
        const onUp = () => {
          header.style.cursor = "grab";
          document.removeEventListener("mousemove", onMove, true);
          document.removeEventListener("mouseup", onUp, true);
        };
        document.addEventListener("mousemove", onMove, true);
        document.addEventListener("mouseup", onUp, true);
      });

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
      input.className = "cl-scroll";
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
        text-align: left;
        unicode-bidi: plaintext;
      `);
      autosizeTextarea(input);
      syncTextareaDirection(input);
      trapScroll(input);

      function doSave() {
        cropAndSend(input.value.trim());
      }

      actionButtonClick(cancelBtn, () => {
        removeContextPanelOutsideHandler();
        removeCropOverlay();
      });

      input.addEventListener("input", () => {
        syncTextareaDirection(input);
        autosizeTextarea(input);
      });
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
          removeCropOverlay();
        };
        document.addEventListener("mousedown", contextPanelOutsideHandler, true);
      }, 50);
    }

    let dragPointerId: number | null = null;

    function updateSelection(pos: { x: number; y: number }) {
      if (!dragStart) return;
      selection = {
        x: Math.min(dragStart.x, pos.x),
        y: Math.min(dragStart.y, pos.y),
        w: Math.abs(pos.x - dragStart.x),
        h: Math.abs(pos.y - dragStart.y),
      };
      redraw();
    }

    function finishSelection() {
      if (!dragStart) return;
      if (!selection) {
        dragStart = null;
        removeCropOverlay();
        return;
      }
      if (selection.w < 10 || selection.h < 10) {
        dragStart = null;
        selection = null;
        removeCropOverlay();
        return;
      }
      dragStart = null;
      canvas.style.cursor = "default";
      cropOverlay!.style.cursor = "default";
      showContextPanel(selection);
    }

    canvas.addEventListener("pointerdown", (e) => {
      if (contextPanel || !e.isPrimary || e.button !== 0) return;
      e.preventDefault();
      dragPointerId = e.pointerId;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture can fail if the page changes underneath the event.
      }
      dragStart = getPos(e);
      selection = null;
      redraw();
    });

    canvas.addEventListener("pointermove", (e) => {
      if (dragPointerId !== e.pointerId || !dragStart || contextPanel) return;
      e.preventDefault();
      updateSelection(getPos(e));
    });

    canvas.addEventListener("pointerup", (e) => {
      if (dragPointerId !== e.pointerId) return;
      e.preventDefault();
      updateSelection(getPos(e));
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore release failures from already-cancelled captures.
      }
      dragPointerId = null;
      finishSelection();
    });

    canvas.addEventListener("pointercancel", (e) => {
      if (dragPointerId !== e.pointerId) return;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore release failures from already-cancelled captures.
      }
      dragPointerId = null;
      dragStart = null;
      selection = null;
      redraw();
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
    const selected = selectedPageText();
    showContextInput(x, y, selected?.text || message.text);
  }
  if (message.type === "SHOW_CROP_OVERLAY") {
    showCropOverlay(
      message.imageData,
      typeof message.scrollX === "number" && typeof message.scrollY === "number"
        ? { x: message.scrollX, y: message.scrollY }
        : undefined,
      message.screenshotId,
    );
  }
};
chrome.runtime.onMessage.addListener(runtimeMessageHandler);
cleanupTasks.push(() => chrome.runtime.onMessage.removeListener(runtimeMessageHandler));

// Show Ask bubble (or immediate context input) on text selection
type RectLike = Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">;
type SelectionAnchor = { clientX: number; clientY: number };
type SelectedTextGeometry = { text: string; rect: RectLike; bounds: RectLike };

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

function normalizeCandidateText(value: string) {
  return value
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasArabicScript(value: string) {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u.test(value);
}

function normalizeArabicForCompare(value: string) {
  return normalizeCandidateText(value)
    .normalize("NFKC")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640\s]/g, "");
}

function normalizePageUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

function normalizeForSimilarity(value: string) {
  const base = normalizeCandidateText(value).normalize("NFKC").toLowerCase();
  return hasArabicScript(base)
    ? base.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "")
    : base;
}

function bigrams(value: string) {
  const compact = value.replace(/\s+/g, "");
  if (compact.length < 2) return compact ? [compact] : [];
  return Array.from({ length: compact.length - 1 }, (_, index) => compact.slice(index, index + 2));
}

function characterSimilarity(a: string, b: string) {
  const left = normalizeForSimilarity(a);
  const right = normalizeForSimilarity(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.55) return 0.92;

  const leftBigrams = bigrams(left);
  const rightCounts = new Map<string, number>();
  bigrams(right).forEach((gram) => rightCounts.set(gram, (rightCounts.get(gram) ?? 0) + 1));
  let overlap = 0;
  leftBigrams.forEach((gram) => {
    const count = rightCounts.get(gram) ?? 0;
    if (count > 0) {
      overlap += 1;
      rightCounts.set(gram, count - 1);
    }
  });
  const denominator = leftBigrams.length + Array.from(rightCounts.values()).reduce((sum, count) => sum + count, 0) + overlap;
  return denominator === 0 ? 0 : (2 * overlap) / denominator;
}

function getLocalCaptures(): Promise<Capture[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get("captures", (result) => resolve(result.captures ?? []));
  });
}

async function similarRecentSave(text: string, url: string, context: string): Promise<Capture | null> {
  const captures = await getLocalCaptures();
  const now = Date.now();
  const pageUrl = normalizePageUrl(url);
  const normalizedText = normalizeForSimilarity(text);
  const normalizedContext = normalizeForSimilarity(context);
  if (!normalizedText) return null;

  return captures
    .filter((capture) => {
      if (capture.imageData) return false;
      if (normalizePageUrl(capture.url) !== pageUrl) return false;
      const age = now - new Date(capture.savedAt).getTime();
      if (age < 0 || age > 5 * 60_000) return false;
      const existing = normalizeForSimilarity(capture.text);
      const existingContext = normalizeForSimilarity(capture.context);
      if (!existing) return false;
      if (existing === normalizedText) return existingContext !== normalizedContext;
      return characterSimilarity(existing, normalizedText) >= 0.86;
    })
    .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())[0] ?? null;
}

function shortRelativeTime(iso: string) {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"} ago`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
}

function isSuspiciousSelectionText(value: string) {
  const text = normalizeCandidateText(value);
  if (!text) return true;
  if (/[\uE000-\uF8FF]/u.test(text)) return true;
  if (/^[\sـ۝۞۩.,:;!?()[\]{}'"`´’‘“”«»\-–—\d٠-٩۰-۹]+$/u.test(text)) return true;
  return normalizeArabicForCompare(text).length === 0;
}

function candidateAttributeValues(element: Element) {
  const preferredAttributes = [
    "aria-label",
    "aria-description",
    "data-arabic",
    "data-arabic-text",
    "data-uthmani",
    "data-uthmani-text",
    "data-ayah",
    "data-ayah-text",
    "data-aya",
    "data-aya-text",
    "data-verse",
    "data-verse-text",
    "data-word",
    "data-word-text",
    "data-text",
    "data-normalized",
    "data-normalized-text",
    "title",
  ];
  const values: string[] = [];

  preferredAttributes.forEach((name) => {
    const value = element.getAttribute(name);
    if (value) values.push(value);
  });

  Array.from(element.attributes).forEach((attribute) => {
    const name = attribute.name.toLowerCase();
    if (!name.startsWith("data-")) return;
    if (preferredAttributes.includes(name)) return;
    if (!/(arabic|uthmani|ayah|aya|verse|word|text|label|original|source)/i.test(name)) return;
    if (/(translation|transliteration|meaning|audio|url|href|id|key|test)/i.test(name)) return;
    values.push(attribute.value);
  });

  const seen = new Set<string>();
  return values
    .map(normalizeCandidateText)
    .filter((value) => value.length > 0)
    .filter((value) => {
      const key = value.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function elementSemanticText(element: Element) {
  const values = candidateAttributeValues(element);
  if (values.length === 0) return "";
  return values.find(hasArabicScript) ?? values[0];
}

function rangeIntersectsElement(range: Range, element: Element) {
  try {
    return range.intersectsNode(element);
  } catch {
    return false;
  }
}

function semanticTextFromRange(range: Range) {
  const container = range.commonAncestorContainer;
  const root = container instanceof Element ? container : container.parentElement;
  if (!root) return "";

  const candidates: Array<{ element: Element; text: string }> = [];
  const addCandidate = (element: Element) => {
    if (isInContextLensUi(element) || !rangeIntersectsElement(range, element)) return;
    const text = elementSemanticText(element);
    if (text) candidates.push({ element, text });
  };

  addCandidate(root);
  root.querySelectorAll("*").forEach(addCandidate);

  const leafCandidates = candidates.filter((candidate) => (
    !candidates.some((other) => other !== candidate && candidate.element.contains(other.element))
  ));
  const source = leafCandidates.length > 0 ? leafCandidates : candidates;
  const seen = new Set<string>();
  return source
    .map((candidate) => candidate.text)
    .filter((text) => {
      const key = normalizeArabicForCompare(text) || text.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" ")
    .trim();
}

function shouldUseSemanticSelectionText(raw: string, semantic: string) {
  if (!semantic) return false;
  if (isSuspiciousSelectionText(raw)) return true;
  if (!hasArabicScript(semantic)) return false;

  const rawComparable = normalizeArabicForCompare(raw);
  const semanticComparable = normalizeArabicForCompare(semantic);
  if (!rawComparable || !semanticComparable) return false;
  if (rawComparable === semanticComparable) return true;
  if (/[\uE000-\uF8FF\uFB50-\uFDFF\uFE70-\uFEFF]/u.test(raw)) return true;
  if (semanticComparable.includes(rawComparable) || rawComparable.includes(semanticComparable)) {
    return semanticComparable.length <= rawComparable.length * 2.4;
  }

  const rawWordCount = normalizeCandidateText(raw).split(/\s+/).filter(Boolean).length;
  const semanticWordCount = normalizeCandidateText(semantic).split(/\s+/).filter(Boolean).length;
  return semanticWordCount >= rawWordCount && semanticComparable.length <= rawComparable.length * 2.2;
}

function rangeSelectionGeometry(range: Range, anchor?: SelectionAnchor): { rect: RectLike; bounds: RectLike } | null {
  const rects = visibleSelectionRects(range);
  if (rects.length > 0) {
    const lineGroups = groupRectsByLine(rects);
    const lineRects = lineGroups.map(unionRects);
    const rect = anchor
      ? [...lineRects].sort((a, b) => rectDistanceSquared(a, anchor) - rectDistanceSquared(b, anchor))[0]
      : lineRects[0];
    return { rect: rect ?? unionRects(rects), bounds: unionRects(rects) };
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
    const rect = { left, top, right, bottom, width: right - left, height: bottom - top };
    return { rect, bounds: rect };
  }

  const fallback = range.getBoundingClientRect();
  if (fallback.width > 1 && fallback.height > 1) return { rect: fallback, bounds: fallback };
  return null;
}

function extractSelectionText(selection: Selection): string {
  const raw = normalizeCandidateText(selection.toString());
  const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const semantic = range ? semanticTextFromRange(range) : "";
  if (shouldUseSemanticSelectionText(raw, semantic)) return semantic;

  // If text is ONLY tatweel/kashida (ـ) characters plus whitespace, the site is likely
  // using a Quran calligraphy font where a single placeholder character renders as Arabic.
  // Try aria-label attributes on elements within the selection as a fallback.
  if (/^[ـ\s]+$/.test(raw) && range) {
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

function selectedPageText(anchor?: SelectionAnchor, target?: EventTarget | null): SelectedTextGeometry | null {
  const selection = window.getSelection();
  const text = selection ? extractSelectionText(selection) : "";

  if (text.length > 0 && selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    // Skip selections that live inside any editable field.
    const ancestor = range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    if (ancestor?.closest("input, textarea, select, [contenteditable], [role='textbox']")) return null;
    const geometry = rangeSelectionGeometry(range, anchor);
    if (geometry) return { text, ...geometry };
  }

  return null;
}

async function resolveQuranText(rawText: string, range: Range): Promise<string> {
  let el: Element | null = range.commonAncestorContainer instanceof Element
    ? range.commonAncestorContainer
    : (range.commonAncestorContainer as Node).parentElement;
  if (!el) return rawText;

  // Walk up until we find a container with [data-word-location] children (quran.com signature)
  let searchRoot: Element | null = el;
  for (let i = 0; i < 15 && searchRoot; i++) {
    if (searchRoot.querySelector("[data-word-location]")) break;
    searchRoot = searchRoot.parentElement;
  }
  if (!searchRoot) return rawText;

  const wordEls = searchRoot.querySelectorAll("[data-word-location]");
  if (wordEls.length === 0) return rawText;

  const verseKeys = new Set<string>();
  for (const wordEl of Array.from(wordEls)) {
    try { if (!range.intersectsNode(wordEl)) continue; } catch { continue; }
    const loc = (wordEl as HTMLElement).dataset.wordLocation ?? "";
    const [surah, verse] = loc.split(":");
    if (surah && verse) verseKeys.add(`${surah}:${verse}`);
  }
  if (verseKeys.size === 0) return rawText;

  try {
    const texts: string[] = [];
    const sortedKeys = Array.from(verseKeys).sort((a, b) => {
      const [as, av] = a.split(":").map(Number);
      const [bs, bv] = b.split(":").map(Number);
      return as !== bs ? as - bs : av - bv;
    });
    for (const key of sortedKeys) {
      const res = await fetch(
        `https://api.qurancdn.com/api/qdc/verses/by_key/${encodeURIComponent(key)}?fields=text_uthmani`,
      );
      if (!res.ok) continue;
      const json = await res.json() as { verse?: { text_uthmani?: string } };
      if (json.verse?.text_uthmani) texts.push(json.verse.text_uthmani);
    }
    return texts.length > 0 ? texts.join("\n") : rawText;
  } catch {
    return rawText;
  }
}

function scheduleSelectionCheck(event?: MouseEvent, removeWhenEmpty = false) {
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
    ? { clientX: event.clientX, clientY: event.clientY }
    : recentAnchor
      ? { clientX: recentAnchor.clientX, clientY: recentAnchor.clientY }
      : null;
  clearSelectionCheckTimer();
  if (saveBubbleSuppressed()) return;
  const selected = selectedPageText(anchor ?? undefined, event?.target ?? null);

  if (selected) {
    const sel = window.getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;

    chrome.storage.local.get("save_triggers", async (result) => {
      const triggers = result.save_triggers ?? { bubble: true, contextMenu: true };
      if (!triggers.bubble) return;
      const text = range ? await resolveQuranText(selected.text, range) : selected.text;
      showSaveBubble(selected.rect, selected.bounds, text, anchor);
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
      const isRapidMultiClick = lastSelectionAnchor !== null
        && lastSelectionAnchor.detail >= 2
        && performance.now() - lastSelectionAnchor.timestamp < 400;
      if (!isRapidMultiClick) suppressSaveBubble();
    }
  } else if (!isInContextLensUi(target) && event.detail <= 1) {
    // A fresh single-click that isn't dismissing the bubble clears any
    // lingering suppression so the next selection works immediately.
    suppressSaveBubbleUntil = 0;
  }

  if (event.detail >= 2 && !isInContextLensUi(target)) {
    suppressSaveBubbleUntil = 0;
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
