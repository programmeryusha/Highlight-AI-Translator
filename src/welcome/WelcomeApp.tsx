import React, { useState } from "react";

export default function WelcomeApp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const type = mode === "signup" ? "SIGN_UP" : "SIGN_IN";
      await chrome.runtime.sendMessage({ type, email: trimmedEmail, password });
      window.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fafaf9" }}>
      <div style={{ maxWidth: 520, width: "100%", padding: "0 24px" }}>
        <div style={{ marginBottom: 36 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🖊️</div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "#37352f", marginBottom: 8 }}>
            Welcome to ContextLens
          </h1>
          <p style={{ fontSize: 16, color: "#6b7280", lineHeight: 1.6 }}>
            Highlight any text on any page and instantly understand it — in any language.
          </p>
        </div>

        {mode === "signup" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20, marginBottom: 36 }}>
            <Step number={1} title="Select any text" description="Highlight a word, sentence, or paragraph on any webpage." />
            <Step number={2} title='Hit "Save" in the bubble' description="A small button appears above your selection. Type what you don't understand and press Enter." />
            <Step number={3} title="Get an instant explanation" description="AI explains it clearly. Open the dashboard anytime to review everything you've saved." />
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Email address"
            disabled={loading}
            required
            style={inputStyle}
          />
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password (min. 6 characters)"
            disabled={loading}
            required
            style={inputStyle}
          />
          {error && (
            <p style={{ fontSize: 13, color: "#dc2626", margin: 0 }}>{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            style={{
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
            {loading
              ? (mode === "signup" ? "Creating account…" : "Signing in…")
              : (mode === "signup" ? "Create account" : "Sign in")}
          </button>
        </form>

        <p style={{ marginTop: 16, fontSize: 13, color: "#9b9a97", textAlign: "center" }}>
          {mode === "signup" ? (
            <>Already have an account?{" "}
              <button onClick={() => { setMode("signin"); setError(""); }} style={{ background: "none", border: "none", color: "#2563eb", fontSize: 13, cursor: "pointer", padding: 0, fontWeight: 600 }}>
                Sign in
              </button>
            </>
          ) : (
            <>New here?{" "}
              <button onClick={() => { setMode("signup"); setError(""); }} style={{ background: "none", border: "none", color: "#2563eb", fontSize: 13, cursor: "pointer", padding: 0, fontWeight: 600 }}>
                Create account
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "12px 14px",
  fontSize: 15,
  border: "1.5px solid #e0ddd9",
  borderRadius: 8,
  outline: "none",
  background: "#fff",
  color: "#37352f",
};

function Step({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#37352f", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>
        {number}
      </div>
      <div>
        <p style={{ fontSize: 15, fontWeight: 600, color: "#37352f", margin: "0 0 3px" }}>{title}</p>
        <p style={{ fontSize: 14, color: "#6b7280", lineHeight: 1.6, margin: 0 }}>{description}</p>
      </div>
    </div>
  );
}
