import React from "react";

export default function WelcomeApp() {
  const createAccountUrl = chrome.runtime.getURL("src/account/create-account.html");
  const signInUrl = chrome.runtime.getURL("src/dashboard/dashboard.html#settings");
  const dashboardUrl = chrome.runtime.getURL("src/dashboard/dashboard.html");

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fafaf9", padding: "40px 20px" }}>
      <section style={{ maxWidth: 560, width: "100%" }}>
        <div style={{ marginBottom: 34 }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: "#37352f", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23, marginBottom: 16 }}>
            ◐
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: "#37352f", margin: "0 0 10px", letterSpacing: 0 }}>
            Welcome to ContextLens
          </h1>
          <p style={{ fontSize: 16, color: "#6b7280", lineHeight: 1.65, margin: 0 }}>
            Highlight text on any page, add what confused you, and get a clear explanation saved to your dashboard.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18, marginBottom: 34 }}>
          <Step number={1} title="Select text" description="Highlight a word, sentence, paragraph, or screenshot region on a page." />
          <Step number={2} title="Ask what it means" description="Use the Ask button or right-click menu to add a quick note." />
          <Step number={3} title="Review it later" description="Your explanations, history, and flashcards live in the dashboard." />
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <a href={createAccountUrl} style={primaryLinkStyle}>
            Create account
          </a>
          <a href={signInUrl} style={secondaryLinkStyle}>
            Sign in
          </a>
          <a href={dashboardUrl} style={quietLinkStyle}>
            Open dashboard
          </a>
        </div>
      </section>
    </main>
  );
}

const primaryLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 138,
  height: 42,
  borderRadius: 8,
  background: "#37352f",
  color: "#fff",
  fontSize: 14,
  fontWeight: 800,
  textDecoration: "none",
  padding: "0 16px",
};

const secondaryLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 96,
  height: 42,
  borderRadius: 8,
  background: "#fff",
  color: "#37352f",
  border: "1px solid #d8d7d2",
  fontSize: 14,
  fontWeight: 800,
  textDecoration: "none",
  padding: "0 16px",
};

const quietLinkStyle: React.CSSProperties = {
  color: "#6b7280",
  fontSize: 13,
  fontWeight: 700,
  textDecoration: "none",
  padding: "10px 4px",
};

function Step({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#37352f", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, flexShrink: 0, marginTop: 2 }}>
        {number}
      </div>
      <div>
        <p style={{ fontSize: 15, fontWeight: 800, color: "#37352f", margin: "0 0 3px" }}>{title}</p>
        <p style={{ fontSize: 14, color: "#6b7280", lineHeight: 1.6, margin: 0 }}>{description}</p>
      </div>
    </div>
  );
}
