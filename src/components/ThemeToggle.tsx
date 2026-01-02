// src/components/ThemeToggle.tsx
"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "amargosa.theme"; // "dark" | "light"

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path
        d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M12 2v2.2M12 19.8V22M4.2 12H2M22 12h-2.2M5.3 5.3 6.9 6.9M17.1 17.1l1.6 1.6M18.7 5.3 17.1 6.9M6.9 17.1l-1.6 1.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path
        d="M21 14.5A7.5 7.5 0 0 1 9.5 3a6.7 6.7 0 1 0 11.5 11.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function applyTheme(theme: "dark" | "light") {
  const root = document.documentElement;
  if (theme === "light") root.classList.add("theme-light");
  else root.classList.remove("theme-light");
}

function readStoredTheme(): "dark" | "light" | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function systemPrefersLight(): boolean {
  try {
    return window.matchMedia?.("(prefers-color-scheme: light)")?.matches ?? false;
  } catch {
    return false;
  }
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const stored = readStoredTheme();
    const initial: "dark" | "light" =
      stored ?? (systemPrefersLight() ? "light" : "dark");

    setTheme(initial);
    applyTheme(initial);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }

  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-[var(--ops-text-muted)] hover:bg-[var(--ops-hover)] focus:outline-none focus:ring-0"
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
