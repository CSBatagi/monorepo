"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

type Theme = "light" | "dark";
type Design = "modern" | "classic";
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
const themeKey = (design: Design) => design === "classic" ? "cs-batagi-theme" : "cs-batagi-modern-theme";
function readTheme(design: Design): Theme {
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
      const saved = localStorage.getItem("cs-batagi-design");
      chosen = (requested || saved) === "classic" ? "classic" : "modern";
    } catch {}
    updateDesign(chosen);
    setTheme(readTheme(chosen));
    setMounted(true);
  }, []);
  useEffect(() => {
    if (!mounted) return;
    document.documentElement.dataset.design = design;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.body.classList.toggle("dark-theme", theme === "dark");
    try {
      localStorage.setItem("cs-batagi-design", design);
      localStorage.setItem(themeKey(design), theme);
    } catch {}
  }, [theme, design, mounted]);
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
