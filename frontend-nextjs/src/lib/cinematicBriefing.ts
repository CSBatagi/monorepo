import { getDateKeyedPeriodData, isDateKeyedPeriodPayload } from './statsPeriods';

export type NightLeader = { name: string; steamId: string; rating: number | null; adr: number | null; kd: number | null };
export type NightMap = { name: string; team1: string; team2: string; score1: number | null; score2: number | null };
export type NightBriefing = { date: string; leaders: NightLeader[]; playerCount: number; maps: NightMap[] };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
function currentData(value: unknown) {
  return isDateKeyedPeriodPayload<unknown>(value) && value.current_period ? getDateKeyedPeriodData(value, value.current_period) : {};
}

/** Never pair one night's scores with another night's player averages. */
export function summarizeLastNight(payload: Record<string, unknown>): NightBriefing | null {
  const nights = currentData(payload.night_avg_periods), matches = currentData(payload.sonmac_by_date_periods);
  const dates = [...new Set([...Object.keys(nights), ...Object.keys(matches)])]
    .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date) && ((Array.isArray(nights[date]) && nights[date].length > 0) || Object.keys(record(record(matches[date]).maps)).length > 0)).sort();
  const date = dates.at(-1); if (!date) return null;
  const rows: NightLeader[] = (Array.isArray(nights[date]) ? nights[date] : []).map((raw: unknown) => {
    const row = record(raw);
    return { name: typeof row.name === 'string' ? row.name : '', steamId: String(row.steam_id || ''), rating: number(row['HLTV 2']), adr: number(row.ADR), kd: number(row['K/D']) };
  }).filter((row: NightLeader) => row.name).sort((a: NightLeader, b: NightLeader) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity) || a.name.localeCompare(b.name, 'tr'));
  const maps = Object.entries(record(record(matches[date]).maps)).map(([name, raw]): NightMap => {
    const map = record(raw), a = record(map.team1), b = record(map.team2);
    return { name: name.replace(/^de_/, ''), team1: typeof a.name === 'string' ? a.name : 'Takım 1', team2: typeof b.name === 'string' ? b.name : 'Takım 2', score1: number(a.score), score2: number(b.score) };
  });
  return { date, leaders: rows.slice(0, 3), playerCount: rows.length, maps };
}

export type AttendanceStatus = 'coming' | 'uncertain' | 'not_coming';
export function attendanceFields(status: AttendanceStatus) {
  return status === 'coming' ? { status } : { status, is_kaptan: false, kaptan_timestamp: null };
}
