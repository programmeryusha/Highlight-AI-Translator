import React from "react";

export default function PrivacyApp() {
  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 24px 80px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: "#37352f", lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>Privacy Policy</h1>
      <p style={{ fontSize: 13, color: "#9b9a97", marginBottom: 40 }}>Last updated: June 2026</p>

      <Section title="What we collect">
        <p>ContextLens stores the content you choose to save: highlighted text, optional notes, source page URL/title for saved items, screenshot regions, AI explanations, follow-up chats, flashcard sets, review state, due dates, ratings, and app preferences.</p>
        <p style={{ marginTop: 10 }}>When you create an account or sign in, your email address and password are sent over HTTPS to the ContextLens backend for authentication. The extension stores your email address and authentication token locally so it can keep you signed in. Passwords are not stored in the extension.</p>
      </Section>

      <Section title="What you highlight">
        <p>Text you highlight, notes you add, screenshot regions you select, source URL/title for that selected item, and chat context are sent to our backend server to generate an explanation. If you are signed in, they are stored in your account so you can review them later and sync across devices.</p>
        <p style={{ marginTop: 10 }}>Your highlights are stored in two places:</p>
        <ul style={{ paddingLeft: 20, marginTop: 6 }}>
          <li>Locally in <code style={{ fontFamily: "monospace", fontSize: "0.9em", background: "#f0efec", borderRadius: 4, padding: "1px 5px" }}>chrome.storage.local</code> on your device</li>
          <li>On the ContextLens backend database hosted on Railway, linked to your account when you are signed in</li>
        </ul>
      </Section>

      <Section title="Third-party AI services">
        <p>To generate explanations, the text or image you choose to save may be sent to one or more of the following providers:</p>
        <ul style={{ paddingLeft: 20, marginTop: 6 }}>
          <li><strong>Google Gemini</strong> — used for standard explanations</li>
          <li><strong>Google Cloud Vision</strong> — used to extract text from screenshots</li>
          <li><strong>Google Fonts</strong> — used to render Arabic text cleanly in the interface</li>
          <li><strong>Anthropic Claude</strong> — used for Deep Dive mode</li>
          <li><strong>QuranCDN</strong> — used only when resolving selected Quran.com verse text by verse key</li>
        </ul>
        <p style={{ marginTop: 10 }}>Each provider's own privacy policy applies to data processed by their APIs. We do not sell data or use it for advertising.</p>
      </Section>

      <Section title="Chrome permissions">
        <p>ContextLens requests the following permissions and uses them only as described:</p>
        <ul style={{ paddingLeft: 20, marginTop: 6 }}>
          <li><strong>storage</strong> — to save your highlights and settings locally</li>
          <li><strong>unlimitedStorage</strong> — to support saved screenshots and larger study histories</li>
          <li><strong>tabs</strong> — to inject the content script and capture screenshots</li>
          <li><strong>scripting</strong> — to inject the highlight bubble into web pages</li>
          <li><strong>contextMenus</strong> — to add an "Ask ContextLens" right-click option</li>
          <li><strong>host permissions</strong> — to show ContextLens on pages where you choose to use it</li>
        </ul>
        <p style={{ marginTop: 10 }}>We do not sell your data, run ads, or use analytics. ContextLens saves source URLs/titles only for items you choose to save.</p>
      </Section>

      <Section title="Limited use">
        <p>The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements. ContextLens uses user data only to provide or improve its explanation, screenshot, history, sync, and flashcard features.</p>
      </Section>

      <Section title="Data retention and deletion">
        <p>You can delete individual saved items from within the extension dashboard. Deleting a synced item removes it from local storage and requests deletion from our backend. You can also delete your account from the dashboard or contact us to delete associated data.</p>
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
