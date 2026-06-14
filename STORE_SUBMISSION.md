# Chrome Web Store — submission checklist (ContextLens)

Goal for now: publish as **Unlisted** for the private beta (installable only via direct link,
still reviewed). One-time **$5** developer registration. Flip to **Public** later (per the plan).

## 0. Before you submit
- [ ] Pay the one-time **$5** dev fee at the [Web Store dev console](https://chrome.google.com/webstore/devconsole).
- [ ] `npm run build` → zip the **`dist/`** folder (manifest.json must be at the zip root).
- [ ] Have your **privacy policy URL** ready (you already serve one from the backend).

## 1. Listing assets
- [ ] **Name:** ContextLens
- [ ] **Summary (≤132 chars):** e.g. "Highlight or screenshot any text — Arabic, Quran, anything — and get an instant explanation + flashcards."
- [ ] **Description:** what it does + the Arabic/Quran strengths; how to use it (highlight → Ask / Deep Dive; screenshot → explain; saved flashcards with spaced repetition).
- [ ] **Category:** Education (or Productivity).
- [ ] **Icon:** 128×128 PNG.
- [ ] **Screenshots:** 1–5 at **1280×800** (or 640×400) — show highlight→explanation, a Deep Dive, the flashcard dashboard, and an Arabic example.
- [ ] **Small promo tile:** 440×280 PNG (optional, recommended).
- [ ] **(Optional) demo video:** 30–60s YouTube link.

## 2. Privacy & data-use (what reviewers scrutinize)
- [ ] **Single-purpose statement:** "Understand text/images you highlight or screenshot, and review them as flashcards."
- [ ] **Permission justifications:**
  - `host_permissions: <all_urls>` + content script on all pages → "users can highlight or screenshot text on any page to get an explanation."
  - `tabs` → "capture the visible tab for screenshot-to-explain."
  - `scripting`, `storage`, `unlimitedStorage`, `contextMenus` → inject the UI, save captures/settings locally, right-click actions.
- [ ] **Data-use disclosures (Privacy practices tab):**
  - Collects **Website content** (selected text / screenshots) — *transmitted* to your server + AI providers to generate explanations.
  - Collects **Authentication information** (email + token) — account/sync.
  - Certify: **not sold**, **not used for unrelated purposes**, **not used for creditworthiness/lending**.
- [ ] **Privacy policy must explicitly state**: selected text and screenshots are sent to your backend **and to AI providers (Google Gemini + Anthropic Claude)** to produce explanations.

## 3. Visibility
- [ ] Set visibility to **Unlisted** for the beta.

## 4. Submit → wait
Review usually takes a few days; broad `<all_urls>` + content handling can lengthen it.

---

## 5. (After publishing) Google sign-in setup
Publishing gives you a **permanent extension ID** — which Google sign-in's redirect URI needs.
The backend `POST /auth/google` is already deployed (off until configured).
1. Note your **extension ID** from the dashboard. The redirect URL is `https://<ID>.chromiumapp.org/`.
2. Google Cloud Console → **APIs & Services**:
   - **OAuth consent screen** → External → app name + your support email; scopes `openid email profile`; add yourself as a test user.
   - **Credentials → Create credentials → OAuth client ID → Web application** → add redirect URI `https://<ID>.chromiumapp.org/`.
3. **Send me the Client ID.** I'll then set `GOOGLE_OAUTH_CLIENT_ID` on Railway, add the `identity` permission to the manifest, and wire the "Sign in with Google" button (`chrome.identity.launchWebAuthFlow` → id_token → `POST /auth/google`).
