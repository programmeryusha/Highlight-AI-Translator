import React from "react";

export default function PrivacyApp() {
  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 24px 80px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: "#37352f", lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>Privacy Policy</h1>
      <p style={{ fontSize: 13, color: "#9b9a97", marginBottom: 40 }}>Last updated: May 2026</p>

      <Section title="What we collect">
        <p>When you install ContextLens, we ask for your email address. We use it to create your account and sync your saved highlights across devices. We do not sell or share your email with third parties.</p>
      </Section>

      <Section title="What you highlight">
        <p>Text you highlight and notes you add are sent to our backend server to generate an explanation. They are stored in your account so you can review them later. Screenshot regions you select are processed the same way.</p>
        <p style={{ marginTop: 10 }}>Your highlights are stored in two places:</p>
        <ul style={{ paddingLeft: 20, marginTop: 6 }}>
          <li>Locally in <code style={{ fontFamily: "monospace", fontSize: "0.9em", background: "#f0efec", borderRadius: 4, padding: "1px 5px" }}>chrome.storage.local</code> on your device</li>
          <li>On our backend database (PostgreSQL hosted on Railway) linked to your account</li>
        </ul>
      </Section>

      <Section title="Third-party AI services">
        <p>To generate explanations, the text or image you highlight is sent to one or more of the following AI providers:</p>
        <ul style={{ paddingLeft: 20, marginTop: 6 }}>
          <li><strong>Google Gemini</strong> — used for standard explanations</li>
          <li><strong>Google Cloud Vision</strong> — used to extract text from screenshots</li>
          <li><strong>Anthropic Claude</strong> — used for Deep Dive mode</li>
        </ul>
        <p style={{ marginTop: 10 }}>Each provider's own privacy policy applies to data processed by their APIs. We do not instruct these providers to train on your data.</p>
      </Section>

      <Section title="Chrome permissions">
        <p>ContextLens requests the following permissions and uses them only as described:</p>
        <ul style={{ paddingLeft: 20, marginTop: 6 }}>
          <li><strong>storage</strong> — to save your highlights and settings locally</li>
          <li><strong>tabs</strong> — to inject the content script and capture screenshots</li>
          <li><strong>scripting</strong> — to inject the highlight bubble into web pages</li>
          <li><strong>contextMenus</strong> — to add an "Ask ContextLens" right-click option</li>
        </ul>
        <p style={{ marginTop: 10 }}>We do not read your browsing history or track which pages you visit.</p>
      </Section>

      <Section title="Data retention and deletion">
        <p>You can delete individual highlights from within the extension dashboard. Deleting a highlight removes it from both local storage and our backend. You can also contact us to delete your entire account and all associated data.</p>
      </Section>

      <Section title="Contact">
        <p>For questions or data deletion requests, email us at <strong>contextlens@gmail.com</strong>.</p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10, color: "#37352f" }}>{title}</h2>
      <div style={{ fontSize: 14, color: "#4a4a4a" }}>{children}</div>
    </div>
  );
}
