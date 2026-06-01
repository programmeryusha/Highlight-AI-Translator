import React, { useEffect, useRef, useState } from "react";
import type { ChatMessage, Message } from "../types";

type Rect = { x: number; y: number; w: number; h: number };
type Stage = "selecting" | "context" | "saving" | "done";
const DEFAULT_ACCENT_COLOR = "#38bdf8";
const SCREENSHOT_PREVIEW_MAX_WIDTH = 760;
const SCREENSHOT_PREVIEW_MAX_HEIGHT = 520;
const SCREENSHOT_PREVIEW_QUALITY = 0.82;

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

function firstStrongTextDirection(value: string): "ltr" | "rtl" {
  for (const character of value.trim()) {
    if (/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u.test(character)) return "rtl";
    if (/[A-Za-z\u00C0-\u024F]/u.test(character)) return "ltr";
  }
  return "ltr";
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

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];

  function inlineMarkdown(line: string): React.ReactNode[] {
    return line.split(/(\*\*[^*\n]+?\*\*|\*[^*\n]+?\*)/g).map((part, index) => {
      if (!part) return null;
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={index} style={{ fontWeight: 800 }}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("*") && part.endsWith("*")) {
        return <em key={index} style={{ fontStyle: "italic" }}>{part.slice(1, -1)}</em>;
      }
      return <React.Fragment key={index}>{part}</React.Fragment>;
    });
  }

  function flushList() {
    if (listItems.length) {
      nodes.push(<ul key={nodes.length} style={{ margin: "6px 0 6px 20px", padding: 0 }}>{listItems}</ul>);
      listItems = [];
    }
  }

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      listItems.push(<li key={index} style={{ marginBottom: 4 }}>{inlineMarkdown(trimmed.slice(2))}</li>);
      return;
    }

    flushList();
    nodes.push(<p key={index} style={{ margin: "0 0 10px", lineHeight: 1.65 }}>{inlineMarkdown(trimmed)}</p>);
  });
  flushList();

  return <>{nodes}</>;
}

