import React, { useState } from "react";

export default function WelcomeApp() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await chrome.runtime.sendMessage({ type: "REGISTER_EMAIL", email: trimmed });
      window.close();
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fafaf9" }}>
      <div style={{ maxWidth: 520, width: "100%", padding: "0 24px" }}>

        <div style={{ marginBottom: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🖊️</div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "#37352f", marginBottom: 8 }}>
            Welcome to ContextLens
          </h1>
          <p style={{ fontSize: 16, color: "#6b7280", lineHeight: 1.6 }}>
            Highlight any text on any page and instantly understand it — in any language.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24, marginBottom: 40 }}>
          <Step
            number={1}
            title="Select any text"
            description="Highlight a word, sentence, or paragraph on any webpage."
          />
          <Step
            number={2}
            title='Hit "Save" in the bubble'
            description="A small button appears above your selection. Click it, optionally type what you don't understand, and press Enter."
          />
          <Step
            number={3}
            title="Get an instant explanation"
            description="AI explains it clearly. Open the dashboard anytime to review everything you've saved, or click any entry to ask follow-up questions."
          />
        </div>

        <form onSubmit={handleSubmit}>
          <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#37352f", marginBottom: 8 }}>
            Enter your email to get started
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={loading}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "12px 14px",
              fontSize: 15,
              border: "1.5px solid #e0ddd9",
              borderRadius: 8,
              outline: "none",
              marginBottom: 12,
              background: "#fff",
              color: "#37352f",
            }}
          />
          {error && (
            <p style={{ fontSize: 13, color: "#dc2626", marginBottom: 10 }}>{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              background: loading ? "#9b9a97" : "#37352f",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "14px 0",
              fontSize: 15,
              fontWeight: 600,
              cursor: loading ? "default" : "pointer",
            }}
          >
            {loading ? "Setting up…" : "Start using ContextLens"}
          </button>
        </form>

        <p style={{ marginTop: 16, fontSize: 12, color: "#9b9a97", textAlign: "center" }}>
          Your email lets us save your highlights across devices. We never send spam.
        </p>
      </div>
    </div>
  );
}

function Step({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <div style={{
        width: 32,
        height: 32,
        borderRadius: "50%",
        background: "#37352f",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        fontWeight: 700,
        flexShrink: 0,
        marginTop: 2,
      }}>
        {number}
      </div>
      <div>
        <p style={{ fontSize: 15, fontWeight: 600, color: "#37352f", marginBottom: 4 }}>{title}</p>
        <p style={{ fontSize: 14, color: "#6b7280", lineHeight: 1.6 }}>{description}</p>
      </div>
    </div>
  );
}
