/** Shared demo archive types and helpers for the Demolar page and its API routes. */

export type DemoTeam = { name: string; score: number; letter: string };

export type DemoRecord = {
  name: string;
  object_name: string | null;
  size: number | string;
  match_id: number | string | null;
  map_name: string | null;
  team1: string | null;
  team2: string | null;
  recorded_at: string | null;
  recording_state: string | null;
  archive_state: string;
  on_game_server: boolean;
  analysis_state: 'none' | 'queued' | 'analyzing' | 'analyzed' | 'failed';
  analysis_force: boolean;
  analysis_requested_by: string | null;
  analysis_requested_at: string | null;
  analysis_started_at: string | null;
  analysis_finished_at: string | null;
  analysis_error: string | null;
  checksum: string | null;
  winner_name?: string | null;
  analyze_date?: string | null;
  duration?: number | null;
  teams?: DemoTeam[] | null;
};

export type DemoListing = {
  demos: DemoRecord[];
  autoAnalyze?: boolean;
  bucket: { refreshedAt: string | null; error: string | null; count: number };
};

const SAFE_NAME = /^[\p{L}\p{N}._-]{1,200}\.dem$/u;

export function isDemoName(name: string): boolean {
  return SAFE_NAME.test(name) && !name.includes('..');
}

export function formatSize(bytes: number | string): string {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(0)} MB`;
  return `${(value / 1024).toFixed(0)} KB`;
}

export function formatRecordedAt(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function recordingLabel(state: string | null): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  switch (state) {
    case 'map-ended': return { text: 'Tamamlandı', tone: 'ok' };
    case 'interrupted': return { text: 'Kesildi', tone: 'warn' };
    case 'reset': return { text: 'Sıfırlandı', tone: 'warn' };
    case 'recording': return { text: 'Kaydediliyor', tone: 'muted' };
    default: return { text: 'Eski kayıt', tone: 'muted' };
  }
}

export function analysisLabel(demo: DemoRecord): { text: string; tone: 'ok' | 'warn' | 'muted' | 'busy' } {
  switch (demo.analysis_state) {
    case 'analyzed': return { text: 'İstatistiklerde', tone: 'ok' };
    case 'queued': return { text: 'Sırada', tone: 'busy' };
    case 'analyzing': return { text: 'Analiz ediliyor', tone: 'busy' };
    case 'failed': return { text: 'Hata', tone: 'warn' };
    default: return { text: 'Analiz edilmedi', tone: 'muted' };
  }
}
