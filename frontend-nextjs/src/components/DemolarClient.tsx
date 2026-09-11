'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@/contexts/SessionContext';
import { useTheme } from '@/contexts/ThemeContext';
import { analysisLabel, formatRecordedAt, formatSize, recordingLabel, type DemoListing, type DemoRecord } from '@/lib/demos';

const POLL_MS = 30000;

const TONE: Record<string, string> = {
  ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  warn: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  busy: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  muted: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

function Badge({ text, tone, title }: { text: string; tone: string; title?: string }) {
  return <span title={title} className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TONE[tone] || TONE.muted}`}>{text}</span>;
}

function Score({ demo }: { demo: DemoRecord }) {
  if (!demo.teams || demo.teams.length < 2) return null;
  const [a, b] = demo.teams;
  return (
    <span className="ml-2 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400" title={`${a.name} ${a.score} - ${b.score} ${b.name}`}>
      <span className={a.score > b.score ? 'font-semibold text-gray-900 dark:text-gray-100' : ''}>{a.score}</span>
      {' : '}
      <span className={b.score > a.score ? 'font-semibold text-gray-900 dark:text-gray-100' : ''}>{b.score}</span>
    </span>
  );
}

export default function DemolarClient() {
  const { user, ready } = useSession();
  const { isDark } = useTheme();
  const [listing, setListing] = useState<DemoListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [onlyComplete, setOnlyComplete] = useState(true);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const disposed = useRef(false);

  const load = useCallback(async (refresh = false) => {
    try {
      const response = await fetch(`/api/demos${refresh ? '?refresh=1' : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(60000) });
      if (disposed.current) return;
      if (response.status === 401 || response.status === 403) { setError('Demoları görmek için giriş yapın.'); setListing(null); return; }
      if (!response.ok) { setError('Demo listesi alınamadı.'); return; }
      setListing(await response.json());
      setError(null);
    } catch {
      if (!disposed.current) setError('Demo listesi alınamadı.');
    } finally {
      if (!disposed.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    disposed.current = false;
    if (!ready) return;
    if (!user) { setLoading(false); setError('Demoları görmek için giriş yapın.'); return; }
    void load();
    fetch('/api/admin/check').then(r => r.json()).then(d => { if (!disposed.current) setIsAdmin(d.isAdmin === true); }).catch(() => {});
    return () => { disposed.current = true; };
  }, [ready, user, load]);

  const active = useMemo(() => (listing?.demos || []).some(d => d.analysis_state === 'queued' || d.analysis_state === 'analyzing'), [listing]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [active, load]);

  const requestAnalysis = async (demo: DemoRecord) => {
    const again = demo.analysis_state === 'analyzed';
    if (again && !confirm(`${demo.name} yeniden analiz edilsin mi? Mevcut istatistikleri bu demo için yeniden yazar.`)) return;
    setBusyName(demo.name);
    setNotice(null);
    try {
      const response = await fetch(`/api/demos/${encodeURIComponent(demo.name)}/analyze`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      setNotice(response.ok ? `${demo.name} analiz sırasına alındı. Sunucu boşken işlenir.` : `Hata: ${data.error || response.status}`);
      await load();
    } catch {
      setNotice('İstek gönderilemedi.');
    } finally {
      setBusyName(null);
    }
  };

  const demos = useMemo(() => {
    const all = listing?.demos || [];
    return onlyComplete ? all.filter(d => d.recording_state === 'map-ended' || d.recording_state === 'unknown' || d.recording_state === null) : all;
  }, [listing, onlyComplete]);

  const surface = isDark ? 'border-dark-border bg-dark-surface' : 'border-gray-200 bg-white';

  if (loading) return <p className="text-sm text-gray-500">Demolar yükleniyor...</p>;
  if (error && !listing) return <p className="text-sm text-red-600">{error}</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={onlyComplete} onChange={e => setOnlyComplete(e.target.checked)} />
          Sadece tamamlanan kayıtlar
        </label>
        <button type="button" onClick={() => void load(true)} className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800">
          Arşivi yenile
        </button>
        <span className="text-xs text-gray-500">{demos.length} demo{listing?.bucket.error ? ' · arşiv listesi alınamadı' : ''}</span>
        {active && <span className="text-xs text-amber-700 dark:text-amber-300">Analiz sürüyor, liste otomatik yenilenir.</span>}
      </div>
      {notice && <p className="text-sm text-blue-700 dark:text-blue-300">{notice}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className={`overflow-x-auto rounded-lg border ${surface}`}>
        <table className="min-w-full text-sm">
          <thead className={isDark ? 'bg-gray-800/60 text-gray-300' : 'bg-gray-50 text-gray-600'}>
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Tarih</th>
              <th className="px-3 py-2 font-medium">Harita</th>
              <th className="px-3 py-2 font-medium">Takımlar</th>
              <th className="px-3 py-2 font-medium">Boyut</th>
              <th className="px-3 py-2 font-medium">Kayıt</th>
              <th className="px-3 py-2 font-medium">İstatistik</th>
              <th className="px-3 py-2 font-medium">İndir</th>
              {isAdmin && <th className="px-3 py-2 font-medium">Yönetici</th>}
            </tr>
          </thead>
          <tbody>
            {demos.length === 0 && (
              <tr><td colSpan={isAdmin ? 8 : 7} className="px-3 py-6 text-center text-gray-500">Henüz demo yok.</td></tr>
            )}
            {demos.map(demo => {
              const recording = recordingLabel(demo.recording_state);
              const analysis = analysisLabel(demo);
              const downloadable = Boolean(demo.object_name);
              const queued = demo.analysis_state === 'queued' || demo.analysis_state === 'analyzing';
              return (
                <tr key={demo.name} className={`border-t ${isDark ? 'border-dark-border' : 'border-gray-100'}`}>
                  <td className="whitespace-nowrap px-3 py-2">{formatRecordedAt(demo.recorded_at)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{demo.map_name ? demo.map_name.replace(/^de_/, '') : '—'}</td>
                  <td className="px-3 py-2">
                    <span title={demo.name}>{demo.team1 && demo.team2 ? `${demo.team1} vs ${demo.team2}` : demo.name}</span>
                    <Score demo={demo} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{formatSize(demo.size)}</td>
                  <td className="px-3 py-2"><Badge text={recording.text} tone={recording.tone} /></td>
                  <td className="px-3 py-2">
                    <Badge text={analysis.text} tone={analysis.tone} title={demo.analysis_error || (demo.analysis_requested_by ? `İsteyen: ${demo.analysis_requested_by}` : undefined)} />
                    {demo.analysis_state === 'failed' && demo.analysis_error && (
                      <div className="mt-1 max-w-xs truncate text-xs text-red-600" title={demo.analysis_error}>{demo.analysis_error}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {downloadable ? (
                      <a href={`/api/demos/${encodeURIComponent(demo.name)}/download`} className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700">
                        İndir
                      </a>
                    ) : (
                      <span className="text-xs text-gray-500" title="Dosya arşive yüklendiğinde indirilebilir">Arşivleniyor</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="whitespace-nowrap px-3 py-2">
                      <button
                        type="button"
                        disabled={queued || busyName === demo.name || (!demo.on_game_server && !demo.object_name)}
                        onClick={() => void requestAnalysis(demo)}
                        className="rounded border border-purple-600 px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-purple-300 dark:hover:bg-purple-900/30"
                      >
                        {demo.analysis_state === 'analyzed' ? 'Yeniden analiz et' : 'Analiz et'}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        İndirme bağlantıları 15 dakika geçerlidir.{' '}
        {listing?.autoAnalyze
          ? 'Tamamlanan web sitesi maçları sunucu boşken otomatik analiz edilir; eski veya kesilen kayıtları yöneticiler elle sıraya alabilir.'
          : 'Otomatik analiz henüz kapalı; demolar yalnızca bir yönetici sıraya aldığında istatistiklere işlenir.'}
      </p>
    </div>
  );
}
