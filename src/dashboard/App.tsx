import React, { useEffect, useState } from "react";
import type { Capture, ContextLensUser, FlashcardSet, Message } from "../types";

type View = "saves" | "history" | "words" | "settings";
type ThemeName = "light" | "dark";
type AppMode = "language_learning" | "student";
type SaveTriggers = { bubble: boolean; contextMenu: boolean };
type ScreenshotTriggers = { floatingButton: boolean; shortcut: boolean; immediate: boolean };
type FlashcardRange = "pastDay" | "past3" | "pastWeek" | "pastMonth";
type CardFontSize = "default" | "large" | "extra_large";
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
  { value: "default", label: "Default", note: "Comfortable reading size." },
  { value: "large", label: "Large", note: "Bigger save text and answers." },
  { value: "extra_large", label: "Extra large", note: "Maximum readability." },
];
const CARD_TYPOGRAPHY: Record<CardFontSize, { source: number; context: number; answer: number; status: number; link: number }> = {
  default: { source: 21, context: 18, answer: 19, status: 16, link: 14 },
  large: { source: 24, context: 21, answer: 21, status: 18, link: 15 },
  extra_large: { source: 28, context: 24, answer: 24, status: 20, link: 16 },
};
const ARABIC_FONT_STACK = "'Noto Naskh Arabic', ui-serif, Georgia, serif";
const FLASHCARD_PROMPT_LIMIT = 260;
const FLASHCARD_EXPLANATION_LIMIT = 520;

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
  return value === "default" || value === "large" || value === "extra_large";
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
          width: "fit-content",
          maxWidth: "74ch",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          font: "inherit",
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
      style={{ ...baseStyle, width: "fit-content", maxWidth: "74ch" }}
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

