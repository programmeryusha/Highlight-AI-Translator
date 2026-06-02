import React, { useEffect, useRef, useState } from "react";
import type { Capture, ChatMessage, ContextLensUser, Message } from "../types";

type ThemeName = "light" | "dark";
const BACKEND_URL = "https://web-production-223b1.up.railway.app";
const DEFAULT_ACCENT_COLOR = "#38bdf8";
const THEME_STORAGE_KEY = "contextlens_theme";
const ARABIC_FONT_STACK = "'Noto Naskh Arabic', 'Noto Sans Arabic', Tahoma, Arial, serif";
const HONORIFIC_MARK = "ﷺ";
const STREAM_DISCONNECTED_MESSAGE = "Streaming connection closed before the answer finished.";
const ARABIC_CHAR = "\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";
const ARABIC_RUN_GLUE = "\\u0660-\\u0669\\u06F0-\\u06F90-9\\s\\u200c\\u200d.,;:!?،؛؟'\"()[\\]{}\\-–—/\\\\";
const ARABIC_RUN = new RegExp(
  `([${ARABIC_CHAR}](?:[${ARABIC_CHAR}${ARABIC_RUN_GLUE}]*[${ARABIC_CHAR}\\u0660-\\u0669\\u06F0-\\u06F90-9])?[.,;:!?،؛؟]*)`,
  "gu",
);
const AUTHENTICATED_IMAGE_CACHE_LIMIT = 48;
const authenticatedImageObjectUrlCache = new Map<string, string>();

type AuthenticatedImageSource = { src: string; loading: boolean; error: boolean; ready: boolean };

