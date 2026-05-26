import React, { useEffect, useState } from "react";
import type { Capture, ContextLensUser, FlashcardSet, Message } from "../types";

type View = "saves" | "history" | "words" | "settings";
type ThemeName = "light" | "dark";
type AppMode = "language_learning" | "student";
type SaveTriggers = { bubble: boolean; contextMenu: boolean };
type ScreenshotTriggers = { floatingButton: boolean; shortcut: boolean; immediate: boolean };
type FlashcardRange = "pastDay" | "past3" | "pastWeek" | "pastMonth";
type CardFontSize = "small" | "default" | "large" | "extra_large";
type CardTypography = (typeof CARD_TYPOGRAPHY)[CardFontSize];
type FsrsRating = "again" | "hard" | "good" | "easy";
type FsrsState = "new" | "learning" | "reviewing" | "relearning";
const LONG_TEXT_LIMIT = 260;
const DEFAULT_ACCENT_COLOR = "#38bdf8";
const DEFAULT_CARD_FONT_SIZE: CardFontSize = "default";
const THEME_STORAGE_KEY = "contextlens_theme";
const FLASHCARD_RANGES: { value: FlashcardRange; label: string; days: number }[] = [
  { value: "pastDay", label: "Past day", days: 1 },
  { value: "past3", label: "Past 3 days", days: 3 },
  { value: "pastWeek", label: "Past week", days: 7 },
  { value: "pastMonth", label: "Past month", days: 30 },
];
const CARD_FONT_OPTIONS: { value: CardFontSize; label: string; note: string }[] = [
  { value: "small", label: "Small", note: "Tighter dashboard cards." },
  { value: "default", label: "Default", note: "Comfortable reading size." },
  { value: "large", label: "Large", note: "Bigger save text and answers." },
  { value: "extra_large", label: "Extra large", note: "Maximum readability." },
];
const CARD_TYPOGRAPHY: Record<CardFontSize, { source: number; context: number; answer: number; status: number; link: number }> = {
  small: { source: 18, context: 16, answer: 17, status: 14, link: 13 },
  default: { source: 21, context: 18, answer: 19, status: 16, link: 14 },
  large: { source: 24, context: 21, answer: 21, status: 18, link: 15 },
  extra_large: { source: 28, context: 24, answer: 24, status: 20, link: 16 },
};
const CALENDAR_COLUMN_WIDTH = 332;
const DASHBOARD_INNER_MAX_WIDTH = 1220;
const CALENDAR_TRANSITION = "240ms cubic-bezier(0.2, 0, 0, 1)";
const ARABIC_FONT_STACK = "'Noto Naskh Arabic', ui-serif, Georgia, serif";
const FLASHCARD_PROMPT_LIMIT = 260;
const FLASHCARD_EXPLANATION_LIMIT = 520;
const SAVED_CARD_EXPLANATION_LIMIT = 760;

function viewFromHash(): View {
  const hash = window.location.hash.replace(/^#/, "").toLowerCase();
  if (hash === "history" || hash === "words" || hash === "settings") return hash;
  return "saves";
}

type DashboardColors = {
  bg: string;
  text: string;
  muted: string;
  softText: string;
  border: string;
  subtle: string;
  surface: string;
  surfaceAlt: string;
  selectedText: string;
  accent: string;
  accentSoft: string;
  danger: string;
  dangerFill: string;
  dangerSoft: string;
  dangerBorder: string;
};

function isThemeName(value: unknown): value is ThemeName {
  return value === "light" || value === "dark";
}

function storedThemeFallback(fallback: ThemeName): ThemeName {
  try {
    const theme = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeName(theme) ? theme : fallback;
  } catch {
    return fallback;
  }
}

function rememberTheme(theme: ThemeName) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The chrome storage value remains authoritative.
  }
}

function isCardFontSize(value: unknown): value is CardFontSize {
  return value === "small" || value === "default" || value === "large" || value === "extra_large";
}

function normalizeHexColor(value: unknown, fallback = DEFAULT_ACCENT_COLOR): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`;
  return fallback;
}

function textOnColor(hex: string): string {
  const color = normalizeHexColor(hex);
  const red = parseInt(color.slice(1, 3), 16) / 255;
  const green = parseInt(color.slice(3, 5), 16) / 255;
  const blue = parseInt(color.slice(5, 7), 16) / 255;
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.62 ? "#1f2933" : "#fff";
}

function rgbTriplet(hex: string): string {
  const color = normalizeHexColor(hex);
  return `${parseInt(color.slice(1, 3), 16)}, ${parseInt(color.slice(3, 5), 16)}, ${parseInt(color.slice(5, 7), 16)}`;
}

function colorWithAlpha(hex: string, alpha: number): string {
  return `rgba(${rgbTriplet(hex)}, ${alpha})`;
}

function hasRtlText(text: string): boolean {
  return /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(text);
}

function firstStrongTextDirection(value: string): "ltr" | "rtl" {
  for (const character of value.trim()) {
    if (/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u.test(character)) return "rtl";
    if (/[A-Za-z\u00C0-\u024F]/u.test(character)) return "ltr";
  }
  return "ltr";
}

function subtleButtonStyle(colors: DashboardColors, fontSize = 13): React.CSSProperties {
  return {
    background: colors.surfaceAlt,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: 7,
    padding: "6px 10px",
    fontSize,
    fontWeight: 750,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "fit-content",
  };
}

function questionLabelStyle(colors: DashboardColors): React.CSSProperties {
  return {
    fontSize: 14,
    color: colors.muted,
    fontWeight: 800,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    margin: "0 0 6px",
  };
}

function questionFontSize(typography: CardTypography): number {
  return typography.answer;
}

function savedCardStyle(colors: DashboardColors, selected = false): React.CSSProperties {
  return {
    background: selected ? colors.accentSoft : colors.surface,
    border: `1px solid ${selected ? colorWithAlpha(colors.accent, 0.45) : colors.border}`,
    borderRadius: 10,
    padding: "22px 24px",
    maxWidth: "100%",
    boxShadow: "0 2px 12px rgba(15,15,15,0.07)",
  };
}

function cardSeeAllButtonStyle(colors: DashboardColors): React.CSSProperties {
  return {
    background: "none",
    border: "none",
    borderBottom: `1px solid ${colorWithAlpha(colors.accent, 0.45)}`,
    color: colors.accent,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 800,
    margin: "10px 0 0",
    padding: "0 0 2px",
    width: "fit-content",
  };
}

function toolbarSummaryStyle(colors: DashboardColors): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    width: "fit-content",
    color: colors.muted,
    padding: "0 2px",
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1,
  };
}

function calendarGridStyle(visible: boolean): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: `minmax(0, 1fr) ${visible ? CALENDAR_COLUMN_WIDTH : 0}px`,
    gap: visible ? 28 : 0,
    alignItems: "start",
    maxWidth: DASHBOARD_INNER_MAX_WIDTH,
    margin: "0 auto",
    transition: `grid-template-columns ${CALENDAR_TRANSITION}, gap ${CALENDAR_TRANSITION}`,
  };
}

function calendarRailStyle(visible: boolean): React.CSSProperties {
  return {
    width: visible ? CALENDAR_COLUMN_WIDTH : 0,
    maxWidth: visible ? CALENDAR_COLUMN_WIDTH : 0,
    opacity: visible ? 1 : 0,
    transform: visible ? "translateY(0)" : "translateY(-10px)",
    overflow: "hidden",
    pointerEvents: visible ? "auto" : "none",
    transition: `width ${CALENDAR_TRANSITION}, max-width ${CALENDAR_TRANSITION}, opacity ${CALENDAR_TRANSITION}, transform ${CALENDAR_TRANSITION}`,
  };
}

function relativeLuminance(hex: string): number {
  const c = normalizeHexColor(hex);
  const lin = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(parseInt(c.slice(1, 3), 16) / 255)
       + 0.7152 * lin(parseInt(c.slice(3, 5), 16) / 255)
       + 0.0722 * lin(parseInt(c.slice(5, 7), 16) / 255);
}

function tooDarkForDarkMode(hex: string): boolean {
  return relativeLuminance(hex) < 0.05;
}

function colorsForTheme(theme: ThemeName, accentColor: string): DashboardColors {
  const dark = theme === "dark";
  return {
    bg: dark ? "#141413" : "#fff",
    text: dark ? "#f5f2ec" : "#37352f",
    muted: dark ? "#a9a39a" : "#9b9a97",
    softText: dark ? "#d4cec5" : "#6b6b6b",
    border: dark ? "#393631" : "#e3e2de",
    subtle: dark ? "#22211f" : "#f0efec",
    surface: dark ? "#1b1a18" : "#fff",
    surfaceAlt: dark ? "#26231f" : "#f7f6f3",
    selectedText: textOnColor(accentColor),
    accent: accentColor,
    accentSoft: colorWithAlpha(accentColor, dark ? 0.24 : 0.12),
    danger: dark ? "#fca5a5" : "#b91c1c",
    dangerFill: dark ? "#dc2626" : "#b91c1c",
    dangerSoft: dark ? "rgba(127,29,29,0.22)" : "#fff7f7",
    dangerBorder: dark ? "rgba(252,165,165,0.34)" : "#fca5a5",
  };
}

function normalizeQuestion(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, " ");
}

function cleanExportCell(value: string): string {
  return value
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function previewText(value: string, limit: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= limit) return trimmed;
  const shortened = trimmed.slice(0, limit).replace(/\s+\S*$/, "").trim();
  return `${shortened || trimmed.slice(0, limit).trim()}…`;
}

function downloadTextFile(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function filenameSlug(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "contextlens";
}

let lastImageRefreshAt = 0;
const IMAGE_REFRESH_COOLDOWN_MS = 30_000;

function refreshRemoteImageUrls() {
  const now = Date.now();
  if (now - lastImageRefreshAt < IMAGE_REFRESH_COOLDOWN_MS) return;
  lastImageRefreshAt = now;
  void sendRuntimeMessage<{ synced: number }>({ type: "SYNC_REMOTE_CAPTURES" }).catch(() => {});
}

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

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];

  function inlineBold(line: string): React.ReactNode[] {
    return line.split(/\*\*(.*?)\*\*/g).map((part, index) => (
      index % 2 === 1 ? <strong key={index} style={{ fontWeight: 800 }}>{part}</strong> : part
    ));
  }

  function flushList() {
    if (listItems.length) {
      nodes.push(<ul key={nodes.length} style={{ margin: "6px 0 6px 20px", padding: 0 }}>{listItems}</ul>);
      listItems = [];
    }
  }

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      listItems.push(<li key={index} style={{ marginBottom: 4 }}>{inlineBold(trimmed.slice(2))}</li>);
      return;
    }

    flushList();
    nodes.push(<p key={index} style={{ margin: "0 0 10px", lineHeight: 1.75 }}>{inlineBold(trimmed)}</p>);
  });
  flushList();

  return <>{nodes}</>;
}

const EXPL_TERM_RE = /^\*\*(.+?)\*\*\s*[—–-]\s*(.+)$/;
const EXPL_LABEL_RE = /^(Line \d+|Arabic\/source|Meaning|Direct|Plain meaning):(.*)/;
const EXPL_SILENT = new Set(["Arabic/source", "Meaning"]);
const EXPL_RENAME: Record<string, string> = { "Direct": "Direct meaning" };
const ARABIC_RANGE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const ARABIC_RUN_GLUE = "\\u0660-\\u0669\\u06F0-\\u06F90-9\\s\\u200c\\u200d.,;:!?،؛؟'\"()[\\]{}\\-–—/\\\\";
const ARABIC_RUN = new RegExp(
  `([؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿](?:[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿${ARABIC_RUN_GLUE}]*[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿\\u0660-\\u0669\\u06F0-\\u06F90-9])?[.,;:!?،؛؟]*)`,
  "gu",
);

function bidiSpan(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let last = 0;
  const re = new RegExp(ARABIC_RUN.source, "gu");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <bdi key={m.index} dir="rtl" lang="ar" style={{ fontFamily: ARABIC_FONT_STACK, fontSize: "1.08em", lineHeight: 1.85, unicodeBidi: "isolate" }}>
        {m[0]}
      </bdi>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function inlineParts(text: string): React.ReactNode {
  return text.split(/\*\*(.*?)\*\*/g).map((part, i) =>
    i % 2 === 1
      ? <strong key={i} style={{ fontWeight: 800, fontFamily: ARABIC_RANGE.test(part) ? ARABIC_FONT_STACK : "inherit" }}>{bidiSpan(part)}</strong>
      : bidiSpan(part)
  );
}

function QuestionText({
  text,
  color,
  fontSize,
  onClick,
  margin = 0,
  lineHeight = 1.55,
  fontWeight = 650,
}: {
  text: string;
  color: string;
  fontSize: number;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  margin?: React.CSSProperties["margin"];
  lineHeight?: React.CSSProperties["lineHeight"];
  fontWeight?: React.CSSProperties["fontWeight"];
}) {
  const [hovered, setHovered] = useState(false);
  const direction = firstStrongTextDirection(text);
  const isRtl = direction === "rtl";
  const effectiveFontSize = isRtl ? Math.round(fontSize * 1.12) : fontSize;
  const effectiveFontFamily = isRtl ? ARABIC_FONT_STACK : "inherit";
  const baseStyle: React.CSSProperties = {
    fontSize: effectiveFontSize,
    fontFamily: effectiveFontFamily,
    color,
    lineHeight,
    margin,
    fontWeight,
    direction,
    textAlign: "left",
    overflowWrap: "break-word",
  };
  if (onClick) {
    return (
      <button
        type="button"
        dir={direction}
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          ...baseStyle,
          display: "block",
          width: "100%",
          maxWidth: "100%",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          appearance: "none",
          fontSize: effectiveFontSize,
          fontFamily: effectiveFontFamily,
          fontWeight,
          textDecoration: hovered ? "underline" : "none",
          textDecorationColor: colorWithAlpha(color, 0.45),
          textDecorationThickness: 1,
          textUnderlineOffset: 5,
        }}
      >
        {inlineParts(text)}
      </button>
    );
  }

  return (
    <p
      dir={direction}
      style={{ ...baseStyle, width: "100%", maxWidth: "100%" }}
    >
      {inlineParts(text)}
    </p>
  );
}

function renderExplanation(text: string, colors: DashboardColors): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;

    const termMatch = line.match(EXPL_TERM_RE);
    if (termMatch) {
      nodes.push(
        <div key={i} style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0 6px", margin: "6px 0" }}>
          <strong style={{ fontFamily: ARABIC_FONT_STACK, fontWeight: 700, fontSize: "1.08em" }}>{bidiSpan(termMatch[1])}</strong>
          <span style={{ color: colors.muted }}>—</span>
          <span>{termMatch[2]}</span>
        </div>
      );
      return;
    }

    const lm = line.match(EXPL_LABEL_RE);
    if (lm) {
      const [, label, rest] = lm;
      const body = rest.trim();
      if (EXPL_SILENT.has(label)) {
        if (body) {
          const isAr = ARABIC_RANGE.test(body);
          nodes.push(
            <p key={i} style={{ margin: "3px 0 6px", lineHeight: 1.85, direction: isAr ? "rtl" : "ltr", textAlign: isAr ? "right" : "left", fontFamily: isAr ? ARABIC_FONT_STACK : "inherit", fontSize: isAr ? "1.08em" : "inherit" }}>
              {bidiSpan(body)}
            </p>
          );
        }
        return;
      }
      const display = EXPL_RENAME[label] ?? label;
      nodes.push(
        <p key={i} style={{ margin: "8px 0 2px", lineHeight: 1.75 }}>
          <span style={{ fontWeight: 700, color: colors.muted, fontSize: "0.82em", letterSpacing: "0.05em", textTransform: "uppercase" }}>{display}:</span>
          {body && <> {inlineParts(body)}</>}
        </p>
      );
      return;
    }

    nodes.push(<p key={i} style={{ margin: "0 0 8px", lineHeight: 1.78 }}>{inlineParts(line)}</p>);
  });
  return <>{nodes}</>;
}

type ParsedError = {
  summary: string;
  userMessage: string;
  nextStep: string;
  diagnostic: string;
  detail: string;
};

function jsonFromErrorMessage(message: string): Record<string, unknown> | null {
  const jsonStart = message.indexOf("{");
  if (jsonStart === -1) return null;
  try {
    const parsed = JSON.parse(message.slice(jsonStart));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseSaveError(message?: string): ParsedError {
  const raw = (message?.trim() || "Unknown error").replace(/^something went wrong\s*[—-]\s*/i, "");
  const parsed = jsonFromErrorMessage(raw);
  const code = parsed?.code ?? parsed?.status ?? raw.match(/\b(?:HTTP|error:)\s*(\d{3})\b/i)?.[1];
  const requestId = parsed?.request_id ?? parsed?.requestId ?? raw.match(/request[_\s-]*id["']?\s*[:=]\s*["']?([A-Za-z0-9_-]+)/i)?.[1];
  const backendMessage = parsed?.message ?? parsed?.detail ?? raw.replace(/^Backend error:\s*/i, "").trim();
  const statusCode = String(code ?? "");

  let summary = "Could not generate an explanation.";
  let userMessage = "Your save is still here, but the AI answer failed.";
  let nextStep = "Try again. If it keeps failing, copy the details and check the backend logs.";
  if (statusCode === "502" || /failed to respond|timeout|timed out/i.test(String(backendMessage))) {
    summary = "Backend did not respond in time.";
    userMessage = "Your save is safe. The server took too long to answer.";
    nextStep = "Try again in a moment. If it repeats, use the request id to find the failing backend log.";
  } else if (statusCode === "401" || statusCode === "403") {
    summary = "Account authorization failed.";
    userMessage = "Your save is safe, but the backend rejected the account token.";
    nextStep = "Sign in again from Settings, then retry this save.";
  } else if (statusCode === "429") {
    summary = "Request limit reached.";
    userMessage = "Your save is safe, but this request hit a usage limit.";
    nextStep = "Wait a bit, then retry.";
  } else if (/network|failed to fetch|could not reach/i.test(raw)) {
    summary = "Could not reach the backend.";
    userMessage = "Your save is safe, but the extension could not contact the server.";
    nextStep = "Check the backend deployment or your network, then retry.";
  }

  const diagnostic = [
    statusCode ? `HTTP ${statusCode}` : "",
    requestId ? `request ${requestId}` : "",
  ].filter(Boolean).join(" • ");
  const detail = [
    diagnostic,
    String(backendMessage || raw).replace(/\s+/g, " "),
  ].filter(Boolean).join(" — ");

  return { summary, userMessage, nextStep, diagnostic, detail };
}

function SaveErrorNotice({
  message,
  colors,
  onRetry,
  retrying,
}: {
  message?: string;
  colors: DashboardColors;
  onRetry: () => void;
  retrying: boolean;
}) {
  const [open, setOpen] = useState(false);
  const parsed = parseSaveError(message);

  function copyDetails(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    void navigator.clipboard?.writeText(parsed.detail).catch(() => {});
  }

  return (
    <div role="status" style={{ margin: "12px 0 0", border: `1px solid ${colors.dangerBorder}`, borderRadius: 8, background: colors.dangerSoft, padding: "12px 13px", maxWidth: "74ch" }}>
      <p style={{ fontSize: 14, color: colors.danger, margin: 0, lineHeight: 1.45, fontWeight: 800 }}>
        {parsed.summary}
      </p>
      <p style={{ fontSize: 13, color: colors.text, margin: "5px 0 0", lineHeight: 1.55 }}>
        {parsed.userMessage}
      </p>
      <p style={{ fontSize: 12, color: colors.muted, margin: "4px 0 0", lineHeight: 1.5 }}>
        {parsed.nextStep}
      </p>
      {parsed.diagnostic && (
        <p style={{ fontSize: 12, color: colors.muted, margin: "4px 0 0", lineHeight: 1.45 }}>
          {parsed.diagnostic}
        </p>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <button
          type="button"
          disabled={retrying}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRetry();
          }}
          style={{ background: retrying ? colors.border : colors.accent, color: retrying ? colors.muted : colors.selectedText, border: "none", borderRadius: 7, padding: "5px 10px", fontSize: 12, fontWeight: 800, cursor: retrying ? "default" : "pointer" }}
        >
          {retrying ? "Retrying..." : "Try again"}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen((value) => !value);
          }}
          style={{ background: colors.surface, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 7, padding: "5px 9px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
        >
          {open ? "Hide details" : "Show details"}
        </button>
        <button
          type="button"
          onClick={copyDetails}
          style={{ background: colors.surface, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 7, padding: "5px 9px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
        >
          Copy details
        </button>
      </div>
      {open && (
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: colors.softText, fontSize: 12, lineHeight: 1.45, margin: "9px 0 0", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
          {parsed.detail}
        </pre>
      )}
    </div>
  );
}

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return width;
}

function useScrolledPast(threshold = 360, hysteresis = 120): boolean {
  const [past, setPast] = useState(() => window.scrollY > threshold);

  useEffect(() => {
    const hideAt = threshold + hysteresis / 2;
    const showAt = threshold - hysteresis / 2;
    const update = () => {
      const y = window.scrollY;
      setPast((current) => {
        if (!current && y > hideAt) return true;
        if (current && y < showAt) return false;
        return current;
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [threshold, hysteresis]);

  return past;
}

function dayKeyFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthKeyFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function currentMonthKey(): string {
  return monthKeyFromDate(new Date());
}

function addDaysToDate(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function capturesForFlashcardRange(captures: Capture[], range: FlashcardRange): Capture[] {
  const days = FLASHCARD_RANGES.find((candidate) => candidate.value === range)?.days ?? 1;
  const end = new Date();
  const start = addDaysToDate(end, -days);
  return captures.filter((capture) => {
    const savedAt = new Date(capture.savedAt);
    return savedAt >= start && savedAt <= end;
  });
}

function capturesForDays(captures: Capture[], keys: Set<string>): Capture[] {
  return captures.filter((capture) => keys.has(dayKey(capture.savedAt)));
}

function dayKey(iso: string): string {
  return dayKeyFromDate(new Date(iso));
}

function todayKey(): string {
  return dayKeyFromDate(new Date());
}

function dayLabelFromKey(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return dayLabel(new Date(year, month - 1, day).toISOString());
}

function hasRawBackendError(message?: string) {
  return Boolean(message && (message.includes("{\"status\"") || message.includes("request_id") || /^something went wrong\s*[—-]/i.test(message)));
}

function normalizeStoredErrorMessage(message?: string) {
  if (!message) return message;
  const parsed = parseSaveError(message);
  return parsed.detail || parsed.summary;
}

function dateFromDayKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(key: string, amount: number): string {
  const date = dateFromDayKey(key);
  date.setDate(date.getDate() + amount);
  return dayKeyFromDate(date);
}

function monthStartFromKey(key: string): Date {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

function addMonths(key: string, amount: number): string {
  const date = monthStartFromKey(key);
  date.setMonth(date.getMonth() + amount);
  return monthKeyFromDate(date);
}

function monthLabelFromKey(key: string): string {
  return monthStartFromKey(key).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function calendarDayKeys(monthKey: string): (string | null)[] {
  const start = monthStartFromKey(monthKey);
  const year = start.getFullYear();
  const month = start.getMonth();
  const blanks = start.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, index) => dayKeyFromDate(new Date(year, month, index + 1)));
  const cells: (string | null)[] = [...Array.from({ length: blanks }, () => null), ...days];

  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function groupByDay(captures: Capture[]): { label: string; items: Capture[] }[] {
  const map = new Map<string, Capture[]>();
  for (const c of captures) {
    const label = dayLabel(c.savedAt);
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(c);
  }
  return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
}

function captureCountsByDay(captures: Capture[]): Map<string, number> {
  const counts = new Map<string, number>();
  captures.forEach((capture) => {
    const key = dayKey(capture.savedAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return counts;
}

function computeStreak(captures: Capture[]): number {
  const counts = captureCountsByDay(captures);
  let cursor = new Date();
  let streak = 0;

  while (counts.has(dayKeyFromDate(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function pageTransitionColor() {
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  if (bodyBg && bodyBg !== "rgba(0, 0, 0, 0)") return bodyBg;
  const htmlBg = getComputedStyle(document.documentElement).backgroundColor;
  return htmlBg && htmlBg !== "rgba(0, 0, 0, 0)" ? htmlBg : "#fff";
}

function navigateWithSoftFade(url: string) {
  const existing = document.getElementById("contextlens-page-transition");
  existing?.remove();

  const cover = document.createElement("div");
  cover.id = "contextlens-page-transition";
  cover.setAttribute("aria-hidden", "true");
  cover.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    pointer-events: none;
    background: ${pageTransitionColor()};
    opacity: 0;
    transition: opacity 140ms cubic-bezier(0.2, 0, 0, 1);
  `;
  document.body.appendChild(cover);

  requestAnimationFrame(() => {
    cover.style.opacity = "1";
  });
  window.setTimeout(() => {
    window.location.assign(url);
  }, 150);
}

