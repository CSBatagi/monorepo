import { getDateKeyedPeriodData, isDateKeyedPeriodPayload } from './statsPeriods';
import { performanceScore } from './performanceScore';

export type NightLeader = { name: string; steamId: string; rating: number | null; adr: number | null; kd: number | null; hltvDiff: number | null; adrDiff: number | null; score: number | null };
export type NightMap = { name: string; team1: string; team2: string; score1: number | null; score2: number | null };
export type NightBriefing = { date: string; leaders: NightLeader[]; bottom: NightLeader[]; playerCount: number; rankedCount: number; maps: NightMap[] };
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
    const rating = number(row['HLTV 2']), adr = number(row.ADR);
    const hltvDiff = number(row['HLTV2 DIFF']), adrDiff = number(row['ADR DIFF']);
    // The generator uses a zero baseline for players without history. Monthly
    // awards exclude these rows too: an unknown expectation is not performance.
    const eligible = hltvDiff !== null && adrDiff !== null && !(hltvDiff === rating && adrDiff === adr);
    return { name: typeof row.name === 'string' ? row.name : '', steamId: String(row.steam_id || ''), rating, adr, kd: number(row['K/D']), hltvDiff, adrDiff, score: eligible ? performanceScore(hltvDiff, adrDiff) : null };
  }).filter((row: NightLeader) => row.name);
  const ranked = rows.filter(row => row.score !== null).sort((a, b) => b.score! - a.score! || a.name.localeCompare(b.name, 'tr'));
  const maps = Object.entries(record(record(matches[date]).maps)).map(([name, raw]): NightMap => {
    const map = record(raw), a = record(map.team1), b = record(map.team2);
    return { name: name.replace(/^de_/, ''), team1: typeof a.name === 'string' ? a.name : 'Takım 1', team2: typeof b.name === 'string' ? b.name : 'Takım 2', score1: number(a.score), score2: number(b.score) };
  });
  return { date, leaders: ranked.filter(row => row.score! > 0).slice(0, 3), bottom: ranked.filter(row => row.score! < 0).reverse().slice(0, 3), playerCount: rows.length, rankedCount: ranked.length, maps };
}

export type AttendanceStatus = 'coming' | 'uncertain' | 'not_coming';
export function attendanceFields(status: AttendanceStatus) {
  return status === 'coming' ? { status } : { status, is_kaptan: false, kaptan_timestamp: null };
}
