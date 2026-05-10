import React, { useEffect, useRef, useState } from "react";
import type { Capture } from "../types";

interface Message {
  role: "user" | "assistant";
  content: string;
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!captureId) return;
    chrome.storage.local.get(["captures", `chat_${captureId}`], (result) => {
      const captures: Capture[] = result.captures ?? [];
      const found = captures.find((c) => c.id === captureId) ?? null;
      setCapture(found);

      const prior: Message[] = result[`chat_${captureId}`] ?? [];
      if (prior.length === 0 && found?.explanation) {
        // Seed with the initial explanation
        const seed: Message[] = [{ role: "assistant", content: found.explanation }];
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

  async function send() {
    const text = input.trim();
    if (!text || loading || !capture) return;
    setInput("");

    const updated: Message[] = [...messages, { role: "user", content: text }];
    setMessages(updated);
    setLoading(true);

    const { anthropic_api_key: apiKey } = await chrome.storage.local.get("anthropic_api_key");
    if (!apiKey) {
      const err: Message[] = [...updated, { role: "assistant", content: "No API key found. Add it in Settings." }];
      setMessages(err);
      setLoading(false);
      return;
    }

    try {
      const systemPrompt = `The user saved this highlighted text:\n"${capture.text}"${capture.context ? `\n\nThey noted they didn't understand: "${capture.context}"` : ""}\n\nAnswer follow-up questions about it clearly and concisely.`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 400,
          system: systemPrompt,
          messages: updated.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await res.json();
      const reply = data.content?.[0]?.text?.trim() ?? "No response.";
      const final: Message[] = [...updated, { role: "assistant", content: reply }];
      setMessages(final);
      chrome.storage.local.set({ [`chat_${captureId}`]: final });
    } catch {
      const errMsgs: Message[] = [...updated, { role: "assistant", content: "Something went wrong. Try again." }];
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", maxWidth: 900, margin: "0 auto" }}>
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
            borderLeft: "3px solid #e3e2de",
            paddingLeft: 16,
            marginBottom: 24,
          }}
        >
          <p style={{ fontSize: 16, color: "#37352f", lineHeight: 1.6, fontWeight: 500 }}>
            {capture.text}
          </p>
          {capture.context && (
            <p style={{ fontSize: 13, color: "#9b9a97", marginTop: 6 }}>
              didn't understand: <em>{capture.context}</em>
            </p>
          )}
        </div>
        <div style={{ borderBottom: "1px solid #e3e2de", marginBottom: 0 }} />
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 48px" }}>
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 12, color: "#9b9a97", marginBottom: 4, fontWeight: 500 }}>
              {m.role === "assistant" ? "AI" : "You"}
            </p>
            <div style={{ fontSize: 15, color: "#37352f" }}>
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
