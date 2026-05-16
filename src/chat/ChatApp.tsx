import React, { useEffect, useRef, useState } from "react";
import type { Capture, ChatMessage, Message } from "../types";

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
  const [deepDiveLoading, setDeepDiveLoading] = useState(false);
  const [deepDiveActive, setDeepDiveActive] = useState(false);
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

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
  }, [messages, loading, deepDiveLoading]);

  useEffect(() => {
    if (!capture) return;
    setSourceExpanded(false);
    setDeepDiveLoading(false);
  }, [capture?.id]);

  async function handleDeepDive() {
    if (!capture || deepDiveActive || deepDiveLoading) return;
    setDeepDiveLoading(true);
    try {
      const data = await sendRuntimeMessage<{ explanation: string; messages: ChatMessage[] }>({
        type: "DEEP_DIVE",
        captureId: capture.id,
      });
      const result: ChatMessage[] = [{ role: "assistant", content: data.explanation }];
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

  const hasScreenshot = Boolean(capture.imageData);
  const sourceIsLong = !hasScreenshot && capture.text.length > 700;
  const sourcePreview = sourceIsLong && !sourceExpanded;
  const showDeepDiveBtn = capture.status === "done" && !deepDiveActive && !deepDiveLoading;

  return (
    <div style={{ minHeight: "100vh", maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column" }}>
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
                background: "#f7f6f3",
              }}
            />
          ) : (
            <p
              style={{
                fontSize: 21,
                color: "#2f2e2b",
                lineHeight: 1.6,
                fontWeight: 650,
                maxHeight: sourcePreview ? 220 : undefined,
                overflow: sourcePreview ? "hidden" : undefined,
                marginBottom: sourceIsLong ? 8 : undefined,
              }}
            >
              {capture.text}
            </p>
          )}
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
                Your question
              </p>
              <p style={{ fontSize: 18, color: "#37352f", lineHeight: 1.55, margin: 0, fontWeight: 650 }}>
                {capture.context}
              </p>
            </div>
          )}
        </div>
        <div style={{ borderBottom: "1px solid #e3e2de", marginBottom: 0 }} />
      </div>

      {/* Messages */}
      <div style={{ padding: "24px 48px 96px", flex: 1 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 12, color: "#9b9a97", marginBottom: 4, fontWeight: 500 }}>
              {m.role === "assistant" ? "AI" : "You"}
            </p>
            <div style={{ fontSize: m.role === "assistant" ? 19 : 16, color: "#37352f", lineHeight: m.role === "assistant" ? 1.8 : 1.7 }}>
              {renderMarkdown(m.content)}
            </div>
          </div>
        ))}
        {showDeepDiveBtn && (
          <div style={{ marginBottom: 20 }}>
            <button
              type="button"
              onClick={handleDeepDive}
              style={{ background: "transparent", color: "#818cf8", border: "1px solid rgba(99,102,241,0.4)", borderRadius: 6, padding: "5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", letterSpacing: "0.02em" }}
            >
              ✦ Deep Dive
            </button>
          </div>
        )}
        {deepDiveLoading && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 12, color: "#818cf8", marginBottom: 4, fontWeight: 500 }}>AI</p>
            <p style={{ fontSize: 15, color: "#818cf8", fontStyle: "italic" }}>Thinking through a deeper answer…</p>
          </div>
        )}
        {loading && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 12, color: deepDiveActive ? "#818cf8" : "#9b9a97", marginBottom: 4, fontWeight: 500 }}>AI</p>
            <p style={{ fontSize: 15, color: deepDiveActive ? "#818cf8" : "#9b9a97", fontStyle: deepDiveActive ? "italic" : undefined }}>
              {deepDiveActive ? "Thinking through a deeper answer…" : "…"}
            </p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ position: "sticky", bottom: 0, padding: "14px 48px 24px", background: "#fff", borderTop: "1px solid #e3e2de" }}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
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
              color: "#37352f",
              background: "#fff",
              border: "1px solid #d8d7d2",
              borderRadius: 14,
              outline: "none",
              padding: "0 16px",
              boxShadow: "0 1px 6px rgba(15, 15, 15, 0.06)",
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
              background: loading || deepDiveLoading || !input.trim() ? "#d8d7d2" : "#37352f",
              color: "#fff",
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