export default function CropApp() {
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("selecting");
  const [selection, setSelection] = useState<Rect | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [context, setContext] = useState("");
  const [immediate, setImmediate] = useState(false);
  const [captureId, setCaptureId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [followup, setFollowup] = useState("");
  const [followupLoading, setFollowupLoading] = useState(false);
  const [deepDiveActive, setDeepDiveActive] = useState(false);
  const [deepDiveLoading, setDeepDiveLoading] = useState(false);
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT_COLOR);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const glowStyleInjected = useRef(false);

  useEffect(() => {
    chrome.storage.session.get("pending_screenshot", (r) => {
      if (r.pending_screenshot) {
        setScreenshot(r.pending_screenshot);
        chrome.storage.session.remove("pending_screenshot");
      }
    });
    chrome.storage.local.get(["screenshot_triggers", "accent_color"], (r) => {
      setImmediate(r.screenshot_triggers?.immediate ?? true);
      setAccentColor(normalizeHexColor(r.accent_color));
    });
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.accent_color) setAccentColor(normalizeHexColor(changes.accent_color.newValue));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    if (stage !== "selecting") return;
    const timer = window.setTimeout(() => window.close(), 15_000);
    return () => window.clearTimeout(timer);
  }, [stage]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !screenshot) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);

      if (selection) {
        ctx.strokeStyle = colorWithAlpha(accentColor, 0.95);
        ctx.lineWidth = 2;
        ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 1;
        ctx.strokeRect(selection.x + 2, selection.y + 2, Math.max(selection.w - 4, 0), Math.max(selection.h - 4, 0));
      }
    };
    img.src = screenshot;
  }, [accentColor, screenshot, selection]);

  useEffect(() => {
    if (!deepDiveLoading && !deepDiveActive) return;
    if (!glowStyleInjected.current) {
      glowStyleInjected.current = true;
      const style = document.createElement("style");
      style.textContent = `
        @keyframes clDeepDiveGlow {
          0%   { filter: drop-shadow(0 0 0px  ${colorWithAlpha(accentColor, 0)});    }
          50%  { filter: drop-shadow(0 0 14px ${colorWithAlpha(accentColor, 0.75)}); }
          100% { filter: drop-shadow(0 0 7px  ${colorWithAlpha(accentColor, 0.45)}); }
        }
        .cl-deep-dive-glow   { animation: clDeepDiveGlow 1.5s ease-in-out infinite; }
        .cl-deep-dive-active { filter: drop-shadow(0 0 6px ${colorWithAlpha(accentColor, 0.4)}); }
      `;
      document.head.appendChild(style);
    }
    const panel = panelRef.current;
    if (!panel) return;
    if (deepDiveLoading) {
      panel.classList.add("cl-deep-dive-glow");
      panel.classList.remove("cl-deep-dive-active");
    } else {
      panel.classList.remove("cl-deep-dive-glow");
      panel.classList.add("cl-deep-dive-active");
    }
  }, [deepDiveLoading, deepDiveActive]);

  function getPos(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvasRef.current!.width / rect.width),
      y: (e.clientY - rect.top) * (canvasRef.current!.height / rect.height),
    };
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (stage !== "selecting") return;
    setDragStart(getPos(e));
    setSelection(null);
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!dragStart || stage !== "selecting") return;
    const pos = getPos(e);
    setSelection({
      x: Math.min(dragStart.x, pos.x),
      y: Math.min(dragStart.y, pos.y),
      w: Math.abs(pos.x - dragStart.x),
      h: Math.abs(pos.y - dragStart.y),
    });
  }

  function onMouseUp() {
    if (!selection || selection.w < 10 || selection.h < 10) return;
    setDragStart(null);
    setStage("context");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function submit(contextOverride = context) {
    if (!selection || !screenshot) return;
    const finalContext = contextOverride.trim();
    setStage("saving");

    const canvas = document.createElement("canvas");
    canvas.width = selection.w;
    canvas.height = selection.h;
    const ctx = canvas.getContext("2d")!;
    const img = new Image();
    img.src = screenshot;
    await new Promise((r) => (img.onload = r));
    ctx.drawImage(img, selection.x, selection.y, selection.w, selection.h, 0, 0, selection.w, selection.h);
    const croppedDataUrl = canvas.toDataURL("image/png");
    const imagePreviewData = createScreenshotPreviewData(canvas);

    if (immediate) {
      try {
        const response = await sendRuntimeMessage<{ captureId: string; explanation: string }>({
          type: "EXPLAIN_SCREENSHOT",
          imageData: croppedDataUrl,
          imagePreviewData,
          context: finalContext,
        });
        setCaptureId(response.captureId);
        setMessages([{ role: "assistant", content: response.explanation }]);
      } catch (error) {
        console.error("ContextLens failed to explain screenshot", error);
        setMessages([{ role: "assistant", content: error instanceof Error ? error.message : "Something went wrong." }]);
      }

      setStage("done");
    } else {
      chrome.runtime.sendMessage({ type: "SAVE_SCREENSHOT", imageData: croppedDataUrl, imagePreviewData, context: finalContext });
      window.close();
    }
  }

  async function askFollowup() {
    const question = followup.trim();
    if (!question || !captureId || followupLoading) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages(nextMessages);
    setFollowup("");
    setFollowupLoading(true);

    try {
      const response = await sendRuntimeMessage<{ reply: string; messages: ChatMessage[] }>({
        type: "ASK_FOLLOWUP",
        captureId,
        question,
        deepDive: deepDiveActive,
      });
      setMessages(response.messages ?? [...nextMessages, { role: "assistant", content: response.reply }]);
    } catch (error) {
      setMessages([...nextMessages, { role: "assistant", content: error instanceof Error ? error.message : "Something went wrong." }]);
    } finally {
      setFollowupLoading(false);
    }
  }

  async function handleDeepDive() {
    if (!captureId || deepDiveActive || deepDiveLoading) return;
    setDeepDiveLoading(true);
    try {
      const response = await sendRuntimeMessage<{ explanation: string; messages: ChatMessage[] }>({
        type: "DEEP_DIVE",
        captureId,
      });
      setMessages(response.messages ?? [{ role: "assistant", content: response.explanation }]);
      setDeepDiveActive(true);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Something went wrong.";
      if (msg === "DEEP_DIVE_LIMIT_REACHED") {
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: "Deep Dive is in beta — you've used all your free sessions. We'll open up more as we grow. Thanks for being an early explorer.",
        }]);
      }
    } finally {
      setDeepDiveLoading(false);
    }
  }

  function resetSelection() {
    setStage("selecting");
    setSelection(null);
    setContext("");
    setMessages([]);
    setCaptureId("");
    setFollowup("");
    setDeepDiveActive(false);
    setDeepDiveLoading(false);
    if (panelRef.current) {
      panelRef.current.classList.remove("cl-deep-dive-glow", "cl-deep-dive-active");
    }
  }

  if (!screenshot) {
    return <div style={{ color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontSize: 16 }}>Loading…</div>;
  }

  const showDeepDiveBtn = messages.length === 1 && messages[0].role === "assistant" && !deepDiveActive && !deepDiveLoading;
  const accentSoft = colorWithAlpha(accentColor, 0.14);
  const accentBorder = colorWithAlpha(accentColor, 0.38);
  const accentText = textOnColor(accentColor);
  const contextDirection = firstStrongTextDirection(context);
  const followupDirection = firstStrongTextDirection(followup);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", background: "#000" }}>
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        style={{ width: "100%", height: "100%", objectFit: "contain", cursor: stage === "selecting" ? "crosshair" : "default" }}
      />

      {stage === "context" && (
        <div style={{ position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)", background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: "16px 20px", width: 400, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
          <p style={{ color: accentColor, fontSize: 12, marginBottom: 8 }}>Region selected</p>
          <input
            ref={inputRef}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") { setStage("selecting"); setSelection(null); } }}
            placeholder="Any specific part you don't understand? (optional)"
            dir={contextDirection}
            style={{ width: "100%", background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,0.15)", color: "#e2e8f0", fontSize: 14, padding: "6px 0", outline: "none", marginBottom: 12, direction: contextDirection, textAlign: contextDirection === "rtl" ? "right" : "left", unicodeBidi: "plaintext" }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => window.close()} style={{ flex: 1, background: "rgba(255,255,255,0.08)", color: "#e2e8f0", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "8px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Cancel
            </button>
            <button onClick={() => submit()} style={{ flex: 1, background: accentColor, color: accentText, border: "none", borderRadius: 6, padding: "8px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Ask
            </button>
          </div>
        </div>
      )}

      {stage === "saving" && (
        <div style={{ position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)", background: "#1a1a2e", borderRadius: 12, padding: "16px 24px", color: "#94a3b8", fontSize: 14, fontStyle: "italic" }}>
          {immediate ? "Analyzing…" : "Saving…"}
        </div>
      )}

      {stage === "done" && (
        <div ref={panelRef} style={{ position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)", background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: "18px 20px", width: "min(520px, calc(100vw - 32px))", maxHeight: "min(620px, calc(100vh - 64px))", boxShadow: "0 8px 32px rgba(0,0,0,0.6)", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
          <div style={{ maxHeight: 360, overflowY: "auto", paddingRight: 4, marginBottom: 14 }}>
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} style={{ marginBottom: 14 }}>
                <p style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, margin: "0 0 3px" }}>{message.role === "assistant" ? "AI" : "You"}</p>
                <div style={{ color: message.role === "assistant" ? "#e2e8f0" : "#cbd5e1", fontSize: message.role === "assistant" ? 15 : 13, lineHeight: 1.65, margin: 0, whiteSpace: "pre-wrap" }}>
                  {renderMarkdown(message.content)}
                </div>
              </div>
            ))}
            {followupLoading && (
              <div style={{ color: deepDiveActive ? accentColor : "#94a3b8", fontSize: 14, fontStyle: "italic", lineHeight: 1.65 }}>
                {deepDiveActive ? "Thinking through a deeper answer…" : "Thinking…"}
              </div>
            )}
            {deepDiveLoading && (
              <div style={{ color: accentColor, fontSize: 14, fontStyle: "italic", lineHeight: 1.65 }}>Thinking through a deeper answer…</div>
            )}
          </div>

          {showDeepDiveBtn && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
              <button
                onClick={handleDeepDive}
                style={{ background: accentSoft, color: accentColor, border: `1px solid ${accentBorder}`, borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", letterSpacing: "0.02em" }}
              >
                ✦ Deep Dive
              </button>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              value={followup}
              onChange={(e) => setFollowup(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") askFollowup(); if (e.key === "Escape") window.close(); }}
              placeholder="Ask a follow-up…"
              disabled={!captureId || followupLoading || deepDiveLoading}
              dir={followupDirection}
              style={{ flex: 1, minWidth: 0, background: "transparent", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 7, color: "#e2e8f0", fontSize: 13, outline: "none", padding: "8px 10px", direction: followupDirection, textAlign: followupDirection === "rtl" ? "right" : "left", unicodeBidi: "plaintext" }}
            />
            <button onClick={askFollowup} disabled={!captureId || followupLoading || deepDiveLoading} style={{ background: accentColor, color: accentText, border: "none", borderRadius: 7, padding: "8px 13px", fontSize: 13, fontWeight: 600, cursor: captureId && !followupLoading && !deepDiveLoading ? "pointer" : "default", opacity: captureId && !followupLoading && !deepDiveLoading ? 1 : 0.55 }}>
              Ask
            </button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={resetSelection} style={{ flex: 1, background: "rgba(255,255,255,0.08)", color: "#94a3b8", border: "none", borderRadius: 6, padding: "8px 0", fontSize: 13, cursor: "pointer" }}>
              New selection
            </button>
            <button onClick={() => window.close()} style={{ flex: 1, background: accentColor, color: accentText, border: "none", borderRadius: 6, padding: "8px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