function sanitizedAuthenticatedCaptureImageUrl(imageData?: string | null): string | null {
  if (!imageData || typeof imageData !== "string") return null;
  try {
    const backend = new URL(BACKEND_URL);
    const url = new URL(imageData, backend);
    if (url.origin !== backend.origin) return null;
    if (!/^\/captures\/[^/]+\/image$/.test(url.pathname)) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function storedAccountToken(): Promise<string | null> {
  const storage = await chrome.storage.local.get("contextlens_user");
  const user = storage.contextlens_user as ContextLensUser | undefined;
  return user?.token ?? null;
}

function cacheAuthenticatedImageObjectUrl(cacheKey: string, objectUrl: string) {
  authenticatedImageObjectUrlCache.set(cacheKey, objectUrl);
  while (authenticatedImageObjectUrlCache.size > AUTHENTICATED_IMAGE_CACHE_LIMIT) {
    const oldest = authenticatedImageObjectUrlCache.keys().next().value;
    if (!oldest) break;
    const oldestUrl = authenticatedImageObjectUrlCache.get(oldest);
    if (oldestUrl) URL.revokeObjectURL(oldestUrl);
    authenticatedImageObjectUrlCache.delete(oldest);
  }
}

async function fetchAuthenticatedImageObjectUrl(imageData: string): Promise<string> {
  const cleanUrl = sanitizedAuthenticatedCaptureImageUrl(imageData);
  if (!cleanUrl) return imageData;
  const token = await storedAccountToken();
  if (!token) throw new Error("Missing account token.");
  const cacheKey = `${token}\n${cleanUrl}`;
  const cached = authenticatedImageObjectUrlCache.get(cacheKey);
  if (cached) return cached;
  const response = await fetch(cleanUrl, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "force-cache",
  });
  if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
  const objectUrl = URL.createObjectURL(await response.blob());
  cacheAuthenticatedImageObjectUrl(cacheKey, objectUrl);
  return objectUrl;
}

function useAuthenticatedImageSource(imageData?: string): AuthenticatedImageSource {
  const cleanUrl = sanitizedAuthenticatedCaptureImageUrl(imageData);
  const [state, setState] = useState<AuthenticatedImageSource & { key: string }>({
    key: "",
    src: "",
    loading: false,
    error: false,
    ready: true,
  });

  useEffect(() => {
    let cancelled = false;
    if (!imageData || !cleanUrl) {
      setState({
        key: imageData ?? "",
        src: imageData ?? "",
        loading: false,
        error: false,
        ready: true,
      });
      return () => { cancelled = true; };
    }

    setState((current) => current.key === cleanUrl && current.src
      ? current
      : { key: cleanUrl, src: "", loading: true, error: false, ready: false });
    void fetchAuthenticatedImageObjectUrl(cleanUrl)
      .then((src) => {
        if (!cancelled) setState({ key: cleanUrl, src, loading: false, error: false, ready: true });
      })
      .catch(() => {
        if (!cancelled) setState({ key: cleanUrl, src: "", loading: false, error: true, ready: false });
      });
    return () => { cancelled = true; };
  }, [cleanUrl, imageData]);

  if (!imageData) return { src: "", loading: false, error: false, ready: true };
  if (!cleanUrl) return { src: imageData, loading: false, error: false, ready: true };
  if (state.key === cleanUrl) {
    const { src, loading, error, ready } = state;
    return { src, loading, error, ready };
  }
  return { src: "", loading: true, error: false, ready: false };
}

function isThemeName(v: unknown): v is ThemeName { return v === "light" || v === "dark"; }

function firstStrongTextDirection(value: string): "ltr" | "rtl" {
  for (const character of value.trim()) {
    if (/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u.test(character)) return "rtl";
    if (/[A-Za-z\u00C0-\u024F]/u.test(character)) return "ltr";
  }
  return "ltr";
}

function bidiSpan(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let last = 0;
  const re = new RegExp(ARABIC_RUN.source, "gu");
  let match: RegExpExecArray | null;
  const pushArabicRun = (run: string, keyPrefix: number) => {
    run.split(new RegExp(`(${HONORIFIC_MARK})`, "g")).forEach((chunk, chunkIndex) => {
      if (!chunk) return;
      if (chunk === HONORIFIC_MARK) {
        parts.push(
          <span
            key={`${keyPrefix}-honorific-${chunkIndex}`}
            dir="rtl"
            lang="ar"
            className="cl-honorific"
            style={{
              display: "inline-block",
              fontFamily: ARABIC_FONT_STACK,
              fontSize: "0.86em",
              fontWeight: 650,
              lineHeight: 1,
              marginInline: "0.16em",
              verticalAlign: "0.18em",
              unicodeBidi: "isolate",
            }}
          >
            {chunk}
          </span>
        );
        return;
      }
      if (!/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u.test(chunk)) {
        parts.push(chunk);
        return;
      }
      parts.push(
        <bdi
          key={`${keyPrefix}-ar-${chunkIndex}`}
          dir="rtl"
          lang="ar"
          className="cl-ar"
          style={{ fontFamily: ARABIC_FONT_STACK, fontSize: "1.08em", lineHeight: 1.85, unicodeBidi: "isolate" }}
        >
          {chunk}
        </bdi>
      );
    });
  };
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    pushArabicRun(match[0], match.index);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function inlineTextParts(text: string): React.ReactNode {
  return text.split(/(\*\*[^*\n]+?\*\*|\*[^*\n]+?\*)/g).map((part, index) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index} style={{ fontWeight: 800 }}>{bidiSpan(part.slice(2, -2))}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={index} style={{ fontStyle: "italic" }}>{bidiSpan(part.slice(1, -1))}</em>;
    }
    return <React.Fragment key={index}>{bidiSpan(part)}</React.Fragment>;
  });
}

function QuestionText({ text, color, fontSize }: { text: string; color: string; fontSize: number }) {
  const direction = firstStrongTextDirection(text);
  return (
    <p
      dir={direction}
      style={{
        fontSize,
        color,
        lineHeight: 1.55,
        margin: 0,
        fontWeight: 650,
        direction,
        textAlign: direction === "rtl" ? "right" : "left",
        unicodeBidi: "plaintext",
        overflowWrap: "break-word",
        width: "fit-content",
        maxWidth: "74ch",
      }}
    >
      {inlineTextParts(text)}
    </p>
  );
}

function storedThemeFallback(fallback: ThemeName): ThemeName {
  try {
    const theme = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeName(theme) ? theme : fallback;
  } catch {
    return fallback;
  }
}

function rememberTheme(theme: ThemeName) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The chrome storage value remains authoritative.
  }
}

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

