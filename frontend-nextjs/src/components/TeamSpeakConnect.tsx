'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Download, Headphones, RefreshCw, ShieldCheck } from 'lucide-react';
import { useSession } from '@/contexts/SessionContext';
import './teamspeak.css';

type Connection = { url: string; expiresAt: number | null; state: 'waiting' | 'code_sent' | 'verified'; requestId: string | null };
const devices = new Map<string, string>();
function deviceFor(steamId: string) {
  const key = 'csbatagi-teamspeak-device:' + steamId;
  try {
    const saved = localStorage.getItem(key);
    if (saved && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)) return saved;
    const created = crypto.randomUUID(); localStorage.setItem(key, created); return created;
  } catch {
    if (!devices.has(steamId)) devices.set(steamId, crypto.randomUUID());
    return devices.get(steamId)!;
  }
}
function checked(data: Connection) {
  if (!data || !['waiting', 'code_sent', 'verified'].includes(data.state) || typeof data.url !== 'string') throw new Error('Bağlantı hazırlanamadı.');
  const url = new URL(data.url);
  if (url.protocol !== 'ts3server:' || url.searchParams.has('token') || url.searchParams.has('password') ||
      (data.expiresAt !== null && !Number.isFinite(data.expiresAt))) throw new Error('Bağlantı hazırlanamadı.');
  return data;
}