function openChat(id: string) {
  window.location.assign(chrome.runtime.getURL("src/chat/chat.html") + `?id=${id}`);
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

function SelectSaveButton({ selected, onToggle, colors }: { selected: boolean; onToggle: (event: React.MouseEvent<HTMLButtonElement>) => void; colors: DashboardColors }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      aria-label={selected ? "Deselect save" : "Select save"}
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

function CapturePreview({ capture, colors, typography }: { capture: Capture; colors: DashboardColors; typography: typeof CARD_TYPOGRAPHY[CardFontSize] }) {
  const [hovered, setHovered] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { setImageFailed(false); }, [capture.imageData]);
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
    maxWidth: "74ch",
    padding: "2px 0",
    direction: rtl ? "rtl" : "ltr",
    textAlign: rtl ? "right" : "left",
    textDecoration: hovered ? "underline" : "none",
    textDecorationColor: colors.accent,
    textUnderlineOffset: 4,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    maxHeight: "8.1em",
    overflow: "hidden",
  };

  if (capture.imageData) {
    return (
      <figure
        style={{
          width: "min(620px, 100%)",
          margin: "0 0 18px",
          border: `1px solid ${hovered ? colors.accent : colors.border}`,
          borderRadius: 8,
          background: colors.surfaceAlt,
          padding: 8,
          boxSizing: "border-box",
          overflow: "hidden",
          cursor: "pointer",
          transition: "border-color 0.15s",
        }}
        onClick={(event) => openCaptureFromClick(event, capture.id)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
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
              borderRadius: 5,
              border: `1px dashed ${colors.border}`,
              background: colors.surface,
            }}
          >
            Screenshot preview unavailable
          </div>
        ) : (
          <img
            src={capture.imageData}
            alt="Saved screenshot"
            onError={() => setImageFailed(true)}
            style={{
              display: "block",
              width: "100%",
              maxHeight: 280,
              objectFit: "contain",
              borderRadius: 5,
              background: colors.surface,
            }}
          />
        )}
      </figure>
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
  colors,
  cardFontSize,
}: {
  captures: Capture[];
  onDeleteCaptures: (ids: string[]) => void;
  onRetryCapture: (id: string) => void;
  headerAction?: React.ReactNode;
  colors: DashboardColors;
  cardFontSize: CardFontSize;
}) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastRangeAnchorId, setLastRangeAnchorId] = useState<string | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [expandAll, setExpandAll] = useState(false);
  const typography = CARD_TYPOGRAPHY[cardFontSize];

  useEffect(() => {
    const visibleIds = new Set(captures.map((capture) => capture.id));
    setSelectedIds((current) => new Set([...current].filter((id) => visibleIds.has(id))));
    setLastRangeAnchorId((current) => current && visibleIds.has(current) ? current : null);
  }, [captures]);

  if (captures.length === 0) {
    return (
      <div style={{ paddingTop: 48, maxWidth: 620 }}>
        <p style={{ color: colors.text, fontSize: 20, fontWeight: 800, margin: "0 0 8px" }}>
          Nothing saved yet.
        </p>
        <p style={{ color: colors.muted, fontSize: 15, lineHeight: 1.65, margin: "0 0 18px" }}>
          Highlight text on any page, click Save, and ContextLens will keep the source, your question, and the explanation together as a card.
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
        </div>
        {headerAction}
      </div>
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
            {group.items.map((c) => (
              <div
                key={c.id}
                style={{
                  background: selectedIds.has(c.id) ? colors.accentSoft : colors.surface,
                  border: `1px solid ${selectedIds.has(c.id) ? colorWithAlpha(colors.accent, 0.45) : colors.border}`,
                  borderRadius: 10,
                  padding: "22px 24px",
                  maxWidth: "100%",
                  boxShadow: "0 2px 12px rgba(15,15,15,0.07)",
                }}
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
                      <div style={{ margin: "14px 0 0", maxWidth: "74ch" }}>
                        <p style={{ fontSize: 14, color: colors.muted, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", margin: "0 0 6px" }}>
                          Your question
                        </p>
                        <QuestionText
                          text={c.context}
                          color={colors.text}
                          fontSize={typography.source + 10}
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
                    {c.status === "done" && c.explanation && (
                      <div
                        style={{
                          fontSize: typography.answer,
                          color: colors.text,
                          margin: "16px 0 0",
                          lineHeight: 1.78,
                          maxHeight: expandAll ? undefined : "18em",
                          maxWidth: "74ch",
                          overflow: expandAll ? "visible" : "hidden",
                          overflowWrap: "break-word",
                        }}
                      >
                        {renderExplanation(c.explanation, colors)}
                      </div>
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
            ))}
          </div>
        </div>
      ))}
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
  const [visibleMonth, setVisibleMonth] = useState(currentMonthKey());
  const selectedCaptures = captures.filter((capture) => dayKey(capture.savedAt) === selectedDay);
  const wideLayout = windowWidth >= 1040;
  const [calendarVisible, setCalendarVisible] = useState(true);

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

  function selectedDaySubtitle() {
    return dateFromDayKey(selectedDay).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }

  function emptyDayMessage() {
    if (selectedDay === todayKey()) return "Nothing saved today.";
    return `Nothing saved on ${selectedDayLabel()}.`;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: wideLayout && calendarVisible ? "minmax(0, 1fr) 332px" : "1fr",
        gap: wideLayout ? 28 : 20,
        alignItems: "start",
        maxWidth: 1220,
        margin: "0 auto",
        minHeight: 520,
      }}
    >
      <div
        style={{
          minWidth: 0,
        }}
      >
        <div style={{ marginBottom: 18, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 24, color: colors.text, margin: 0, fontWeight: 800 }}>
              {selectedDayLabel()}
            </h2>
            <p style={{ fontSize: 14, color: colors.muted, margin: "5px 0 0", lineHeight: 1.45 }}>
              {selectedCaptures.length} {selectedCaptures.length === 1 ? "card" : "cards"} · {selectedDaySubtitle()}
            </p>
          </div>
          {wideLayout && (
            <button
              type="button"
              onClick={() => setCalendarVisible((v) => !v)}
              style={{ ...subtleButtonStyle(colors, 13), flexShrink: 0 }}
            >
              {calendarVisible ? "Hide calendar" : "Show calendar"}
            </button>
          )}
        </div>

        {!wideLayout && (
          <div
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              boxShadow: "0 2px 12px rgba(15,15,15,0.05)",
              display: "flex",
              justifyContent: "center",
              margin: "0 0 20px",
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
        )}

        {selectedCaptures.length > 0 ? (
          <SavesView
            captures={selectedCaptures}
            onDeleteCaptures={onDeleteCaptures}
            onRetryCapture={onRetryCapture}
            colors={colors}
            cardFontSize={cardFontSize}
          />
        ) : (
          <p style={{ color: colors.muted, fontSize: 15, paddingTop: 8 }}>
            {emptyDayMessage()}
          </p>
        )}
      </div>

      {wideLayout && calendarVisible && (
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            boxShadow: "0 2px 12px rgba(15,15,15,0.05)",
            display: "flex",
            justifyContent: "center",
            padding: "18px 16px",
            position: "sticky",
            top: 92,
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
  captureIds: string[];
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
      map.set(key, { id: key, count: 0, word, explanation: c.explanation ?? "", exampleText: c.imageData ? "" : c.text, imageData: c.imageData, captureIds: [] });
    }
    const entry = map.get(key)!;
    entry.count++;
    entry.captureIds.push(c.id);
    if (!entry.explanation && c.explanation) entry.explanation = c.explanation;
    if (!entry.imageData && c.imageData) entry.imageData = c.imageData;
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}

function FlashcardView({ words, onClose, colors }: { words: WordEntry[]; onClose: () => void; colors: DashboardColors }) {
  const [deck, setDeck] = useState(words);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [ratings, setRatings] = useState<Record<string, "known" | "learning">>({});

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
        rate("learning");
      } else if (event.key === "2" && flipped) {
        event.preventDefault();
        rate("known");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (deck.length === 0) return null;
  const card = deck[Math.min(index, deck.length - 1)];
  const knownCount = Object.values(ratings).filter((rating) => rating === "known").length;
  const learningCount = Object.values(ratings).filter((rating) => rating === "learning").length;
  const progress = Math.round(((index + (flipped ? 0.5 : 0)) / deck.length) * 100);

  function next() {
    setFlipped(false);
    setIndex((current) => (current + 1) % deck.length);
  }

  function prev() {
    setFlipped(false);
    setIndex((current) => (current - 1 + deck.length) % deck.length);
  }

  function rate(rating: "known" | "learning") {
    const currentCard = deck[index];
    setRatings((current) => ({ ...current, [currentCard.id]: rating }));
    if (rating === "learning" && deck.length > 1) {
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
          <span style={{ fontSize: 12, color: colors.muted }}>Space flips · arrows navigate · 1 learning · 2 known</span>
          <span style={{ fontSize: 12, color: colors.muted }}>{knownCount} known · {learningCount} still learning</span>
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
            <p style={{ fontSize: 28, fontWeight: 700, color: colors.text, margin: 0 }}>{card.word}</p>
            <p style={{ fontSize: 13, color: colors.muted, marginTop: 16 }}>Click or press Space to reveal</p>
          </>
        ) : (
          <>
            <p style={{ fontSize: 12, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 850, margin: "0 0 10px" }}>Answer</p>
            <div style={{ fontSize: 17, color: colors.text, lineHeight: 1.75, margin: 0, maxWidth: "72ch" }}>
              {renderMarkdown(card.explanation || "No explanation yet — save a highlight with this question to get one.")}
            </div>
            {card.imageData ? (
              <img
                src={card.imageData}
                alt="Saved screenshot"
                style={{ display: "block", width: "100%", maxHeight: 220, objectFit: "contain", borderRadius: 6, marginTop: 16, background: colors.subtle }}
              />
            ) : card.exampleText ? (
              <p style={{ fontSize: 13, color: colors.muted, marginTop: 16, lineHeight: 1.55, borderLeft: `3px solid ${colors.border}`, paddingLeft: 10 }}>
                "{card.exampleText.slice(0, 100)}{card.exampleText.length > 100 ? "…" : ""}"
              </p>
            ) : null}
          </>
        )}
      </div>

      {flipped && (
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 14, flexWrap: "wrap" }}>
          <button type="button" onClick={() => rate("learning")} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: "10px 18px", fontSize: 14, fontWeight: 850, cursor: "pointer", color: colors.text }}>
            Still learning
          </button>
          <button type="button" onClick={() => rate("known")} style={{ background: colors.accent, border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 14, fontWeight: 850, cursor: "pointer", color: colors.selectedText }}>
            Known
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
  | { kind: "set"; setId: string };

function uniqueCaptureIds(captures: Capture[]) {
  return Array.from(new Set(captures.map((capture) => capture.id)));
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
  colors,
  theme,
  accentColor,
  cardFontSize,
}: {
  captures: Capture[];
  colors: DashboardColors;
  theme: ThemeName;
  accentColor: string;
  cardFontSize: CardFontSize;
}) {
  const [studyWords, setStudyWords] = useState<WordEntry[] | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [source, setSource] = useState<FlashcardSource>({ kind: "days" });
  const [selectedDays, setSelectedDays] = useState<Set<string>>(() => new Set([todayKey()]));
  const [calendarMonth, setCalendarMonth] = useState(currentMonthKey());
  const [sets, setSets] = useState<FlashcardSet[]>([]);
  const [newSetName, setNewSetName] = useState("");
  const [showCreateSet, setShowCreateSet] = useState(false);
  const [showSets, setShowSets] = useState(false);
  const [calendarVisible, setCalendarVisible] = useState(true);
  const typography = CARD_TYPOGRAPHY[cardFontSize];

  useEffect(() => {
    chrome.storage.local.get("flashcard_sets", (result) => setSets(normalizeFlashcardSets(result.flashcard_sets)));
  }, []);

  const setById = new Map(sets.map((set) => [set.id, set]));
  const setRows = flashcardSetRows(sets);
  const activeSet = source.kind === "set" ? setById.get(source.setId) : undefined;
  const captureById = new Map(captures.map((capture) => [capture.id, capture]));
  const sourceCaptures = source.kind === "range"
    ? capturesForFlashcardRange(captures, source.range)
    : source.kind === "days"
      ? capturesForDays(captures, selectedDays)
      : (activeSet?.captureIds.map((id) => captureById.get(id)).filter((capture): capture is Capture => Boolean(capture)) ?? []);
  const words = buildFlashcardList(sourceCaptures);
  const sourceLabel = source.kind === "range"
    ? FLASHCARD_RANGES.find((range) => range.value === source.range)?.label ?? "Date range"
    : source.kind === "days"
      ? `${selectedDays.size} picked ${selectedDays.size === 1 ? "day" : "days"}`
      : activeSet?.name ?? "Saved set";
  const canCreateSet = Boolean(
    newSetName.trim()
      && sourceCaptures.length > 0,
  );

  function storeSets(next: FlashcardSet[]) {
    setSets(next);
    chrome.storage.local.set({ flashcard_sets: next });
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

  function openCreateSet() {
    setShowSets(false);
    setShowCreateSet(true);
  }

  function createSet() {
    const name = newSetName.trim();
    const captureIds = uniqueCaptureIds(sourceCaptures);
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
  }

  function deleteSet(id: string) {
    storeSets(sets
      .filter((set) => set.id !== id)
      .map((set) => {
        if (set.parentSetId !== id) return set;
        const { parentSetId: _parentSetId, ...independentSet } = set;
        return independentSet;
      }));
    if (source.kind === "set" && source.setId === id) setSource({ kind: "days" });
  }

  function exportButtons(exportWords: WordEntry[], label: string) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: colors.muted, fontWeight: 700 }}>{label}</span>
        <button
          type="button"
          disabled={exportWords.length === 0}
          onClick={() => exportFlashcards("anki", exportWords)}
          style={{ background: exportWords.length ? colors.accent : colors.border, color: exportWords.length ? colors.selectedText : colors.muted, border: "none", borderRadius: 7, padding: "7px 11px", fontSize: 12, fontWeight: 800, cursor: exportWords.length ? "pointer" : "default" }}
        >
          Anki
        </button>
        <button
          type="button"
          disabled={exportWords.length === 0}
          onClick={() => exportFlashcards("quizlet", exportWords)}
          style={{ background: colors.surface, color: exportWords.length ? colors.text : colors.muted, border: `1px solid ${colors.border}`, borderRadius: 7, padding: "7px 11px", fontSize: 12, fontWeight: 800, cursor: exportWords.length ? "pointer" : "default" }}
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

  function compactSetExportButtons(set: FlashcardSet, exportWords: WordEntry[]) {
    const disabled = exportWords.length === 0;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => exportFlashcards("anki", exportWords, set.name)}
          title={`Export ${set.name} to Anki`}
          style={{ background: disabled ? colors.border : colors.accent, color: disabled ? colors.muted : colors.selectedText, border: "none", borderRadius: 6, padding: "6px 8px", fontSize: 12, fontWeight: 850, cursor: disabled ? "default" : "pointer" }}
        >
          Anki
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => exportFlashcards("quizlet", exportWords, set.name)}
          title={`Export ${set.name} to Quizlet`}
          style={{ background: colors.surface, color: disabled ? colors.muted : colors.text, border: `1px solid ${colors.border}`, borderRadius: 6, padding: "6px 8px", fontSize: 12, fontWeight: 850, cursor: disabled ? "default" : "pointer" }}
        >
          Quizlet
        </button>
      </div>
    );
  }

  if (studyWords) return <FlashcardView words={studyWords} onClose={() => setStudyWords(null)} colors={colors} />;

  const sourcePanel = source.kind === "set" && activeSet ? (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: 14, background: colors.surface, display: "grid", gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 12, color: colors.muted, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", margin: "0 0 4px" }}>Selected set</p>
        <p style={{ fontSize: 17, color: colors.text, fontWeight: 850, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeSet.name}</p>
        <p style={{ fontSize: 12, color: colors.muted, margin: "3px 0 0" }}>{words.length} {words.length === 1 ? "card" : "cards"}</p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {exportButtons(words, "Current set")}
        <button type="button" onClick={() => setSource({ kind: "days" })} style={{ background: colors.surfaceAlt, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 7, padding: "8px 13px", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
          Pick days
        </button>
      </div>
    </div>
  ) : (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, boxShadow: "0 2px 12px rgba(15,15,15,0.05)", display: "flex", justifyContent: "center", padding: "18px 16px" }}>
      <FlashcardDayCalendar captures={captures} selectedDays={selectedDays} visibleMonth={calendarMonth} onVisibleMonthChange={setCalendarMonth} onToggleDay={toggleDay} colors={colors} theme={theme} accentColor={accentColor} />
    </div>
  );

  const cards = words.length === 0 ? (
    <p style={{ color: colors.muted, fontSize: 15, lineHeight: 1.6, margin: 0 }}>
      No cards · {sourceLabel}. {source.kind === "set" ? "Choose another set." : "Pick days from the selector."}
    </p>
  ) : (
    <div>
      {words.map((word) => {
        const promptPreview = previewText(word.word, FLASHCARD_PROMPT_LIMIT);
        const explanationPreview = word.explanation ? previewText(word.explanation, FLASHCARD_EXPLANATION_LIMIT) : "";
        return (
          <div
            key={word.id}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              padding: "22px 24px",
              marginBottom: 14,
              boxShadow: "0 2px 12px rgba(15,15,15,0.07)",
            }}
          >
            {word.imageData ? (
              <img
                src={word.imageData}
                alt="Saved screenshot"
                style={{ display: "block", width: "100%", maxHeight: 220, objectFit: "contain", borderRadius: 6, background: colors.surfaceAlt, marginBottom: explanationPreview ? 12 : 0 }}
              />
            ) : (
              <p
                style={{
                  color: colors.text,
                  fontSize: typography.context,
                  fontWeight: 600,
                  lineHeight: 1.6,
                  margin: 0,
                  maxHeight: "8.1em",
                  overflow: "hidden",
                  overflowWrap: "break-word",
                  textAlign: "left",
                }}
              >
                {inlineParts(promptPreview)}
              </p>
            )}
            {explanationPreview && (
              <div style={{ fontSize: typography.answer, color: colors.softText, margin: word.imageData ? 0 : "12px 0 0", lineHeight: 1.78, maxHeight: "7em", overflow: "hidden", overflowWrap: "break-word" }}>
                {renderMarkdown(explanationPreview)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 22, color: colors.text, margin: "0 0 6px", fontWeight: 700 }}>Flashcards</h2>
          <p style={{ fontSize: 13, color: colors.muted, margin: 0 }}>
            {words.length} {words.length === 1 ? "card" : "cards"} · {sourceLabel}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" onClick={() => setCalendarVisible((v) => !v)} style={{ ...subtleButtonStyle(colors, 13) }}>
            {calendarVisible ? "Hide calendar" : "Show calendar"}
          </button>
          <button type="button" onClick={openCreateSet} style={{ background: showCreateSet ? colors.accent : colors.surface, color: showCreateSet ? colors.selectedText : colors.text, border: `1px solid ${showCreateSet ? colors.accent : colors.border}`, borderRadius: 7, padding: "8px 14px", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
            Create set
          </button>
          <button type="button" onClick={() => { setShowCreateSet(false); setShowSets(true); }} style={{ background: showSets ? colors.accent : colors.surface, color: showSets ? colors.selectedText : colors.text, border: `1px solid ${showSets ? colors.accent : colors.border}`, borderRadius: 7, padding: "8px 14px", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
            Sets
          </button>
          <button type="button" onClick={() => setShowExport((open) => !open)} style={{ background: showExport ? colors.accent : colors.surface, color: showExport ? colors.selectedText : colors.text, border: `1px solid ${showExport ? colors.accent : colors.border}`, borderRadius: 7, padding: "8px 14px", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
            Export
          </button>
          <button type="button" disabled={words.length === 0} onClick={() => setStudyWords(words)} style={{ background: words.length ? colors.accent : colors.border, color: words.length ? colors.selectedText : colors.muted, border: "none", borderRadius: 7, padding: "8px 14px", fontSize: 13, fontWeight: 800, cursor: words.length ? "pointer" : "default" }}>
            Study
          </button>
        </div>
      </div>

      {showCreateSet && (
        <FlashcardPopup title="Create set" onClose={() => setShowCreateSet(false)} colors={colors}>
          <p style={{ fontSize: 13, color: colors.muted, lineHeight: 1.5, margin: "0 0 14px" }}>
            Save {words.length} {words.length === 1 ? "card" : "cards"} · {sourceLabel}.
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

      {showSets && (
        <FlashcardPopup title="Sets" onClose={() => setShowSets(false)} colors={colors} width={680}>
          {sets.length === 0 ? (
            <p style={{ color: colors.muted, fontSize: 14, margin: 0 }}>No saved sets yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {setRows.map(({ set, depth }) => {
                const selected = source.kind === "set" && source.setId === set.id;
                const count = set.captureIds.filter((id) => captureById.has(id)).length;
                const parent = set.parentSetId ? setById.get(set.parentSetId) : undefined;
                const exportWords = setFlashcards(set);
                return (
                  <div key={set.id} style={{ marginLeft: depth * 18, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto", gap: 8, alignItems: "center", border: `1px solid ${selected ? colors.accent : colors.border}`, background: selected ? colors.accentSoft : colors.surfaceAlt, borderRadius: 8, padding: "9px 10px" }}>
                    <button type="button" onClick={() => { setSource({ kind: "set", setId: set.id }); setShowSets(false); }} style={{ flex: 1, minWidth: 0, background: "none", border: "none", color: colors.text, padding: 0, textAlign: "left", cursor: "pointer" }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{set.name}</span>
                      <span style={{ display: "block", fontSize: 12, color: colors.muted, marginTop: 2 }}>
                        {count} {count === 1 ? "card" : "cards"}{parent ? ` · within ${parent.name}` : ""}
                      </span>
                    </button>
                    {compactSetExportButtons(set, exportWords)}
                    <button type="button" onClick={() => deleteSet(set.id)} title="Delete set" style={{ background: colors.surface, color: colors.muted, border: `1px solid ${colors.border}`, borderRadius: 6, width: 28, height: 28, cursor: "pointer", padding: 0, fontWeight: 900 }}>x</button>
                  </div>
                );
              })}
            </div>
          )}
        </FlashcardPopup>
      )}

      <div style={{ display: "flex", alignItems: "flex-start", gap: 32, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 620px", minWidth: 0 }}>
          {showExport && (
            <div style={{ border: `1px solid ${colors.border}`, background: colors.surface, borderRadius: 8, padding: 14, marginBottom: 16, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <p style={{ fontSize: 13, color: colors.text, margin: 0 }}>
                Export {words.length} {words.length === 1 ? "card" : "cards"} · {sourceLabel}.
              </p>
              {exportButtons(words, "Current selection")}
            </div>
          )}
          {cards}
        </div>
        {calendarVisible && (
          <aside style={{ flex: "0 0 332px", width: 332, maxWidth: "100%", position: "sticky", top: 92 }}>
            {sourcePanel}
          </aside>
        )}
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

      {/* Save triggers */}
      <p style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>Save trigger</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 40 }}>
        {([
          { field: "bubble" as const, label: "Show Save button on highlight", desc: "A small button appears over your selection — click it to save." },
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
        <p style={{ fontSize: 14, color: colors.text, margin: "0 0 4px" }}>Today and History cards</p>
        <p style={{ fontSize: 12, color: colors.muted, margin: "0 0 8px", lineHeight: 1.5 }}>
          Increase the saved text and answer size in Today and History.
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
      <p style={{ fontSize: 13, color: colors.muted, marginTop: 40, marginBottom: 12 }}>Default mode</p>
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

      {/* Theme */}
      <p style={{ fontSize: 13, color: colors.muted, marginTop: 40, marginBottom: 12 }}>Appearance</p>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
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
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 16 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 12, color: colors.text, fontSize: 14 }}>
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
                background: isFuture ? colors.surfaceAlt : colorFor(count),
                color: textFor(count, isFuture),
                fontSize: 12,
                fontWeight: isSelected ? 700 : 600,
                cursor: isFuture ? "default" : "pointer",
                padding: 0,
                boxShadow: isSelected ? `0 0 0 2px ${colorWithAlpha(accentColor, theme === "dark" ? 0.22 : 0.14)}` : "none",
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
    <div style={{ width: 300, maxWidth: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 13 }}>
        <button type="button" onClick={() => onVisibleMonthChange(previousMonth)} aria-label="Previous flashcard month" style={{ width: 28, height: 28, borderRadius: 999, border: `1px solid ${colors.border}`, background: colors.surface, color: colors.text, cursor: "pointer", fontSize: 16 }}>‹</button>
        <p style={{ fontSize: 14, color: colors.text, margin: 0, fontWeight: 800 }}>{monthLabelFromKey(visibleMonth)}</p>
        <button type="button" onClick={() => canGoNext && onVisibleMonthChange(nextMonth)} disabled={!canGoNext} aria-label="Next flashcard month" style={{ width: 28, height: 28, borderRadius: 999, border: `1px solid ${colors.border}`, background: canGoNext ? colors.surface : colors.surfaceAlt, color: canGoNext ? colors.text : colors.muted, cursor: canGoNext ? "pointer" : "default", fontSize: 16 }}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 34px)", gap: 7, marginBottom: 8 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => <span key={`${label}-${index}`} style={{ fontSize: 11, color: colors.muted, fontWeight: 800, textAlign: "center" }}>{label}</span>)}
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
                background: future ? colors.surfaceAlt : colorFor(count),
                boxShadow: selected ? `0 0 0 2px ${colorWithAlpha(accentColor, theme === "dark" ? 0.22 : 0.14)}` : "none",
                color: future ? colors.muted : count > 0 ? (theme === "dark" ? "#f0ede6" : "#1a1916") : colors.muted,
                cursor: future ? "default" : "pointer",
                fontSize: 12,
                fontWeight: selected ? 700 : 600,
                padding: 0,
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
  const [theme, setThemeState] = useState<ThemeName>(() => storedThemeFallback("dark"));
  const [accentColor, setAccentColorState] = useState(DEFAULT_ACCENT_COLOR);
  const [cardFontSize, setCardFontSizeState] = useState<CardFontSize>(DEFAULT_CARD_FONT_SIZE);
  const [streakTooltipVisible, setStreakTooltipVisible] = useState(false);

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
  const contentMaxWidth = view === "history" || view === "words" ? 1280 : 1100;
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
      const next = normalizeFlashcardSets(result.flashcard_sets)
        .map((set) => ({ ...set, captureIds: set.captureIds.filter((id) => !idsToDelete.has(id)) }))
        .filter((set) => set.captureIds.length > 0);
      chrome.storage.local.set({ flashcard_sets: normalizeFlashcardSets(next) });
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
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "8px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 72 }}>
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
            <nav style={{ display: "flex", gap: 16, alignItems: "center" }}>
              {(["saves", "history", "words", "settings"] as View[]).map((v) => (
                <button
                  key={v}
                  onClick={() => navigateView(v)}
                  style={{
                    background: "none",
                    border: "none",
                    borderBottom: view === v ? `2px solid ${colors.text}` : "2px solid transparent",
                    color: view === v ? colors.text : colors.muted,
                    fontWeight: view === v ? 600 : 400,
                    fontSize: 14,
                    cursor: "pointer",
                    padding: "4px 0",
                    textTransform: "capitalize",
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
        {view === "words" && <WordsView captures={captures} colors={colors} theme={theme} accentColor={accentColor} cardFontSize={cardFontSize} />}
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
