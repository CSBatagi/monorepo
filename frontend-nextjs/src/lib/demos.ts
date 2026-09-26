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
  origin?: 'server' | 'upload';
  uploaded_by?: string | null;
  uploader_name?: string | null;
  source_platform?: string | null;
  analysis_source?: string | null;
  original_name?: string | null;
  server_name?: string | null;
};

export type UploadSettings = { enabled: boolean; chunkBytes: number; minBytes: number; maxBytes: number; dailyLimit: number };

/** The game VM in its role as the analysis machine (backend/analysisServer.js). */
export type AnalysisServerState = {
  vm: 'running' | 'starting' | 'stopping' | 'stopped' | 'unknown';
  autoStart: boolean;
  autoStop: boolean;
  startPending: boolean;
  idleMinutes: number;
  idleSince: string | null;
  stopAt: string | null;
  busy: { reason: string; text: string | null } | null;
  lastEvent: string | null;
  stoppedAt: string | null;
  stoppedAutomatically: boolean;
};

export type DemoListing = {
  demos: DemoRecord[];
  autoAnalyze?: boolean;
  bucket: { refreshedAt: string | null; error: string | null; count: number };
  uploads?: UploadSettings;
  analysisServer?: AnalysisServerState | null;
};

/** Where an uploaded demo was played; shown next to the teams. */
export const UPLOAD_PLATFORMS: { value: string; label: string }[] = [
  { value: 'xplay', label: 'xplay.gg' },
  { value: 'faceit', label: 'FACEIT' },
  { value: 'other', label: 'Diğer sunucu' },
];

/**
 * `csdm analyze --source` values (CS Demo Manager 3.20.1). xplay.gg demos often carry no
 * recognisable source and only analyze as MatchZy, so that is the default.
 */
export const ANALYSIS_SOURCES: { value: string; label: string }[] = [
  { value: 'matchzy', label: 'MatchZy (önerilen, xplay dahil)' },
  { value: 'auto', label: 'Otomatik algıla' },
  { value: 'valve', label: 'Valve (matchmaking)' },
  { value: 'faceit', label: 'FACEIT' },
  { value: 'esea', label: 'ESEA' },
  { value: 'esl', label: 'ESL' },
  { value: 'ebot', label: 'eBot' },
  { value: 'esplay', label: 'Esplay' },
  { value: 'esportal', label: 'Esportal' },
  { value: 'esportligaen', label: 'Esportligaen' },
  { value: 'fastcup', label: 'Fastcup' },
  { value: '5eplay', label: '5EPlay' },
  { value: 'gamersclub', label: 'Gamers Club' },
  { value: 'challengermode', label: 'Challengermode' },
  { value: 'perfectworld', label: 'Perfect World' },
  { value: 'popflash', label: 'PopFlash' },
  { value: 'pracc', label: 'Pracc' },
  { value: 'renown', label: 'Renown' },
];

export function platformLabel(value: string | null | undefined): string {
  return UPLOAD_PLATFORMS.find(p => p.value === value)?.label || 'Harici';
}

const EXTRACT = 'İçindeki .dem dosyasını çıkarıp onu yükleyin.';
const FOREIGN_SIGNATURES: { bytes: number[]; message: string }[] = [
  { bytes: [0x50, 0x4b, 0x03, 0x04], message: `Bu bir ZIP arşivi. ${EXTRACT}` },
  { bytes: [0x1f, 0x8b], message: `Bu bir GZIP arşivi (.gz). ${EXTRACT}` },
  { bytes: [0x28, 0xb5, 0x2f, 0xfd], message: `Bu bir Zstandard arşivi (.zst). ${EXTRACT}` },
  { bytes: [0x52, 0x61, 0x72, 0x21], message: `Bu bir RAR arşivi. ${EXTRACT}` },
  { bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], message: `Bu bir 7z arşivi. ${EXTRACT}` },
  { bytes: [0x42, 0x5a, 0x68], message: `Bu bir BZIP2 arşivi. ${EXTRACT}` },
  { bytes: [...'HL2DEMO'].map(c => c.charCodeAt(0)), message: 'Bu bir CS:GO demosu; yalnızca CS2 demoları yüklenebilir.' },
];
const CS2_STAMP = [...'PBDEMS2'].map(c => c.charCodeAt(0)).concat(0);

/**
 * Quick check in the browser before any upload starts: extension, size and the CS2 stamp.
 * The backend re-validates every byte; this only saves members a pointless transfer.
 */
export async function precheckDemoFile(file: File, settings: UploadSettings): Promise<string | null> {
  if (!/\.dem$/i.test(file.name)) {
    return /\.(zip|gz|zst|rar|7z|bz2)$/i.test(file.name) ? `Arşiv dosyası seçildi. ${EXTRACT}` : 'Yalnızca .dem uzantılı CS2 demo dosyaları yüklenebilir.';
  }
  if (file.size < settings.minBytes) return 'Dosya bir maç demosu için çok küçük.';
  if (file.size > settings.maxBytes) return `Dosya çok büyük (en fazla ${formatSize(settings.maxBytes)}).`;
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  for (const signature of FOREIGN_SIGNATURES) {
    if (signature.bytes.every((byte, index) => head[index] === byte)) return signature.message;
  }
  if (!CS2_STAMP.every((byte, index) => head[index] === byte)) return 'Bu dosya bir CS2 demosu değil (.dem başlığı bulunamadı).';
  return null;
}

/** `datetime-local` value (browser time zone) for a timestamp. */
export function toLocalInputValue(time: number): string {
  const date = new Date(time);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

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

export function formatClock(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
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
    case 'uploaded': return { text: 'Yüklendi', tone: 'ok' };
    case 'truncated': return { text: 'Yarım kayıt', tone: 'warn' };
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
