import { buildSeasonWindowOptions, type SeasonWindowOption } from "./seasonRanges";

export type StatsPeriodEntry = {
  id: string;
  label?: string;
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean;
};

export type DateKeyedPeriodPayload<T = any> = {
  current_period?: string;
  season_starts?: string[];
  periods?: StatsPeriodEntry[];
  data?: Record<string, Record<string, T>>;
};

export function isDateKeyedPeriodPayload<T = any>(value: unknown): value is DateKeyedPeriodPayload<T> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as DateKeyedPeriodPayload<T>).data === "object" &&
      (value as DateKeyedPeriodPayload<T>).data !== null
  );
}

export function mergeDateKeyedPeriodData<T = any>(payload: DateKeyedPeriodPayload<T> | null | undefined): Record<string, T> {
  const merged: Record<string, T> = {};
  const data = payload?.data || {};
  for (const period of payload?.periods || []) {
    if (!period?.id || period.id === "all_time") continue;
    Object.assign(merged, data[period.id] || {});
  }
  return merged;
}

export function getDateKeyedPeriodData<T = any>(
  payload: DateKeyedPeriodPayload<T> | null | undefined,
  periodId: string
): Record<string, T> {
  if (!payload?.data) return {};
  if (periodId === "all_time") {
    return payload.data.all_time || mergeDateKeyedPeriodData(payload);
  }
  return payload.data[periodId] || {};
}

export function getStaticStatsHistoryUrl(dataset: "night_avg" | "sonmac_by_date", periodId: string): string {
  return `/data/stats-history/${dataset}/${periodId}.json`;
}

export async function fetchStaticDateKeyedPeriod<T = any>(
  dataset: "night_avg" | "sonmac_by_date",
  periodId: string
): Promise<Record<string, T>> {
  const res = await fetch(getStaticStatsHistoryUrl(dataset, periodId), { cache: "force-cache" });
  if (!res.ok) return {};
  const data = await res.json();
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

export async function loadDateKeyedPeriodSelection<T = any>({
  dataset,
  payload,
  periodId,
  loadedData,
}: {
  dataset: "night_avg" | "sonmac_by_date";
  payload: DateKeyedPeriodPayload<T> | null | undefined;
  periodId: string;
  loadedData: Record<string, Record<string, T>>;
}): Promise<Record<string, Record<string, T>>> {
  if (!payload?.periods?.length) return loadedData;

  const nextData = { ...loadedData };
  if (periodId !== "all_time") {
    if (!nextData[periodId]) {
      nextData[periodId] = await fetchStaticDateKeyedPeriod<T>(dataset, periodId);
    }
    return nextData;
  }

  const periodIds = payload.periods
    .map((period) => period.id)
    .filter((id): id is string => Boolean(id && id !== "all_time"));
  await Promise.all(
    periodIds.map(async (id) => {
      if (!nextData[id]) {
        nextData[id] = await fetchStaticDateKeyedPeriod<T>(dataset, id);
      }
    })
  );
  nextData.all_time = periodIds.reduce<Record<string, T>>((merged, id) => {
    Object.assign(merged, nextData[id] || {});
    return merged;
  }, {});
  return nextData;
}

export function dateKeysForPeriodPayload<T = any>(payload: DateKeyedPeriodPayload<T> | null | undefined): string[] {
  return Object.keys(mergeDateKeyedPeriodData(payload)).sort();
}

export function buildPeriodWindowOptions<T = any>(
  payload: DateKeyedPeriodPayload<T> | null | undefined,
  fallbackSeasonStarts: string[],
  fallbackDates: string[]
): SeasonWindowOption[] {
  if (!payload?.periods?.length || !payload.data) {
    return buildSeasonWindowOptions(fallbackSeasonStarts, fallbackDates);
  }

  const options: SeasonWindowOption[] = [];
  const hasPeriods = payload.periods.some((period) => period?.id && period.id !== "all_time");
  for (const period of payload.periods) {
    if (!period?.id) continue;
    if (period.id === "all_time" && !hasPeriods) continue;
    options.push({
      id: period.id,
      label: period.label || period.id,
      startDate: period.start_date || null,
      endDate: period.end_date || null,
    });
  }

  return options.length ? options : buildSeasonWindowOptions(fallbackSeasonStarts, fallbackDates);
}

export function filterDateKeyedDataByRange<T = any>(
  data: Record<string, T>,
  startDate: string | null,
  endDate: string | null
): Record<string, T> {
  const filtered: Record<string, T> = {};
  for (const [date, value] of Object.entries(data || {})) {
    if (startDate && date < startDate) continue;
    if (endDate && date > endDate) continue;
    filtered[date] = value;
  }
  return filtered;
}
