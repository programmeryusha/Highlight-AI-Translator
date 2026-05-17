import React, { useEffect, useState } from "react";
import type { Capture, ContextLensUser, Message } from "../types";

type View = "saves" | "history" | "words" | "settings";
type ThemeName = "light" | "dark";
type AppMode = "language_learning" | "student";
type SaveTriggers = { bubble: boolean; contextMenu: boolean };
type ScreenshotTriggers = { floatingButton: boolean; shortcut: boolean; immediate: boolean };
type FlashcardExportRange = "yesterday" | "previous3" | "lastWeek" | "lastMonth" | "custom";
const LONG_TEXT_LIMIT = 420;
const DEFAULT_FLASHCARD_THRESHOLD = 3;
const DEFAULT_ACCENT_COLOR = "#2563eb";
const FLASHCARD_EXPORT_RANGES: { value: FlashcardExportRange; label: string }[] = [
  { value: "yesterday", label: "Yesterday" },
  { value: "previous3", label: "Previous 3 days" },
  { value: "lastWeek", label: "Last week" },
  { value: "lastMonth", label: "Last month" },
  { value: "custom", label: "Custom" },
];

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
};

function isThemeName(value: unknown): value is ThemeName {
  return value === "light" || value === "dark";
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

function colorsForTheme(theme: ThemeName, accentColor: string): DashboardColors {
  const dark = theme === "dark";
  return {
    bg: dark ? "#171717" : "#fff",
    text: dark ? "#f4f1ea" : "#37352f",
    muted: dark ? "#a8a29e" : "#9b9a97",
    softText: dark ? "#d6d3cd" : "#6b6b6b",
    border: dark ? "#34312c" : "#e3e2de",
    subtle: dark ? "#24221f" : "#f0efec",
    surface: dark ? "#1d1b18" : "#fff",
    surfaceAlt: dark ? "#27241f" : "#f7f6f3",
    selectedText: textOnColor(accentColor),
    accent: accentColor,
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

function downloadTextFile(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDaysToDate(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function capturesForExportRange(captures: Capture[], range: FlashcardExportRange, customStartKey?: string, customEndKey?: string): Capture[] {
  const now = new Date();
  const todayStart = startOfLocalDay(now);
  let start: Date;
  let end: Date;

  if (range === "yesterday") {
    start = addDaysToDate(todayStart, -1);
    end = todayStart;
  } else if (range === "previous3") {
    start = addDaysToDate(todayStart, -3);
    end = todayStart;
  } else if (range === "lastWeek") {
    start = addDaysToDate(todayStart, -6);
    end = now;
  } else if (range === "lastMonth") {
    start = addDaysToDate(todayStart, -29);
    end = now;
  } else {
    start = customStartKey ? dateFromDayKey(customStartKey) : addDaysToDate(todayStart, -29);
    end = customEndKey ? addDaysToDate(dateFromDayKey(customEndKey), 1) : now;
  }

  return captures.filter((capture) => {
    const savedAt = new Date(capture.savedAt);
    return savedAt >= start && savedAt < end;
  });
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
  chrome.tabs.create({ url: chrome.runtime.getURL("src/chat/chat.html") + `?id=${id}` });
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

function FlashcardStarButton({ capture, starred, onToggle }: { capture: Capture; starred: boolean; onToggle: (id: string) => void }) {
  if (!capture.context.trim()) return null;

  return (
    <button
      type="button"
      aria-label={starred ? "Remove from flashcards" : "Add to flashcards"}
      title={starred ? "Remove from flashcards" : "Add to flashcards"}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle(capture.id);
      }}
      style={{
        width: 30,
        height: 30,
        borderRadius: 999,
        border: "1px solid #e3e2de",
        background: starred ? "#37352f" : "#fff",
        color: starred ? "#fff" : "#9b9a97",
        cursor: "pointer",
        fontSize: 15,
        lineHeight: "28px",
        textAlign: "center",
        flexShrink: 0,
      }}
    >
      {starred ? "★" : "☆"}
    </button>
  );
}

function SelectSaveButton({ selected, onToggle }: { selected: boolean; onToggle: () => void }) {
  const accent = `var(--contextlens-accent, ${DEFAULT_ACCENT_COLOR})`;
  return (
    <button
      type="button"
      aria-label={selected ? "Deselect save" : "Select save"}
      title={selected ? "Deselect save" : "Select save"}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      style={{
        width: 22,
        height: 22,
        borderRadius: 6,
        border: selected ? `1px solid ${accent}` : "1px solid #d8d7d2",
        background: selected ? accent : "#fff",
        color: "#fff",
        cursor: "pointer",
        fontSize: 14,
        lineHeight: "20px",
        fontWeight: 800,
        flexShrink: 0,
        marginTop: 6,
        padding: 0,
      }}
    >
      {selected ? "✓" : ""}
    </button>
  );
}

function DeleteSaveButton({ onDelete }: { onDelete: () => void }) {
  return (
    <button
      type="button"
      aria-label="Delete save"
      title="Delete save"
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDelete();
      }}
      style={{
        width: 30,
        height: 30,
        borderRadius: 999,
        border: "1px solid #e3e2de",
        background: "#fff",
        color: "#9b9a97",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <TrashIcon />
    </button>
  );
}

function CapturePreview({ capture }: { capture: Capture }) {
  if (capture.imageData) {
    return (
      <img
        src={capture.imageData}
        alt="screenshot"
        onClick={(event) => openCaptureFromClick(event, capture.id)}
        style={{ maxWidth: "100%", maxHeight: 240, borderRadius: 6, marginBottom: 4, display: "block", cursor: "pointer" }}
      />
    );
  }

  const isLong = capture.text.length > LONG_TEXT_LIMIT;
  const text = isLong ? `${capture.text.slice(0, LONG_TEXT_LIMIT).trim()}…` : capture.text;

  return (
    <>
      <p
        onClick={(event) => openCaptureFromClick(event, capture.id)}
        style={{ fontSize: 21, fontWeight: 650, color: "#2f2e2b", lineHeight: 1.6, margin: 0, cursor: "pointer" }}
      >
        {text}
      </p>
      {isLong && (
        <p
          onClick={(event) => openCaptureFromClick(event, capture.id)}
          style={{ fontSize: 14, color: `var(--contextlens-accent, ${DEFAULT_ACCENT_COLOR})`, margin: "7px 0 0", fontWeight: 700, cursor: "pointer", width: "fit-content" }}
        >
          Open full save
        </p>
      )}
    </>
  );
}

function SavesView({
  captures,
  starredCaptureIds,
  onToggleStar,
  onDeleteCaptures,
  headerAction,
}: {
  captures: Capture[];
  starredCaptureIds: Set<string>;
  onToggleStar: (id: string) => void;
  onDeleteCaptures: (ids: string[]) => void;
  headerAction?: React.ReactNode;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const visibleIds = new Set(captures.map((capture) => capture.id));
    setSelectedIds((current) => new Set([...current].filter((id) => visibleIds.has(id))));
  }, [captures]);

  if (captures.length === 0) {
    return (
      <p style={{ color: "#9b9a97", fontSize: 15, paddingTop: 48 }}>
        Nothing saved yet. Highlight any text on the web to save it here.
      </p>
    );
  }

  const groups = groupByDay(captures);
  const selectedCount = selectedIds.size;

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function deleteSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    onDeleteCaptures(ids);
    setSelectedIds(new Set());
  }

  return (
    <div>
      {selectedCount > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            border: "1px solid #e3e2de",
            borderRadius: 8,
            padding: "10px 12px",
            marginBottom: 22,
          }}
        >
          <span style={{ fontSize: 13, color: "#37352f", fontWeight: 700 }}>
            {selectedCount} selected
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={deleteSelected}
              style={{ background: "#37352f", color: "#fff", border: "none", borderRadius: 7, padding: "7px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
            >
              Delete selected
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              style={{ background: "#fff", color: "#8d8b86", border: "1px solid #d8d7d2", borderRadius: 7, padding: "7px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {groups.map((group) => (
        <div key={group.label} style={{ marginBottom: 40 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "#9b9a97", textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
              {group.label}
            </p>
            {headerAction}
          </div>
          <div>
            {group.items.map((c) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={(event) => openCaptureFromClick(event, c.id)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  openChat(c.id);
                }}
                style={{ padding: "18px 0 28px", maxWidth: "100%", cursor: "pointer", outline: "none" }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <SelectSaveButton selected={selectedIds.has(c.id)} onToggle={() => toggleSelected(c.id)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <CapturePreview capture={c} />
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                    <FlashcardStarButton capture={c} starred={starredCaptureIds.has(c.id)} onToggle={onToggleStar} />
                    <DeleteSaveButton onDelete={() => onDeleteCaptures([c.id])} />
                  </div>
                </div>

                {c.context && (
                  <div style={{ borderLeft: "3px solid #d8d7d2", paddingLeft: 12, margin: "10px 0 0 34px" }}>
                    <p style={{ fontSize: 12, color: "#8d8b86", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", margin: "0 0 4px" }}>
                      Your question
                    </p>
                    <p style={{ fontSize: 18, color: "#37352f", lineHeight: 1.55, margin: 0, fontWeight: 650 }}>
                      {c.context}
                    </p>
                  </div>
                )}

                {c.status === "pending" && (
                  <p style={{ fontSize: 16, color: "#8d8b86", margin: "10px 0 0 34px", fontStyle: "italic" }}>
                    thinking…
                  </p>
                )}
                {c.status === "error" && (
                  <p style={{ fontSize: 16, color: "#eb5757", margin: "10px 0 0 34px", lineHeight: 1.6 }}>
                    something went wrong — {c.errorMessage ?? "try again"}
                  </p>
                )}
                {c.status === "done" && c.explanation && (
                  <div style={{ fontSize: 19, color: "#4f4d49", margin: "14px 0 0 34px", lineHeight: 1.75 }}>
                    {renderMarkdown(c.explanation)}
                  </div>
                )}
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
  starredCaptureIds,
  onToggleStar,
  onDeleteCaptures,
  colors,
  theme,
  accentColor,
}: {
  captures: Capture[];
  starredCaptureIds: Set<string>;
  onToggleStar: (id: string) => void;
  onDeleteCaptures: (ids: string[]) => void;
  colors: DashboardColors;
  theme: ThemeName;
  accentColor: string;
}) {
  const windowWidth = useWindowWidth();
  const [selectedDay, setSelectedDay] = useState(todayKey());
  const [visibleMonth, setVisibleMonth] = useState(currentMonthKey());
  const selectedCaptures = captures.filter((capture) => dayKey(capture.savedAt) === selectedDay);
  const previousDay = addDays(selectedDay, -1);
  const nextDay = addDays(selectedDay, 1);
  const canGoNext = nextDay <= todayKey();
  const dockCalendar = windowWidth >= 1600;
  const calendarGap = 92;
  const calendarWidth = 300;

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

  function emptyDayMessage() {
    if (selectedDay === todayKey()) return "Nothing saved today.";
    return `Nothing saved on ${selectedDayLabel()}.`;
  }

  return (
    <div style={{ position: "relative", minHeight: 520 }}>
      <div
        style={{
          maxWidth: dockCalendar ? `calc(100% - ${calendarWidth + calendarGap}px)` : 980,
          margin: dockCalendar ? `0 ${calendarWidth + calendarGap}px 0 0` : "0 auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18, marginBottom: 28 }}>
          <button
            onClick={() => selectDay(previousDay)}
            aria-label="Previous day"
            style={{
              width: 34,
              height: 34,
              borderRadius: 999,
              border: "1px solid #e3e2de",
              background: "#fff",
              color: "#37352f",
              cursor: "pointer",
              fontSize: 18,
            }}
          >
            ‹
          </button>
          <div style={{ minWidth: 220, textAlign: "center" }}>
            <h2 style={{ fontSize: 22, color: "#37352f", margin: 0, fontWeight: 700 }}>
              {selectedDayLabel()}
            </h2>
            <p style={{ fontSize: 13, color: "#9b9a97", margin: "5px 0 0" }}>
              {selectedCaptures.length} {selectedCaptures.length === 1 ? "save" : "saves"}
            </p>
          </div>
          <button
            onClick={() => canGoNext && selectDay(nextDay)}
            disabled={!canGoNext}
            aria-label="Next day"
            style={{
              width: 34,
              height: 34,
              borderRadius: 999,
              border: "1px solid #e3e2de",
              background: canGoNext ? "#fff" : "#f7f6f3",
              color: canGoNext ? "#37352f" : "#c7c6c3",
              cursor: canGoNext ? "pointer" : "default",
              fontSize: 18,
            }}
          >
            ›
          </button>
        </div>

        {selectedCaptures.length > 0 ? (
          <SavesView
            captures={selectedCaptures}
            starredCaptureIds={starredCaptureIds}
            onToggleStar={onToggleStar}
            onDeleteCaptures={onDeleteCaptures}
          />
        ) : (
          <p style={{ color: "#9b9a97", fontSize: 15, paddingTop: 8, textAlign: "center" }}>
            {emptyDayMessage()}
          </p>
        )}
      </div>

      <div
        style={{
          position: dockCalendar ? "absolute" : "static",
          top: dockCalendar ? 0 : undefined,
          right: dockCalendar ? 0 : undefined,
          width: calendarWidth,
          margin: dockCalendar ? undefined : "36px auto 0",
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
    </div>
  );
}

interface WordEntry {
  word: string;
  count: number;
  explanation: string;
  exampleText: string;
  starred: boolean;
}

function buildFlashcardList(
  captures: Capture[],
  threshold = DEFAULT_FLASHCARD_THRESHOLD,
  starredCaptureIds = new Set<string>(),
  monthKey: string | null = currentMonthKey(),
): WordEntry[] {
  const map = new Map<string, { count: number; word: string; explanation: string; exampleText: string; starred: boolean }>();
  for (const c of captures) {
    const isStarred = starredCaptureIds.has(c.id);
    const isInScope = monthKey === null || monthKeyFromDate(new Date(c.savedAt)) === monthKey;
    if (!isInScope && !isStarred) continue;

    const question = c.context?.trim();
    if (!question) continue;

    const key = normalizeQuestion(question);
    if (!map.has(key)) {
      map.set(key, { count: 0, word: question, explanation: c.explanation ?? "", exampleText: c.text, starred: false });
    }
    const entry = map.get(key)!;
    entry.count++;
    if (!entry.explanation && c.explanation) entry.explanation = c.explanation;
    if (isStarred) entry.starred = true;
  }
  return Array.from(map.values())
    .filter((entry) => entry.starred || entry.count >= threshold)
    .sort((a, b) => Number(b.starred) - Number(a.starred) || b.count - a.count || a.word.localeCompare(b.word));
}

function FlashcardView({ words, onClose }: { words: WordEntry[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  if (words.length === 0) return null;
  const card = words[index];

  function next() { setFlipped(false); setTimeout(() => setIndex((i) => (i + 1) % words.length), 150); }
  function prev() { setFlipped(false); setTimeout(() => setIndex((i) => (i - 1 + words.length) % words.length), 150); }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", paddingTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#9b9a97", fontSize: 14, cursor: "pointer" }}>
          ← Back to flashcards
        </button>
        <span style={{ fontSize: 13, color: "#9b9a97" }}>{index + 1} / {words.length}</span>
      </div>

      {/* Card */}
      <div
        onClick={() => setFlipped((f) => !f)}
        style={{
          minHeight: 220,
          background: flipped ? "#f7f6f3" : "#fff",
          border: "1px solid #e3e2de",
          borderRadius: 12,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 48px",
          cursor: "pointer",
          transition: "background 0.2s",
          textAlign: "center",
          marginBottom: 24,
        }}
      >
        {!flipped ? (
          <>
            <p style={{ fontSize: 28, fontWeight: 700, color: "#37352f", margin: 0 }}>{card.word}</p>
            <p style={{ fontSize: 13, color: "#9b9a97", marginTop: 16 }}>Click to reveal</p>
          </>
        ) : (
          <>
            <div style={{ fontSize: 16, color: "#37352f", lineHeight: 1.7, margin: 0 }}>
              {renderMarkdown(card.explanation || "No explanation yet — save a highlight with this question to get one.")}
            </div>
            {card.exampleText && (
              <p style={{ fontSize: 13, color: "#9b9a97", marginTop: 16, fontStyle: "italic" }}>
                "{card.exampleText.slice(0, 100)}{card.exampleText.length > 100 ? "…" : ""}"
              </p>
            )}
          </>
        )}
      </div>

      {/* Nav */}
      <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
        <button onClick={prev} style={{ background: "#f7f6f3", border: "1px solid #e3e2de", borderRadius: 8, padding: "10px 28px", fontSize: 14, cursor: "pointer", color: "#37352f" }}>
          ← Prev
        </button>
        <button onClick={next} style={{ background: "#37352f", border: "none", borderRadius: 8, padding: "10px 28px", fontSize: 14, cursor: "pointer", color: "#fff" }}>
          Next →
        </button>
      </div>
    </div>
  );
}

function WordsView({ captures, flashcardThreshold, starredCaptureIds }: { captures: Capture[]; flashcardThreshold: number; starredCaptureIds: Set<string> }) {
  const [flashcard, setFlashcard] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exportRange, setExportRange] = useState<FlashcardExportRange>("yesterday");
  const [customStartKey, setCustomStartKey] = useState(() => dayKeyFromDate(addDaysToDate(startOfLocalDay(new Date()), -29)));
  const [customEndKey, setCustomEndKey] = useState(() => todayKey());
  const words = buildFlashcardList(captures, flashcardThreshold, starredCaptureIds);
  const exportWords = buildFlashcardList(
    capturesForExportRange(captures, exportRange, customStartKey, customEndKey),
    flashcardThreshold,
    starredCaptureIds,
    null,
  );
  const exportRangeLabel = FLASHCARD_EXPORT_RANGES.find((range) => range.value === exportRange)?.label ?? "Selected range";
  const exportSummary = exportRange === "custom" ? `${customStartKey} to ${customEndKey}` : exportRangeLabel.toLowerCase();

  if (flashcard) return <FlashcardView words={words} onClose={() => setFlashcard(false)} />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 22, color: "#37352f", margin: "0 0 6px", fontWeight: 700 }}>Flashcards</h2>
          <p style={{ fontSize: 13, color: "#9b9a97", margin: 0 }}>
            {words.length} ready this month
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            onClick={() => setShowExport((open) => !open)}
            style={{
              background: showExport ? "#37352f" : "#fff",
              color: showExport ? "#fff" : "#37352f",
              border: "1px solid #d8d7d2",
              borderRadius: 6,
              padding: "7px 16px",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Export
          </button>
          <button
            disabled={words.length === 0}
            onClick={() => setFlashcard(true)}
            style={{
              background: words.length === 0 ? "#d8d7d2" : "#37352f",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "7px 16px",
              fontSize: 13,
              fontWeight: 700,
              cursor: words.length === 0 ? "default" : "pointer",
            }}
          >
            Study
          </button>
        </div>
      </div>

      {showExport && (
        <div
          style={{
            border: "1px solid #e3e2de",
            borderRadius: 8,
            padding: 16,
            marginBottom: 26,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <div>
            <p style={{ fontSize: 13, color: "#9b9a97", margin: "0 0 8px" }}>Export flashcards</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {FLASHCARD_EXPORT_RANGES.map((range) => (
                <button
                  key={range.value}
                  type="button"
                  onClick={() => setExportRange(range.value)}
                  style={{
                    background: exportRange === range.value ? "#37352f" : "#fff",
                    color: exportRange === range.value ? "#fff" : "#37352f",
                    border: "1px solid #d8d7d2",
                    borderRadius: 999,
                    padding: "6px 11px",
                    fontSize: 13,
                    fontWeight: 650,
                    cursor: "pointer",
                  }}
                >
                  {range.label}
                </button>
              ))}
            </div>
            {exportRange === "custom" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#8d8b86", fontWeight: 700 }}>
                  From
                  <input
                    type="date"
                    value={customStartKey}
                    max={customEndKey}
                    onChange={(event) => setCustomStartKey(event.target.value)}
                    style={{ border: "1px solid #d8d7d2", borderRadius: 6, padding: "6px 8px", fontSize: 13, color: "#37352f" }}
                  />
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#8d8b86", fontWeight: 700 }}>
                  To
                  <input
                    type="date"
                    value={customEndKey}
                    min={customStartKey}
                    max={todayKey()}
                    onChange={(event) => setCustomEndKey(event.target.value)}
                    style={{ border: "1px solid #d8d7d2", borderRadius: 6, padding: "6px 8px", fontSize: 13, color: "#37352f" }}
                  />
                </label>
              </div>
            )}
            <p style={{ fontSize: 12, color: "#9b9a97", margin: "10px 0 0" }}>
              {exportWords.length} {exportWords.length === 1 ? "flashcard" : "flashcards"} ready from {exportSummary}.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={exportWords.length === 0}
              onClick={() => exportFlashcards("anki", exportWords)}
              style={{
                background: exportWords.length === 0 ? "#d8d7d2" : "#37352f",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "9px 14px",
                fontSize: 13,
                fontWeight: 700,
                cursor: exportWords.length === 0 ? "default" : "pointer",
              }}
            >
              Export to Anki
            </button>
            <button
              type="button"
              disabled={exportWords.length === 0}
              onClick={() => exportFlashcards("quizlet", exportWords)}
              style={{
                background: "#fff",
                color: exportWords.length === 0 ? "#b3b1ad" : "#37352f",
                border: "1px solid #d8d7d2",
                borderRadius: 8,
                padding: "9px 14px",
                fontSize: 13,
                fontWeight: 700,
                cursor: exportWords.length === 0 ? "default" : "pointer",
              }}
            >
              Export to Quizlet
            </button>
          </div>
        </div>
      )}

      {words.length === 0 ? (
        <p style={{ color: "#9b9a97", fontSize: 15, lineHeight: 1.6, margin: 0 }}>
          No flashcards yet. Ask about the same question {flashcardThreshold} times this month or star a save to add it here.
        </p>
      ) : (
        <div>
          {words.map((w) => (
            <div key={w.word} style={{ padding: "12px 0", borderBottom: "1px solid #f0efec", display: "grid", gridTemplateColumns: "1fr auto", alignItems: "start", gap: 16 }}>
              <div>
                <p style={{ fontSize: 16, fontWeight: 500, color: "#37352f", margin: 0 }}>{w.word}</p>
                {w.starred && (
                  <p style={{ fontSize: 12, color: "#8d8b86", margin: "3px 0 0", fontWeight: 700 }}>
                    Starred
                  </p>
                )}
                {w.explanation && (
                  <div style={{ fontSize: 14, color: "#6b6b6b", margin: "4px 0 0", lineHeight: 1.6 }}>{renderMarkdown(w.explanation)}</div>
                )}
              </div>
              <span style={{ fontSize: 12, color: "#9b9a97", background: "#f0efec", borderRadius: 999, padding: "2px 10px", whiteSpace: "nowrap", marginTop: 4 }}>
                ×{w.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function exportFlashcards(format: "anki" | "quizlet", flashcards: WordEntry[]) {
  const rows = flashcards
    .map((card) => `${cleanExportCell(card.word)}\t${cleanExportCell(card.explanation || card.exampleText || "No explanation yet.")}`)
    .join("\n");
  const filename = format === "anki" ? "contextlens-anki.tsv" : "contextlens-quizlet.txt";
  downloadTextFile(filename, rows);
}

function SettingsView({
  flashcardThreshold,
  onFlashcardThresholdChange,
  account,
  onAccountChange,
  appMode,
  onAppModeChange,
  theme,
  onThemeChange,
  accentColor,
  onAccentColorChange,
  colors,
}: {
  flashcardThreshold: number;
  onFlashcardThresholdChange: (value: number) => void;
  account: ContextLensUser | null;
  onAccountChange: (account: ContextLensUser | null) => void;
  appMode: AppMode;
  onAppModeChange: (mode: AppMode) => void;
  theme: ThemeName;
  onThemeChange: (t: ThemeName) => void;
  accentColor: string;
  onAccentColorChange: (color: string) => void;
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
  const [accentDraft, setAccentDraft] = useState(accentColor);

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

  async function handleSignOut() {
    setAccountLoading(true);
    try {
      await sendRuntimeMessage<void>({ type: "SIGN_OUT" });
      onAccountChange(null);
      setAccountStatus("");
      setAccountFormVisible(true);
    } finally {
      setAccountLoading(false);
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
                onClick={handleSignOut}
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
                  color: "#b91c1c",
                  border: "1px solid #fca5a5",
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
              <div style={{ marginTop: 12, border: "1px solid #fca5a5", borderRadius: 8, padding: 12, background: theme === "dark" ? "rgba(127,29,29,0.18)" : "#fff7f7" }}>
                <p style={{ fontSize: 12, color: theme === "dark" ? "#fecaca" : "#991b1b", margin: "0 0 10px", lineHeight: 1.5 }}>
                  This deletes your account and saved cloud data. This email cannot be used to create another account.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={handleDeleteAccount}
                    disabled={accountLoading}
                    style={{
                      background: "#b91c1c",
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
                {accountLoading ? "Signing in…" : "Continue"}
              </button>
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
            <input type="checkbox" checked={triggers[opt.field]} onChange={(e) => handleTriggerChange(opt.field, e.target.checked)} style={{ marginTop: 3 }} />
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
          style={{ marginTop: 3 }}
        />
        <div>
          <p style={{ fontSize: 14, color: colors.text, margin: 0 }}>Show answer immediately</p>
          <p style={{ fontSize: 12, color: colors.muted, margin: "2px 0 0" }}>
            Shows the AI answer in the popup after pressing Enter, then lets you ask follow-ups.
          </p>
        </div>
      </label>

      {/* Flashcards */}
      <p style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>Flashcards</p>
      <div style={{ marginBottom: 40 }}>
        <label style={{ display: "block", marginBottom: 18 }}>
          <p style={{ fontSize: 14, color: colors.text, margin: "0 0 4px" }}>Question repeat threshold</p>
          <p style={{ fontSize: 12, color: colors.muted, margin: "0 0 8px" }}>
            A question appears in Flashcards after this many saves in the current month, unless it is starred.
          </p>
          <input
            type="number"
            min={1}
            max={50}
            value={flashcardThreshold}
            onChange={(event) => {
              const next = Math.max(1, Math.min(50, Number(event.target.value) || DEFAULT_FLASHCARD_THRESHOLD));
              onFlashcardThresholdChange(next);
            }}
            style={{
              width: 92,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 14,
              color: colors.text,
              background: colors.surface,
            }}
          />
        </label>

      </div>

      {/* Screenshot triggers */}
      <p style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>Screenshot trigger</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {([
          { field: "floatingButton" as const, label: "Show camera button on pages", desc: "A camera button appears in the corner of every page." },
          { field: "shortcut" as const, label: "Keyboard shortcut", desc: "Set your shortcut at chrome://extensions/shortcuts." },
        ]).map((opt) => (
          <label key={opt.field} style={{ display: "flex", gap: 12, cursor: "pointer", alignItems: "flex-start" }}>
            <input type="checkbox" checked={screenshotTriggers[opt.field]} onChange={(e) => handleScreenshotTriggerChange(opt.field, e.target.checked)} style={{ marginTop: 3 }} />
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
      <p style={{ fontSize: 13, color: colors.muted, marginTop: 40, marginBottom: 12 }}>Learning mode</p>
      <label style={{ display: "block", marginBottom: 40 }}>
        <p style={{ fontSize: 14, color: colors.text, margin: "0 0 4px" }}>Default answer style</p>
        <p style={{ fontSize: 12, color: colors.muted, margin: "0 0 8px", lineHeight: 1.5 }}>
          Student mode includes study helpers like analogies.
        </p>
        <select
          value={appMode}
          onChange={(event) => onAppModeChange(event.target.value as AppMode)}
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
          <option value="language_learning">Language</option>
          <option value="student">Student</option>
        </select>
      </label>

      {/* Theme */}
      <p style={{ fontSize: 13, color: colors.muted, marginTop: 40, marginBottom: 12 }}>Appearance</p>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 16 }}>
        <div style={{ display: "flex", background: colors.subtle, borderRadius: 999, padding: 3, gap: 2, width: "fit-content" }}>
          {(["light", "dark"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onThemeChange(t)}
              style={{
                background: theme === t ? colors.text : "transparent",
                color: theme === t ? colors.bg : colors.muted,
                border: "none",
                borderRadius: 999,
                padding: "5px 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                textTransform: "capitalize",
                transition: "background 0.15s, color 0.15s",
              }}
            >
              {t === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
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
          {["#2563eb", "#0f766e", "#b45309", "#be123c", "#37352f"].map((swatch) => (
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
    return colors.text;
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

export default function App() {
  const [view, setView] = useState<View>(() => viewFromHash());
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [currentDayKey, setCurrentDayKey] = useState(todayKey());
  const [flashcardThreshold, setFlashcardThreshold] = useState(DEFAULT_FLASHCARD_THRESHOLD);
  const [starredCaptureIds, setStarredCaptureIds] = useState<Set<string>>(new Set());
  const [account, setAccount] = useState<ContextLensUser | null>(null);
  const [appMode, setAppMode] = useState<AppMode>("language_learning");
  const [theme, setThemeState] = useState<ThemeName>("light");
  const [accentColor, setAccentColorState] = useState(DEFAULT_ACCENT_COLOR);

  useEffect(() => {
    chrome.storage.local.get(["captures", "flashcard_threshold", "flashcard_starred_capture_ids", "contextlens_user", "app_mode", "theme", "accent_color"], (r) => {
      setCaptures(r.captures ?? []);
      setFlashcardThreshold(r.flashcard_threshold ?? DEFAULT_FLASHCARD_THRESHOLD);
      setStarredCaptureIds(new Set(r.flashcard_starred_capture_ids ?? []));
      setAccount(r.contextlens_user ?? null);
      setAppMode(r.app_mode ?? "language_learning");
      const t = isThemeName(r.theme) ? r.theme : "light";
      const accent = normalizeHexColor(r.accent_color);
      setThemeState(t);
      setAccentColorState(accent);
      document.documentElement.setAttribute("data-theme", t);
      document.documentElement.style.setProperty("--contextlens-accent", accent);
    });
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.captures) setCaptures(changes.captures.newValue ?? []);
      if (changes.flashcard_threshold) setFlashcardThreshold(changes.flashcard_threshold.newValue ?? DEFAULT_FLASHCARD_THRESHOLD);
      if (changes.flashcard_starred_capture_ids) setStarredCaptureIds(new Set(changes.flashcard_starred_capture_ids.newValue ?? []));
      if (changes.contextlens_user) setAccount(changes.contextlens_user.newValue ?? null);
      if (changes.app_mode) setAppMode(changes.app_mode.newValue ?? "language_learning");
      if (changes.theme) {
        const nextTheme = isThemeName(changes.theme.newValue) ? changes.theme.newValue : "light";
        setThemeState(nextTheme);
        document.documentElement.setAttribute("data-theme", nextTheme);
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

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentDayKey(todayKey()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const todayCaptures = captures.filter((capture) => dayKey(capture.savedAt) === currentDayKey);
  const streak = computeStreak(captures);
  const contentMaxWidth = view === "history" ? 1800 : 1100;
  const contentPadding = view === "history" ? "32px 48px 32px 96px" : "32px";
  const colors = colorsForTheme(theme, accentColor);

  function updateFlashcardThreshold(value: number) {
    setFlashcardThreshold(value);
    chrome.storage.local.set({ flashcard_threshold: value });
  }

  function toggleFlashcardStar(id: string) {
    setStarredCaptureIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      chrome.storage.local.set({ flashcard_starred_capture_ids: Array.from(next) });
      return next;
    });
  }

  function deleteCapturesByIds(ids: string[]) {
    const idsToDelete = new Set(ids);
    if (idsToDelete.size === 0) return;

    setCaptures((current) => {
      const next = current.filter((capture) => !idsToDelete.has(capture.id));
      chrome.storage.local.set({ captures: next });
      return next;
    });

    setStarredCaptureIds((current) => {
      const next = new Set(current);
      idsToDelete.forEach((id) => next.delete(id));
      chrome.storage.local.set({ flashcard_starred_capture_ids: Array.from(next) });
      return next;
    });

    chrome.storage.local.get("deep_dive_capture_ids", (result) => {
      const next = (result.deep_dive_capture_ids ?? []).filter((id: string) => !idsToDelete.has(id));
      chrome.storage.local.set({ deep_dive_capture_ids: next });
    });

    void sendRuntimeMessage<{ deleted: number }>({ type: "DELETE_REMOTE_CAPTURES", ids: Array.from(idsToDelete) }).catch((error) => {
      console.warn("ContextLens remote delete skipped", error);
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
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 64 }}>
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
              <button
                onClick={() => navigateView("saves")}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                title="Go to today"
              >
                <span style={{ fontSize: 16 }}>🔥</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>{streak}</span>
              </button>
            )}
            <nav style={{ display: "flex", gap: 18 }}>
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
            </nav>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: contentMaxWidth, margin: "0 auto", padding: contentPadding }}>
        {view === "saves" && (
          <SavesView
            captures={todayCaptures}
            starredCaptureIds={starredCaptureIds}
            onToggleStar={toggleFlashcardStar}
            onDeleteCaptures={deleteCapturesByIds}
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
          />
        )}
        {view === "history" && (
          <HistoryView
            captures={captures}
            starredCaptureIds={starredCaptureIds}
            onToggleStar={toggleFlashcardStar}
            onDeleteCaptures={deleteCapturesByIds}
            colors={colors}
            theme={theme}
            accentColor={accentColor}
          />
        )}
        {view === "words" && <WordsView captures={captures} flashcardThreshold={flashcardThreshold} starredCaptureIds={starredCaptureIds} />}
        {view === "settings" && (
          <SettingsView
            flashcardThreshold={flashcardThreshold}
            onFlashcardThresholdChange={updateFlashcardThreshold}
            account={account}
            onAccountChange={setAccount}
            appMode={appMode}
            onAppModeChange={setMode}
            theme={theme}
            onThemeChange={setTheme}
            accentColor={accentColor}
            onAccentColorChange={setAccentColor}
            colors={colors}
          />
        )}
      </div>
    </div>
  );
}