export default function TeamSpeakConnect() {
  const { user, ready } = useSession();
  const steamId = user?.steamId;
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launched, setLaunched] = useState(false);
  const [code, setCode] = useState('');
  const request = useRef<AbortController | null>(null);
  const current = useRef({ connection, launched });
  useEffect(() => { current.current = { connection, launched }; }, [connection, launched]);
  const send = useCallback(async (action: string, body: Record<string, unknown>, signal?: AbortSignal) => {
    if (!steamId) throw new Error('Steam ile giriş yap.');
    const response = await fetch('/api/teamspeak/' + action, { method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: deviceFor(steamId), ...body }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Bağlantı hazırlanamadı. Yeniden dene.');
    return checked(data);
  }, [steamId]);
  const prepare = useCallback(async (reset = false) => {
    if (!steamId) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const previous = current.current;
    const keepOpen = reset && previous.connection?.state !== 'verified' &&
      (previous.launched || previous.connection?.state === 'code_sent');
    setLoading(true); setError(null); setConnection(null); setCode(''); setLaunched(keepOpen);
    try {
      const data = await send('join', { reset }, controller.signal);
      if (!controller.signal.aborted) {
        setConnection(data);
        if (keepOpen && new URL(data.url).searchParams.get('nickname') !== new URL(previous.connection!.url).searchParams.get('nickname')) {
          setLaunched(false);
          setError('Önce TeamSpeak içindeki mevcut CS Batağı bağlantısını kes. Sonra buradan bir kez aç.');
        }
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Bağlantı hazırlanamadı.');
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [steamId, send]);

  useEffect(() => {
    setLaunched(false); setConnection(null); setError(null); setCode('');
    if (ready && steamId) void prepare();
    return () => { request.current?.abort(); };
  }, [ready, steamId, prepare]);
  useEffect(() => {
    if (!connection?.expiresAt) return;
    const timer = setTimeout(() => {
      setConnection(null); setLaunched(false); setCode(''); setError('Doğrulama süresi doldu. Bağlantıyı yenile.');
    }, Math.max(0, connection.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [connection?.expiresAt]);
  useEffect(() => {
    if (!launched || connection?.state !== 'waiting' || !connection.requestId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const value = await send('status', { requestId: connection.requestId }, controller.signal);
          if (!controller.signal.aborted) { setConnection(value); setError(null); }
        } catch (failure) {
          if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Doğrulama bekleniyor.');
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(() => { void poll(); }, 5000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [launched, connection?.state, connection?.requestId, send]);

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (!connection?.requestId || !/^[0-9A-F]{10}$/i.test(code) || verifying) return;
    setVerifying(true); setError(null);
    try { setConnection(await send('verify', { requestId: connection.requestId, code: code.toUpperCase() })); setCode(''); setLaunched(true); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Kod doğrulanamadı.'); }
    finally { setVerifying(false); }
  };
  return <section id="teamspeak" className="teamspeak-connect" aria-label="TeamSpeak sesli sohbet">
    <div className="teamspeak-copy"><span className="teamspeak-icon"><Headphones size={24} /></span><div>
      <h2>Sesliye gel · TeamSpeak</h2>
      <p>Steam hesabınla kulübe katıl. Adres veya şifre yazmadan bağlan.</p>
      <small>İlk kez: TeamSpeak 3’ü kur, bağlantıyı aç, uygulamanın özel mesajındaki kodu burada doğrula. Sonraki girişler tek tık.</small>
    </div></div>
    <div className="teamspeak-actions">
      {!ready || loading ? <button disabled aria-busy="true"><Headphones size={17} /> Bağlantı hazırlanıyor…</button>
        : !user ? <Link prefetch={false} href="/login?next=%2Fteamspeak">Steam ile giriş yap</Link>
        : connection && (launched || connection.state === 'code_sent') ? <button disabled><Headphones size={17} />
          {connection.state === 'verified' ? 'TeamSpeak bağlantın açık' : 'TeamSpeak açık · kodu doğrula'}</button>
        : connection ? <a className="teamspeak-join" href={connection.url} onClick={event => {
          if (connection.expiresAt && connection.expiresAt <= Date.now()) { event.preventDefault(); void prepare(true); return; }
          setLaunched(true);
        }}><Headphones size={17} /> {connection.state === 'verified' ? 'TeamSpeak’e katıl' : 'TeamSpeak’i aç'}</a>
        : <button onClick={() => { void prepare(); }}><RefreshCw size={17} /> {error ? 'Tekrar dene' : 'Bağlantıyı hazırla'}</button>}
      <a className="teamspeak-download" href="https://www.teamspeak.com/en/downloads/?product=ts3" target="_blank" rel="noopener noreferrer"><Download size={16} /> TeamSpeak 3’ü indir</a>
    </div>
    {connection?.state === 'code_sent' && <form className="teamspeak-verification" onSubmit={event => { void verify(event); }}>
      <label htmlFor="teamspeak-code">TeamSpeak özel mesajındaki doğrulama kodu</label>
      <div><input id="teamspeak-code" value={code} onChange={event => setCode(event.target.value.replace(/[^0-9a-f]/gi, '').toUpperCase().slice(0, 10))}
        autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={10} placeholder="10 karakterli kod" aria-describedby="teamspeak-code-help" />
        <button disabled={verifying || code.length !== 10}><ShieldCheck size={16} /> {verifying ? 'Doğrulanıyor…' : 'Kimliğimi doğrula'}</button></div>
      <small id="teamspeak-code-help">Kod yalnızca bağlı TeamSpeak kimliğine gönderilir. Kimseyle paylaşma. Bu cihaz için bir kez yeterli.</small>
    </form>}
    {error && <p className="teamspeak-feedback" role="alert">{error}</p>}
    {launched && connection?.state === 'waiting' && !error && <p className="teamspeak-feedback" role="status">Tarayıcının “TeamSpeak’i aç” isteğini onayla. Doğrulama lobisinde bekle; özel mesaj gelince kod alanı burada açılır.</p>}
    {connection?.state === 'verified' && <p className="teamspeak-feedback" role="status"><ShieldCheck size={16} /> Steam kimliğin bağlı. Sesli odaya katılabilirsin.</p>}
    {connection && <button className="teamspeak-reset" onClick={() => { void prepare(true); }}>
      {connection.state === 'verified' ? 'Yeni TeamSpeak kimliği mi? Yeniden doğrula' : launched || connection.state === 'code_sent' ? 'Aynı bağlantıda yeni kod iste' : 'Bağlantı açılmadı mı? Doğrulamayı yeniden başlat'}
    </button>}
  </section>;
}
