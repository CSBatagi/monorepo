"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

type Theme = "light" | "dark";
type Design = "modern" | "classic";
type ClubVersion = "original" | "panels" | "warm" | "graphite";
const clubVersions: ClubVersion[] = ["original", "panels", "warm", "graphite"];
interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  isDark: boolean;
  design: Design;
  setDesign: (design: Design) => void;
  clubVersion: ClubVersion;
  cycleClubVersion: () => void;
}
const ThemeContext = createContext<ThemeContextType>({
  theme: "dark", toggleTheme: () => {}, isDark: true, design: "modern", setDesign: () => {},
  clubVersion: "original", cycleClubVersion: () => {},
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
  const [clubVersion, setClubVersion] = useState<ClubVersion>("original");
  useEffect(() => {
    let chosen: Design = "modern";
    try {
      const requested = new URLSearchParams(window.location.search).get("ui");
      const saved = localStorage.getItem("cs-batagi-design");
      chosen = (requested || saved) === "classic" ? "classic" : "modern";
    } catch {}
    updateDesign(chosen);
    try {
      const saved = localStorage.getItem("cs-batagi-club-version");
      if (clubVersions.includes(saved as ClubVersion)) setClubVersion(saved as ClubVersion);
    } catch {}
    setTheme(readTheme(chosen));
    setMounted(true);
  }, []);
  useEffect(() => {
    if (!mounted) return;
    document.documentElement.dataset.design = design;
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
  const cycleClubVersion = useCallback(() => setClubVersion(prev => clubVersions[(clubVersions.indexOf(prev) + 1) % clubVersions.length]), []);
  return <ThemeContext.Provider value={{ theme, toggleTheme, isDark: theme === "dark", design, setDesign, clubVersion, cycleClubVersion }}>{children}</ThemeContext.Provider>;
}
