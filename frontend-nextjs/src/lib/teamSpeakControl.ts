import { NextRequest, NextResponse } from 'next/server';
import { gameControl } from './gameControl';

const publicErrors = new Set([
  'TeamSpeak için Steam ile giriş yap.', 'TeamSpeak yalnızca kulüp üyelerine açıktır.',
  'Üyelik doğrulanamadı. Yeniden Steam ile giriş yap.', 'Biraz bekleyip tekrar dene.',
  'TeamSpeak bağlantısı henüz etkinleştirilmedi.', 'Doğrulama isteği geçersiz.',
  'Kod eşleşmedi. TeamSpeak özel mesajındaki kodu kontrol et.', 'Doğrulama süresi doldu. Bağlantıyı yenile.',
  'Bu TeamSpeak kimliği başka bir Steam hesabına bağlı. TeamSpeak içinde yeni bir kimlik oluştur.',
  'TeamSpeak bağlantını açık tut ve tekrar dene.', 'Doğrulama yeniden başlatılmalı. Bağlantıyı yenile.',
]);
export async function teamSpeakControl(req: NextRequest, action: 'join' | 'status' | 'verify') {
  let body;
  try { body = JSON.stringify(await req.json()); }
  catch { return NextResponse.json({ error: 'Doğrulama isteği geçersiz.' }, { status: 400 }); }
  const response = await gameControl(req, 'teamspeak/' + action, 'POST', { body });
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  try {
    const data = await response.json();
    if (!response.ok) return NextResponse.json({ error: publicErrors.has(data.error) ? data.error : 'TeamSpeak şu anda yanıt vermiyor. Biraz sonra tekrar dene.' }, { status: response.status, headers });
    const url = new URL(data.url);
    const allowed = new Set(['port', 'nickname', 'cid', 'addbookmark']);
    if (url.protocol !== 'ts3server:' || url.username || url.password || url.hash || (url.pathname && url.pathname !== '/') ||
        url.hostname.toLowerCase() !== (process.env.TEAMSPEAK_HOST || 'voice.csbatagi.com').toLowerCase() || [...url.searchParams.keys()].some(key => !allowed.has(key)) ||
        !['waiting', 'code_sent', 'verified'].includes(data.state) ||
        (data.expiresAt !== null && !Number.isFinite(data.expiresAt)) ||
        (data.requestId !== null && (typeof data.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.requestId)))) throw new Error('Invalid connection');
    // Allowlist the response: accidental backend debug fields/credentials and
    // invitation/password URL parameters can never be forwarded to the browser.
    return NextResponse.json({ url: data.url, state: data.state, expiresAt: data.expiresAt, requestId: data.requestId }, { headers });
  } catch {
    return NextResponse.json({ error: 'TeamSpeak bağlantısı doğrulanamadı. Biraz sonra tekrar dene.' }, { status: response.ok ? 502 : response.status, headers });
  }
}
