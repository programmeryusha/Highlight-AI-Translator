export interface Capture {
  id: string;
  text: string;
  context: string; // user-provided context/note
  url: string;
  title: string;
  savedAt: string; // ISO timestamp
  explanation: string | null;
  status: "pending" | "done" | "error";
  imageData?: string; // base64 data URL for screenshot captures
}

export interface StorageSchema {
  captures: Capture[];
  anthropic_api_key?: string;
}

export type Message =
  | { type: "SAVE_HIGHLIGHT"; text: string; url: string; title: string; context: string }
  | { type: "SHOW_CONTEXT_INPUT"; text: string }
  | { type: "TAKE_SCREENSHOT" }
  | { type: "SHOW_CROP_OVERLAY"; imageData: string }
  | { type: "SAVE_SCREENSHOT"; imageData: string; context: string }
  | { type: "OPEN_DASHBOARD" };
