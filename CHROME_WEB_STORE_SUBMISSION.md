# Chrome Web Store Submission Notes

## Single Purpose

ContextLens helps users understand and review text or screenshot regions they choose on webpages. Users can highlight text or crop a screenshot, ask for an AI explanation, save the result, review history, and study saved items as flashcards.

## Permission Justifications

- `storage`: Stores saved highlights, screenshot previews, AI explanations, follow-up chats, flashcard sets, review state, and user preferences locally.
- `unlimitedStorage`: Supports larger saved histories and user-selected screenshot captures without Chrome's small local storage quota becoming a functional limit.
- `contextMenus`: Adds an "Ask ContextLens" right-click action for selected text.
- `tabs`: Finds the active tab, opens extension pages, refreshes/injects the content script when needed, and captures the visible tab only when the user starts the screenshot flow.
- `scripting`: Injects or refreshes the ContextLens content script in active pages so the selection bubble, screenshot crop overlay, and page UI work reliably after install/update.
- `host_permissions: <all_urls>`: Required because ContextLens is designed to work on user-selected text and screenshots across normal webpages, not one fixed domain. The extension does not send page content automatically; it sends selected text, chosen screenshot regions, source URL/title, and notes only after a user action.
- `host_permissions: https://web-production-223b1.up.railway.app/*`: Allows the extension to communicate with the ContextLens backend for explanations, accounts, sync, flashcards, and deletion.

## Remote Code Declaration

ContextLens does not load or execute remotely hosted JavaScript and does not use `eval()` or `new Function()`. The extension communicates with remote servers for data and server-side operations: AI explanations, OCR/image processing, account authentication, sync, and optional Quran.com verse-text resolution. Extension behavior and UI logic are contained in the submitted extension package.

## Data Disclosure Checklist

Disclose these data categories in the Chrome Web Store privacy fields:

- Personally identifiable information: email address.
- Authentication information: password during sign-in/signup/reset requests and authentication token stored locally for signed-in sessions.
- User activity / website content: selected text, selected screenshot regions, source URL/title for saved items, notes, follow-up questions, and generated answers.
- Web browsing activity: source URL/title only for webpages where the user chooses to save or explain selected text/screenshot content.
- User-provided content: flashcard set names, review ratings, and study metadata.

Disclose that data is shared with:

- ContextLens backend hosted on Railway.
- Google Gemini and Google Cloud Vision for AI explanation/OCR features.
- Google Fonts for Arabic interface typography.
- Anthropic Claude for Deep Dive explanations.
- QuranCDN only when resolving selected Quran.com verse text.

Do not mark analytics, advertising, or sale of data; the extension does not use them.

## Store Listing Notes

The listing should clearly say that ContextLens adds an on-page selection bubble and optional screenshot button, sends only user-selected text or chosen screenshot regions for explanation, and stores saved items locally and in the user's account when signed in.

## Backend Readiness

The extension now sends auth tokens for `GET /captures`, `GET /flashcard-sets`, and protected screenshot image fetches with an `Authorization: Bearer <token>` header instead of a URL query parameter. The local `highlighter-backend` repo has matching support and no longer returns screenshot URLs with `?token=...`; deploy that backend before publishing this extension build.