let lastImageRefreshAt = 0;
const IMAGE_REFRESH_COOLDOWN_MS = 30_000;

function refreshRemoteImageUrls() {
  const now = Date.now();
  if (now - lastImageRefreshAt < IMAGE_REFRESH_COOLDOWN_MS) return;
  lastImageRefreshAt = now;
  void sendRuntimeMessage<{ synced: number }>({ type: "SYNC_REMOTE_CAPTURES" }).catch(() => {});
}

function sendRuntimeMessage<T>(message: Message): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) { reject(new Error(lastError.message)); return; }
      if (response?.error) { reject(new Error(response.error)); return; }
      resolve(response as T);
    });
  });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function fallbackForDisconnectedStream(message: Record<string, unknown>): Message | null {
  if (message.type === "ASK_FOLLOWUP_STREAM") {
    return {
      type: "ASK_FOLLOWUP",
      captureId: String(message.captureId ?? ""),
      question: String(message.question ?? ""),
      deepDive: Boolean(message.deepDive),
      fallbackText: optionalString(message.fallbackText),
      fallbackContext: optionalString(message.fallbackContext),
      fallbackImageData: optionalString(message.fallbackImageData),
      fallbackImagePreviewData: optionalString(message.fallbackImagePreviewData),
      fallbackUrl: optionalString(message.fallbackUrl),
      fallbackTitle: optionalString(message.fallbackTitle),
    };
  }
  if (message.type === "DEEP_DIVE_STREAM") {
    return {
      type: "DEEP_DIVE",
      captureId: String(message.captureId ?? ""),
      fallbackText: optionalString(message.fallbackText),
      fallbackContext: optionalString(message.fallbackContext),
      fallbackImageData: optionalString(message.fallbackImageData),
      fallbackImagePreviewData: optionalString(message.fallbackImagePreviewData),
      fallbackUrl: optionalString(message.fallbackUrl),
      fallbackTitle: optionalString(message.fallbackTitle),
    };
  }
  return null;
}

function streamRuntimeMessage<T>(
  message: Record<string, unknown>,
  handlers: { onChunk?: (chunk: string) => void } = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: "contextlens-explain-stream" });
    let settled = false;

    port.onMessage.addListener((event: Record<string, unknown>) => {
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
        reject(new Error(typeof event.error === "string" ? event.error : "Streaming answer failed."));
      }
    });

    port.onDisconnect.addListener(() => {
      if (settled) return;
      settled = true;

      const fallbackMessage = fallbackForDisconnectedStream(message);
      if (fallbackMessage) {
        sendRuntimeMessage<T>(fallbackMessage).then(resolve).catch(reject);
        return;
      }

      reject(new Error(STREAM_DISCONNECTED_MESSAGE));
    });

    port.postMessage(message);
  });
}

function pageTransitionColor() {
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  if (bodyBg && bodyBg !== "rgba(0, 0, 0, 0)") return bodyBg;
  const htmlBg = getComputedStyle(document.documentElement).backgroundColor;
  return htmlBg && htmlBg !== "rgba(0, 0, 0, 0)" ? htmlBg : "#fff";
}

