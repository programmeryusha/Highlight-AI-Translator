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
  fsrsStability?: number;
  fsrsDifficulty?: number;
  fsrsLapses?: number;
  fsrsState?: "new" | "learning" | "reviewing" | "relearning";
  fsrsDueAt?: string;
  fsrsLastReviewedAt?: string | null;
  fsrsReviewCount?: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface FlashcardSet {
  id: string;
  name: string;
  captureIds: string[];
  parentSetId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StorageSchema {
  captures: Capture[];
  card_font_size?: "default" | "large" | "extra_large";
  flashcard_sets?: FlashcardSet[];
  deep_dive_capture_ids?: string[];
  contextlens_user?: ContextLensUser;
}

export interface ContextLensUser {
  email: string;
  token: string;
}

export type Message =
  | { type: "SAVE_HIGHLIGHT"; text: string; url: string; title: string; context: string; replaceCaptureId?: string }
  | { type: "SHOW_CONTEXT_INPUT"; text: string }
  | { type: "TAKE_SCREENSHOT"; scrollX?: number; scrollY?: number }
  | { type: "SHOW_CROP_OVERLAY"; imageData: string; scrollX?: number; scrollY?: number }
  | { type: "SAVE_SCREENSHOT"; imageData: string; context: string }
  | { type: "EXPLAIN_SCREENSHOT"; imageData: string; context: string; replaceCaptureId?: string }
  | { type: "RETRY_CAPTURE"; captureId: string }
  | { type: "ASK_FOLLOWUP"; captureId: string; question: string; deepDive?: boolean; fallbackText?: string; fallbackContext?: string; fallbackImageData?: string; fallbackUrl?: string; fallbackTitle?: string }
  | { type: "SIGN_UP"; email: string; password: string }
  | { type: "SIGN_IN"; email: string; password: string }
  | { type: "SIGN_IN_OR_SIGN_UP"; email: string; password: string }
  | { type: "SIGN_OUT" }
  | { type: "DELETE_ACCOUNT" }
  | { type: "DEEP_DIVE"; captureId: string; fallbackText?: string; fallbackContext?: string; fallbackImageData?: string; fallbackUrl?: string; fallbackTitle?: string }
  | { type: "SYNC_REMOTE_CAPTURES" }
  | { type: "DELETE_REMOTE_CAPTURES"; ids: string[] }
  | { type: "REVIEW_FLASHCARDS"; ids: string[]; rating: "again" | "hard" | "good" | "easy" }
  | { type: "OPEN_DASHBOARD" }
  | { type: "ANALOGY"; text: string }
  | { type: "FORGOT_PASSWORD"; email: string }
  | { type: "RESET_PASSWORD"; email: string; code: string; newPassword: string };
