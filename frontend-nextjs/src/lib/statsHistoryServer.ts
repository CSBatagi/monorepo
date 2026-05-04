import fs from "fs/promises";
import path from "path";
import type { DateKeyedPeriodPayload } from "./statsPeriods";

type DateKeyedDataset = "night_avg" | "sonmac_by_date";

function periodOverlapsRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  rangeStart: string | null,
  rangeEnd: string | null
): boolean {
  if (rangeStart && endDate && endDate < rangeStart) return false;
  if (rangeEnd && startDate && startDate > rangeEnd) return false;
  return true;
}

async function readStaticPeriod<T>(dataset: DateKeyedDataset, periodId: string): Promise<Record<string, T>> {
  try {
    const filePath = path.join(process.cwd(), "public", "data", "stats-history", dataset, `${periodId}.json`);
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function filterDateRange<T>(data: Record<string, T>, rangeStart: string | null, rangeEnd: string | null): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [date, value] of Object.entries(data || {})) {
    if (rangeStart && date < rangeStart) continue;
    if (rangeEnd && date > rangeEnd) continue;
    out[date] = value;
  }
  return out;
}

export async function readDateKeyedRangeFromStaticHistory<T = any>({
  dataset,
  payload,
  currentData,
  rangeStart,
  rangeEnd,
}: {
  dataset: DateKeyedDataset;
  payload: DateKeyedPeriodPayload<T> | null | undefined;
  currentData: Record<string, T>;
  rangeStart: string | null;
  rangeEnd: string | null;
}): Promise<Record<string, T>> {
  const merged: Record<string, T> = {};
  const currentPeriod = payload?.current_period;

  for (const period of payload?.periods || []) {
    if (!period?.id || period.id === "all_time") continue;
    if (!periodOverlapsRange(period.start_date, period.end_date, rangeStart, rangeEnd)) continue;
    const periodData = period.id === currentPeriod
      ? currentData
      : await readStaticPeriod<T>(dataset, period.id);
    Object.assign(merged, filterDateRange(periodData, rangeStart, rangeEnd));
  }

  if (Object.keys(merged).length > 0) return merged;
  return filterDateRange(currentData || {}, rangeStart, rangeEnd);
}
