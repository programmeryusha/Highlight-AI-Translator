import React, { useEffect, useRef, useState } from "react";
import type { ChatMessage, Message } from "../types";

type Rect = { x: number; y: number; w: number; h: number };
type Stage = "selecting" | "context" | "saving" | "done";

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
    chrome.storage.local.get("screenshot_triggers", (r) => {
      setImmediate(r.screenshot_triggers?.immediate ?? true);
    });
  }, []);

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
        ctx.strokeStyle = "rgba(99,102,241,0.95)";
        ctx.lineWidth = 2;
        ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 1;
        ctx.strokeRect(selection.x + 2, selection.y + 2, Math.max(selection.w - 4, 0), Math.max(selection.h - 4, 0));
      }
    };
    img.src = screenshot;
  }, [screenshot, selection]);

  useEffect(() => {
    if (!deepDiveLoading && !deepDiveActive) return;
    if (!glowStyleInjected.current) {
      glowStyleInjected.current = true;
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

    if (immediate) {
      try {
        const response = await sendRuntimeMessage<{ captureId: string; explanation: string }>({
          type: "EXPLAIN_SCREENSHOT",
          imageData: croppedDataUrl,
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
      chrome.runtime.sendMessage({ type: "SAVE_SCREENSHOT", imageData: croppedDataUrl, context: finalContext });
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
      setMessages([{ role: "assistant", content: response.explanation }]);
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
          <p style={{ color: "#6366f1", fontSize: 12, marginBottom: 8 }}>Region selected</p>
          <input
            ref={inputRef}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") { setStage("selecting"); setSelection(null); } }}
            placeholder="Any specific part you don't understand? (optional)"
            style={{ width: "100%", background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,0.15)", color: "#e2e8f0", fontSize: 14, padding: "6px 0", outline: "none", marginBottom: 12 }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => window.close()} style={{ flex: 1, background: "rgba(255,255,255,0.08)", color: "#e2e8f0", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "8px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Cancel
            </button>
            <button onClick={() => submit()} style={{ flex: 1, background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, padding: "8px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Save
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
                <p style={{ color: message.role === "assistant" ? "#e2e8f0" : "#cbd5e1", fontSize: message.role === "assistant" ? 15 : 13, lineHeight: 1.65, margin: 0, whiteSpace: "pre-wrap" }}>
                  {message.content}
                </p>
              </div>
            ))}
            {followupLoading && (
              <div style={{ color: deepDiveActive ? "#818cf8" : "#94a3b8", fontSize: 14, fontStyle: "italic", lineHeight: 1.65 }}>
                {deepDiveActive ? "Thinking through a deeper answer…" : "Thinking…"}
              </div>
            )}
            {deepDiveLoading && (
              <div style={{ color: "#818cf8", fontSize: 14, fontStyle: "italic", lineHeight: 1.65 }}>Thinking through a deeper answer…</div>
            )}
          </div>

          {showDeepDiveBtn && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
              <button
                onClick={handleDeepDive}
                style={{ background: "transparent", color: "#818cf8", border: "1px solid rgba(99,102,241,0.4)", borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", letterSpacing: "0.02em" }}
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
              style={{ flex: 1, minWidth: 0, background: "transparent", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 7, color: "#e2e8f0", fontSize: 13, outline: "none", padding: "8px 10px" }}
            />
            <button onClick={askFollowup} disabled={!captureId || followupLoading || deepDiveLoading} style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 7, padding: "8px 13px", fontSize: 13, fontWeight: 600, cursor: captureId && !followupLoading && !deepDiveLoading ? "pointer" : "default", opacity: captureId && !followupLoading && !deepDiveLoading ? 1 : 0.55 }}>
              Ask
            </button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={resetSelection} style={{ flex: 1, background: "rgba(255,255,255,0.08)", color: "#94a3b8", border: "none", borderRadius: 6, padding: "8px 0", fontSize: 13, cursor: "pointer" }}>
              New selection
            </button>
            <button onClick={() => window.close()} style={{ flex: 1, background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, padding: "8px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
