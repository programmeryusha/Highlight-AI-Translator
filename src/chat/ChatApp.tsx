import React, { useEffect, useRef, useState } from "react";
import type { Capture, ChatMessage, Message } from "../types";

type ThemeName = "light" | "dark";
const DEFAULT_ACCENT_COLOR = "#6466f1";

function isThemeName(v: unknown): v is ThemeName { return v === "light" || v === "dark"; }

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

  function inlineBold(line: string, _key: number): React.ReactNode {
    const parts = line.split(/\*\*(.*?)\*\*/g);
    return parts.map((part, i) => i % 2 === 1 ? <strong key={i} style={{ fontWeight: 800 }}>{part}</strong> : part);
  }

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) { flushList(); return; }
    if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      listItems.push(<li key={i} style={{ marginBottom: 4 }}>{inlineBold(trimmed.slice(2), i)}</li>);
    } else {
      flushList();
      nodes.push(<p key={i} style={{ margin: "0 0 10px", lineHeight: 1.75 }}>{inlineBold(trimmed, i)}</p>);
    }
  });
  flushList();
  return <>{nodes}</>;
}

export default function ChatApp() {
  const params = new URLSearchParams(location.search);
  const captureId = params.get("id");

  const [capture, setCapture] = useState<Capture | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [deepDiveLoading, setDeepDiveLoading] = useState(false);
  const [deepDiveActive, setDeepDiveActive] = useState(false);
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT_COLOR);
  const [theme, setTheme] = useState<ThemeName>("light");
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollOnNextUpdate = useRef(false);

  useEffect(() => {
    chrome.storage.local.get(["accent_color", "theme"], (result) => {
      setAccentColor(normalizeHexColor(result.accent_color));
      if (isThemeName(result.theme)) setTheme(result.theme);
    });
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.accent_color) setAccentColor(normalizeHexColor(changes.accent_color.newValue));
      if (changes.theme && isThemeName(changes.theme.newValue)) setTheme(changes.theme.newValue);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!captureId) return;
    document.title = "ContextLens";
    chrome.storage.local.get(["captures", `chat_${captureId}`, "deep_dive_capture_ids"], (result) => {
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
  }, [captureId]);

  // Only auto-scroll when explicitly triggered by user action, never on initial load
  useEffect(() => {
    if (scrollOnNextUpdate.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      scrollOnNextUpdate.current = false;
    }
  }, [messages, loading, deepDiveLoading]);

  useEffect(() => {
    if (!capture) return;
    setSourceExpanded(false);
    setDeepDiveLoading(false);
  }, [capture?.id]);

  // Apply background color to document body
  useEffect(() => {
    const dark = theme === "dark";
    document.body.style.background = dark ? "#111113" : "#fff";
    return () => { document.body.style.background = ""; };
  }, [theme]);

  async function handleDeepDive() {
    if (!capture || deepDiveActive || deepDiveLoading) return;
    scrollOnNextUpdate.current = true;
    setDeepDiveLoading(true);
    try {
      const data = await sendRuntimeMessage<{ explanation: string; messages: ChatMessage[] }>({
        type: "DEEP_DIVE",
        captureId: capture.id,
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
      setMessages((prev) => [...prev, { role: "assistant", content }]);
    } finally {
      setDeepDiveLoading(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || loading || deepDiveLoading || !capture) return;
    setInput("");
    scrollOnNextUpdate.current = true;

    const updated: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(updated);
    setLoading(true);

    try {
      const data = await sendRuntimeMessage<{ reply: string; messages: ChatMessage[] }>({
        type: "ASK_FOLLOWUP",
        captureId: capture.id,
        question: text,
        deepDive: deepDiveActive,
      });
      const final = data.messages ?? [...updated, { role: "assistant", content: data.reply }];
      setMessages(final);
      chrome.storage.local.set({ [`chat_${captureId}`]: final });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong. Try again.";
      setMessages([...updated, { role: "assistant", content: message }]);
    }
    setLoading(false);
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
  const showDeepDiveBtn = capture.status === "done" && !deepDiveActive && !deepDiveLoading;

  return (
    <div style={{ minHeight: "100vh", maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", background: colors.bg }}>
      {/* Header */}
      <div style={{ padding: "32px 48px 0" }}>
        <a
          href={chrome.runtime.getURL("src/dashboard/dashboard.html")}
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
            <img
              src={capture.imageData}
              alt="Saved screenshot"
              style={{
                display: "block",
                width: "100%",
                maxHeight: 460,
                objectFit: "contain",
                borderRadius: 6,
                background: dark ? "#1e1d1b" : "#f7f6f3",
              }}
            />
          ) : (
            <p
              style={{
                fontSize: 21,
                color: colors.text,
                lineHeight: 1.6,
                fontWeight: 650,
                maxHeight: sourcePreview ? 220 : undefined,
                overflow: sourcePreview ? "hidden" : undefined,
                marginBottom: sourceIsLong ? 8 : undefined,
                margin: 0,
              }}
            >
              {capture.text}
            </p>
          )}
          {sourceIsLong && (
            <button
              onClick={() => setSourceExpanded((v) => !v)}
              style={{ background: "none", border: "none", color: accentColor, fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, marginBottom: 6 }}
            >
              {sourceExpanded ? "Collapse text" : "Show full text"}
            </button>
          )}
          {capture.context && (
            <div style={{ borderTop: `1px solid ${colors.border}`, marginTop: 12, paddingTop: 12 }}>
              <p style={{ fontSize: 12, color: colors.muted, fontWeight: 600, margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Your question
              </p>
              <p style={{ fontSize: 18, color: colors.text, lineHeight: 1.55, margin: 0, fontWeight: 650 }}>
                {capture.context}
              </p>
            </div>
          )}
        </div>
        <div style={{ borderBottom: `1px solid ${colors.border}`, marginBottom: 0 }} />
      </div>

      {/* Messages */}
      <div style={{ padding: "24px 48px 96px", flex: 1 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 20 }}>
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
        {deepDiveLoading && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 12, color: accentColor, marginBottom: 4, fontWeight: 500 }}>AI</p>
            <p style={{ fontSize: 15, color: accentColor, fontStyle: "italic" }}>Thinking through a deeper answer…</p>
          </div>
        )}
        {loading && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 12, color: deepDiveActive ? accentColor : colors.muted, marginBottom: 4, fontWeight: 500 }}>AI</p>
            <p style={{ fontSize: 15, color: deepDiveActive ? accentColor : colors.muted, fontStyle: deepDiveActive ? "italic" : undefined }}>
              {deepDiveActive ? "Thinking through a deeper answer…" : "…"}
            </p>
          </div>
        )}
        <div ref={bottomRef} />
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