function navigateWithSoftFade(url: string) {
  const existing = document.getElementById("contextlens-page-transition");
  existing?.remove();

  const cover = document.createElement("div");
  cover.id = "contextlens-page-transition";
  cover.setAttribute("aria-hidden", "true");
  cover.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    pointer-events: none;
    background: ${pageTransitionColor()};
    opacity: 0;
    transition: opacity 140ms cubic-bezier(0.2, 0, 0, 1);
  `;
  document.body.appendChild(cover);

  requestAnimationFrame(() => {
    cover.style.opacity = "1";
  });
  window.setTimeout(() => {
    window.location.assign(url);
  }, 150);
}

function dashboardUrl() {
  return chrome.runtime.getURL("src/dashboard/dashboard.html");
}

function safeDashboardReturnUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const dashboard = new URL(dashboardUrl());
    if (url.origin === dashboard.origin && url.pathname === dashboard.pathname) return url.toString();
  } catch {
    return null;
  }
  return null;
}

function goBackToDashboardSource(returnUrl: string | null) {
  const target = safeDashboardReturnUrl(returnUrl);
  if (target && window.history.length > 1) {
    window.history.back();
    return;
  }
  navigateWithSoftFade(target ?? dashboardUrl());
}

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];

  function flushList() {
    if (listItems.length) {
      nodes.push(<ul key={nodes.length} style={{ margin: "6px 0 6px 20px", padding: 0 }}>{listItems}</ul>);
      listItems = [];
    }
  }

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) { flushList(); return; }
    if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      listItems.push(<li key={i} style={{ marginBottom: 4 }}>{inlineTextParts(trimmed.slice(2))}</li>);
    } else {
      flushList();
      const direction = firstStrongTextDirection(trimmed);
      nodes.push(
        <p
          key={i}
          dir={direction}
          style={{
            margin: "0 0 10px",
            lineHeight: 1.75,
            direction,
            textAlign: direction === "rtl" ? "right" : "left",
            unicodeBidi: "plaintext",
          }}
        >
          {inlineTextParts(trimmed)}
        </p>
      );
    }
  });
  flushList();
  return <>{nodes}</>;
}

export default function ChatApp() {
  const params = new URLSearchParams(location.search);
  const captureId = params.get("id");
  const returnUrl = params.get("returnUrl");

  const [capture, setCapture] = useState<Capture | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [deepDiveLoading, setDeepDiveLoading] = useState(false);
  const [streamingAnswerStarted, setStreamingAnswerStarted] = useState(false);
  const [deepDiveActive, setDeepDiveActive] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT_COLOR);
  const [theme, setTheme] = useState<ThemeName>(() => storedThemeFallback("light"));
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const loadingAnswerRef = useRef<HTMLDivElement>(null);
  const scrollToAnswerOnNextUpdate = useRef(false);

  useEffect(() => {
    chrome.storage.local.get(["accent_color", "theme"], (result) => {
      setAccentColor(normalizeHexColor(result.accent_color));
      const nextTheme = isThemeName(result.theme) ? result.theme : "light";
      setTheme(nextTheme);
      rememberTheme(nextTheme);
    });
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.accent_color) setAccentColor(normalizeHexColor(changes.accent_color.newValue));
      if (changes.theme) {
        const nextTheme = isThemeName(changes.theme.newValue) ? changes.theme.newValue : "light";
        setTheme(nextTheme);
        rememberTheme(nextTheme);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!captureId) return;
    let cancelled = false;
    document.title = "ContextLens";

    const loadCapture = () => chrome.storage.local.get(["captures", `chat_${captureId}`, "deep_dive_capture_ids"], (result) => {
      if (cancelled) return;
      const captures: Capture[] = result.captures ?? [];
      const found = captures.find((c) => c.id === captureId) ?? null;
      setCapture(found);
      setDeepDiveActive(Boolean(captureId && (result.deep_dive_capture_ids ?? []).includes(captureId)));

      const prior: ChatMessage[] = result[`chat_${captureId}`] ?? [];
      if (prior.length === 0 && found?.explanation) {
        const seed: ChatMessage[] = [{ role: "assistant", content: found.explanation }];
        setMessages(seed);
        chrome.storage.local.set({ [`chat_${captureId}`]: seed });
      } else {
        setMessages(prior);
      }
    });

    loadCapture();
    sendRuntimeMessage<{ synced: number }>({ type: "SYNC_REMOTE_CAPTURES" })
      .then(loadCapture)
      .catch(() => {});

    return () => { cancelled = true; };
  }, [captureId]);

  // Only auto-scroll when explicitly triggered by a follow-up/deep-dive action.
  useEffect(() => {
    if (!scrollToAnswerOnNextUpdate.current) return;
    let lastAssistantIndex = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "assistant") {
        lastAssistantIndex = i;
        break;
      }
    }
    const target = streamingAnswerStarted && lastAssistantIndex >= 0
      ? messageRefs.current.get(lastAssistantIndex)
      : loading || deepDiveLoading
        ? loadingAnswerRef.current
        : lastAssistantIndex >= 0
          ? messageRefs.current.get(lastAssistantIndex)
          : null;
    if (!target) return;
    target.scrollIntoView({ behavior: streamingAnswerStarted ? "auto" : "smooth", block: streamingAnswerStarted ? "end" : "start" });
    if (!loading && !deepDiveLoading) scrollToAnswerOnNextUpdate.current = false;
  }, [messages, loading, deepDiveLoading, streamingAnswerStarted]);

  useEffect(() => {
    if (!capture) return;
    setSourceExpanded(false);
    setDeepDiveLoading(false);
    setStreamingAnswerStarted(false);
    setImageFailed(false);
  }, [capture?.id]);

  useEffect(() => { setImageFailed(false); }, [capture?.imageData]);

  // Apply background color to document body
  useEffect(() => {
    const dark = theme === "dark";
    document.documentElement.setAttribute("data-theme", theme);
    document.body.style.background = dark ? "#111113" : "#fff";
    rememberTheme(theme);
    return () => { document.body.style.background = ""; };
  }, [theme]);

  const captureImage = useAuthenticatedImageSource(capture?.imageData);

  async function handleDeepDive() {
    if (!capture || deepDiveActive || deepDiveLoading) return;
    scrollToAnswerOnNextUpdate.current = true;
    setDeepDiveLoading(true);
    setStreamingAnswerStarted(false);
    const baseMessages = messages;
    let streamed = "";
    try {
      const data = await streamRuntimeMessage<{ explanation: string; messages: ChatMessage[] }>({
        type: "DEEP_DIVE_STREAM",
        captureId: capture.id,
        fallbackText: capture.imageData ? undefined : capture.text,
        fallbackContext: capture.context,
        fallbackImageData: capture.imageData,
        fallbackImagePreviewData: capture.imagePreviewData,
        fallbackUrl: capture.url,
        fallbackTitle: capture.title,
      }, {
        onChunk: (chunk) => {
          streamed += chunk;
          setStreamingAnswerStarted(true);
          setMessages([...baseMessages, { role: "assistant", content: streamed }]);
        },
      });
      const result: ChatMessage[] = data.messages ?? [{ role: "assistant", content: data.explanation }];
      setMessages(result);
      setDeepDiveActive(true);
      chrome.storage.local.set({ [`chat_${captureId}`]: result });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Something went wrong.";
      const content = msg === "DEEP_DIVE_LIMIT_REACHED"
        ? "Deep Dive is in beta — you've used all your free sessions. We'll open up more as we grow. Thanks for being an early explorer."
        : msg;
      setMessages([...baseMessages, { role: "assistant", content }]);
    } finally {
      setDeepDiveLoading(false);
      setStreamingAnswerStarted(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || loading || deepDiveLoading || !capture) return;
    setInput("");
    scrollToAnswerOnNextUpdate.current = true;
    setStreamingAnswerStarted(false);

    const updated: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(updated);
    setLoading(true);
    let streamed = "";

    try {
      const data = await streamRuntimeMessage<{ reply: string; messages: ChatMessage[] }>({
        type: "ASK_FOLLOWUP_STREAM",
        captureId: capture.id,
        question: text,
        deepDive: deepDiveActive,
        fallbackText: capture.imageData ? undefined : capture.text,
        fallbackContext: capture.context,
        fallbackImageData: capture.imageData,
        fallbackImagePreviewData: capture.imagePreviewData,
        fallbackUrl: capture.url,
        fallbackTitle: capture.title,
      }, {
        onChunk: (chunk) => {
          streamed += chunk;
          setStreamingAnswerStarted(true);
          setMessages([...updated, { role: "assistant", content: streamed }]);
        },
      });
      const final = data.messages ?? [...updated, { role: "assistant", content: data.reply }];
      setMessages(final);
      chrome.storage.local.set({ [`chat_${captureId}`]: final });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong. Try again.";
      setMessages([...updated, { role: "assistant", content: message }]);
    }
    setLoading(false);
    setStreamingAnswerStarted(false);
  }

  const dark = theme === "dark";
  const colors = {
    bg:          dark ? "#111113"   : "#fff",
    text:        dark ? "#e8e6e2"   : "#37352f",
    muted:       dark ? "#6b6a67"   : "#9b9a97",
    border:      dark ? "#2a2928"   : "#e3e2de",
    inputBorder: dark ? "#3a3937"   : "#d8d7d2",
    surface:     dark ? "#1a1918"   : "#fff",
    sourceBg:    dark ? "#161514"   : "transparent",
    stickyBg:    dark ? "#111113"   : "#fff",
  };

  const accentSoft   = colorWithAlpha(accentColor, 0.14);
  const accentBorder = colorWithAlpha(accentColor, 0.38);
  const sourceToggleStyle: React.CSSProperties = {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: 7,
    color: accentColor,
    fontSize: 13,
    fontWeight: 750,
    cursor: "pointer",
    padding: "6px 10px",
    marginTop: 10,
    marginBottom: 2,
  };

  if (!capture) {
    return (
      <div style={{ padding: "60px 48px", color: colors.muted, background: colors.bg, minHeight: "100vh" }}>
        Loading…
      </div>
    );
  }

  const hasScreenshot = Boolean(capture.imageData);
  const sourceIsLong = !hasScreenshot && capture.text.length > 700;
  const sourcePreview = sourceIsLong && !sourceExpanded;
  const sourceDirection = firstStrongTextDirection(capture.text);
  const showDeepDiveBtn = capture.status === "done" && !deepDiveActive && !deepDiveLoading;

  return (
    <div style={{ minHeight: "100vh", maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", background: colors.bg }}>
      {/* Header */}
      <div style={{ padding: "32px 48px 0" }}>
        <a
          href={safeDashboardReturnUrl(returnUrl) ?? dashboardUrl()}
          onClick={(event) => {
            event.preventDefault();
            goBackToDashboardSource(returnUrl);
          }}
          style={{ fontSize: 13, color: colors.muted, textDecoration: "none", display: "inline-block", marginBottom: 24 }}
        >
          ← Back
        </a>
        <div
          style={{
            border: `1px solid ${colors.border}`,
            borderLeft: `3px solid ${colors.border}`,
            borderRadius: 8,
            padding: "14px 16px",
            marginBottom: 24,
            background: colors.sourceBg,
          }}
        >
          {hasScreenshot ? (
            imageFailed || captureImage.error ? (
              <div
                style={{
                  minHeight: 80,
                  display: "grid",
                  placeItems: "center",
                  color: colors.muted,
                  fontSize: 13,
                  fontWeight: 700,
                  borderRadius: 6,
                  border: `1px dashed ${colors.border}`,
                  background: dark ? "#1e1d1b" : "#f7f6f3",
                }}
              >
                Screenshot preview unavailable
              </div>
            ) : captureImage.loading && !captureImage.src ? (
              <div
                style={{
                  minHeight: 80,
                  display: "grid",
                  placeItems: "center",
                  color: colors.muted,
                  fontSize: 13,
                  fontWeight: 700,
                  borderRadius: 6,
                  border: `1px dashed ${colors.border}`,
                  background: dark ? "#1e1d1b" : "#f7f6f3",
                }}
              >
                Loading screenshot…
              </div>
            ) : (
              <img
                src={captureImage.src}
                alt="Saved screenshot"
                onError={() => {
                  setImageFailed(true);
                  if (capture.imageData && !capture.imageData.startsWith("data:")) refreshRemoteImageUrls();
                }}
                style={{
                  display: "block",
                  width: "100%",
                  maxHeight: 460,
                  objectFit: "contain",
                  borderRadius: 6,
                  background: dark ? "#1e1d1b" : "#f7f6f3",
                }}
              />
            )
          ) : (
            <p
              dir={sourceDirection}
              style={{
                fontSize: 21,
                color: colors.text,
                lineHeight: 1.6,
                fontWeight: 650,
                direction: sourceDirection,
                textAlign: sourceDirection === "rtl" ? "right" : "left",
                unicodeBidi: "plaintext",
                fontFamily: sourceDirection === "rtl" ? ARABIC_FONT_STACK : "inherit",
                maxHeight: sourcePreview ? 220 : undefined,
                overflow: sourcePreview ? "hidden" : undefined,
                marginBottom: sourceIsLong ? 8 : undefined,
                margin: 0,
              }}
            >
              {bidiSpan(capture.text)}
            </p>
          )}
          {sourceIsLong && (
            <button
              onClick={() => setSourceExpanded((v) => !v)}
              style={sourceToggleStyle}
            >
              {sourceExpanded ? "Collapse text" : "Show full text"}
            </button>
          )}
          {capture.context && (
            <div style={{ borderTop: `1px solid ${colors.border}`, marginTop: 12, paddingTop: 12 }}>
              <p style={{ fontSize: 12, color: colors.muted, fontWeight: 600, margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Your question
              </p>
              <QuestionText text={capture.context} color={colors.text} fontSize={20} />
            </div>
          )}
        </div>
        <div style={{ borderBottom: `1px solid ${colors.border}`, marginBottom: 0 }} />
      </div>

      {/* Messages */}
      <div style={{ padding: "24px 48px 96px", flex: 1 }}>
        {messages.map((m, i) => (
          <div
            key={i}
            ref={(node) => {
              if (node) messageRefs.current.set(i, node);
              else messageRefs.current.delete(i);
            }}
            style={{ marginBottom: 20 }}
          >
            <p style={{ fontSize: 12, color: colors.muted, marginBottom: 4, fontWeight: 500 }}>
              {m.role === "assistant" ? "AI" : "You"}
            </p>
            <div style={{ fontSize: m.role === "assistant" ? 19 : 16, color: colors.text, lineHeight: m.role === "assistant" ? 1.8 : 1.7 }}>
              {renderMarkdown(m.content)}
            </div>
          </div>
        ))}
        {showDeepDiveBtn && (
          <div style={{ marginBottom: 20 }}>
            <button
              type="button"
              onClick={handleDeepDive}
              style={{ background: accentSoft, color: accentColor, border: `1px solid ${accentBorder}`, borderRadius: 6, padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", letterSpacing: "0.02em" }}
            >
              ✦ Deep Dive
            </button>
          </div>
        )}
        {deepDiveLoading && !streamingAnswerStarted && (
          <div ref={loadingAnswerRef} style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 12, color: accentColor, marginBottom: 4, fontWeight: 500 }}>AI</p>
            <p style={{ fontSize: 15, color: accentColor, fontStyle: "italic" }}>Thinking through a deeper answer…</p>
          </div>
        )}
        {loading && !streamingAnswerStarted && (
          <div ref={loadingAnswerRef} style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 12, color: deepDiveActive ? accentColor : colors.muted, marginBottom: 4, fontWeight: 500 }}>AI</p>
            <p style={{ fontSize: 15, color: deepDiveActive ? accentColor : colors.muted, fontStyle: deepDiveActive ? "italic" : undefined }}>
              {deepDiveActive ? "Thinking through a deeper answer…" : "…"}
            </p>
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ position: "sticky", bottom: 0, padding: "14px 48px 24px", background: colors.stickyBg, borderTop: `1px solid ${colors.border}` }}>
        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          style={{ display: "flex", gap: 10, alignItems: "center" }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a follow-up question…"
            disabled={loading || deepDiveLoading}
            style={{
              flex: 1,
              minHeight: 52,
              fontSize: 17,
              color: colors.text,
              background: colors.surface,
              border: `1px solid ${colors.inputBorder}`,
              borderRadius: 14,
              outline: "none",
              padding: "0 16px",
              boxShadow: dark ? "none" : "0 1px 6px rgba(15,15,15,0.06)",
            }}
          />
          <button
            type="submit"
            disabled={loading || deepDiveLoading || !input.trim()}
            style={{
              minHeight: 52,
              padding: "0 18px",
              border: "none",
              borderRadius: 14,
              background: loading || deepDiveLoading || !input.trim()
                ? (dark ? "#2a2928" : "#d8d7d2")
                : (dark ? "#e8e6e2" : "#37352f"),
              color: dark ? "#111113" : "#fff",
              fontSize: 15,
              fontWeight: 700,
              cursor: loading || deepDiveLoading || !input.trim() ? "default" : "pointer",
            }}
          >
            Ask
          </button>
        </form>
      </div>
    </div>
  );
}
