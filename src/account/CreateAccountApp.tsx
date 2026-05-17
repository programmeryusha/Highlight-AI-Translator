import React, { useState } from "react";
import type { ContextLensUser, Message } from "../types";

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

export default function CreateAccountApp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const trimmedEmail = email.trim().toLowerCase();
  const canSubmit = trimmedEmail.includes("@") && password.length >= 6 && confirmPassword.length >= 6 && !loading;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!trimmedEmail.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    setError("");
    setStatus("");
    try {
      const account = await sendRuntimeMessage<ContextLensUser>({ type: "SIGN_UP", email: trimmedEmail, password });
      setStatus(`Signed in as ${account.email}. Opening your dashboard...`);
      window.setTimeout(() => {
        window.location.href = chrome.runtime.getURL("src/dashboard/dashboard.html#settings");
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create your account.");
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", background: "#fafaf9", display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 20px" }}>
      <section style={{ width: "100%", maxWidth: 440 }}>
        <a href={chrome.runtime.getURL("src/welcome/welcome.html")} style={{ color: "#6b7280", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
          Back
        </a>
        <div style={{ marginTop: 22, marginBottom: 24 }}>
          <h1 style={{ color: "#37352f", fontSize: 28, fontWeight: 800, margin: "0 0 8px" }}>Create your account</h1>
          <p style={{ color: "#6b7280", fontSize: 15, lineHeight: 1.6, margin: 0 }}>
            Use an email and password to sync your saved highlights across devices.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={labelStyle}>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              disabled={loading}
              required
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              placeholder="At least 6 characters"
              disabled={loading}
              required
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Confirm password
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              placeholder="Re-enter your password"
              disabled={loading}
              required
              style={inputStyle}
            />
          </label>

          {error && <p style={{ color: "#dc2626", fontSize: 13, lineHeight: 1.5, margin: "2px 0 0" }}>{error}</p>}
          {status && <p style={{ color: "#2563eb", fontSize: 13, lineHeight: 1.5, margin: "2px 0 0" }}>{status}</p>}

          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              width: "100%",
              height: 44,
              borderRadius: 8,
              border: "none",
              background: canSubmit ? "#37352f" : "#d8d7d2",
              color: canSubmit ? "#fff" : "#8b8984",
              fontSize: 14,
              fontWeight: 800,
              cursor: canSubmit ? "pointer" : "default",
              marginTop: 4,
            }}
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p style={{ color: "#8b8984", fontSize: 13, lineHeight: 1.5, margin: "18px 0 0", textAlign: "center" }}>
          Already have an account?{" "}
          <a href={chrome.runtime.getURL("src/dashboard/dashboard.html#settings")} style={{ color: "#2563eb", fontWeight: 700, textDecoration: "none" }}>
            Sign in
          </a>
        </p>
      </section>
    </main>
  );
}

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  color: "#37352f",
  fontSize: 13,
  fontWeight: 700,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 42,
  boxSizing: "border-box",
  padding: "0 12px",
  fontSize: 14,
  border: "1px solid #d8d7d2",
  borderRadius: 8,
  outline: "none",
  background: "#fff",
  color: "#37352f",
};
