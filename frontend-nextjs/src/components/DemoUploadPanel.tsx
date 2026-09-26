'use client';

import { useEffect, useRef, useState } from 'react';
import { ANALYSIS_SOURCES, UPLOAD_PLATFORMS, formatSize, precheckDemoFile, toLocalInputValue, type UploadSettings } from '@/lib/demos';

const MAX_RETRIES = 6;
const RETRYABLE = new Set([500, 502, 503, 504]);

type ChunkResult = { received: number; done: boolean };

class UploadFailure extends Error {}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}

// Sends one chunk; retries network errors and busy/relay failures, and resynchronises when the
// server already holds more bytes (a response lost after the chunk was stored).
async function sendChunk(id: string, offset: number, chunk: Blob, signal: AbortSignal): Promise<ChunkResult> {
  for (let attempt = 0; ; attempt++) {
    let response: Response | null = null;
    try {
      response = await fetch(`/api/demos/uploads/${id}?offset=${offset}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk, signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
    }
    if (response) {
      const data = await response.json().catch(() => ({}));
      if (response.ok) return data as ChunkResult;
      if (response.status === 409 && typeof data.received === 'number') return { received: data.received, done: false };
      if (response.status === 410 && data.state === 'complete') return { received: Number.MAX_SAFE_INTEGER, done: true };
      if (!RETRYABLE.has(response.status) || attempt >= MAX_RETRIES) throw new UploadFailure(data.error || `Yükleme başarısız (HTTP ${response.status}).`);
    } else if (attempt >= MAX_RETRIES) {
      throw new UploadFailure('Bağlantı koptu; yüklemeyi yeniden başlatın.');
    }
    await wait(Math.min(30000, 1000 * 2 ** attempt), signal);
  }
}

export default function DemoUploadPanel({ settings, isDark, onUploaded }: {
  settings: UploadSettings;
  isDark: boolean;
  onUploaded: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [platform, setPlatform] = useState('xplay');
  const [source, setSource] = useState('matchzy');
  const [playedAt, setPlayedAt] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const uploadId = useRef<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const uploading = sent !== null;

  useEffect(() => {
    if (!uploading) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploading]);

  useEffect(() => () => abort.current?.abort(), []);

  const choose = async (picked: File | null) => {
    setFile(null);
    setProblem(null);
    if (!picked) return;
    const reason = await precheckDemoFile(picked, settings);
    if (reason) { setProblem(reason); if (input.current) input.current.value = ''; return; }
    setFile(picked);
    // A demo downloaded right after the match (or extracted from its archive) carries a close timestamp.
    setPlayedAt(toLocalInputValue(picked.lastModified || Date.now()));
  };

  const upload = async () => {
    if (!file || uploading) return;
    const recordedAt = new Date(playedAt);
    if (Number.isNaN(recordedAt.getTime())) { setProblem('Maç tarihini girin.'); return; }
    const controller = new AbortController();
    abort.current = controller;
    setProblem(null);
    setSent(0);
    try {
      const started = await fetch('/api/demos/uploads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ fileName: file.name, size: file.size, platform, source, recordedAt: recordedAt.toISOString() }),
      });
      const session = await started.json().catch(() => ({}));
      if (!started.ok) throw new UploadFailure(session.error || `Yükleme başlatılamadı (HTTP ${started.status}).`);
      uploadId.current = session.id;
      let offset = 0;
      for (;;) {
        const result = await sendChunk(session.id, offset, file.slice(offset, offset + session.chunkSize), controller.signal);
        offset = Math.min(result.received, file.size);
        setSent(offset);
        if (result.done) break;
      }
      uploadId.current = null;
      setFile(null);
      if (input.current) input.current.value = '';
      onUploaded(`${file.name} yüklendi. Bir yönetici analiz ettiğinde istatistiklere işlenir.`);
    } catch (error) {
      if (controller.signal.aborted) setProblem('Yükleme iptal edildi.');
      else setProblem(error instanceof UploadFailure ? error.message : 'Yükleme başarısız; bağlantınızı kontrol edip yeniden deneyin.');
      if (uploadId.current) void fetch(`/api/demos/uploads/${uploadId.current}`, { method: 'DELETE' }).catch(() => {});
      uploadId.current = null;
    } finally {
      abort.current = null;
      setSent(null);
    }
  };

  const field = `rounded border px-2 py-1 text-sm ${isDark ? 'border-dark-border bg-dark-surface text-gray-100' : 'border-gray-300 bg-white'}`;
  const percent = file && sent !== null ? Math.floor((sent / file.size) * 100) : 0;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded border border-blue-600 px-3 py-1 text-sm font-medium text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-900/30">
        Başka sunucudan demo yükle
      </button>
    );
  }

  return (
    <div className={`space-y-3 rounded-lg border p-4 text-sm ${isDark ? 'border-dark-border bg-dark-surface' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Başka sunucudan demo yükle</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            xplay.gg, FACEIT veya başka bir sunucuda oynanan maçların CS2 demolarını ekleyin. Yalnızca .dem dosyaları kabul edilir
            (en fazla {formatSize(settings.maxBytes)}, günde {settings.dailyLimit} yükleme); .zip, .gz veya .zst arşivlerini önce çıkarın.
            Dosyanın her baytı demo biçimine göre denetlenir. Yüklenen demoları tüm üyeler indirebilir; istatistiklere ancak bir yönetici analiz ettiğinde işlenir.
          </p>
        </div>
        {!uploading && <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-500 hover:underline">Kapat</button>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs font-medium">Demo dosyası (.dem)</span>
          <input ref={input} type="file" accept=".dem" disabled={uploading} onChange={e => void choose(e.target.files?.[0] || null)} className="text-sm" />
          {file && <span className="text-xs text-gray-500">{file.name} · {formatSize(file.size)}</span>}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium">Oynandığı yer</span>
          <select value={platform} disabled={uploading} onChange={e => setPlatform(e.target.value)} className={field}>
            {UPLOAD_PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium">Maç tarihi ve saati</span>
          <input type="datetime-local" value={playedAt} disabled={uploading} onChange={e => setPlayedAt(e.target.value)} className={field} />
          <span className="text-xs text-gray-500">İstatistikler bu tarihin gecesine yazılır.</span>
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs font-medium">Analiz türü</span>
          <select value={source} disabled={uploading} onChange={e => setSource(e.target.value)} className={field}>
            {ANALYSIS_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <span className="text-xs text-gray-500">xplay demoları çoğu zaman kaynak bilgisi taşımaz; MatchZy seçili kalırsa sorunsuz analiz edilir.</span>
        </label>
      </div>
      {uploading && (
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-xs text-gray-500">%{percent} · {formatSize(sent || 0)} / {file ? formatSize(file.size) : ''} — sayfayı kapatmayın.</p>
        </div>
      )}
      {problem && <p className="text-sm text-red-600">{problem}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={!file || uploading} onClick={() => void upload()}
          className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">
          Yükle
        </button>
        {uploading && (
          <button type="button" onClick={() => abort.current?.abort()} className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800">
            İptal
          </button>
        )}
      </div>
    </div>
  );
}