function openChat(id: string) {
  navigateWithSoftFade(chrome.runtime.getURL("src/chat/chat.html") + `?id=${id}`);
}

function openCaptureFromClick(event: React.MouseEvent, id: string) {
  if (window.getSelection()?.toString().trim()) return;
  event.stopPropagation();
  openChat(id);
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function SelectSaveButton({
  selected,
  onToggle,
  colors,
  itemLabel = "save",
}: {
  selected: boolean;
  onToggle: (event: React.MouseEvent<HTMLButtonElement>) => void;
  colors: DashboardColors;
  itemLabel?: string;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      aria-label={selected ? `Deselect ${itemLabel}` : `Select ${itemLabel}`}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle(event);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 18,
        height: 18,
        borderRadius: 4,
        border: selected ? `2px solid ${colors.accent}` : `2px solid ${hovered ? colors.accent : colors.border}`,
        background: selected ? colors.accent : hovered ? colors.accentSoft : colors.surfaceAlt,
        color: selected ? colors.selectedText : colors.accent,
        cursor: "pointer",
        fontSize: 11,
        lineHeight: "14px",
        fontWeight: 800,
        flexShrink: 0,
        padding: 0,
        transition: "background 120ms ease, border 120ms ease",
      }}
    >
      {selected ? "✓" : ""}
    </button>
  );
}

function SaveDeleteButton({ onDelete, colors }: { onDelete: () => void; colors: DashboardColors }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      aria-label="Delete save"
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 28,
        height: 28,
        borderRadius: 7,
        border: `1px solid ${hovered ? colors.dangerBorder : colors.border}`,
        background: hovered ? colors.dangerSoft : "transparent",
        color: hovered ? colors.danger : colors.muted,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        padding: 0,
        transition: "background 120ms ease, border 120ms ease, color 120ms ease",
      }}
    >
      <TrashIcon />
    </button>
  );
}

