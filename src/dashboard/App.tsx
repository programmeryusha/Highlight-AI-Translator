import React, { useEffect, useState } from "react";
import type { Capture } from "../types";

type View = "saves" | "history" | "words" | "settings";
type SaveTriggers = { bubble: boolean; contextMenu: boolean };
type ScreenshotTriggers = { floatingButton: boolean; shortcut: boolean; immediate: boolean };
const LONG_TEXT_LIMIT = 420;

function dayKeyFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
                  <p style={{ fontSize: 17, color: "#4f4d49", margin: "12px 0 0", lineHeight: 1.75 }}>
                    {c.explanation}
                  </p>
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
  const keys = Array.from(new Set(captures.map((capture) => dayKey(capture.savedAt))))
    .filter((key) => key !== todayKey())
    .sort((a, b) => b.localeCompare(a));
  const [selectedDay, setSelectedDay] = useState(keys[0] ?? "");
  const selectedCaptures = captures.filter((capture) => dayKey(capture.savedAt) === selectedDay);

  useEffect(() => {
    if (!selectedDay && keys[0]) setSelectedDay(keys[0]);
    if (selectedDay && !keys.includes(selectedDay)) setSelectedDay(keys[0] ?? "");
  }, [keys.join("|"), selectedDay]);

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <MonthHeatMap captures={captures} />
      </div>
      {keys.length === 0 ? (
        <p style={{ color: "#9b9a97", fontSize: 15, paddingTop: 8 }}>No previous days yet. Tomorrow, today’s saves will move here.</p>
      ) : (
        <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: "#9b9a97", margin: 0 }}>{keys.length} saved {keys.length === 1 ? "day" : "days"}</p>
        <select
          value={selectedDay}
          onChange={(event) => setSelectedDay(event.target.value)}
          style={{ border: "1px solid #e3e2de", borderRadius: 6, background: "#fff", color: "#37352f", fontSize: 13, padding: "6px 10px" }}
        >
          {keys.map((key) => (
            <option key={key} value={key}>{dayLabelFromKey(key)}</option>
          ))}
        </select>
      </div>
      <SavesView captures={selectedCaptures} />
        </>
      )}
    </div>
  );
}

interface WordEntry {
  word: string;
  count: number;
  explanation: string;
  exampleText: string;
}

function buildWordList(captures: Capture[]): WordEntry[] {
  const map = new Map<string, { count: number; explanation: string; exampleText: string }>();
  for (const c of captures) {
    const w = c.context?.trim();
    if (!w) continue;
    const key = w.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { count: 0, explanation: c.explanation ?? "", exampleText: c.text });
    }
    const entry = map.get(key)!;
    entry.count++;
    if (!entry.explanation && c.explanation) entry.explanation = c.explanation;
  }
  return Array.from(map.entries())
    .map(([, v], i) => ({ word: Array.from(map.keys())[i], count: v.count, explanation: v.explanation, exampleText: v.exampleText }))
    .sort((a, b) => b.count - a.count);
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
          ← Back to words
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
            <p style={{ fontSize: 16, color: "#37352f", lineHeight: 1.7, margin: 0 }}>
              {card.explanation || "No explanation yet — save a highlight with this word to get one."}
            </p>
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
  const words = buildWordList(captures);

  if (flashcard) return <FlashcardView words={words} onClose={() => setFlashcard(false)} />;

  if (words.length === 0) {
    return <p style={{ color: "#9b9a97", fontSize: 15, paddingTop: 48 }}>No words yet. When you save a highlight with a specific word or phrase, it appears here.</p>;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: "#9b9a97" }}>{words.length} unique {words.length === 1 ? "word" : "words"}</p>
        <button
          onClick={() => setFlashcard(true)}
          style={{ background: "#37352f", color: "#fff", border: "none", borderRadius: 6, padding: "7px 16px", fontSize: 13, cursor: "pointer" }}
        >
          Flashcards
        </button>
      </div>
      <div>
        {words.map((w) => (
          <div key={w.word} style={{ padding: "12px 0", borderBottom: "1px solid #f0efec", display: "grid", gridTemplateColumns: "1fr auto", alignItems: "start", gap: 16 }}>
            <div>
              <p style={{ fontSize: 16, fontWeight: 500, color: "#37352f", margin: 0 }}>{w.word}</p>
              {w.explanation && (
                <p style={{ fontSize: 14, color: "#6b6b6b", margin: "4px 0 0", lineHeight: 1.6 }}>{w.explanation}</p>
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

function MonthHeatMap({ captures }: { captures: Capture[] }) {
  const now = new Date();
  const counts = captureCountsByDay(captures);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, index) => index + 1);
  const max = Math.max(1, ...days.map((day) => counts.get(dayKeyFromDate(new Date(now.getFullYear(), now.getMonth(), day))) ?? 0));

  function colorFor(count: number) {
    if (count === 0) return "#f0efec";
    const opacity = 0.25 + (count / max) * 0.65;
    return `rgba(99, 102, 241, ${opacity})`;
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: "#9b9a97", margin: "0 0 10px" }}>
        {now.toLocaleDateString("en-US", { month: "long" })} activity
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(16, 12px)", gap: 4, width: "fit-content" }}>
        {days.map((day) => {
          const key = dayKeyFromDate(new Date(now.getFullYear(), now.getMonth(), day));
          const count = counts.get(key) ?? 0;
          return (
            <span
              key={key}
              title={`${day}: ${count} ${count === 1 ? "save" : "saves"}`}
              style={{ width: 12, height: 12, borderRadius: 3, background: colorFor(count), display: "block" }}
            />
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
                  {v === "saves" ? "Today" : v}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 32px" }}>
        {view === "saves" && <SavesView captures={todayCaptures} />}
        {view === "history" && <HistoryView captures={captures} />}
        {view === "words" && <WordsView captures={captures} />}
        {view === "settings" && <SettingsView />}
      </div>
    </div>
  );
}
