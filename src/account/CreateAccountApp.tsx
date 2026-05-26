import React, { useRef, useState } from "react";
import type { AppMode, ContextLensUser, Message } from "../types";

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

function setStoredAppMode(mode: AppMode): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ app_mode: mode }, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) reject(new Error(lastError.message));
      else resolve();
    });
  });
}

const modeOptions: { value: AppMode; title: string; description: string }[] = [
  {
    value: "language_learning",
    title: "Language Learning",
    description: "For learning languages: translations, grammar, vocabulary, and natural phrasing.",
  },
  {
    value: "student",
    title: "Student",
    description: "For general info: quick explanations, study help, and context for anything you save.",
  },
];

export default function CreateAccountApp() {
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [selectedMode, setSelectedMode] = useState<AppMode | "">("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const trimmedEmail = email.trim().toLowerCase();
  const canSubmit = trimmedEmail.includes("@") && password.length >= 6 && confirmPassword.length >= 6 && Boolean(selectedMode) && !loading;

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
    if (!selectedMode) {
      setError("Choose a mode before creating your account.");
      return;
    }

    setLoading(true);
    setError("");
    setStatus("");
    try {
      await setStoredAppMode(selectedMode);
      const account = await sendRuntimeMessage<ContextLensUser>({ type: "SIGN_UP", email: trimmedEmail, password });
      setStatus(`Signed in as ${account.email}. Opening your dashboard...`);
      window.setTimeout(() => {
        window.location.href = chrome.runtime.getURL("src/dashboard/dashboard.html#settings");
      }, 500);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create your account.";
      if (/already registered|already exists/i.test(message)) {
        setError("That email is already registered. Enter a different email to create a new account.");
        window.setTimeout(() => {
          emailInputRef.current?.focus();
          emailInputRef.current?.select();
        }, 0);
      } else {
        setError(message);
      }
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
              ref={emailInputRef}
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

          <div>
            <p style={{ color: "#37352f", fontSize: 13, fontWeight: 800, margin: "2px 0 8px" }}>Choose your mode</p>
            <div role="radiogroup" aria-label="Choose mode" style={{ display: "grid", gap: 10 }}>
              {modeOptions.map((option) => {
                const selected = selectedMode === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={loading}
                    onClick={() => setSelectedMode(option.value)}
                    style={{
                      width: "100%",
                      border: `1px solid ${selected ? "#37352f" : "#d8d7d2"}`,
                      borderRadius: 8,
                      background: selected ? "#f0efec" : "#fff",
                      color: "#37352f",
                      padding: "12px 13px",
                      textAlign: "left",
                      cursor: loading ? "default" : "pointer",
                    }}
                  >
                    <span style={{ display: "block", fontSize: 14, fontWeight: 850, marginBottom: 4 }}>{option.title}</span>
                    <span style={{ display: "block", color: "#6b7280", fontSize: 13, lineHeight: 1.45 }}>{option.description}</span>
                  </button>
                );
              })}
            </div>
            <p style={{ color: "#8b8984", fontSize: 12, lineHeight: 1.5, margin: "8px 0 0" }}>
              You can change this later by tapping the extension icon.
            </p>
          </div>

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