function ScreenshotPreview({
  imageData,
  colors,
  alt = "Saved screenshot",
  maxHeight = 280,
  margin = 0,
  onClick,
}: {
  imageData: string;
  colors: DashboardColors;
  alt?: string;
  maxHeight?: number;
  margin?: React.CSSProperties["margin"];
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const interactive = Boolean(onClick);

  useEffect(() => { setImageFailed(false); }, [imageData]);

  return (
    <figure
      style={{
        width: "min(620px, 100%)",
        margin,
        border: `1px solid ${hovered && interactive ? colors.accent : colors.border}`,
        borderRadius: 8,
        background: colors.surfaceAlt,
        padding: 8,
        boxSizing: "border-box",
        overflow: "hidden",
        cursor: interactive ? "pointer" : "default",
        transition: "border-color 0.15s",
      }}
      onClick={onClick}
      onMouseEnter={() => interactive && setHovered(true)}
      onMouseLeave={() => interactive && setHovered(false)}
    >
      {imageFailed ? (
        <div
          style={{
            minHeight: 124,
            display: "grid",
            placeItems: "center",
            color: colors.muted,
            fontSize: 13,
            fontWeight: 700,
            border: `1px dashed ${colors.border}`,
            background: colors.surface,
          }}
        >
          Screenshot preview unavailable
        </div>
      ) : (
        <img
          src={imageData}
          alt={alt}
          onError={() => {
            setImageFailed(true);
            if (imageData && !imageData.startsWith("data:")) refreshRemoteImageUrls();
          }}
          style={{
            display: "block",
            width: "100%",
            maxHeight,
            objectFit: "contain",
            borderRadius: 0,
            background: colors.surface,
          }}
        />
      )}
    </figure>
  );
}

function CapturePreview({ capture, colors, typography }: { capture: Capture; colors: DashboardColors; typography: typeof CARD_TYPOGRAPHY[CardFontSize] }) {
  const [hovered, setHovered] = useState(false);
  const rtl = hasRtlText(capture.text);
  const sourceStyle: React.CSSProperties = {
    background: "none",
    border: "none",
    color: colors.text,
    cursor: "pointer",
    display: "block",
    font: "inherit",
    fontFamily: rtl ? ARABIC_FONT_STACK : "inherit",
    fontSize: rtl ? Math.round(typography.source * 1.12) : typography.source,
    fontWeight: 600,
    lineHeight: 1.6,
    margin: 0,
    width: "100%",
    maxWidth: "100%",
    padding: "2px 0",
    direction: rtl ? "rtl" : "ltr",
    textAlign: rtl ? "right" : "left",
    textDecoration: hovered ? "underline" : "none",
    textDecorationColor: colors.accent,
    textUnderlineOffset: 4,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  };

  if (capture.imageData) {
    return (
      <ScreenshotPreview
        imageData={capture.imageData}
        colors={colors}
        margin="0 0 18px"
        onClick={(event) => openCaptureFromClick(event, capture.id)}
      />
    );
  }

  const isLong = capture.text.length > LONG_TEXT_LIMIT;
  const text = isLong ? `${capture.text.slice(0, LONG_TEXT_LIMIT).trim()}…` : capture.text;

  return (
    <>
      <button
        type="button"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={(event) => openCaptureFromClick(event, capture.id)}
        style={sourceStyle}
      >
        {text}
      </button>
    </>
  );
}

function SavesView({
  captures,
  onDeleteCaptures,
  onRetryCapture,
  headerAction,
  toolbarSummary,
  sidePanel,
  sidePanelVisible = false,
  colors,
  cardFontSize,
}: {
  captures: Capture[];
  onDeleteCaptures: (ids: string[]) => void;
  onRetryCapture: (id: string) => void;
  headerAction?: React.ReactNode;
  toolbarSummary?: React.ReactNode;
  sidePanel?: React.ReactNode;
  sidePanelVisible?: boolean;
  colors: DashboardColors;
  cardFontSize: CardFontSize;
}) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastRangeAnchorId, setLastRangeAnchorId] = useState<string | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [expandAll, setExpandAll] = useState(false);
  const [expandedCardIds, setExpandedCardIds] = useState<Set<string>>(new Set());
  const typography = CARD_TYPOGRAPHY[cardFontSize];

  useEffect(() => {
    const visibleIds = new Set(captures.map((capture) => capture.id));
    setSelectedIds((current) => new Set([...current].filter((id) => visibleIds.has(id))));
    setLastRangeAnchorId((current) => current && visibleIds.has(current) ? current : null);
    setExpandedCardIds((current) => new Set([...current].filter((id) => visibleIds.has(id))));
  }, [captures]);

  if (captures.length === 0) {
    return (
      <div style={{ paddingTop: 48, maxWidth: 620 }}>
        <p style={{ color: colors.text, fontSize: 20, fontWeight: 800, margin: "0 0 8px" }}>
          Nothing saved yet.
        </p>
        <p style={{ color: colors.muted, fontSize: 15, lineHeight: 1.65, margin: "0 0 18px" }}>
          Highlight text on any page, click Ask, and ContextLens will keep the source, your question, and the explanation together as a card.
        </p>
        <div style={{ border: `1px solid ${colors.border}`, borderLeft: `3px solid ${colors.accent}`, borderRadius: 8, background: colors.surface, padding: "15px 16px", maxWidth: 460 }}>
          <p style={{ color: colors.softText, fontSize: 15, lineHeight: 1.55, margin: "0 0 10px" }}>
            "A word or passage you highlighted…"
          </p>
          <p style={{ color: colors.text, fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            The answer appears here, ready to review or turn into flashcards.
          </p>
        </div>
      </div>
    );
  }

  const groups = groupByDay(captures);
  const selectedCount = selectedIds.size;

  function toggleSelectionMode() {
    const nextMode = !selectionMode;
    setSelectionMode(nextMode);
    if (!nextMode) {
      setSelectedIds(new Set());
      setLastRangeAnchorId(null);
    }
  }

  function toggleSelected(id: string, event: React.MouseEvent<HTMLButtonElement>) {
    const index = captures.findIndex((capture) => capture.id === id);
    const anchorIndex = lastRangeAnchorId ? captures.findIndex((capture) => capture.id === lastRangeAnchorId) : -1;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (event.shiftKey && index !== -1 && anchorIndex !== -1) {
        const [start, end] = [Math.min(index, anchorIndex), Math.max(index, anchorIndex)];
        const rangeIds = captures.slice(start, end + 1).map((capture) => capture.id);
        const shouldSelectRange = !next.has(id);
        rangeIds.forEach((rangeId) => {
          if (shouldSelectRange) next.add(rangeId);
          else next.delete(rangeId);
        });
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setLastRangeAnchorId(id);
  }

  function deleteSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    onDeleteCaptures(ids);
    setSelectedIds(new Set());
  }

  function retryCapture(id: string) {
    setRetryingIds((current) => new Set(current).add(id));
    onRetryCapture(id);
    window.setTimeout(() => {
      setRetryingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }, 1200);
  }

  function toggleCardExpanded(id: string) {
    setExpandedCardIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const cards = (
    <>
      {groups.map((group) => (
        <div key={group.label} style={{ marginBottom: 40 }}>
          {groups.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
                {group.label}
              </p>
            </div>
          )}
          <div style={{ display: "grid", gap: 14 }}>
            {group.items.map((c) => {
              const explanation = c.explanation ?? "";
              const explanationIsLong = explanation.trim().length > SAVED_CARD_EXPLANATION_LIMIT;
              const cardExpanded = expandAll || expandedCardIds.has(c.id) || !explanationIsLong;
              const explanationPreview = cardExpanded ? explanation : previewText(explanation, SAVED_CARD_EXPLANATION_LIMIT);

              return (
                <div
                  key={c.id}
                  style={savedCardStyle(colors, selectedIds.has(c.id))}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    {selectionMode && (
                      <div style={{ display: "flex", alignItems: "center", paddingTop: 5, flexShrink: 0 }}>
                        <SelectSaveButton selected={selectedIds.has(c.id)} onToggle={(event) => toggleSelected(c.id, event)} colors={colors} />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <CapturePreview capture={c} colors={colors} typography={typography} />

                      {c.context && (
                        <div style={{ margin: "14px 0 0", width: "100%" }}>
                          <p style={questionLabelStyle(colors)}>
                            Your question
                          </p>
                          <QuestionText
                            text={c.context}
                            color={colors.text}
                            fontSize={questionFontSize(typography)}
                            fontWeight={800}
                            onClick={(event) => openCaptureFromClick(event, c.id)}
                          />
                        </div>
                      )}

                      {c.status === "pending" && (
                        <p style={{ fontSize: typography.status, color: colors.muted, margin: "12px 0 0", fontStyle: "italic" }}>
                          thinking…
                        </p>
                      )}
                      {c.status === "error" && (
                        <SaveErrorNotice
                          message={c.errorMessage}
                          colors={colors}
                          onRetry={() => retryCapture(c.id)}
                          retrying={retryingIds.has(c.id)}
                        />
                      )}
                      {c.status === "done" && explanation && (
                        <>
                          <div
                            style={{
                              fontSize: typography.answer,
                              color: colors.text,
                              margin: "16px 0 0",
                              lineHeight: 1.78,
                              maxWidth: "100%",
                              overflowWrap: "break-word",
                            }}
                          >
                            {renderExplanation(explanationPreview, colors)}
                          </div>
                          {explanationIsLong && !expandAll && (
                            <button
                              type="button"
                              onClick={() => toggleCardExpanded(c.id)}
                              style={cardSeeAllButtonStyle(colors)}
                            >
                              {expandedCardIds.has(c.id) ? "Show less" : "See all"}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    {!selectionMode && (
                      <SaveDeleteButton
                        onDelete={() => onDeleteCaptures([c.id])}
                        colors={colors}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={toggleSelectionMode}
            style={{
              ...subtleButtonStyle(colors, 13),
              background: selectionMode ? colors.accent : colors.surfaceAlt,
              color: selectionMode ? colors.selectedText : colors.text,
              borderColor: selectionMode ? colors.accent : colors.border,
            }}
          >
            {selectionMode ? "Done" : "Select"}
          </button>
          {selectionMode && selectedCount > 0 && (
            <>
              <button
                type="button"
                onClick={deleteSelected}
                style={{ background: colors.dangerFill, color: "#fff", border: "none", borderRadius: 7, padding: "6px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                Delete {selectedCount}
              </button>
              <button
                type="button"
                onClick={toggleSelectionMode}
                style={{ background: "none", color: colors.muted, border: `1px solid ${colors.border}`, borderRadius: 7, padding: "6px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                Cancel
              </button>
            </>
          )}
          {!selectionMode && (
            <button
              type="button"
              onClick={() => setExpandAll((v) => !v)}
              style={{ ...subtleButtonStyle(colors, 13) }}
            >
              {expandAll ? "Collapse" : "Expand all"}
            </button>
          )}
          {toolbarSummary}
        </div>
        {headerAction}
      </div>
      {sidePanel ? (
        <div style={calendarGridStyle(sidePanelVisible)}>
          <div style={{ minWidth: 0 }}>
            {cards}
          </div>
          <div aria-hidden={!sidePanelVisible} style={calendarRailStyle(sidePanelVisible)}>
            <div style={{ width: CALENDAR_COLUMN_WIDTH, boxSizing: "border-box" }}>
              {sidePanel}
            </div>
          </div>
        </div>
      ) : cards}
    </div>
  );
}

function HistoryView({
  captures,
  onDeleteCaptures,
  onRetryCapture,
  colors,
  theme,
  accentColor,
  cardFontSize,
}: {
  captures: Capture[];
  onDeleteCaptures: (ids: string[]) => void;
  onRetryCapture: (id: string) => void;
  colors: DashboardColors;
  theme: ThemeName;
  accentColor: string;
  cardFontSize: CardFontSize;
}) {
  const windowWidth = useWindowWidth();
  const [selectedDay, setSelectedDay] = useState(todayKey());
  const [visibleMonth, setVisibleMonth] = useState(() => currentMonthKey());
  const selectedCaptures = captures.filter((capture) => dayKey(capture.savedAt) === selectedDay);
  const wideLayout = windowWidth >= 1040;
  const calendarVisible = !useScrolledPast(360);

  function selectDay(key: string) {
    setSelectedDay(key);
    setVisibleMonth(monthKeyFromDate(dateFromDayKey(key)));
  }

  function selectedDayLabel() {
    if (selectedDay === todayKey()) return "Today";
    return dateFromDayKey(selectedDay).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }

  function selectedDayShortLabel() {
    return dateFromDayKey(selectedDay).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }

  function emptyDayMessage() {
    if (selectedDay === todayKey()) return "Nothing saved today.";
    return `Nothing saved on ${selectedDayLabel()}.`;
  }

  const calendarPanel = (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        boxShadow: "0 2px 12px rgba(15,15,15,0.05)",
        display: "flex",
        justifyContent: "center",
        padding: "18px 16px",
      }}
    >
      <MonthCalendar
        captures={captures}
        selectedDay={selectedDay}
        visibleMonth={visibleMonth}
        onVisibleMonthChange={setVisibleMonth}
        onSelectDay={selectDay}
        colors={colors}
        theme={theme}
        accentColor={accentColor}
      />
    </div>
  );

  return (
    <div
      style={{
        maxWidth: DASHBOARD_INNER_MAX_WIDTH,
        margin: "0 auto",
        minHeight: 520,
      }}
    >
      {!wideLayout && (
        <div style={{ margin: "0 0 20px" }}>
          {calendarPanel}
        </div>
      )}

      {selectedCaptures.length > 0 ? (
        <SavesView
          captures={selectedCaptures}
          onDeleteCaptures={onDeleteCaptures}
          onRetryCapture={onRetryCapture}
          toolbarSummary={
            <span style={toolbarSummaryStyle(colors)}>
              {selectedDayShortLabel()}
              <span>·</span>
              {selectedCaptures.length} {selectedCaptures.length === 1 ? "card" : "cards"}
            </span>
          }
          sidePanel={wideLayout ? calendarPanel : undefined}
          sidePanelVisible={wideLayout && calendarVisible}
          colors={colors}
          cardFontSize={cardFontSize}
        />
      ) : wideLayout ? (
        <div style={calendarGridStyle(calendarVisible)}>
          <p style={{ color: colors.muted, fontSize: 15, paddingTop: 8 }}>
            {emptyDayMessage()}
          </p>
          <div aria-hidden={!calendarVisible} style={calendarRailStyle(calendarVisible)}>
            <div style={{ width: CALENDAR_COLUMN_WIDTH, boxSizing: "border-box" }}>
              {calendarPanel}
            </div>
          </div>
        </div>
      ) : (
        <p style={{ color: colors.muted, fontSize: 15, paddingTop: 8 }}>
          {emptyDayMessage()}
        </p>
      )}
    </div>
  );
}

interface WordEntry {
  id: string;
  word: string;
  count: number;
  explanation: string;
  exampleText: string;
  imageData?: string;
  latestSavedAt: string;
  captureIds: string[];
  fsrsStability: number;
  fsrsDifficulty: number;
  fsrsLapses: number;
  fsrsState: FsrsState;
  fsrsDueAt: string;
  fsrsReviewCount: number;
}

const FSRS_DECAY = -0.5;
const FSRS_FACTOR = Math.pow(0.9, 1 / FSRS_DECAY) - 1;
const FSRS_INITIAL_STABILITY: Record<FsrsRating, number> = { again: 0.02, hard: 0.5, good: 1, easy: 4 };
const FSRS_INITIAL_DIFFICULTY: Record<FsrsRating, number> = { again: 7.5, hard: 6.2, good: 5, easy: 3.8 };
const FSRS_DIFFICULTY_DELTA: Record<FsrsRating, number> = { again: 1.2, hard: 0.45, good: -0.05, easy: -0.65 };
const FSRS_STABILITY_FACTOR: Record<Exclude<FsrsRating, "again">, number> = { hard: 1.25, good: 2.15, easy: 3.5 };

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeFsrsState(value: unknown): FsrsState {
  return value === "learning" || value === "reviewing" || value === "relearning" ? value : "new";
}

function fsrsDueAt(capture: Capture): string {
  return capture.fsrsDueAt ?? capture.savedAt;
}

function captureIsDue(capture: Capture, now = Date.now()): boolean {
  if (capture.status !== "done") return false;
  return new Date(fsrsDueAt(capture)).getTime() <= now;
}

function fsrsRetrievability(elapsedDays: number, stability: number) {
  return Math.pow(1 + FSRS_FACTOR * Math.max(0, elapsedDays) / Math.max(0.01, stability), FSRS_DECAY);
}

function nextFsrsDifficulty(difficulty: number, rating: FsrsRating) {
  const shifted = difficulty + FSRS_DIFFICULTY_DELTA[rating];
  const reverted = 5 + (shifted - 5) * 0.96;
  return Math.round(clampNumber(reverted, 1, 10) * 100) / 100;
}

function nextFsrsStability(stability: number, difficulty: number, retrievability: number, rating: Exclude<FsrsRating, "again">) {
  const difficultyFactor = clampNumber(1.25 - (difficulty - 1) / 12, 0.35, 1.25);
  const retrievabilityFactor = 1 + Math.max(0, 1 - retrievability) * 1.8;
  const next = stability * FSRS_STABILITY_FACTOR[rating] * difficultyFactor * retrievabilityFactor;
  return Math.round(clampNumber(next, 0.02, 36500) * 100) / 100;
}

function applyFsrsReview(capture: Capture, rating: FsrsRating, now = new Date()): Capture {
  const reviewCount = capture.fsrsReviewCount ?? 0;
  const lapses = capture.fsrsLapses ?? 0;
  const state = normalizeFsrsState(capture.fsrsState);
  if (reviewCount <= 0 || state === "new") {
    const stability = FSRS_INITIAL_STABILITY[rating];
    const difficulty = FSRS_INITIAL_DIFFICULTY[rating];
    const dueAt = rating === "again"
      ? new Date(now.getTime() + 5 * 60_000)
      : rating === "hard"
        ? new Date(now.getTime() + 10 * 60_000)
        : new Date(now.getTime() + stability * 86400_000);
    return {
      ...capture,
      fsrsStability: stability,
      fsrsDifficulty: difficulty,
      fsrsLapses: lapses + (rating === "again" ? 1 : 0),
      fsrsState: rating === "again" || rating === "hard" ? "learning" : "reviewing",
      fsrsDueAt: dueAt.toISOString(),
      fsrsLastReviewedAt: now.toISOString(),
      fsrsReviewCount: reviewCount + 1,
    };
  }

  const stability = Math.max(0.02, capture.fsrsStability ?? 0.02);
  const lastReviewedAt = new Date(capture.fsrsLastReviewedAt ?? capture.savedAt);
  const elapsedDays = (now.getTime() - lastReviewedAt.getTime()) / 86400_000;
  const retrievability = fsrsRetrievability(elapsedDays, stability);
  const difficulty = nextFsrsDifficulty(capture.fsrsDifficulty ?? 5, rating);

  if (rating === "again") {
    const nextStability = Math.round(clampNumber(stability * (0.35 + (1 - retrievability) * 0.2), 0.02, stability) * 100) / 100;
    return {
      ...capture,
      fsrsStability: nextStability,
      fsrsDifficulty: difficulty,
      fsrsLapses: lapses + 1,
      fsrsState: "relearning",
      fsrsDueAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      fsrsLastReviewedAt: now.toISOString(),
      fsrsReviewCount: reviewCount + 1,
    };
  }

  const nextStability = nextFsrsStability(stability, difficulty, retrievability, rating);
  return {
    ...capture,
    fsrsStability: nextStability,
    fsrsDifficulty: difficulty,
    fsrsLapses: lapses,
    fsrsState: "reviewing",
    fsrsDueAt: new Date(now.getTime() + nextStability * 86400_000).toISOString(),
    fsrsLastReviewedAt: now.toISOString(),
    fsrsReviewCount: reviewCount + 1,
  };
}

function flashcardPrompt(capture: Capture) {
  const context = capture.context?.trim();
  if (context) return context;
  if (capture.imageData || capture.text.trim() === "[Screenshot]") return "";
  return capture.text.slice(0, 120).trim();
}

function buildFlashcardList(captures: Capture[]): WordEntry[] {
  const map = new Map<string, WordEntry>();
  for (const c of captures) {
    const word = flashcardPrompt(c);
    if (!word && !c.imageData) continue;
    const key = word ? normalizeQuestion(word) : c.id;
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        count: 0,
        word,
        explanation: c.explanation ?? "",
        exampleText: c.imageData ? "" : c.text,
        imageData: c.imageData,
        latestSavedAt: c.savedAt,
        captureIds: [],
        fsrsStability: c.fsrsStability ?? 0,
        fsrsDifficulty: c.fsrsDifficulty ?? 5,
        fsrsLapses: 0,
        fsrsState: normalizeFsrsState(c.fsrsState),
        fsrsDueAt: fsrsDueAt(c),
        fsrsReviewCount: 0,
      });
    }
    const entry = map.get(key)!;
    entry.count++;
    entry.captureIds.push(c.id);
    entry.fsrsLapses += c.fsrsLapses ?? 0;
    entry.fsrsReviewCount += c.fsrsReviewCount ?? 0;
    if (new Date(fsrsDueAt(c)).getTime() < new Date(entry.fsrsDueAt).getTime()) {
      entry.fsrsStability = c.fsrsStability ?? 0;
      entry.fsrsDifficulty = c.fsrsDifficulty ?? 5;
      entry.fsrsState = normalizeFsrsState(c.fsrsState);
      entry.fsrsDueAt = fsrsDueAt(c);
    }
    if (new Date(c.savedAt).getTime() > new Date(entry.latestSavedAt).getTime()) {
      entry.latestSavedAt = c.savedAt;
      entry.exampleText = c.imageData ? "" : c.text;
      entry.word = word || entry.word;
      entry.explanation = c.explanation ?? entry.explanation;
      entry.imageData = c.imageData ?? entry.imageData;
    }
    if (!entry.explanation && c.explanation) entry.explanation = c.explanation;
    if (!entry.imageData && c.imageData) entry.imageData = c.imageData;
  }
  return Array.from(map.values())
    .sort((a, b) => (
      new Date(b.latestSavedAt).getTime() - new Date(a.latestSavedAt).getTime()
      || b.count - a.count
      || a.word.localeCompare(b.word)
    ));
}

function FlashcardView({
  words,
  onClose,
  onReview,
  colors,
  cardFontSize,
}: {
  words: WordEntry[];
  onClose: () => void;
  onReview: (word: WordEntry, rating: FsrsRating) => void;
  colors: DashboardColors;
  cardFontSize: CardFontSize;
}) {
  const [deck, setDeck] = useState(words);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [ratings, setRatings] = useState<Record<string, FsrsRating>>({});
  const typography = CARD_TYPOGRAPHY[cardFontSize];

  useEffect(() => {
    setDeck(words);
    setIndex(0);
    setFlipped(false);
    setRatings({});
  }, [words]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === " ") {
        event.preventDefault();
        setFlipped((current) => !current);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        prev();
      } else if (event.key === "1" && flipped) {
        event.preventDefault();
        rate("again");
      } else if (event.key === "2" && flipped) {
        event.preventDefault();
        rate("hard");
      } else if (event.key === "3" && flipped) {
        event.preventDefault();
        rate("good");
      } else if (event.key === "4" && flipped) {
        event.preventDefault();
        rate("easy");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (deck.length === 0) return null;
  const card = deck[Math.min(index, deck.length - 1)];
  const reviewedCount = Object.keys(ratings).length;
  const againCount = Object.values(ratings).filter((rating) => rating === "again").length;
  const progress = Math.round(((index + (flipped ? 0.5 : 0)) / deck.length) * 100);

  function next() {
    setFlipped(false);
    setIndex((current) => (current + 1) % deck.length);
  }

  function prev() {
    setFlipped(false);
    setIndex((current) => (current - 1 + deck.length) % deck.length);
  }

  function rate(rating: FsrsRating) {
    const currentCard = deck[index];
    onReview(currentCard, rating);
    setRatings((current) => ({ ...current, [currentCard.id]: rating }));
    if (rating === "again" && deck.length > 1) {
      setDeck((currentDeck) => {
        const nextDeck = [...currentDeck];
        const [item] = nextDeck.splice(index, 1);
        const insertAt = Math.min(nextDeck.length, index + 2);
        nextDeck.splice(insertAt, 0, item);
        return nextDeck;
      });
      setFlipped(false);
      setIndex((current) => Math.min(current, deck.length - 1));
      return;
    }
    next();
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", paddingTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, gap: 16 }}>
        <button onClick={onClose} style={{ ...subtleButtonStyle(colors, 13), background: colors.surface }}>
          ← Back to flashcards
        </button>
        <span style={{ fontSize: 13, color: colors.muted, fontWeight: 750 }}>{index + 1} / {deck.length}</span>
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ height: 8, borderRadius: 999, background: colors.surfaceAlt, border: `1px solid ${colors.border}`, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.max(4, progress)}%`, background: colors.accent, transition: "width 160ms ease" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: colors.muted }}>Space flips · arrows navigate · 1 Again · 2 Hard · 3 Good · 4 Easy</span>
          <span style={{ fontSize: 12, color: colors.muted }}>{reviewedCount} reviewed · {againCount} again</span>
        </div>
      </div>

      <div
        onClick={() => setFlipped((f) => !f)}
        style={{
          minHeight: 320,
          background: flipped ? colors.surfaceAlt : colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          alignItems: flipped ? "stretch" : "center",
          justifyContent: flipped ? "flex-start" : "center",
          padding: "34px 40px",
          cursor: "pointer",
          transition: "background 0.2s",
          textAlign: flipped ? "left" : "center",
          marginBottom: 24,
          boxShadow: "0 10px 30px rgba(15,15,15,0.08)",
        }}
      >
        {!flipped ? (
          <>
            <p style={questionLabelStyle(colors)}>Your question</p>
            <QuestionText
              text={card.word || "Screenshot"}
              color={colors.text}
              fontSize={questionFontSize(typography)}
              fontWeight={800}
              lineHeight={1.45}
            />
            <p style={{ fontSize: 13, color: colors.muted, marginTop: 16 }}>Click or press Space to reveal</p>
          </>
        ) : (
          <>
            <p style={{ fontSize: 12, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 850, margin: "0 0 10px" }}>Answer</p>
            <div style={{ fontSize: typography.answer, color: colors.text, lineHeight: 1.78, margin: 0, maxWidth: "72ch" }}>
              {renderExplanation(card.explanation || "No explanation yet — save a highlight with this question to get one.", colors)}
            </div>
            {card.imageData ? (
              <ScreenshotPreview imageData={card.imageData} colors={colors} margin="16px 0 0" />
            ) : card.exampleText ? (
              <p style={{ fontSize: 13, color: colors.muted, marginTop: 16, lineHeight: 1.55, borderLeft: `3px solid ${colors.border}`, paddingLeft: 10 }}>
                "{card.exampleText.slice(0, 100)}{card.exampleText.length > 100 ? "…" : ""}"
              </p>
            ) : null}
            <p style={{ fontSize: 12, color: colors.muted, margin: "16px 0 0", lineHeight: 1.5 }}>
              {card.fsrsState} · S {card.fsrsStability.toFixed(2)}d · D {card.fsrsDifficulty.toFixed(1)} · Lapses {card.fsrsLapses}
            </p>
          </>
        )}
      </div>

      {flipped && (
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 14, flexWrap: "wrap" }}>
          <button type="button" onClick={() => rate("again")} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: "10px 18px", fontSize: 14, fontWeight: 850, cursor: "pointer", color: colors.text }}>
            Again
          </button>
          <button type="button" onClick={() => rate("hard")} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: "10px 18px", fontSize: 14, fontWeight: 850, cursor: "pointer", color: colors.text }}>
            Hard
          </button>
          <button type="button" onClick={() => rate("good")} style={{ background: colors.accent, border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 14, fontWeight: 850, cursor: "pointer", color: colors.selectedText }}>
            Good
          </button>
          <button type="button" onClick={() => rate("easy")} style={{ background: colors.accent, border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 14, fontWeight: 850, cursor: "pointer", color: colors.selectedText }}>
            Easy
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
        <button onClick={prev} style={{ background: colors.surfaceAlt, border: `1px solid ${colors.border}`, borderRadius: 8, padding: "10px 28px", fontSize: 14, cursor: "pointer", color: colors.text }}>
          ← Prev
        </button>
        <button onClick={next} style={{ background: colors.accent, border: "none", borderRadius: 8, padding: "10px 28px", fontSize: 14, cursor: "pointer", color: colors.selectedText }}>
          Next →
        </button>
      </div>
    </div>
  );
}

type FlashcardSource =
  | { kind: "range"; range: FlashcardRange }
  | { kind: "days" }
  | { kind: "due" }
  | { kind: "set"; setId: string };

function uniqueCaptureIds(captures: Capture[]) {
  return Array.from(new Set(captures.map((capture) => capture.id)));
}

function uniqueFlashcardCaptureIds(words: WordEntry[]) {
  return Array.from(new Set(words.flatMap((word) => word.captureIds)));
}

function normalizeFlashcardSets(value: unknown): FlashcardSet[] {
  if (!Array.isArray(value)) return [];
  const normalized = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const captureIds = Array.isArray(raw.captureIds) ? raw.captureIds.filter((id): id is string => typeof id === "string") : [];
    if (typeof raw.id !== "string" || typeof raw.name !== "string" || captureIds.length === 0) return [];
    const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString();
    const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : createdAt;
    const parentSetId = typeof raw.parentSetId === "string" && raw.parentSetId !== raw.id ? raw.parentSetId : undefined;
    return [{ id: raw.id, name: raw.name.trim() || "Flashcard set", captureIds, parentSetId, createdAt, updatedAt }];
  });
  const ids = new Set(normalized.map((set) => set.id));
  return normalized.map((set) => {
    if (!set.parentSetId || ids.has(set.parentSetId)) return set;
    const { parentSetId: _parentSetId, ...independentSet } = set;
    return independentSet;
  });
}

function flashcardSetRows(sets: FlashcardSet[]) {
  const ids = new Set(sets.map((set) => set.id));
  const children = new Map<string, FlashcardSet[]>();
  const rows: { set: FlashcardSet; depth: number }[] = [];
  const seen = new Set<string>();

  sets.forEach((set) => {
    const parentId = set.parentSetId && ids.has(set.parentSetId) ? set.parentSetId : "";
    children.set(parentId, [...(children.get(parentId) ?? []), set]);
  });

  function visit(set: FlashcardSet, depth: number) {
    if (seen.has(set.id)) return;
    seen.add(set.id);
    rows.push({ set, depth });
    (children.get(set.id) ?? []).forEach((child) => visit(child, depth + 1));
  }

  (children.get("") ?? []).forEach((set) => visit(set, 0));
  sets.forEach((set) => visit(set, 0));
  return rows;
}

function FlashcardPopup({
  title,
  onClose,
  colors,
  children,
  width = 520,
}: {
  title: string;
  onClose: () => void;
  colors: DashboardColors;
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <div
      role="presentation"
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 30,
        display: "grid",
        placeItems: "center",
        padding: 20,
        background: "rgba(16, 17, 20, 0.34)",
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          width: `min(${width}px, 100%)`,
          maxHeight: "min(680px, calc(100vh - 40px))",
          overflow: "auto",
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 18,
          boxShadow: "0 24px 68px rgba(15, 15, 15, 0.28)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <h3 style={{ color: colors.text, fontSize: 17, fontWeight: 850, margin: 0 }}>{title}</h3>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`} style={{ width: 30, height: 30, border: `1px solid ${colors.border}`, borderRadius: 7, background: colors.surfaceAlt, color: colors.text, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}>
            x
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function WordsView({
  captures,
  onReviewFlashcard,
  colors,
  theme,
  accentColor,
  cardFontSize,
}: {
  captures: Capture[];
  onReviewFlashcard: (word: WordEntry, rating: FsrsRating) => void;
  colors: DashboardColors;
  theme: ThemeName;
  accentColor: string;
  cardFontSize: CardFontSize;
}) {
  const [studyWords, setStudyWords] = useState<WordEntry[] | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [source, setSource] = useState<FlashcardSource>({ kind: "days" });
  const [selectedDays, setSelectedDays] = useState<Set<string>>(() => new Set());
  const [calendarMonth, setCalendarMonth] = useState(currentMonthKey());
  const [sets, setSets] = useState<FlashcardSet[]>([]);
  const [newSetName, setNewSetName] = useState("");
  const [showCreateSet, setShowCreateSet] = useState(false);
  const calendarVisible = !useScrolledPast(360);
  const [expandAll, setExpandAll] = useState(false);
  const [expandedWordIds, setExpandedWordIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedWordIds, setSelectedWordIds] = useState<Set<string>>(new Set());
  const [createSetScope, setCreateSetScope] = useState<"current" | "selected">("current");
  const [activeExportButton, setActiveExportButton] = useState<string | null>(null);
  const [openSetMenuId, setOpenSetMenuId] = useState<string | null>(null);
  const [draggedSetId, setDraggedSetId] = useState<string | null>(null);
  const [hoveredSetId, setHoveredSetId] = useState<string | null>(null);
  const [hoveredSetActionId, setHoveredSetActionId] = useState<string | null>(null);
  const [hoveredSetMenuAction, setHoveredSetMenuAction] = useState<string | null>(null);
  const typography = CARD_TYPOGRAPHY[cardFontSize];

  useEffect(() => {
    chrome.storage.local.get("flashcard_sets", (result) => setSets(normalizeFlashcardSets(result.flashcard_sets)));
    void sendRuntimeMessage<{ synced: number }>({ type: "SYNC_REMOTE_FLASHCARD_SETS" }).catch(() => {});
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.flashcard_sets) setSets(normalizeFlashcardSets(changes.flashcard_sets.newValue));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!openSetMenuId) return;
    const closeMenu = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-set-actions-root]")) return;
      setOpenSetMenuId(null);
    };
    document.addEventListener("mousedown", closeMenu);
    return () => document.removeEventListener("mousedown", closeMenu);
  }, [openSetMenuId]);

  const setById = new Map(sets.map((set) => [set.id, set]));
  const setRows = flashcardSetRows(sets);
  const activeSet = source.kind === "set" ? setById.get(source.setId) : undefined;
  const captureById = new Map(captures.map((capture) => [capture.id, capture]));
  const sourceCaptures = source.kind === "range"
    ? capturesForFlashcardRange(captures, source.range)
    : source.kind === "days"
      ? capturesForDays(captures, selectedDays)
      : source.kind === "due"
        ? captures.filter((capture) => captureIsDue(capture))
        : (activeSet?.captureIds.map((id) => captureById.get(id)).filter((capture): capture is Capture => Boolean(capture)) ?? []);
  const words = buildFlashcardList(sourceCaptures);
  const wordIdsKey = words.map((word) => word.id).join("\0");
  const selectedWords = words.filter((word) => selectedWordIds.has(word.id));
  const selectedCount = selectedWords.length;
  const sourceLabel = source.kind === "range"
    ? FLASHCARD_RANGES.find((range) => range.value === source.range)?.label ?? "Date range"
    : source.kind === "days"
      ? `${selectedDays.size} picked ${selectedDays.size === 1 ? "day" : "days"}`
      : source.kind === "due"
        ? "due cards"
        : activeSet?.name ?? "Saved set";
  const createSetCaptureIds = createSetScope === "selected" ? uniqueFlashcardCaptureIds(selectedWords) : uniqueCaptureIds(sourceCaptures);
  const createSetCardCount = createSetScope === "selected" ? selectedCount : words.length;
  const createSetLabel = createSetScope === "selected"
    ? `${selectedCount} selected ${selectedCount === 1 ? "card" : "cards"}`
    : sourceLabel;
  const hasDaySelection = source.kind !== "days" || selectedDays.size > 0;
  const canExportCurrent = words.length > 0 && (source.kind !== "days" || selectedDays.size > 0);
  const daySelectionSummary = source.kind === "days" && selectedDays.size > 0
    ? `${selectedDays.size} ${selectedDays.size === 1 ? "day" : "days"} selected`
    : "";
  const canCreateSet = Boolean(
    newSetName.trim()
      && createSetCaptureIds.length > 0,
  );

  useEffect(() => {
    const visibleIds = new Set(words.map((word) => word.id));
    setExpandedWordIds((current) => new Set([...current].filter((id) => visibleIds.has(id))));
    setSelectedWordIds((current) => new Set([...current].filter((id) => visibleIds.has(id))));
  }, [wordIdsKey]);

  function toggleWordExpanded(id: string) {
    setExpandedWordIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectionMode() {
    const nextMode = !selectionMode;
    setSelectionMode(nextMode);
    if (!nextMode) {
      setSelectedWordIds(new Set());
    }
  }

  function cancelSelection() {
    setSelectionMode(false);
    setSelectedWordIds(new Set());
  }

  function toggleSelectedWord(id: string, event: React.MouseEvent<HTMLButtonElement>) {
    const index = words.findIndex((word) => word.id === id);
    setSelectedWordIds((current) => {
      const next = new Set(current);
      if (event.shiftKey && index !== -1 && current.size > 0) {
        const selectedIndexes = words.flatMap((word, wordIndex) => current.has(word.id) ? [wordIndex] : []);
        const anchorIndex = selectedIndexes[selectedIndexes.length - 1] ?? index;
        const [start, end] = [Math.min(index, anchorIndex), Math.max(index, anchorIndex)];
        const shouldSelectRange = !next.has(id);
        words.slice(start, end + 1).forEach((word) => {
          if (shouldSelectRange) next.add(word.id);
          else next.delete(word.id);
        });
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function storeSets(next: FlashcardSet[], deletedIds: string[] = []) {
    const normalized = normalizeFlashcardSets(next);
    setSets(normalized);
    chrome.storage.local.set({ flashcard_sets: normalized });
    if (normalized.length > 0) {
      void sendRuntimeMessage<{ sets: FlashcardSet[] }>({ type: "UPSERT_REMOTE_FLASHCARD_SETS", sets: normalized }).catch((error) => {
        console.warn("ContextLens flashcard set sync skipped", error);
      });
    }
    if (deletedIds.length > 0) {
      void sendRuntimeMessage<{ deleted: number }>({ type: "DELETE_REMOTE_FLASHCARD_SETS", ids: deletedIds }).catch((error) => {
        console.warn("ContextLens flashcard set delete sync skipped", error);
      });
    }
  }

  function toggleDay(key: string) {
    setSelectedDays((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setSource({ kind: "days" });
  }

  function openCreateSet(scope: "current" | "selected" = "current") {
    setCreateSetScope(scope);
    setShowCreateSet(true);
  }

  function handleSetsButton() {
    setShowCreateSet(false);
    setShowExport(false);
    setSource({ kind: "days" });
    setSelectedDays(new Set());
    cancelSelection();
  }

  function createSet() {
    const name = newSetName.trim();
    const captureIds = createSetCaptureIds;
    if (!name || captureIds.length === 0) return;
    const now = new Date().toISOString();
    const nextSet: FlashcardSet = {
      id: crypto.randomUUID(),
      name,
      captureIds,
      createdAt: now,
      updatedAt: now,
    };
    storeSets([nextSet, ...sets]);
    setNewSetName("");
    setShowCreateSet(false);
    setShowExport(false);
    setSource({ kind: "days" });
    setSelectedDays(new Set());
    cancelSelection();
  }

  function deleteSet(id: string) {
    storeSets(sets
      .filter((set) => set.id !== id)
      .map((set) => {
        if (set.parentSetId !== id) return set;
        const { parentSetId: _parentSetId, ...independentSet } = set;
        return independentSet;
      }), [id]);
    if (source.kind === "set" && source.setId === id) setSource({ kind: "days" });
  }

  function mergeSetIntoTarget(sourceSetId: string, targetSetId: string) {
    if (sourceSetId === targetSetId) return;
    const sourceSet = setById.get(sourceSetId);
    const targetSet = setById.get(targetSetId);
    if (!sourceSet || !targetSet) return;
    if (!window.confirm(`Merge "${sourceSet.name}" into "${targetSet.name}"?`)) return;
    const now = new Date().toISOString();
    const mergedCaptureIds = Array.from(new Set([...targetSet.captureIds, ...sourceSet.captureIds]));
    storeSets(sets
      .filter((set) => set.id !== sourceSetId)
      .map((set) => {
        if (set.id === targetSetId) {
          return { ...set, captureIds: mergedCaptureIds, updatedAt: now };
        }
        if (set.parentSetId === sourceSetId) {
          return { ...set, parentSetId: targetSetId, updatedAt: now };
        }
        return set;
      }), [sourceSetId]);
    if (source.kind === "set" && source.setId === sourceSetId) {
      setSource({ kind: "set", setId: targetSetId });
    }
  }

  function handleSetDrop(targetSetId: string, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const sourceSetId = draggedSetId;
    setDraggedSetId(null);
    if (!sourceSetId || sourceSetId === targetSetId) return;
    mergeSetIntoTarget(sourceSetId, targetSetId);
  }

  function pressExportButton(key: string) {
    setActiveExportButton(key);
    window.setTimeout(() => {
      setActiveExportButton((current) => current === key ? null : current);
    }, 650);
  }

  function exportButtonStyle(disabled: boolean, active: boolean, compact = false): React.CSSProperties {
    return {
      background: disabled ? colors.border : active ? colors.accent : colors.surfaceAlt,
      color: disabled ? colors.muted : active ? colors.selectedText : colors.text,
      border: `1px solid ${disabled ? colors.border : active ? colors.accent : colors.border}`,
      borderRadius: compact ? 6 : 7,
      padding: compact ? "6px 8px" : "7px 11px",
      fontSize: 12,
      fontWeight: compact ? 850 : 800,
      cursor: disabled ? "default" : "pointer",
      transition: "background 140ms ease, border-color 140ms ease, color 140ms ease",
    };
  }

  function runExport(format: "anki" | "quizlet", exportWords: WordEntry[], key: string, name?: string) {
    if (exportWords.length === 0) return;
    pressExportButton(key);
    exportFlashcards(format, exportWords, name);
  }

  function exportButtons(exportWords: WordEntry[], keyPrefix: string, name?: string) {
    const disabled = exportWords.length === 0;
    const ankiKey = `${keyPrefix}:anki`;
    const quizletKey = `${keyPrefix}:quizlet`;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => runExport("anki", exportWords, ankiKey, name)}
          style={exportButtonStyle(disabled, activeExportButton === ankiKey)}
        >
          Anki
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => runExport("quizlet", exportWords, quizletKey, name)}
          style={exportButtonStyle(disabled, activeExportButton === quizletKey)}
        >
          Quizlet
        </button>
      </div>
    );
  }

  function setFlashcards(set: FlashcardSet) {
    return buildFlashcardList(
      set.captureIds
        .map((id) => captureById.get(id))
        .filter((capture): capture is Capture => Boolean(capture)),
    );
  }

  function setDeckCounts(exportWords: WordEntry[]) {
    const now = Date.now();
    return {
      newCount: exportWords.filter((word) => word.fsrsReviewCount <= 0 || word.fsrsState === "new").length,
      learnCount: exportWords.filter((word) => word.fsrsState === "learning" || word.fsrsState === "relearning").length,
      dueCount: exportWords.filter((word) => word.fsrsState === "reviewing" && new Date(word.fsrsDueAt).getTime() <= now).length,
    };
  }

  function setMenuButtonStyle(actionKey: string, danger = false): React.CSSProperties {
    return {
      background: hoveredSetMenuAction === actionKey ? colors.subtle : "transparent",
      color: danger ? colors.danger : colors.text,
      border: "none",
      textAlign: "left",
      padding: "8px 9px",
      borderRadius: 6,
      cursor: "pointer",
      fontSize: 13,
      fontWeight: 750,
      transition: "background 120ms ease, color 120ms ease",
    };
  }

  function renderSetDeckTable(emptyMessage = "No saved sets yet.") {
    if (sets.length === 0) {
      return (
        <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, background: colors.surface, padding: 16, maxWidth: 560 }}>
          <p style={{ color: colors.text, fontSize: 15, fontWeight: 850, margin: "0 0 6px" }}>Create a custom set</p>
          <p style={{ color: colors.muted, fontSize: 14, lineHeight: 1.6, margin: 0 }}>{emptyMessage}</p>
        </div>
      );
    }
    return (
      <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: "visible", background: colors.surfaceAlt, width: "100%" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 88px 88px 88px 64px", alignItems: "center", gap: 14, padding: "10px 12px", borderBottom: `1px solid ${colors.border}`, color: colors.text, fontSize: 13, fontWeight: 850 }}>
          <span>Set</span>
          <span style={{ textAlign: "center" }}>New</span>
          <span style={{ textAlign: "center" }}>Learn</span>
          <span style={{ textAlign: "center" }}>Due</span>
          <span />
        </div>
        {setRows.map(({ set, depth }) => {
          const selected = source.kind === "set" && source.setId === set.id;
          const parent = set.parentSetId ? setById.get(set.parentSetId) : undefined;
          const exportWords = setFlashcards(set);
          const count = exportWords.length;
          const deckCounts = setDeckCounts(exportWords);
          return (
            <div
              key={set.id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                setDraggedSetId(set.id);
                setOpenSetMenuId(null);
              }}
              onDragOver={(event) => {
                if (draggedSetId && draggedSetId !== set.id) event.preventDefault();
              }}
              onDrop={(event) => handleSetDrop(set.id, event)}
              onDragEnd={() => setDraggedSetId(null)}
              onMouseEnter={() => setHoveredSetId(set.id)}
              onMouseLeave={() => setHoveredSetId((current) => current === set.id ? null : current)}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) 88px 88px 88px 64px",
                gap: 14,
                alignItems: "center",
                padding: "8px 10px 8px 12px",
                borderBottom: `1px solid ${colors.border}`,
                background: selected ? colors.accentSoft : hoveredSetId === set.id ? colors.subtle : colors.surface,
                opacity: draggedSetId === set.id ? 0.72 : 1,
                outline: draggedSetId && draggedSetId !== set.id ? `1px dashed ${colors.accent}` : "none",
                outlineOffset: -3,
                cursor: "grab",
                transition: "background 140ms ease, opacity 180ms ease, outline-color 140ms ease",
              }}
            >
              <button type="button" onClick={() => setSource({ kind: "set", setId: set.id })} style={{ flex: 1, minWidth: 0, background: "none", border: "none", color: colors.text, padding: 0, textAlign: "left", cursor: "pointer" }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingLeft: depth * 18 }}>{depth > 0 ? "- " : ""}{set.name}</span>
                <span style={{ display: "block", fontSize: 12, color: colors.muted, marginTop: 2, paddingLeft: depth * 18 }}>
                  {count} {count === 1 ? "card" : "cards"}{parent ? ` · within ${parent.name}` : ""}
                </span>
              </button>
              <span style={{ textAlign: "center", color: "#60a5fa", fontSize: 13, fontWeight: 850 }}>{deckCounts.newCount}</span>
              <span style={{ textAlign: "center", color: "#f87171", fontSize: 13, fontWeight: 850 }}>{deckCounts.learnCount}</span>
              <span style={{ textAlign: "center", color: "#4ade80", fontSize: 13, fontWeight: 850 }}>{deckCounts.dueCount}</span>
              <div data-set-actions-root style={{ position: "relative", justifySelf: "center" }}>
                <button
                  type="button"
                  onClick={() => setOpenSetMenuId((current) => current === set.id ? null : set.id)}
                  onMouseEnter={() => setHoveredSetActionId(set.id)}
                  onMouseLeave={() => setHoveredSetActionId((current) => current === set.id ? null : current)}
                  title={`Set actions for ${set.name}`}
                  aria-label={`Set actions for ${set.name}`}
                  style={{
                    background: hoveredSetActionId === set.id || openSetMenuId === set.id ? colors.subtle : colors.surface,
                    color: hoveredSetActionId === set.id || openSetMenuId === set.id ? colors.text : colors.muted,
                    border: `1px solid ${hoveredSetActionId === set.id || openSetMenuId === set.id ? colors.accent : colors.border}`,
                    borderRadius: 6,
                    width: 32,
                    height: 32,
                    cursor: "pointer",
                    padding: 0,
                    fontSize: 15,
                    fontWeight: 900,
                    transition: "background 120ms ease, border-color 120ms ease, color 120ms ease",
                  }}
                >
                  ⚙
                </button>
                {openSetMenuId === set.id && (
                  <div style={{ position: "absolute", right: 0, top: 38, zIndex: 20, minWidth: 150, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 6, boxShadow: "0 12px 30px rgba(15,15,15,0.18)", display: "grid", gap: 4 }}>
                    <button
                      type="button"
                      onMouseEnter={() => setHoveredSetMenuAction(`${set.id}:anki`)}
                      onMouseLeave={() => setHoveredSetMenuAction(null)}
                      onClick={() => { runExport("anki", exportWords, `set-menu-${set.id}:anki`, set.name); setOpenSetMenuId(null); }}
                      style={{ ...setMenuButtonStyle(`${set.id}:anki`), opacity: exportWords.length ? 1 : 0.55, cursor: exportWords.length ? "pointer" : "default" }}
                    >
                      Export Anki
                    </button>
                    <button
                      type="button"
                      onMouseEnter={() => setHoveredSetMenuAction(`${set.id}:quizlet`)}
                      onMouseLeave={() => setHoveredSetMenuAction(null)}
                      onClick={() => { runExport("quizlet", exportWords, `set-menu-${set.id}:quizlet`, set.name); setOpenSetMenuId(null); }}
                      style={{ ...setMenuButtonStyle(`${set.id}:quizlet`), opacity: exportWords.length ? 1 : 0.55, cursor: exportWords.length ? "pointer" : "default" }}
                    >
                      Export Quizlet
                    </button>
                    <button
                      type="button"
                      onMouseEnter={() => setHoveredSetMenuAction(`${set.id}:delete`)}
                      onMouseLeave={() => setHoveredSetMenuAction(null)}
                      onClick={() => { deleteSet(set.id); setOpenSetMenuId(null); }}
                      style={setMenuButtonStyle(`${set.id}:delete`, true)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (studyWords) return <FlashcardView words={studyWords} onClose={() => setStudyWords(null)} onReview={onReviewFlashcard} colors={colors} cardFontSize={cardFontSize} />;

  const sourcePanel = source.kind === "set" && activeSet ? (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: 14, background: colors.surface, display: "grid", gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 12, color: colors.muted, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", margin: "0 0 4px" }}>Selected set</p>
        <p style={{ fontSize: 17, color: colors.text, fontWeight: 850, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeSet.name}</p>
        <p style={{ fontSize: 12, color: colors.muted, margin: "3px 0 0" }}>{words.length} {words.length === 1 ? "card" : "cards"}</p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {exportButtons(words, `set-${activeSet.id}`, activeSet.name)}
        <button type="button" onClick={() => setSource({ kind: "days" })} style={{ background: colors.surfaceAlt, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 7, padding: "8px 13px", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
          Pick days from calendar to create custom set
        </button>
      </div>
    </div>
  ) : (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, boxShadow: "0 2px 12px rgba(15,15,15,0.05)", display: "flex", justifyContent: "center", padding: "18px 16px" }}>
      <FlashcardDayCalendar captures={captures} selectedDays={selectedDays} visibleMonth={calendarMonth} onVisibleMonthChange={setCalendarMonth} onToggleDay={toggleDay} colors={colors} theme={theme} accentColor={accentColor} />
    </div>
  );

  const showInlineSets = source.kind === "days" && selectedDays.size === 0;
  const cards = words.length === 0 ? (
    <div style={{ color: colors.muted, fontSize: 15, lineHeight: 1.6, margin: 0, display: "grid", justifyItems: "start", gap: 10 }}>
      {showInlineSets ? (
        renderSetDeckTable("Pick one or more dates on the calendar. When cards appear, use Create set to save them together.")
      ) : (
        <p style={{ margin: 0 }}>
          No cards · {sourceLabel}. {source.kind === "set" ? "Choose another set." : source.kind === "due" ? "Nothing is due right now." : "Pick days from calendar to create custom set."}
        </p>
      )}
    </div>
  ) : (
    <div>
      {words.map((word) => {
        const wordExpanded = expandAll || expandedWordIds.has(word.id);
        const promptIsLong = word.word.trim().length > FLASHCARD_PROMPT_LIMIT;
        const explanationIsLong = Boolean(word.explanation && word.explanation.trim().length > FLASHCARD_EXPLANATION_LIMIT);
        const canExpandCard = promptIsLong || explanationIsLong;
        const promptPreview = wordExpanded ? word.word : previewText(word.word, FLASHCARD_PROMPT_LIMIT);
        const explanationPreview = word.explanation ? (wordExpanded ? word.explanation : previewText(word.explanation, FLASHCARD_EXPLANATION_LIMIT)) : "";
        const selected = selectedWordIds.has(word.id);
        return (
          <div
            key={word.id}
            style={{
              ...savedCardStyle(colors, selected),
              marginBottom: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              {selectionMode && (
                <div style={{ display: "flex", alignItems: "center", paddingTop: 5, flexShrink: 0 }}>
                  <SelectSaveButton selected={selected} onToggle={(event) => toggleSelectedWord(word.id, event)} colors={colors} itemLabel="flashcard" />
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                {word.imageData && (
                  <ScreenshotPreview imageData={word.imageData} colors={colors} />
                )}
                {promptPreview && (
                  <div style={{ margin: word.imageData ? "14px 0 0" : 0, width: "100%" }}>
                    <p style={questionLabelStyle(colors)}>Your question</p>
                    <QuestionText
                      text={promptPreview}
                      color={colors.text}
                      fontSize={questionFontSize(typography)}
                      fontWeight={800}
                    />
                  </div>
                )}
                {explanationPreview && (
                  <div style={{ fontSize: typography.answer, color: colors.text, margin: promptPreview ? "16px 0 0" : word.imageData ? "14px 0 0" : 0, lineHeight: 1.78, overflowWrap: "break-word", maxWidth: "100%" }}>
                    {renderExplanation(explanationPreview, colors)}
                  </div>
                )}
                {canExpandCard && !expandAll && (
                  <button
                    type="button"
                    onClick={() => toggleWordExpanded(word.id)}
                    style={cardSeeAllButtonStyle(colors)}
                  >
                    {expandedWordIds.has(word.id) ? "Show less" : "See all"}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ maxWidth: DASHBOARD_INNER_MAX_WIDTH, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-start" }}>
          {selectionMode ? (
            <>
              <span style={{ color: colors.muted, fontSize: 13, fontWeight: 800, padding: "0 2px" }}>
                {selectedCount} selected
              </span>
              <button
                type="button"
                disabled={selectedCount === 0}
                onClick={() => openCreateSet("selected")}
                style={{
                  ...subtleButtonStyle(colors, 13),
                  color: selectedCount ? colors.text : colors.muted,
                  cursor: selectedCount ? "pointer" : "default",
                  opacity: selectedCount ? 1 : 0.65,
                }}
              >
                Create set
              </button>
              {exportButtons(selectedWords, "selected-flashcards", "selected-flashcards")}
              <button type="button" onClick={cancelSelection} style={{ ...subtleButtonStyle(colors, 13) }}>
                Cancel
              </button>
            </>
          ) : (
            <>
              {words.length > 0 && (
                <button type="button" onClick={() => openCreateSet("current")} style={{ ...subtleButtonStyle(colors, 13) }}>
                  Create set
                </button>
              )}
              {words.length > 0 && (
                <button
                  type="button"
                  onClick={toggleSelectionMode}
                  style={{
                    ...subtleButtonStyle(colors, 13),
                    background: colors.surfaceAlt,
                    color: colors.text,
                    borderColor: colors.border,
                  }}
                >
                  Select
                </button>
              )}
              {hasDaySelection && (
                <button type="button" onClick={handleSetsButton} style={{ ...subtleButtonStyle(colors, 13) }}>
                  Sets
                </button>
              )}
              {canExportCurrent && (
                <button type="button" onClick={() => setShowExport((open) => !open)} style={{ ...subtleButtonStyle(colors, 13) }}>
                  Export
                </button>
              )}
              {daySelectionSummary && (
                <span style={toolbarSummaryStyle(colors)}>
                  {daySelectionSummary}
                  <span>·</span>
                  {words.length} {words.length === 1 ? "card" : "cards"}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {showCreateSet && (
        <FlashcardPopup title="Create set" onClose={() => setShowCreateSet(false)} colors={colors}>
          <p style={{ fontSize: 13, color: colors.muted, lineHeight: 1.5, margin: "0 0 14px" }}>
            Save {createSetCardCount} {createSetCardCount === 1 ? "card" : "cards"} · {createSetLabel}.
          </p>
          <input
            autoFocus
            value={newSetName}
            onChange={(event) => setNewSetName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && canCreateSet) createSet(); }}
            placeholder="Set name"
            style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${colors.border}`, borderRadius: 8, background: colors.surfaceAlt, color: colors.text, padding: "10px 11px", fontSize: 14, outline: "none", marginBottom: 12 }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => setShowCreateSet(false)} style={{ background: colors.surface, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 7, padding: "8px 13px", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
              Cancel
            </button>
            <button type="button" disabled={!canCreateSet} onClick={createSet} style={{ background: canCreateSet ? colors.accent : colors.border, color: canCreateSet ? colors.selectedText : colors.muted, border: "none", borderRadius: 7, padding: "8px 13px", fontSize: 13, fontWeight: 800, cursor: canCreateSet ? "pointer" : "default" }}>
              Save set
            </button>
          </div>
        </FlashcardPopup>
      )}

      <div
        style={{
          ...calendarGridStyle(calendarVisible),
        }}
      >
        <div style={{ minWidth: 0 }}>
          {showExport && !selectionMode && canExportCurrent && (
            <div style={{ border: `1px solid ${colors.border}`, background: colors.surface, borderRadius: 8, padding: 14, marginBottom: 16, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <p style={{ fontSize: 13, color: colors.text, margin: 0 }}>
                Export {words.length} {words.length === 1 ? "card" : "cards"} · {sourceLabel}.
              </p>
              {exportButtons(words, "current-selection")}
            </div>
          )}
          {cards}
        </div>
        <div aria-hidden={!calendarVisible} style={calendarRailStyle(calendarVisible)}>
          <div style={{ width: CALENDAR_COLUMN_WIDTH, boxSizing: "border-box" }}>
            {sourcePanel}
          </div>
        </div>
      </div>
    </div>
  );
}

function exportFlashcards(format: "anki" | "quizlet", flashcards: WordEntry[], name = "contextlens") {
  const rows = flashcards
    .map((card) => `${cleanExportCell(card.word)}\t${cleanExportCell(card.explanation || card.exampleText || "No explanation yet.")}`)
    .join("\n");
  const baseName = filenameSlug(name);
  const filename = format === "anki" ? `${baseName}-anki.tsv` : `${baseName}-quizlet.txt`;
  downloadTextFile(filename, rows);
}

function SettingsView({
  account,
  onAccountChange,
  appMode,
  onAppModeChange,
  cardFontSize,
  onCardFontSizeChange,
  accentColor,
  onAccentColorChange,
  theme,
  colors,
}: {
  account: ContextLensUser | null;
  onAccountChange: (account: ContextLensUser | null) => void;
  appMode: AppMode;
  onAppModeChange: (mode: AppMode) => void;
  cardFontSize: CardFontSize;
  onCardFontSizeChange: (size: CardFontSize) => void;
  accentColor: string;
  onAccentColorChange: (color: string) => void;
  theme: ThemeName;
  colors: DashboardColors;
}) {
  const [triggers, setTriggers] = useState<SaveTriggers>({ bubble: true, contextMenu: true });
  const [screenshotTriggers, setScreenshotTriggers] = useState<ScreenshotTriggers>({ floatingButton: true, shortcut: true, immediate: true });
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [accountStatus, setAccountStatus] = useState("");
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountFormVisible, setAccountFormVisible] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [forgotStep, setForgotStep] = useState<"off" | "email" | "code">("off");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotCode, setForgotCode] = useState("");
  const [forgotNewPassword, setForgotNewPassword] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotStatus, setForgotStatus] = useState("");
  const [accentDraft, setAccentDraft] = useState(accentColor);
  const [overlayTheme, setOverlayTheme] = useState<ThemeName>("dark");

  useEffect(() => {
    chrome.storage.local.get("overlay_theme", (r) => {
      setOverlayTheme(isThemeName(r.overlay_theme) ? r.overlay_theme : "dark");
    });
  }, []);

  function toggleOverlayTheme() {
    const next: ThemeName = overlayTheme === "dark" ? "light" : "dark";
    setOverlayTheme(next);
    chrome.storage.local.set({ overlay_theme: next });
  }

  useEffect(() => {
    chrome.storage.local.remove("anthropic_api_key");
    chrome.storage.local.get(["save_triggers", "screenshot_triggers", "answer_immediate"], (r) => {
      if (r.save_triggers) setTriggers(r.save_triggers);
      const saved = r.screenshot_triggers ?? { floatingButton: true, shortcut: true, immediate: true };
      const immediate = r.answer_immediate !== undefined ? Boolean(r.answer_immediate) : (saved.immediate ?? true);
      setScreenshotTriggers({ ...saved, immediate });
    });
  }, []);

  useEffect(() => {
    setAccentDraft(accentColor);
  }, [accentColor]);

  useEffect(() => {
    if (account) {
      setAccountFormVisible(false);
      setDeleteConfirmVisible(false);
    }
  }, [account]);

  function handleTriggerChange(field: keyof SaveTriggers, value: boolean) {
    const updated = { ...triggers, [field]: value };
    setTriggers(updated);
    chrome.storage.local.set({ save_triggers: updated });
  }

  function handleScreenshotTriggerChange(field: keyof ScreenshotTriggers, value: boolean) {
    const updated = { ...screenshotTriggers, [field]: value };
    setScreenshotTriggers(updated);
    const patch: Record<string, unknown> = { screenshot_triggers: updated };
    if (field === "immediate") patch.answer_immediate = value;
    chrome.storage.local.set(patch);
  }

  function openShortcutSettings() {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  }

  function openCreateAccountPage() {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/account/create-account.html") });
  }

  async function handleAuth() {
    const email = authEmail.trim().toLowerCase();
    if (!email.includes("@") || authPassword.length < 6) return;
    setAccountLoading(true);
    setAccountStatus("");
    try {
      const result = await sendRuntimeMessage<ContextLensUser>({ type: "SIGN_IN_OR_SIGN_UP", email, password: authPassword });
      onAccountChange(result);
      setAuthEmail("");
      setAuthPassword("");
      setAccountStatus(`Signed in as ${result.email}.`);
    } catch (error) {
      setAccountStatus(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setAccountLoading(false);
    }
  }

  function beginChangeAccount() {
    setAuthEmail("");
    setAuthPassword("");
    setDeleteConfirmVisible(false);
    setAccountStatus("Current account stays active until another account signs in.");
    setAccountFormVisible(true);
  }

  function cancelChangeAccount() {
    setAuthEmail("");
    setAuthPassword("");
    setAccountStatus("");
    setAccountFormVisible(false);
  }

  async function handleForgotSubmit() {
    const email = forgotEmail.trim().toLowerCase();
    if (!email.includes("@")) return;
    setForgotLoading(true);
    setForgotStatus("");
    try {
      await sendRuntimeMessage<{ sent: boolean }>({ type: "FORGOT_PASSWORD", email });
      setForgotStep("code");
      setForgotStatus("Check your email for a 6-digit reset code.");
    } catch (error) {
      setForgotStatus(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleResetSubmit() {
    const email = forgotEmail.trim().toLowerCase();
    if (!email.includes("@") || forgotCode.length !== 6 || forgotNewPassword.length < 6) return;
    setForgotLoading(true);
    setForgotStatus("");
    try {
      const result = await sendRuntimeMessage<ContextLensUser>({ type: "RESET_PASSWORD", email, code: forgotCode, newPassword: forgotNewPassword });
      onAccountChange(result);
      setForgotStep("off");
      setForgotEmail("");
      setForgotCode("");
      setForgotNewPassword("");
      setAccountStatus(`Password reset. Signed in as ${result.email}.`);
    } catch (error) {
      setForgotStatus(error instanceof Error ? error.message : "Reset failed.");
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleDeleteAccount() {
    setAccountLoading(true);
    setAccountStatus("");
    try {
      await sendRuntimeMessage<{ deleted: boolean }>({ type: "DELETE_ACCOUNT" });
      onAccountChange(null);
      setAuthEmail("");
      setAuthPassword("");
      setDeleteConfirmVisible(false);
      setAccountFormVisible(false);
      setAccountStatus("Account deleted. This email cannot be used to create a new account.");
    } catch (error) {
      setAccountStatus(error instanceof Error ? error.message : "Delete account failed.");
    } finally {
      setAccountLoading(false);
    }
  }

  function handleAccentDraft(value: string) {
    setAccentDraft(value);
    if (/^#[0-9a-fA-F]{6}$/.test(value) || /^[0-9a-fA-F]{6}$/.test(value)) {
      onAccentColorChange(normalizeHexColor(value));
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: 40,
    boxSizing: "border-box",
    border: `1px solid ${colors.border}`,
    borderRadius: 8,
    padding: "0 11px",
    fontSize: 14,
    color: colors.text,
    background: colors.surface,
    outline: "none",
  };

  return (
    <div style={{ maxWidth: 520, paddingTop: 8 }}>
      {/* Account */}
      <p style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>Account</p>
      <div style={{ marginBottom: 40 }}>
        {account && !accountFormVisible ? (
          <div>
            <p style={{ fontSize: 14, color: colors.text, margin: "0 0 4px", fontWeight: 700 }}>
              {account.email}
            </p>
            <p style={{ fontSize: 12, color: colors.muted, margin: "0 0 12px", lineHeight: 1.5 }}>
              Signed in — saves sync to Railway when the backend is reachable.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={beginChangeAccount}
                disabled={accountLoading}
                style={{
                  background: colors.surface,
                  color: colors.text,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: accountLoading ? "default" : "pointer",
                }}
              >
                Change account
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirmVisible(true)}
                disabled={accountLoading}
                style={{
                  background: colors.surface,
                  color: colors.danger,
                  border: `1px solid ${colors.dangerBorder}`,
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: accountLoading ? "default" : "pointer",
                }}
              >
                Delete account
              </button>
            </div>
            {deleteConfirmVisible && (
              <div style={{ marginTop: 12, border: `1px solid ${colors.dangerBorder}`, borderRadius: 8, padding: 12, background: colors.dangerSoft }}>
                <p style={{ fontSize: 12, color: colors.danger, margin: "0 0 10px", lineHeight: 1.5 }}>
                  This deletes your account and saved cloud data. This email cannot be used to create another account.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={handleDeleteAccount}
                    disabled={accountLoading}
                    style={{
                      background: colors.dangerFill,
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      padding: "8px 12px",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: accountLoading ? "default" : "pointer",
                    }}
                  >
                    {accountLoading ? "Deleting…" : "Delete permanently"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmVisible(false)}
                    disabled={accountLoading}
                    style={{
                      background: colors.surface,
                      color: colors.text,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 8,
                      padding: "8px 12px",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: accountLoading ? "default" : "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <div>
                <p style={{ fontSize: 14, color: colors.text, margin: "0 0 3px", fontWeight: 700 }}>
                  {accountFormVisible ? "Change account" : "Sign in"}
                </p>
                <p style={{ fontSize: 12, color: colors.muted, margin: 0, lineHeight: 1.5 }}>
                  Use your ContextLens account. If this email is new, we'll create the account and keep you signed in.
                </p>
              </div>
              <button
                type="button"
                onClick={openCreateAccountPage}
                style={{
                  background: colors.surface,
                  color: colors.text,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  padding: "7px 10px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Create account page
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="Email address"
                autoComplete="email"
                style={inputStyle}
              />
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                onKeyDown={(e) => { if (e.key === "Enter") handleAuth(); }}
                style={inputStyle}
              />
              <button
                type="button"
                onClick={handleAuth}
                disabled={accountLoading || !authEmail.includes("@") || authPassword.length < 6}
                style={{
                  alignSelf: "flex-start",
                  background: accountLoading || !authEmail.includes("@") || authPassword.length < 6 ? colors.border : colors.accent,
                  color: accountLoading || !authEmail.includes("@") || authPassword.length < 6 ? colors.muted : colors.selectedText,
                  border: "none",
                  borderRadius: 8,
                  padding: "9px 14px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: accountLoading || !authEmail.includes("@") || authPassword.length < 6 ? "default" : "pointer",
                }}
              >
                {accountLoading ? "Signing in…" : accountFormVisible ? "Switch account" : "Continue"}
              </button>
              {account && accountFormVisible && (
                <button
                  type="button"
                  onClick={cancelChangeAccount}
                  disabled={accountLoading}
                  style={{
                    alignSelf: "flex-start",
                    background: colors.surface,
                    color: colors.text,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 8,
                    padding: "9px 14px",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: accountLoading ? "default" : "pointer",
                  }}
                >
                  Cancel
                </button>
              )}
              {forgotStep === "off" && (
                <button
                  type="button"
                  onClick={() => { setForgotStep("email"); setForgotEmail(authEmail); setForgotStatus(""); }}
                  style={{ alignSelf: "flex-start", background: "none", border: "none", color: colors.muted, fontSize: 12, cursor: "pointer", padding: 0, textDecoration: "underline" }}
                >
                  Forgot password?
                </button>
              )}
              {forgotStep !== "off" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: colors.text, margin: 0 }}>Reset password</p>
                  {forgotStep === "email" && (
                    <>
                      <input
                        type="email"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        placeholder="Your email address"
                        onKeyDown={(e) => { if (e.key === "Enter") handleForgotSubmit(); }}
                        style={inputStyle}
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          onClick={handleForgotSubmit}
                          disabled={forgotLoading || !forgotEmail.includes("@")}
                          style={{ background: colors.accent, color: colors.selectedText, border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: forgotLoading || !forgotEmail.includes("@") ? "default" : "pointer", opacity: forgotLoading || !forgotEmail.includes("@") ? 0.5 : 1 }}
                        >
                          {forgotLoading ? "Sending…" : "Send reset code"}
                        </button>
                        <button type="button" onClick={() => { setForgotStep("off"); setForgotStatus(""); }} style={{ background: "none", border: "none", color: colors.muted, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>Cancel</button>
                      </div>
                    </>
                  )}
                  {forgotStep === "code" && (
                    <>
                      <input
                        type="text"
                        value={forgotCode}
                        onChange={(e) => setForgotCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder="6-digit code from email"
                        style={inputStyle}
                      />
                      <input
                        type="password"
                        value={forgotNewPassword}
                        onChange={(e) => setForgotNewPassword(e.target.value)}
                        placeholder="New password (6+ characters)"
                        onKeyDown={(e) => { if (e.key === "Enter") handleResetSubmit(); }}
                        style={inputStyle}
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          onClick={handleResetSubmit}
                          disabled={forgotLoading || forgotCode.length !== 6 || forgotNewPassword.length < 6}
                          style={{ background: colors.accent, color: colors.selectedText, border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: forgotLoading || forgotCode.length !== 6 || forgotNewPassword.length < 6 ? "default" : "pointer", opacity: forgotLoading || forgotCode.length !== 6 || forgotNewPassword.length < 6 ? 0.5 : 1 }}
                        >
                          {forgotLoading ? "Resetting…" : "Reset password"}
                        </button>
                        <button type="button" onClick={() => setForgotStep("email")} style={{ background: "none", border: "none", color: colors.muted, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>Back</button>
                      </div>
                    </>
                  )}
                  {forgotStatus && <p style={{ fontSize: 12, color: forgotStatus.toLowerCase().includes("check") ? colors.muted : "#eb5757", margin: 0, lineHeight: 1.5 }}>{forgotStatus}</p>}
                </div>
              )}
            </div>
          </div>
        )}
        {accountStatus && (
          <p style={{ fontSize: 12, color: accountStatus.toLowerCase().includes("error") || accountStatus.toLowerCase().includes("failed") || accountStatus.toLowerCase().includes("could not") ? "#eb5757" : colors.muted, margin: "10px 0 0", lineHeight: 1.5 }}>
            {accountStatus}
          </p>
        )}
      </div>

      {/* Appearance */}
      <p style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>Appearance</p>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 16, marginBottom: 40 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, color: colors.text, fontWeight: 600 }}>Overlay theme</span>
          <button
            type="button"
            onClick={toggleOverlayTheme}
            aria-label={overlayTheme === "dark" ? "Switch overlay to light" : "Switch overlay to dark"}
            title={overlayTheme === "dark" ? "Overlay: dark" : "Overlay: light"}
            style={{
              width: 32,
              height: 32,
              borderRadius: 999,
              border: `1px solid ${colors.border}`,
              background: colors.surface,
              color: colors.text,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            {overlayTheme === "dark" ? "☀" : "☾"}
          </button>
          <span style={{ fontSize: 12, color: colors.muted }}>{overlayTheme === "dark" ? "Dark" : "Light"}</span>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 12, color: colors.text, fontSize: 14, flexWrap: "wrap" }}>
          <input
            type="color"
            value={accentColor}
            onChange={(event) => onAccentColorChange(normalizeHexColor(event.target.value))}
            style={{
              width: 32,
              height: 32,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              padding: 2,
              background: colors.surface,
              cursor: "pointer",
            }}
            aria-label="Accent color"
          />
          <span style={{ fontWeight: 600 }}>Accent color</span>
          <input
            value={accentDraft}
            onChange={(event) => handleAccentDraft(event.target.value)}
            onBlur={() => setAccentDraft(accentColor)}
            spellCheck={false}
            style={{
              width: 96,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              padding: "7px 9px",
              color: colors.text,
              background: colors.surface,
              fontSize: 13,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              outline: "none",
            }}
          />
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {["#38bdf8", "#6466f1", "#0f766e", "#b45309", "#be123c", "#37352f"].filter(s => theme !== "dark" || !tooDarkForDarkMode(s)).map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Use ${swatch}`}
              onClick={() => onAccentColorChange(swatch)}
              style={{
                width: 24,
                height: 24,
                borderRadius: 999,
                border: accentColor === swatch ? `2px solid ${colors.text}` : `1px solid ${colors.border}`,
                background: swatch,
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
        </div>
      </div>

      {/* Save triggers */}
      <p style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>Save trigger</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 40 }}>
        {([
          { field: "bubble" as const, label: "Show Ask button on highlight", desc: "A small button appears over your selection — click it to ask." },
          { field: "contextMenu" as const, label: "Add to right-click menu", desc: "\"Save to ContextLens\" appears in the right-click context menu." },
        ]).map((opt) => (
          <label key={opt.field} style={{ display: "flex", gap: 12, cursor: "pointer", alignItems: "flex-start" }}>
            <input type="checkbox" checked={triggers[opt.field]} onChange={(e) => handleTriggerChange(opt.field, e.target.checked)} style={{ accentColor: colors.accent, marginTop: 3 }} />
            <div>
              <p style={{ fontSize: 14, color: colors.text, margin: 0 }}>{opt.label}</p>
              <p style={{ fontSize: 12, color: colors.muted, margin: "2px 0 0" }}>{opt.desc}</p>
            </div>
          </label>
        ))}
      </div>

      {/* Answer behavior */}
      <p style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>Answer behavior</p>
      <label style={{ display: "flex", gap: 12, cursor: "pointer", alignItems: "flex-start", marginBottom: 40 }}>
        <input
          type="checkbox"
          checked={screenshotTriggers.immediate}
          onChange={(e) => handleScreenshotTriggerChange("immediate", e.target.checked)}
          style={{ accentColor: colors.accent, marginTop: 3 }}
        />
        <div>
          <p style={{ fontSize: 14, color: colors.text, margin: 0 }}>Show answer immediately</p>
          <p style={{ fontSize: 12, color: colors.muted, margin: "2px 0 0" }}>
            Shows the AI answer in the popup after pressing Enter, then lets you ask follow-ups.
          </p>
        </div>
      </label>

      <p style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>Card text size</p>
      <label style={{ display: "block", marginBottom: 40 }}>
        <p style={{ fontSize: 14, color: colors.text, margin: "0 0 4px" }}>Dashboard cards</p>
        <p style={{ fontSize: 12, color: colors.muted, margin: "0 0 8px", lineHeight: 1.5 }}>
          Adjust saved text and answer size across Today, History, and Flashcards.
        </p>
        <select
          value={cardFontSize}
          onChange={(event) => onCardFontSizeChange(event.target.value as CardFontSize)}
          style={{
            width: 190,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 14,
            color: colors.text,
            background: colors.surface,
            outline: "none",
          }}
        >
          {CARD_FONT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <p style={{ fontSize: 12, color: colors.muted, margin: "7px 0 0", lineHeight: 1.5 }}>
          {CARD_FONT_OPTIONS.find((option) => option.value === cardFontSize)?.note}
        </p>
      </label>

      {/* Screenshot triggers */}
      <p style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>Screenshot trigger</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {([
          { field: "floatingButton" as const, label: "Show camera button on pages", desc: "A camera button appears in the corner of every page." },
          { field: "shortcut" as const, label: "Keyboard shortcut", desc: "Set your shortcut at chrome://extensions/shortcuts." },
        ]).map((opt) => (
          <label key={opt.field} style={{ display: "flex", gap: 12, cursor: "pointer", alignItems: "flex-start" }}>
            <input type="checkbox" checked={screenshotTriggers[opt.field]} onChange={(e) => handleScreenshotTriggerChange(opt.field, e.target.checked)} style={{ accentColor: colors.accent, marginTop: 3 }} />
            <div>
              <p style={{ fontSize: 14, color: colors.text, margin: 0 }}>{opt.label}</p>
              <p style={{ fontSize: 12, color: colors.muted, margin: "2px 0 0" }}>{opt.desc}</p>
            </div>
          </label>
        ))}
        <button
          type="button"
          onClick={openShortcutSettings}
          style={{
            width: "fit-content",
            background: colors.surface,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Open Chrome shortcut settings
        </button>
      </div>

      {/* Learning mode */}
      <p style={{ fontSize: 13, color: colors.muted, marginTop: 40, marginBottom: 12 }}>Current mode</p>
      <div style={{ display: "flex", gap: 10, marginBottom: 40 }}>
        {([
          { value: "language_learning", label: "Language", desc: "Clear explanations for text, words, and concepts." },
          { value: "student", label: "Student", desc: "Kid-friendly explanations with analogies and simple words." },
        ] as { value: AppMode; label: string; desc: string }[]).map(({ value, label, desc }) => (
          <button
            key={value}
            type="button"
            onClick={() => onAppModeChange(value)}
            style={{
              flex: 1,
              padding: "12px 14px",
              borderRadius: 10,
              border: appMode === value ? `2px solid ${colors.accent}` : `1px solid ${colors.border}`,
              background: appMode === value ? colorWithAlpha(colors.accent, 0.08) : colors.surface,
              color: appMode === value ? colors.accent : colors.text,
              textAlign: "left",
              cursor: "pointer",
              transition: "border 120ms, background 120ms",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 12, color: appMode === value ? colors.accent : colors.muted, lineHeight: 1.5, opacity: appMode === value ? 0.85 : 1 }}>{desc}</div>
          </button>
        ))}
      </div>

    </div>
  );
}

function MonthCalendar({
  captures,
  selectedDay,
  visibleMonth,
  onVisibleMonthChange,
  onSelectDay,
  colors,
  theme,
  accentColor,
}: {
  captures: Capture[];
  selectedDay: string;
  visibleMonth: string;
  onVisibleMonthChange: (month: string) => void;
  onSelectDay: (day: string) => void;
  colors: DashboardColors;
  theme: ThemeName;
  accentColor: string;
}) {
  const counts = captureCountsByDay(captures);
  const days = calendarDayKeys(visibleMonth);
  const realDays = days.filter((day): day is string => Boolean(day));
  const max = Math.max(1, ...realDays.map((day) => counts.get(day) ?? 0));
  const previousMonth = addMonths(visibleMonth, -1);
  const nextMonth = addMonths(visibleMonth, 1);
  const canGoNextMonth = nextMonth <= currentMonthKey();

  function colorFor(count: number) {
    if (count === 0) return colors.surfaceAlt;
    const cappedMax = Math.max(12, Math.min(48, max));
    const intensity = Math.min(1, Math.log1p(count) / Math.log1p(cappedMax));
    const alpha = theme === "dark"
      ? 0.16 + intensity * 0.42
      : 0.07 + intensity * 0.34;
    return colorWithAlpha(accentColor, alpha);
  }

  function borderFor(count: number, isSelected: boolean) {
    if (isSelected) return `2px solid ${colors.accent}`;
    if (count > 0) return `1px solid ${colorWithAlpha(accentColor, theme === "dark" ? 0.42 : 0.28)}`;
    return `1px solid ${colors.border}`;
  }

  function textFor(count: number, isFuture: boolean) {
    if (isFuture) return theme === "dark" ? "#5f5a51" : "#d8d7d2";
    if (count === 0) return colors.muted;
    return theme === "dark" ? "#f0ede6" : "#1a1916";
  }

  return (
    <div style={{ width: 300 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button
          onClick={() => onVisibleMonthChange(previousMonth)}
          aria-label="Previous month"
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            color: colors.text,
            cursor: "pointer",
            fontSize: 16,
          }}
        >
          ‹
        </button>
        <p style={{ fontSize: 15, color: colors.text, margin: 0, fontWeight: 700 }}>
          {monthLabelFromKey(visibleMonth)}
        </p>
        <button
          onClick={() => canGoNextMonth && onVisibleMonthChange(nextMonth)}
          disabled={!canGoNextMonth}
          aria-label="Next month"
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            border: `1px solid ${colors.border}`,
            background: canGoNextMonth ? colors.surface : colors.surfaceAlt,
            color: canGoNextMonth ? colors.text : colors.muted,
            cursor: canGoNextMonth ? "pointer" : "default",
            fontSize: 16,
          }}
        >
          ›
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 34px)", gap: 7, marginBottom: 8 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => (
          <span key={`${label}-${index}`} style={{ fontSize: 11, color: colors.muted, fontWeight: 700, textAlign: "center" }}>
            {label}
          </span>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 34px)", gap: 7, width: "fit-content" }}>
        {days.map((key, index) => {
          if (!key) return <span key={`blank-${index}`} style={{ width: 34, height: 34 }} />;

          const count = counts.get(key) ?? 0;
          const date = dateFromDayKey(key);
          const isSelected = selectedDay === key;
          const isFuture = key > todayKey();
          return (
            <button
              key={key}
              title={`${dayLabelFromKey(key)}: ${count} ${count === 1 ? "save" : "saves"}`}
              onClick={() => !isFuture && onSelectDay(key)}
              disabled={isFuture}
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                border: borderFor(count, isSelected),
                background: isFuture ? colors.surfaceAlt : isSelected ? colors.accent : colorFor(count),
                color: isSelected ? colors.selectedText : textFor(count, isFuture),
                fontSize: 12,
                fontWeight: isSelected ? 900 : 600,
                cursor: isFuture ? "default" : "pointer",
                padding: 0,
                position: "relative",
                zIndex: isSelected ? 1 : 0,
                boxShadow: isSelected
                  ? `0 0 0 3px ${colorWithAlpha(accentColor, theme === "dark" ? 0.34 : 0.22)}, inset 0 0 0 1px ${colorWithAlpha("#ffffff", 0.38)}`
                  : "none",
                transition: "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease, color 120ms ease",
              }}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FlashcardDayCalendar({
  captures,
  selectedDays,
  visibleMonth,
  onVisibleMonthChange,
  onToggleDay,
  colors,
  theme,
  accentColor,
}: {
  captures: Capture[];
  selectedDays: Set<string>;
  visibleMonth: string;
  onVisibleMonthChange: (month: string) => void;
  onToggleDay: (day: string) => void;
  colors: DashboardColors;
  theme: ThemeName;
  accentColor: string;
}) {
  const counts = captureCountsByDay(captures);
  const days = calendarDayKeys(visibleMonth);
  const realDays = days.filter((key): key is string => Boolean(key));
  const max = Math.max(1, ...realDays.map((day) => counts.get(day) ?? 0));
  const previousMonth = addMonths(visibleMonth, -1);
  const nextMonth = addMonths(visibleMonth, 1);
  const canGoNext = nextMonth <= currentMonthKey();

  function colorFor(count: number) {
    if (count === 0) return colors.surfaceAlt;
    const cappedMax = Math.max(12, Math.min(48, max));
    const intensity = Math.min(1, Math.log1p(count) / Math.log1p(cappedMax));
    const alpha = theme === "dark"
      ? 0.16 + intensity * 0.42
      : 0.07 + intensity * 0.34;
    return colorWithAlpha(accentColor, alpha);
  }

  function borderFor(count: number, isSelected: boolean) {
    if (isSelected) return `2px solid ${colors.accent}`;
    if (count > 0) return `1px solid ${colorWithAlpha(accentColor, theme === "dark" ? 0.42 : 0.28)}`;
    return `1px solid ${colors.border}`;
  }

  return (
    <div style={{ width: 300 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button type="button" onClick={() => onVisibleMonthChange(previousMonth)} aria-label="Previous flashcard month" style={{ width: 28, height: 28, borderRadius: 999, border: `1px solid ${colors.border}`, background: colors.surface, color: colors.text, cursor: "pointer", fontSize: 16 }}>‹</button>
        <p style={{ fontSize: 15, color: colors.text, margin: 0, fontWeight: 700 }}>{monthLabelFromKey(visibleMonth)}</p>
        <button type="button" onClick={() => canGoNext && onVisibleMonthChange(nextMonth)} disabled={!canGoNext} aria-label="Next flashcard month" style={{ width: 28, height: 28, borderRadius: 999, border: `1px solid ${colors.border}`, background: canGoNext ? colors.surface : colors.surfaceAlt, color: canGoNext ? colors.text : colors.muted, cursor: canGoNext ? "pointer" : "default", fontSize: 16 }}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 34px)", gap: 7, marginBottom: 8 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => <span key={`${label}-${index}`} style={{ fontSize: 11, color: colors.muted, fontWeight: 700, textAlign: "center" }}>{label}</span>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 34px)", gap: 7, width: "fit-content" }}>
        {days.map((key, index) => {
          if (!key) return <span key={`blank-${index}`} style={{ width: 34, height: 34 }} />;
          const date = dateFromDayKey(key);
          const count = counts.get(key) ?? 0;
          const selected = selectedDays.has(key);
          const future = key > todayKey();
          return (
            <button
              key={key}
              type="button"
              title={`${dayLabelFromKey(key)}: ${count} ${count === 1 ? "save" : "saves"}`}
              disabled={future}
              onClick={() => !future && onToggleDay(key)}
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                border: borderFor(count, selected),
                background: future ? colors.surfaceAlt : selected ? colors.accent : colorFor(count),
                boxShadow: selected
                  ? `0 0 0 3px ${colorWithAlpha(accentColor, theme === "dark" ? 0.34 : 0.22)}, inset 0 0 0 1px ${colorWithAlpha("#ffffff", 0.38)}`
                  : "none",
                color: selected ? colors.selectedText : future ? colors.muted : count > 0 ? (theme === "dark" ? "#f0ede6" : "#1a1916") : colors.muted,
                cursor: future ? "default" : "pointer",
                fontSize: 12,
                fontWeight: selected ? 900 : 600,
                padding: 0,
                position: "relative",
                zIndex: selected ? 1 : 0,
                transition: "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease, color 120ms ease",
              }}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>(() => viewFromHash());
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [currentDayKey, setCurrentDayKey] = useState(todayKey());
  const [account, setAccount] = useState<ContextLensUser | null>(null);
  const [appMode, setAppMode] = useState<AppMode>("language_learning");
  const [theme, setThemeState] = useState<ThemeName>(() => storedThemeFallback("light"));
  const [accentColor, setAccentColorState] = useState(DEFAULT_ACCENT_COLOR);
  const [cardFontSize, setCardFontSizeState] = useState<CardFontSize>(DEFAULT_CARD_FONT_SIZE);
  const [streakTooltipVisible, setStreakTooltipVisible] = useState(false);
  const [hoveredNavView, setHoveredNavView] = useState<View | null>(null);

  useEffect(() => {
    chrome.storage.local.get(["captures", "contextlens_user", "app_mode", "theme", "accent_color", "card_font_size"], (r) => {
      const storedCaptures: Capture[] = r.captures ?? [];
      const normalizedCaptures = storedCaptures.map((capture) => (
        capture.status === "error" && hasRawBackendError(capture.errorMessage)
          ? { ...capture, errorMessage: normalizeStoredErrorMessage(capture.errorMessage) }
          : capture
      ));
      setCaptures(normalizedCaptures);
      if (normalizedCaptures.some((capture, index) => capture.errorMessage !== storedCaptures[index]?.errorMessage)) {
        chrome.storage.local.set({ captures: normalizedCaptures });
      }
      setAccount(r.contextlens_user ?? null);
      setAppMode(r.app_mode ?? "language_learning");
      setCardFontSizeState(isCardFontSize(r.card_font_size) ? r.card_font_size : DEFAULT_CARD_FONT_SIZE);
      const t = isThemeName(r.theme) ? r.theme : "light";
      const accent = normalizeHexColor(r.accent_color);
      setThemeState(t);
      setAccentColorState(accent);
      document.documentElement.setAttribute("data-theme", t);
      rememberTheme(t);
      document.documentElement.style.setProperty("--contextlens-accent", accent);
    });
    void sendRuntimeMessage<{ synced: number }>({ type: "SYNC_REMOTE_CAPTURES" }).catch(() => {});
    void sendRuntimeMessage<{ synced: number }>({ type: "SYNC_REMOTE_FLASHCARD_SETS" }).catch(() => {});
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.captures) setCaptures(changes.captures.newValue ?? []);
      if (changes.contextlens_user) setAccount(changes.contextlens_user.newValue ?? null);
      if (changes.app_mode) setAppMode(changes.app_mode.newValue ?? "language_learning");
      if (changes.card_font_size) setCardFontSizeState(isCardFontSize(changes.card_font_size.newValue) ? changes.card_font_size.newValue : DEFAULT_CARD_FONT_SIZE);
      if (changes.theme) {
        const nextTheme = isThemeName(changes.theme.newValue) ? changes.theme.newValue : "light";
        setThemeState(nextTheme);
        document.documentElement.setAttribute("data-theme", nextTheme);
        rememberTheme(nextTheme);
      }
      if (changes.accent_color) {
        const nextAccent = normalizeHexColor(changes.accent_color.newValue);
        setAccentColorState(nextAccent);
        document.documentElement.style.setProperty("--contextlens-accent", nextAccent);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function navigateView(nextView: View) {
    setView(nextView);
    const nextHash = nextView === "saves" ? "" : `#${nextView}`;
    if (window.location.hash !== nextHash) {
      history.replaceState(null, "", `${window.location.pathname}${nextHash}`);
    }
  }

  function setTheme(t: ThemeName) {
    setThemeState(t);
    chrome.storage.local.set({ theme: t });
    document.documentElement.setAttribute("data-theme", t);
    rememberTheme(t);
  }

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    if (nextTheme === "dark" && tooDarkForDarkMode(accentColor)) {
      setAccentColor(DEFAULT_ACCENT_COLOR);
    }
    setTheme(nextTheme);
  }

  function setAccentColor(color: string) {
    const nextColor = normalizeHexColor(color);
    setAccentColorState(nextColor);
    chrome.storage.local.set({ accent_color: nextColor });
    document.documentElement.style.setProperty("--contextlens-accent", nextColor);
  }

  function setMode(mode: AppMode) {
    setAppMode(mode);
    chrome.storage.local.set({ app_mode: mode });
  }

  function setCardFontSize(size: CardFontSize) {
    setCardFontSizeState(size);
    chrome.storage.local.set({ card_font_size: size });
  }

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentDayKey(todayKey()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const todayCaptures = captures.filter((capture) => dayKey(capture.savedAt) === currentDayKey);
  const streak = computeStreak(captures);
  const contentMaxWidth = 1280;
  const contentPadding = "32px";
  const colors = colorsForTheme(theme, accentColor);

  useEffect(() => {
    document.documentElement.style.background = colors.bg;
    document.body.style.background = colors.bg;
  }, [colors.bg]);

  function deleteCapturesByIds(ids: string[]) {
    const idsToDelete = new Set(ids);
    if (idsToDelete.size === 0) return;

    setCaptures((current) => {
      const next = current.filter((capture) => !idsToDelete.has(capture.id));
      chrome.storage.local.set({ captures: next });
      return next;
    });

    chrome.storage.local.get("deep_dive_capture_ids", (result) => {
      const next = (result.deep_dive_capture_ids ?? []).filter((id: string) => !idsToDelete.has(id));
      chrome.storage.local.set({ deep_dive_capture_ids: next });
    });

    chrome.storage.local.get("flashcard_sets", (result) => {
      const currentSets = normalizeFlashcardSets(result.flashcard_sets);
      const next = currentSets
        .map((set) => ({ ...set, captureIds: set.captureIds.filter((id) => !idsToDelete.has(id)) }))
        .filter((set) => set.captureIds.length > 0);
      const normalizedNext = normalizeFlashcardSets(next);
      const nextIds = new Set(normalizedNext.map((set) => set.id));
      const deletedSetIds = currentSets.filter((set) => !nextIds.has(set.id)).map((set) => set.id);
      chrome.storage.local.set({ flashcard_sets: normalizedNext });
      if (normalizedNext.length > 0) {
        void sendRuntimeMessage<{ sets: FlashcardSet[] }>({ type: "UPSERT_REMOTE_FLASHCARD_SETS", sets: normalizedNext }).catch((error) => {
          console.warn("ContextLens flashcard set sync skipped", error);
        });
      }
      if (deletedSetIds.length > 0) {
        void sendRuntimeMessage<{ deleted: number }>({ type: "DELETE_REMOTE_FLASHCARD_SETS", ids: deletedSetIds }).catch((error) => {
          console.warn("ContextLens flashcard set delete sync skipped", error);
        });
      }
    });

    void sendRuntimeMessage<{ deleted: number }>({ type: "DELETE_REMOTE_CAPTURES", ids: Array.from(idsToDelete) }).catch((error) => {
      console.warn("ContextLens remote delete skipped", error);
    });
  }

  function retryCaptureById(id: string) {
    setCaptures((current) => {
      const next = current.map((capture) => (
        capture.id === id ? { ...capture, status: "pending" as const, errorMessage: undefined } : capture
      ));
      chrome.storage.local.set({ captures: next });
      return next;
    });

    sendRuntimeMessage<{ captureId: string; explanation: string }>({ type: "RETRY_CAPTURE", captureId: id }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error || "Retry failed.");
      setCaptures((current) => {
        const next = current.map((capture) => (
          capture.id === id ? { ...capture, status: "error" as const, errorMessage: message } : capture
        ));
        chrome.storage.local.set({ captures: next });
        return next;
      });
    });
  }

  function reviewFlashcard(word: WordEntry, rating: FsrsRating) {
    const ids = new Set(word.captureIds);
    const now = new Date();
    setCaptures((current) => {
      const next = current.map((capture) => (
        ids.has(capture.id) ? applyFsrsReview(capture, rating, now) : capture
      ));
      chrome.storage.local.set({ captures: next });
      return next;
    });

    void sendRuntimeMessage<{ captures: Capture[] }>({ type: "REVIEW_FLASHCARDS", ids: word.captureIds, rating })
      .then((response) => {
        const reviewed = response.captures ?? [];
        if (reviewed.length === 0) return;
        const reviewedById = new Map(reviewed.map((capture) => [capture.id, capture]));
        setCaptures((current) => {
          const next = current.map((capture) => reviewedById.get(capture.id) ?? capture);
          chrome.storage.local.set({ captures: next });
          return next;
        });
      })
      .catch((error) => {
        console.warn("ContextLens flashcard review sync skipped", error);
      });
  }

  function clearTodayCaptures() {
    if (todayCaptures.length === 0) return;
    if (todayCaptures.length > 5) {
      const confirmed = window.confirm(`Delete ${todayCaptures.length} saves from today? This can't be undone.`);
      if (!confirmed) return;
    }
    deleteCapturesByIds(todayCaptures.map((capture) => capture.id));
  }

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, color: colors.text }}>
      <div style={{ borderBottom: `1px solid ${colors.border}`, background: colors.bg }}>
        <div style={{ maxWidth: contentMaxWidth, margin: "0 auto", padding: "4px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 60 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button
              onClick={() => navigateView("saves")}
              style={{ background: "none", border: "none", padding: 0, fontSize: 15, fontWeight: 600, color: colors.text, cursor: "pointer" }}
            >
              ContextLens
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 22 }}>
            {streak > 0 && (
              <div
                style={{ position: "relative", display: "inline-flex" }}
                onMouseEnter={() => setStreakTooltipVisible(true)}
                onMouseLeave={() => setStreakTooltipVisible(false)}
                onFocus={() => setStreakTooltipVisible(true)}
                onBlur={() => setStreakTooltipVisible(false)}
              >
                <button
                  onClick={() => navigateView("saves")}
                  aria-label={`${streak} day streak`}
                  style={{ background: "none", border: "none", padding: "2px 4px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                >
                  <span style={{ fontSize: 16 }}>🔥</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>{streak}</span>
                </button>
                {streakTooltipVisible && (
                  <div
                    role="tooltip"
                    style={{
                      position: "absolute",
                      top: "calc(100% + 8px)",
                      left: "50%",
                      transform: "translateX(-50%)",
                      zIndex: 20,
                      background: colors.surfaceAlt,
                      color: colors.text,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 6,
                      boxShadow: "0 10px 24px rgba(15,15,15,0.14)",
                      padding: "6px 9px",
                      fontSize: 12,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      pointerEvents: "none",
                    }}
                  >
                    {streak} day streak
                  </div>
                )}
              </div>
            )}
            <nav style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {(["saves", "history", "words", "settings"] as View[]).map((v) => (
                <button
                  key={v}
                  onClick={() => navigateView(v)}
                  onMouseEnter={() => setHoveredNavView(v)}
                  onMouseLeave={() => setHoveredNavView((current) => current === v ? null : current)}
                  style={{
                    minHeight: 40,
                    minWidth: v === "words" ? 92 : 64,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: hoveredNavView === v && view !== v ? colors.subtle : "transparent",
                    border: "none",
                    borderRadius: 8,
                    color: view === v ? colors.text : colors.muted,
                    fontWeight: view === v ? 600 : 400,
                    fontSize: 14,
                    cursor: "pointer",
                    padding: "0 10px",
                    textTransform: "capitalize",
                    transition: "background 120ms ease, color 120ms ease, border-color 120ms ease",
                  }}
                >
                  {v === "saves" ? "Today" : v === "words" ? "Flashcards" : v}
                </button>
              ))}
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                title={theme === "dark" ? "Light mode" : "Dark mode"}
                style={{
                  width: 32,
                  height: 32,
                  marginLeft: 10,
                  borderRadius: 999,
                  border: `1px solid ${colors.border}`,
                  background: colors.surface,
                  color: colors.text,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 15,
                  cursor: "pointer",
                  boxShadow: theme === "dark" ? "0 0 0 1px rgba(255,255,255,0.02)" : "0 1px 2px rgba(15,15,15,0.05)",
                }}
              >
                {theme === "dark" ? "☀" : "☾"}
              </button>
            </nav>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: contentMaxWidth, margin: "0 auto", padding: contentPadding }}>
        {view === "saves" && (
          <SavesView
            captures={todayCaptures}
            onDeleteCaptures={deleteCapturesByIds}
            onRetryCapture={retryCaptureById}
            headerAction={
              todayCaptures.length > 0 ? (
                <button
                  type="button"
                  onClick={clearTodayCaptures}
                  title="Clear today's saves"
                  style={{
                    background: colors.surface,
                    color: colors.muted,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 7,
                    padding: "6px 10px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Clear all
                </button>
              ) : null
            }
            colors={colors}
            cardFontSize={cardFontSize}
          />
        )}
        {view === "history" && (
          <HistoryView
            captures={captures}
            onDeleteCaptures={deleteCapturesByIds}
            onRetryCapture={retryCaptureById}
            colors={colors}
            theme={theme}
            accentColor={accentColor}
            cardFontSize={cardFontSize}
          />
        )}
        {view === "words" && <WordsView captures={captures} onReviewFlashcard={reviewFlashcard} colors={colors} theme={theme} accentColor={accentColor} cardFontSize={cardFontSize} />}
        {view === "settings" && (
          <SettingsView
            account={account}
            onAccountChange={setAccount}
            appMode={appMode}
            onAppModeChange={setMode}
            cardFontSize={cardFontSize}
            onCardFontSizeChange={setCardFontSize}
            accentColor={accentColor}
            onAccentColorChange={setAccentColor}
            theme={theme}
            colors={colors}
          />
        )}
      </div>
    </div>
  );
}
