export interface Capture {
  id: string;
  text: string;
  context: string; // user-provided context/note
  url: string;
  title: string;
  savedAt: string; // ISO timestamp
  explanation: string | null;
  status: "pending" | "done" | "error";
  errorMessage?: string;
  imageData?: string; // base64 data URL for screenshot captures
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StorageSchema {
  captures: Capture[];
  flashcard_threshold?: number;
  flashcard_starred_capture_ids?: string[];
  contextlens_user?: ContextLensUser;
}

export interface ContextLensUser {
  username: string;
  token: string;
}

export type Message =
  | { type: "SAVE_HIGHLIGHT"; text: string; url: string; title: string; context: string }
  | { type: "SHOW_CONTEXT_INPUT"; text: string }
  | { type: "TAKE_SCREENSHOT" }
  | { type: "SHOW_CROP_OVERLAY"; imageData: string }
  | { type: "SAVE_SCREENSHOT"; imageData: string; context: string }
  | { type: "EXPLAIN_SCREENSHOT"; imageData: string; context: string }
  | { type: "ASK_FOLLOWUP"; captureId: string; question: string }
  | { type: "CREATE_ACCOUNT"; username: string }
  | { type: "SYNC_REMOTE_CAPTURES" }
  | { type: "DELETE_REMOTE_CAPTURES"; ids: string[] }
  | { type: "OPEN_DASHBOARD" };
