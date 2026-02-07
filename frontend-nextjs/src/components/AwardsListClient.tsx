"use client";
import React, { useEffect, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";

export interface PlayerAward {
  name: string;
  totalHltvDiff: number;
  totalAdrDiff: number;
  gameCount: number;
  performanceScore: number;
  avgHltvDiff: number;
  avgAdrDiff: number;
}

export default function AwardsListClient({ players, color }: { players: PlayerAward[]; color: "green" | "red" }) {
  const { isDark } = useTheme();
  const colorClass = color === "green" 
    ? (isDark ? "text-green-400" : "text-green-700") 
    : (isDark ? "text-red-400" : "text-red-700");
  const NAME_WIDTH = 15;
  const NR_WIDTH = 2;
  const SKOR_WIDTH = 17;

  // Responsive: detect if mobile
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return (
    <div className="font-mono text-base">
      {players.map((p, i) => {
        const nr = String(i + 1).padStart(NR_WIDTH, " ");
        const name = p.name.length > NAME_WIDTH ? p.name.slice(0, NAME_WIDTH) : p.name.padEnd(NAME_WIDTH, " ");
        const separator = " |";
        const numberAndName = `${nr}. ${name}${separator}`;
        const skorSign = p.performanceScore >= 0 ? "+" : "-";
        const skorValue = Math.abs(p.performanceScore).toFixed(2);
        const skorTextRaw = `SKOR: ${skorSign}${skorValue}`;
        // Responsive padding
        const skorText = isMobile
          ? skorTextRaw.padEnd(SKOR_WIDTH, " ")
          : skorTextRaw.padStart(SKOR_WIDTH, " ");
        const detailsText = `(HLTV DIFF: ${p.avgHltvDiff.toFixed(2)}, ADR DIFF: ${p.avgAdrDiff.toFixed(2)}, MAÇ: ${p.gameCount})`;

        return (
          <div key={p.name} className="mb-2">
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <span className={`font-bold ${colorClass}`} style={{ whiteSpace: 'pre' }}>
                {numberAndName}
              </span>
              <span
                className={colorClass + " font-bold text-right md:text-left"}
                style={{ whiteSpace: 'pre', display: 'inline-block', minWidth: `${SKOR_WIDTH}ch` }}
              >
                {skorText}
              </span>
            </div>
            <div className="ml-4">
              <span className={`text-[11px] sm:text-sm ${isDark ? 'text-gray-400' : 'text-black'}`}>
                {detailsText}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
} 