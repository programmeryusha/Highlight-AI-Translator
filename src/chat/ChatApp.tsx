import React, { useEffect, useRef, useState } from "react";
import type { Capture, ChatMessage } from "../types";

const BACKEND_URL = "https://web-production-223b1.up.railway.app";

async function throwResponseError(label: string, res: Response): Promise<never> {
  let detail = "";
  try {
    const body = await res.text();
    if (body) {
      try {
        const parsed = JSON.parse(body);
        detail = parsed.detail ?? parsed.error?.message ?? parsed.error?.type ?? body;
      } catch {
        detail = body;
      }
    }
  } catch {
    // Ignore secondary failures while reporting the primary HTTP status.
  }

  const shortDetail = detail ? ` — ${detail.slice(0, 240)}` : "";
  throw new Error(`${label}: ${res.status}${shortDetail}`);
}

function renderMarkdown(text: string): React.ReactNode {
  // Split into lines, group consecutive list items into a <ul>
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];

  function flushList() {
    if (listItems.length) {
      nodes.push(<ul key={nodes.length} style={{ margin: "6px 0 6px 20px", padding: 0 }}>{listItems}</ul>);
      listItems = [];
    }
  }

  function inlineBold(line: string, key: number): React.ReactNode {
    const parts = line.split(/\*\*(.*?)\*\*/g);
    return parts.map((part, i) => i % 2 === 1 ? <strong key={i}>{part}</strong> : part);
  }

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }
    if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      const content = trimmed.slice(2);
      listItems.push(<li key={i} style={{ marginBottom: 4 }}>{inlineBold(content, i)}</li>);
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
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!captureId) return;
    chrome.storage.local.get(["captures", `chat_${captureId}`], (result) => {
      const captures: Capture[] = result.captures ?? [];
      const found = captures.find((c) => c.id === captureId) ?? null;
      setCapture(found);

      const prior: ChatMessage[] = result[`chat_${captureId}`] ?? [];
      if (prior.length === 0 && found?.explanation) {
        // Seed with the initial explanation
        const seed: ChatMessage[] = [{ role: "assistant", content: found.explanation }];
        setMessages(seed);
        chrome.storage.local.set({ [`chat_${captureId}`]: seed });
      } else {
        setMessages(prior);
      }
    });
  }, [captureId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!capture) return;
    setSourceExpanded(false);
  }, [capture?.id]);

  async function send() {
    const text = input.trim();
    if (!text || loading || !capture) return;
    setInput("");

    const updated: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(updated);
    setLoading(true);

    try {
      const transcript = updated
        .slice(-8)
        .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
        .join("\n");
      const source = [
        `Saved item: ${capture.text}`,
        capture.context ? `Original context note: ${capture.context}` : "",
        `Conversation so far:\n${transcript}`,
      ].filter(Boolean).join("\n\n");

      const res = await fetch(`${BACKEND_URL}/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: source,
          context: text,
        }),
      });
      if (!res.ok) await throwResponseError("Backend error", res);

      const data = await res.json();
      const reply = data.explanation?.trim() ?? "No response.";
      const final: ChatMessage[] = [...updated, { role: "assistant", content: reply }];
      setMessages(final);
      chrome.storage.local.set({ [`chat_${captureId}`]: final });
    } catch (error) {
      console.error("ContextLens chat failed", error);
      const message = error instanceof Error ? error.message : "Something went wrong. Try again.";
      const errMsgs: ChatMessage[] = [...updated, { role: "assistant", content: message }];
      setMessages(errMsgs);
    }
    setLoading(false);
  }

  if (!capture) {
    return (
      <div style={{ padding: "60px 48px", color: "#9b9a97" }}>
        Loading…
      </div>
    );
  }

  const sourceIsLong = capture.text.length > 700;
  const sourcePreview = sourceIsLong && !sourceExpanded;

  return (
    <div style={{ minHeight: "100vh", maxWidth: 900, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ padding: "32px 48px 0" }}>
        <a
          href={chrome.runtime.getURL("src/dashboard/dashboard.html")}
          style={{ fontSize: 13, color: "#9b9a97", textDecoration: "none", display: "inline-block", marginBottom: 24 }}
        >
          ← Back
        </a>
        {/* Highlighted text */}
        <div
          style={{
            border: "1px solid #e3e2de",
            borderLeft: "3px solid #e3e2de",
            borderRadius: 8,
            padding: "14px 16px",
            marginBottom: 24,
          }}
        >
          <p style={{ fontSize: 16, color: "#37352f", lineHeight: 1.6, fontWeight: 500, maxHeight: sourcePreview ? 180 : undefined, overflow: sourcePreview ? "hidden" : undefined, marginBottom: sourceIsLong ? 8 : undefined }}>
            {capture.text}
          </p>
          {sourceIsLong && (
            <button
              onClick={() => setSourceExpanded((value) => !value)}
              style={{ background: "none", border: "none", color: "#6366f1", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, marginBottom: 6 }}
            >
              {sourceExpanded ? "Collapse text" : "Show full text"}
            </button>
          )}
          {capture.context && (
            <div style={{ borderTop: "1px solid #e3e2de", marginTop: 12, paddingTop: 12 }}>
              <p style={{ fontSize: 12, color: "#9b9a97", fontWeight: 600, margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Your note
              </p>
              <p style={{ fontSize: 15, color: "#37352f", lineHeight: 1.55, margin: 0, fontWeight: 500 }}>
                {capture.context}
              </p>
            </div>
          )}
        </div>
        <div style={{ borderBottom: "1px solid #e3e2de", marginBottom: 0 }} />
      </div>

      {/* Messages */}
      <div style={{ padding: "24px 48px 8px" }}>
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 12, color: "#9b9a97", marginBottom: 4, fontWeight: 500 }}>
              {m.role === "assistant" ? "AI" : "You"}
            </p>
            <div style={{ fontSize: m.role === "assistant" ? 17 : 15, color: "#37352f", lineHeight: m.role === "assistant" ? 1.85 : 1.7 }}>
              {renderMarkdown(m.content)}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 12, color: "#9b9a97", marginBottom: 4, fontWeight: 500 }}>AI</p>
            <p style={{ fontSize: 15, color: "#9b9a97" }}>…</p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "16px 48px 32px", borderTop: "1px solid #e3e2de" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask a follow-up question…"
          disabled={loading}
          style={{
            width: "100%",
            fontSize: 15,
            color: "#37352f",
            background: "transparent",
            border: "none",
            outline: "none",
            padding: "8px 0",
          }}
        />
      </div>
    </div>
  );
}
