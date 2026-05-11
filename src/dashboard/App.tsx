import React, { useEffect, useState } from "react";
import type { Capture } from "../types";

type View = "saves" | "history" | "words" | "settings";
type SaveTriggers = { bubble: boolean; contextMenu: boolean };
type ScreenshotTriggers = { floatingButton: boolean; shortcut: boolean; immediate: boolean };
const LONG_TEXT_LIMIT = 420;

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];

  function inlineBold(line: string): React.ReactNode[] {
    return line.split(/\*\*(.*?)\*\*/g).map((part, index) => (
      index % 2 === 1 ? <strong key={index}>{part}</strong> : part
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

function CapturePreview({ capture }: { capture: Capture }) {
  if (capture.imageData) {
    return <img src={capture.imageData} alt="screenshot" style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 6, marginBottom: 4, display: "block" }} />;
  }

  const isLong = capture.text.length > LONG_TEXT_LIMIT;
  const text = isLong ? `${capture.text.slice(0, LONG_TEXT_LIMIT).trim()}…` : capture.text;

  return (
    <>
      <p style={{ fontSize: 18, fontWeight: 600, color: "#2f2e2b", lineHeight: 1.65, margin: 0 }}>
        {text}
      </p>
      {isLong && (
        <p style={{ fontSize: 14, color: "#6366f1", margin: "7px 0 0", fontWeight: 700 }}>
          Open full save
        </p>
      )}
    </>
  );
}

function SavesView({ captures }: { captures: Capture[] }) {
  if (captures.length === 0) {
    return (
      <p style={{ color: "#9b9a97", fontSize: 15, paddingTop: 48 }}>
        Nothing saved yet. Highlight any text on the web to save it here.
      </p>
    );
  }

  const groups = groupByDay(captures);

  return (
    <div>
      {groups.map((group) => (
        <div key={group.label} style={{ marginBottom: 40 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: "#9b9a97", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
            {group.label}
          </p>
          <div>
            {group.items.map((c) => (
              <div
                key={c.id}
                onClick={() => openChat(c.id)}
                style={{ padding: "16px 0 20px", cursor: "pointer", maxWidth: 900 }}
              >
                <CapturePreview capture={c} />

                {c.context && (
                  <div style={{ borderLeft: "3px solid #d8d7d2", paddingLeft: 12, margin: "10px 0 0" }}>
                    <p style={{ fontSize: 12, color: "#8d8b86", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", margin: "0 0 4px" }}>
                      Your question
                    </p>
                    <p style={{ fontSize: 17, color: "#37352f", lineHeight: 1.55, margin: 0, fontWeight: 600 }}>
                      {c.context}
                    </p>
                  </div>
                )}

                {c.status === "pending" && (
                  <p style={{ fontSize: 16, color: "#8d8b86", margin: "10px 0 0", fontStyle: "italic" }}>
                    thinking…
                  </p>
                )}
                {c.status === "error" && (
                  <p style={{ fontSize: 16, color: "#eb5757", margin: "10px 0 0", lineHeight: 1.6 }}>
                    something went wrong — {c.errorMessage ?? "try again"}
                  </p>
                )}
                {c.status === "done" && c.explanation && (
                  <div style={{ fontSize: 17, color: "#4f4d49", margin: "12px 0 0", lineHeight: 1.75 }}>
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

function HistoryView({ captures }: { captures: Capture[] }) {
  const windowWidth = useWindowWidth();
  const [selectedDay, setSelectedDay] = useState(todayKey());
  const [visibleMonth, setVisibleMonth] = useState(currentMonthKey());
  const selectedCaptures = captures.filter((capture) => dayKey(capture.savedAt) === selectedDay);
  const previousDay = addDays(selectedDay, -1);
  const nextDay = addDays(selectedDay, 1);
  const canGoNext = nextDay <= todayKey();
  const dockCalendar = windowWidth >= 1600;

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
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
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
          <SavesView captures={selectedCaptures} />
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
          width: 300,
          margin: dockCalendar ? undefined : "36px auto 0",
        }}
      >
        <MonthCalendar
          captures={captures}
          selectedDay={selectedDay}
          visibleMonth={visibleMonth}
          onVisibleMonthChange={setVisibleMonth}
          onSelectDay={selectDay}
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
}

function buildFlashcardList(captures: Capture[], monthKey = currentMonthKey()): WordEntry[] {
  const map = new Map<string, { count: number; word: string; explanation: string; exampleText: string }>();
  for (const c of captures) {
    if (monthKeyFromDate(new Date(c.savedAt)) !== monthKey) continue;

    const question = c.context?.trim();
    if (!question) continue;

    const key = question.toLowerCase().replace(/\s+/g, " ");
    if (!map.has(key)) {
      map.set(key, { count: 0, word: question, explanation: c.explanation ?? "", exampleText: c.text });
    }
    const entry = map.get(key)!;
    entry.count++;
    if (!entry.explanation && c.explanation) entry.explanation = c.explanation;
  }
  return Array.from(map.values())
    .filter((entry) => entry.count >= 3)
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
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

function WordsView({ captures }: { captures: Capture[] }) {
  const [flashcard, setFlashcard] = useState(false);
  const words = buildFlashcardList(captures);

  if (flashcard) return <FlashcardView words={words} onClose={() => setFlashcard(false)} />;

  if (words.length === 0) {
    return (
      <div style={{ paddingTop: 16 }}>
        <h2 style={{ fontSize: 22, color: "#37352f", margin: "0 0 10px", fontWeight: 700 }}>Flashcards</h2>
        <p style={{ color: "#9b9a97", fontSize: 15, lineHeight: 1.6, margin: 0 }}>
          No flashcards yet. Ask about the same question 3 times this month and it will appear here.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 22, color: "#37352f", margin: "0 0 6px", fontWeight: 700 }}>Flashcards</h2>
          <p style={{ fontSize: 13, color: "#9b9a97", margin: 0 }}>
            {words.length} ready this month
          </p>
        </div>
        <button
          onClick={() => setFlashcard(true)}
          style={{ background: "#37352f", color: "#fff", border: "none", borderRadius: 6, padding: "7px 16px", fontSize: 13, cursor: "pointer" }}
        >
          Study
        </button>
      </div>
      <div>
        {words.map((w) => (
          <div key={w.word} style={{ padding: "12px 0", borderBottom: "1px solid #f0efec", display: "grid", gridTemplateColumns: "1fr auto", alignItems: "start", gap: 16 }}>
            <div>
              <p style={{ fontSize: 16, fontWeight: 500, color: "#37352f", margin: 0 }}>{w.word}</p>
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
    </div>
  );
}

function SettingsView() {
  const [triggers, setTriggers] = useState<SaveTriggers>({ bubble: true, contextMenu: true });
  const [screenshotTriggers, setScreenshotTriggers] = useState<ScreenshotTriggers>({ floatingButton: true, shortcut: true, immediate: false });

  useEffect(() => {
    chrome.storage.local.remove("anthropic_api_key");
    chrome.storage.local.get(["save_triggers", "screenshot_triggers"], (r) => {
      if (r.save_triggers) setTriggers(r.save_triggers);
      if (r.screenshot_triggers) setScreenshotTriggers(r.screenshot_triggers);
    });
  }, []);

  function handleTriggerChange(field: keyof SaveTriggers, value: boolean) {
    const updated = { ...triggers, [field]: value };
    setTriggers(updated);
    chrome.storage.local.set({ save_triggers: updated });
  }

  function handleScreenshotTriggerChange(field: keyof ScreenshotTriggers, value: boolean) {
    const updated = { ...screenshotTriggers, [field]: value };
    setScreenshotTriggers(updated);
    chrome.storage.local.set({ screenshot_triggers: updated });
  }

  return (
    <div style={{ maxWidth: 400, paddingTop: 8 }}>
      {/* Save triggers */}
      <p style={{ fontSize: 13, color: "#9b9a97", marginBottom: 12 }}>Save trigger</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 40 }}>
        {([
          { field: "bubble" as const, label: "Show Save button on highlight", desc: "A small button appears over your selection — click it to save." },
          { field: "contextMenu" as const, label: "Add to right-click menu", desc: "\"Save to ContextLens\" appears in the right-click context menu." },
        ]).map((opt) => (
          <label key={opt.field} style={{ display: "flex", gap: 12, cursor: "pointer", alignItems: "flex-start" }}>
            <input type="checkbox" checked={triggers[opt.field]} onChange={(e) => handleTriggerChange(opt.field, e.target.checked)} style={{ marginTop: 3 }} />
            <div>
              <p style={{ fontSize: 14, color: "#37352f", margin: 0 }}>{opt.label}</p>
              <p style={{ fontSize: 12, color: "#9b9a97", margin: "2px 0 0" }}>{opt.desc}</p>
            </div>
          </label>
        ))}
      </div>

      {/* Screenshot triggers */}
      <p style={{ fontSize: 13, color: "#9b9a97", marginBottom: 12 }}>Screenshot trigger</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {([
          { field: "floatingButton" as const, label: "Show camera button on pages", desc: "A camera button appears in the corner of every page." },
          { field: "shortcut" as const, label: "Keyboard shortcut", desc: "Set your shortcut at chrome://extensions/shortcuts." },
          { field: "immediate" as const, label: "Show answer immediately", desc: "Displays the explanation in the popup instead of saving quietly." },
        ]).map((opt) => (
          <label key={opt.field} style={{ display: "flex", gap: 12, cursor: "pointer", alignItems: "flex-start" }}>
            <input type="checkbox" checked={screenshotTriggers[opt.field]} onChange={(e) => handleScreenshotTriggerChange(opt.field, e.target.checked)} style={{ marginTop: 3 }} />
            <div>
              <p style={{ fontSize: 14, color: "#37352f", margin: 0 }}>{opt.label}</p>
              <p style={{ fontSize: 12, color: "#9b9a97", margin: "2px 0 0" }}>{opt.desc}</p>
            </div>
          </label>
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
}: {
  captures: Capture[];
  selectedDay: string;
  visibleMonth: string;
  onVisibleMonthChange: (month: string) => void;
  onSelectDay: (day: string) => void;
}) {
  const counts = captureCountsByDay(captures);
  const days = calendarDayKeys(visibleMonth);
  const realDays = days.filter((day): day is string => Boolean(day));
  const max = Math.max(1, ...realDays.map((day) => counts.get(day) ?? 0));
  const previousMonth = addMonths(visibleMonth, -1);
  const nextMonth = addMonths(visibleMonth, 1);
  const canGoNextMonth = nextMonth <= currentMonthKey();

  function colorFor(count: number) {
    if (count === 0) return "#f0efec";
    const opacity = 0.25 + (count / max) * 0.65;
    return `rgba(99, 102, 241, ${opacity})`;
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
            border: "1px solid #e3e2de",
            background: "#fff",
            color: "#37352f",
            cursor: "pointer",
            fontSize: 16,
          }}
        >
          ‹
        </button>
        <p style={{ fontSize: 15, color: "#37352f", margin: 0, fontWeight: 700 }}>
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
            border: "1px solid #e3e2de",
            background: canGoNextMonth ? "#fff" : "#f7f6f3",
            color: canGoNextMonth ? "#37352f" : "#c7c6c3",
            cursor: canGoNextMonth ? "pointer" : "default",
            fontSize: 16,
          }}
        >
          ›
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 34px)", gap: 7, marginBottom: 8 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => (
          <span key={`${label}-${index}`} style={{ fontSize: 11, color: "#9b9a97", fontWeight: 700, textAlign: "center" }}>
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
                border: isSelected ? "2px solid #6366f1" : "1px solid #e3e2de",
                background: isFuture ? "#fafafa" : colorFor(count),
                color: isFuture ? "#d8d7d2" : count > 0 ? "#37352f" : "#9b9a97",
                fontSize: 12,
                fontWeight: isSelected ? 700 : 600,
                cursor: isFuture ? "default" : "pointer",
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
  const [view, setView] = useState<View>("saves");
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [currentDayKey, setCurrentDayKey] = useState(todayKey());

  useEffect(() => {
    chrome.storage.local.get("captures", (r) => {
      setCaptures(r.captures ?? []);
    });
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.captures) setCaptures(changes.captures.newValue ?? []);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentDayKey(todayKey()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const todayCaptures = captures.filter((capture) => dayKey(capture.savedAt) === currentDayKey);
  const streak = computeStreak(captures);
  const contentMaxWidth = view === "history" ? 1560 : 1100;

  return (
    <div style={{ minHeight: "100vh", background: "#fff", color: "#37352f" }}>
      <div style={{ borderBottom: "1px solid #e3e2de" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 64 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>
            ContextLens
            {todayCaptures.length > 0 && (
              <span style={{ color: "#9b9a97", fontWeight: 400, marginLeft: 6, fontSize: 14 }}>{todayCaptures.length}</span>
            )}
          </span>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 22 }}>
            <span style={{ fontSize: 13, color: "#37352f", whiteSpace: "nowrap" }}>
              {streak} day streak
            </span>
            <nav style={{ display: "flex", gap: 18 }}>
              {(["saves", "history", "words", "settings"] as View[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  style={{
                    background: "none",
                    border: "none",
                    color: view === v ? "#37352f" : "#9b9a97",
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

      <div style={{ maxWidth: contentMaxWidth, margin: "0 auto", padding: "32px 32px" }}>
        {view === "saves" && <SavesView captures={todayCaptures} />}
        {view === "history" && <HistoryView captures={captures} />}
        {view === "words" && <WordsView captures={captures} />}
        {view === "settings" && <SettingsView />}
      </div>
    </div>
  );
}
