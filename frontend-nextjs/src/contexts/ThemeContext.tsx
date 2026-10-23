"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

type Theme = "light" | "dark";
type Design = "modern" | "boomer" | "cinematic";
const clubVersion = "warm-graphite";
interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  isDark: boolean;
  design: Design;
  setDesign: (design: Design) => void;
}
const ThemeContext = createContext<ThemeContextType>({
  theme: "dark", toggleTheme: () => {}, isDark: true, design: "modern", setDesign: () => {},
});
export function useTheme() { return useContext(ThemeContext); }
const themeKey = (design: Design) => design === "boomer" ? "cs-batagi-boomer-theme" : design === "cinematic" ? "cs-batagi-cinematic-theme" : "cs-batagi-modern-theme";
// Boomer Edition reuses the club styling (data-design="modern") with its own shell and home.
const cssDesign = (design: Design) => design === "boomer" ? "modern" : design;
function parseDesign(value: string | null): Design {
  // The original classic design was retired; its fans land on the Boomer Edition.
  if (value === "boomer" || value === "classic") return "boomer";
  return value === "cinematic" ? "cinematic" : "modern";
}
function readTheme(design: Design): Theme {
  if (design === "cinematic") return "dark";
  try {
    const value = localStorage.getItem(themeKey(design));
    if (value === "light" || value === "dark") return value;
  } catch { /* Storage may be disabled. Preferences still work for this session. */ }
  return design === "modern" ? "dark" : "light";
}
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [design, updateDesign] = useState<Design>("modern");
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    let chosen: Design = "modern";
    try {
      const requested = new URLSearchParams(window.location.search).get("ui");
      let saved: string | null = null;
      try { saved = localStorage.getItem("cs-batagi-design"); } catch {}
      const value = requested || saved;
      chosen = parseDesign(value);
    } catch {}
    updateDesign(chosen);
    setTheme(readTheme(chosen));
    setMounted(true);
  }, []);
  useEffect(() => {
    if (!mounted) return;
    document.documentElement.dataset.design = cssDesign(design);
    document.documentElement.dataset.edition = design === "boomer" ? "boomer" : "";
    document.documentElement.dataset.clubVersion = clubVersion;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.body.classList.toggle("dark-theme", theme === "dark");
    try {
      localStorage.setItem("cs-batagi-design", design);
      localStorage.setItem(themeKey(design), theme);
      localStorage.setItem("cs-batagi-club-version", clubVersion);
    } catch {}
  }, [theme, design, mounted, clubVersion]);
  const setDesign = useCallback((next: Design) => {
    updateDesign(next);
    setTheme(readTheme(next));
    // Keep a directly shared ?ui= URL consistent with the visible switch.
    const url = new URL(window.location.href);
    if (url.searchParams.has("ui")) {
      url.searchParams.set("ui", next);
      window.history.replaceState(window.history.state, "", url);
    }
  }, []);
  const toggleTheme = useCallback(() => setTheme(prev => prev === "dark" ? "light" : "dark"), []);
  return <ThemeContext.Provider value={{ theme, toggleTheme, isDark: theme === "dark", design, setDesign }}>{children}</ThemeContext.Provider>;
}
