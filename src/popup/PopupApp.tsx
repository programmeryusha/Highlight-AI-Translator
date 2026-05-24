import React, { useEffect, useState } from "react";

type AppMode = "language_learning" | "student";
type ThemeName = "light" | "dark";
type FontSize = "sm" | "md" | "lg";

const DEFAULT_ACCENT_COLOR = "#38bdf8";
const THEME_STORAGE_KEY = "contextlens_theme";

function normalizeHexColor(value: unknown, fallback = DEFAULT_ACCENT_COLOR): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`;
  return fallback;
}

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

function colorsFor(theme: ThemeName, accent: string) {
  const dark = theme === "dark";
  return {
    bg: dark ? "#171717" : "#fff",
    text: dark ? "#f4f1ea" : "#37352f",
    muted: dark ? "#a8a29e" : "#8d8b86",
    border: dark ? "#34312c" : "#e3e2de",
    surface: dark ? "#1d1b18" : "#fff",
    subtle: dark ? "#24221f" : "#f7f6f3",
    accent,
  };
}

export default function PopupApp() {
  const [appMode, setAppMode] = useState<AppMode>("language_learning");
  const [theme, setTheme] = useState<ThemeName>(() => storedThemeFallback("dark"));
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT_COLOR);
  const [fontSize, setFontSize] = useState<FontSize>("md");

  useEffect(() => {
    chrome.storage.local.get(["app_mode", "theme", "accent_color", "card_font_size"], (result) => {
      setAppMode(result.app_mode ?? "language_learning");
      const nextTheme = isThemeName(result.theme) ? result.theme : "light";
      setTheme(nextTheme);
      rememberTheme(nextTheme);
      setAccentColor(normalizeHexColor(result.accent_color));
      setFontSize(result.card_font_size ?? "md");
    });
  }, []);

  function updateMode(mode: AppMode) {
    setAppMode(mode);
    chrome.storage.local.set({ app_mode: mode });
  }

  function updateFontSize(size: FontSize) {
    setFontSize(size);
    chrome.storage.local.set({ card_font_size: size });
  }

  function openDashboard() {
    chrome.runtime.openOptionsPage();
    window.close();
  }

  const colors = colorsFor(theme, accentColor);

  return (
    <div style={{ background: colors.bg, color: colors.text, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <p style={{ fontSize: 15, fontWeight: 750, margin: 0 }}>ContextLens</p>
        <span style={{ width: 9, height: 9, borderRadius: 999, background: colors.accent, flexShrink: 0 }} />
      </div>

      <label style={{ display: "block", marginBottom: 12 }}>
        <span style={{ display: "block", fontSize: 12, color: colors.muted, marginBottom: 6, fontWeight: 650 }}>Mode</span>
        <select
          value={appMode}
          onChange={(event) => updateMode(event.target.value as AppMode)}
          style={{
            width: "100%",
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            background: colors.surface,
            color: colors.text,
            padding: "9px 10px",
            fontSize: 14,
            outline: "none",
          }}
        >
          <option value="language_learning">Language</option>
          <option value="student">Student</option>
        </select>
      </label>

      <div style={{ marginBottom: 12 }}>
        <span style={{ display: "block", fontSize: 12, color: colors.muted, marginBottom: 6, fontWeight: 650 }}>Text size</span>
        <div style={{ display: "flex", gap: 6 }}>
          {(["sm", "md", "lg"] as FontSize[]).map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => updateFontSize(size)}
              style={{
                flex: 1,
                border: `1px solid ${fontSize === size ? colors.accent : colors.border}`,
                borderRadius: 8,
                background: fontSize === size ? colors.accent : colors.surface,
                color: fontSize === size ? "#fff" : colors.text,
                padding: "7px 0",
                fontSize: size === "sm" ? 12 : size === "lg" ? 16 : 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {size === "sm" ? "S" : size === "md" ? "M" : "L"}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={openDashboard}
        style={{
          width: "100%",
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          background: colors.subtle,
          color: colors.text,
          padding: "9px 10px",
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Open Dashboard
      </button>
    </div>
  );
}
