import React, { useEffect, useState } from "react";
import type { Capture } from "../types";

type View = "saves" | "words" | "settings";
type SaveTriggers = { bubble: boolean; contextMenu: boolean };
type ScreenshotTriggers = { floatingButton: boolean; shortcut: boolean; immediate: boolean };

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

function openChat(id: string) {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/chat/chat.html") + `?id=${id}` });
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
                style={{ padding: "10px 0", cursor: "pointer" }}
              >
                {c.imageData ? (
                  <img src={c.imageData} alt="screenshot" style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 6, marginBottom: 4, display: "block" }} />
                ) : (
                  <p style={{ fontSize: 17, fontWeight: 500, color: "#37352f", lineHeight: 1.6, margin: 0 }}>
                    {c.text}
                  </p>
                )}

                {c.context && (
                  <p style={{ fontSize: 14, color: "#9b9a97", margin: "3px 0 0" }}>
                    ↳ {c.context}
                  </p>
                )}

                {c.status === "pending" && (
                  <p style={{ fontSize: 14, color: "#c7c6c3", margin: "5px 0 0", fontStyle: "italic" }}>
                    thinking…
                  </p>
                )}
                {c.status === "error" && (
                  <p style={{ fontSize: 14, color: "#eb5757", margin: "5px 0 0" }}>
                    something went wrong — try again
                  </p>
                )}
                {c.status === "done" && c.explanation && (
                  <p style={{ fontSize: 15, color: "#6b6b6b", margin: "5px 0 0", lineHeight: 1.7 }}>
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
  const [key, setKey] = useState("");
  const [keySet, setKeySet] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [keyCleared, setKeyCleared] = useState(false);
  const [triggers, setTriggers] = useState<SaveTriggers>({ bubble: true, contextMenu: true });
  const [screenshotTriggers, setScreenshotTriggers] = useState<ScreenshotTriggers>({ floatingButton: true, shortcut: true, immediate: false });

  useEffect(() => {
    chrome.storage.local.get(["anthropic_api_key", "save_triggers", "screenshot_triggers"], (r) => {
      setKeySet(!!r.anthropic_api_key);
      if (r.save_triggers) setTriggers(r.save_triggers);
      if (r.screenshot_triggers) setScreenshotTriggers(r.screenshot_triggers);
    });
  }, []);

  function handleSaveKey() {
    if (!key.trim()) return;
    chrome.storage.local.set({ anthropic_api_key: key.trim() }, () => {
      setKeySaved(true);
      setKeySet(true);
      setKey("");
      setTimeout(() => setKeySaved(false), 2000);
    });
  }

  function handleClearKey() {
    chrome.storage.local.remove("anthropic_api_key", () => {
      setKeySet(false);
      setKeyCleared(true);
      setTimeout(() => setKeyCleared(false), 2000);
    });
  }

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

      {/* Optional own API key */}
      <p style={{ fontSize: 13, fontWeight: 600, color: "#37352f", marginBottom: 4 }}>
        Use your own Claude API key
        {keySet && <span style={{ color: "#0f7b6c", fontWeight: 400, marginLeft: 8 }}>✓ active</span>}
        {keyCleared && <span style={{ color: "#9b9a97", fontWeight: 400, marginLeft: 8 }}>removed</span>}
      </p>
      <p style={{ fontSize: 13, color: "#9b9a97", marginBottom: 12, lineHeight: 1.5 }}>
        Optional. By default ContextLens uses a shared AI connection. If you have a Claude Pro or Team subscription, paste your key here to use it instead — useful for higher limits or access to more powerful models.
      </p>
      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSaveKey()}
        placeholder={keySet ? "Enter new key to replace…" : "sk-ant-…"}
        style={{
          width: "100%",
          padding: "8px 0",
          background: "transparent",
          border: "none",
          borderBottom: "1px solid #e3e2de",
          color: "#37352f",
          fontSize: 14,
          outline: "none",
          marginBottom: 10,
        }}
      />
      <div style={{ display: "flex", gap: 8, marginBottom: 40 }}>
        <button
          onClick={handleSaveKey}
          disabled={!key.trim()}
          style={{
            background: keySaved ? "#0f7b6c" : "#37352f",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            padding: "7px 16px",
            fontSize: 13,
            cursor: key.trim() ? "pointer" : "default",
            opacity: key.trim() ? 1 : 0.4,
          }}
        >
          {keySaved ? "Saved" : "Save key"}
        </button>
        {keySet && (
          <button
            onClick={handleClearKey}
            style={{
              background: "none",
              color: "#9b9a97",
              border: "1px solid #e3e2de",
              borderRadius: 4,
              padding: "7px 16px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Remove
          </button>
        )}
      </div>

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
          { field: "floatingButton" as const, label: "Show camera button on pages", desc: "A 📷 button appears in the corner of every page." },
          { field: "shortcut" as const, label: "Keyboard shortcut", desc: "Set your shortcut at chrome://extensions/shortcuts." },
          { field: "immediate" as const, label: "Show answer immediately", desc: "Displays the explanation in the screenshot window instead of saving quietly." },
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

export default function App() {
  const [view, setView] = useState<View>("saves");
  const [captures, setCaptures] = useState<Capture[]>([]);

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

  return (
    <div style={{ minHeight: "100vh", background: "#fff", color: "#37352f" }}>
      <div style={{ borderBottom: "1px solid #e3e2de" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>
            ContextLens
            {captures.length > 0 && (
              <span style={{ color: "#9b9a97", fontWeight: 400, marginLeft: 6, fontSize: 14 }}>{captures.length}</span>
            )}
          </span>
          <nav style={{ display: "flex", gap: 24 }}>
            {(["saves", "words", "settings"] as View[]).map((v) => (
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
                {v}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 32px" }}>
        {view === "saves" && <SavesView captures={captures} />}
        {view === "words" && <WordsView captures={captures} />}
        {view === "settings" && <SettingsView />}
      </div>
    </div>
  );
}
