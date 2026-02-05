export type SeasonWindowOption = {
  id: string;
  label: string;
  startDate: string | null;
  endDate: string | null;
};

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const dateOnly = value.split("T")[0]?.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  return dateOnly;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

export function normalizeSeasonStarts(raw: unknown, fallbackDates: string[] = []): string[] {
  const starts: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const normalized = normalizeIsoDate(item);
      if (normalized) starts.push(normalized);
    }
  }
  for (const d of fallbackDates) {
    const normalized = normalizeIsoDate(d);
    if (normalized) starts.push(normalized);
  }
  return Array.from(new Set(starts)).sort();
}

function isDateInRange(date: string, startDate: string | null, endDate: string | null): boolean {
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}

export function buildSeasonWindowOptions(
  seasonStarts: string[],
  availableDates: string[]
): SeasonWindowOption[] {
  const normalizedStarts = Array.from(new Set(seasonStarts.filter(Boolean))).sort();
  const normalizedDates = Array.from(new Set(availableDates.filter(Boolean))).sort();
  const fallbackStart = normalizedDates[0] || null;
  if (fallbackStart && !normalizedStarts.length) normalizedStarts.push(fallbackStart);

  const windows: SeasonWindowOption[] = [];
  for (let i = 0; i < normalizedStarts.length; i += 1) {
    const startDate = normalizedStarts[i];
    const nextStart = normalizedStarts[i + 1] || null;
    const endDate = nextStart ? addDays(nextStart, -1) : null;
    const hasData = normalizedDates.some((d) => isDateInRange(d, startDate, endDate));
    if (!hasData) continue;
    const isCurrent = !nextStart;
    windows.push({
      id: `season_${startDate}`,
      label: isCurrent ? `Guncel Sezon (${startDate} - ...)` : `Sezon (${startDate} - ${endDate})`,
      startDate,
      endDate,
    });
  }

  windows.sort((a, b) => (a.startDate || "").localeCompare(b.startDate || "")).reverse();
  windows.push({ id: "all_time", label: "Tum Zamanlar", startDate: null, endDate: null });
  return windows;
}

export function filterDatesBySeason(dates: string[], window: SeasonWindowOption): string[] {
  return dates.filter((d) => isDateInRange(d, window.startDate, window.endDate));
}

export function filterDataBySeason<T>(
  allData: Record<string, T>,
  window: SeasonWindowOption
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [date, value] of Object.entries(allData || {})) {
    if (isDateInRange(date, window.startDate, window.endDate)) {
      out[date] = value;
    }
  }
  return out;
}
