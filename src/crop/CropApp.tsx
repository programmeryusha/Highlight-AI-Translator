import React, { useEffect, useRef, useState } from "react";

type Rect = { x: number; y: number; w: number; h: number };
type Stage = "selecting" | "context" | "saving" | "done";

export default function CropApp() {
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("selecting");
  const [selection, setSelection] = useState<Rect | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [context, setContext] = useState("");
  const [immediate, setImmediate] = useState(false);
  const [explanation, setExplanation] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    chrome.storage.session.get("pending_screenshot", (r) => {
      if (r.pending_screenshot) {
        setScreenshot(r.pending_screenshot);
        chrome.storage.session.remove("pending_screenshot");
      }
    });
    chrome.storage.local.get("screenshot_triggers", (r) => {
      setImmediate(r.screenshot_triggers?.immediate ?? false);
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
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.clearRect(selection.x, selection.y, selection.w, selection.h);
        ctx.drawImage(img, selection.x, selection.y, selection.w, selection.h, selection.x, selection.y, selection.w, selection.h);
        ctx.strokeStyle = "#6366f1";
        ctx.lineWidth = 2;
        ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
      }
    };
    img.src = screenshot;
  }, [screenshot, selection]);

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

  async function submit() {
    if (!selection || !screenshot) return;
    setStage("saving");

    // Crop image
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
      // Show inline result
      const { anthropic_api_key: apiKey } = await chrome.storage.local.get("anthropic_api_key");
      if (!apiKey) { setExplanation("Add your API key in Settings."); setStage("done"); return; }

      const base64 = croppedDataUrl.split(",")[1];
      const prompt = context
        ? `The user doesn't understand "${context}" in this image. Explain it clearly in 1-3 sentences in English. Plain text only, no markdown.`
        : "Explain what is shown in this image in 1-3 sentences in English. Be clear and concise. Plain text only, no markdown.";

      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 300,
            messages: [{ role: "user", content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
              { type: "text", text: prompt },
            ]}],
          }),
        });
        const data = await res.json();
        setExplanation(data.content?.[0]?.text?.trim().replace(/^#+\s*/gm, "") ?? "No response.");
      } catch { setExplanation("Something went wrong."); }

      // Also save to list in background
      chrome.runtime.sendMessage({ type: "SAVE_SCREENSHOT", imageData: croppedDataUrl, context });
      setStage("done");
    } else {
      // Save to list, close
      chrome.runtime.sendMessage({ type: "SAVE_SCREENSHOT", imageData: croppedDataUrl, context });
      window.close();
    }
  }

  if (!screenshot) {
    return <div style={{ color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontSize: 16 }}>Loading…</div>;
  }

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", background: "#000" }}>
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        style={{ width: "100%", height: "100%", objectFit: "contain", cursor: stage === "selecting" ? "crosshair" : "default" }}
      />

      {stage === "selecting" && (
        <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.75)", color: "#fff", padding: "8px 20px", borderRadius: 999, fontSize: 14, pointerEvents: "none" }}>
          Drag to select a region · Esc to cancel
        </div>
      )}

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
            <button onClick={submit} style={{ flex: 1, background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, padding: "8px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Save
            </button>
            <button onClick={() => { setStage("selecting"); setSelection(null); }} style={{ flex: 1, background: "rgba(255,255,255,0.08)", color: "#94a3b8", border: "none", borderRadius: 6, padding: "8px 0", fontSize: 13, cursor: "pointer" }}>
              Reselect
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
        <div style={{ position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)", background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: "20px 24px", width: 460, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
          <p style={{ color: "#e2e8f0", fontSize: 15, lineHeight: 1.7, marginBottom: 16 }}>{explanation}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setStage("selecting"); setSelection(null); setContext(""); setExplanation(""); }} style={{ flex: 1, background: "rgba(255,255,255,0.08)", color: "#94a3b8", border: "none", borderRadius: 6, padding: "8px 0", fontSize: 13, cursor: "pointer" }}>
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
