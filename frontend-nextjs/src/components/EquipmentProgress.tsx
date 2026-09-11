'use client';

import { useEffect, useRef, useState } from 'react';
import { Award, Coins, Trophy } from 'lucide-react';
import { CosmeticAccount } from '@/lib/cosmetics';

type Awards = {
  members: { email: string; steam_id: string }[];
  awards: { request_id: string; steam_id: string; admin_email: string; amount: number; reason: string; season_start: string; awarded_at: string }[];
  seasonStart: string; seasonStarts: string[];
};
async function awardRequest(body?: unknown): Promise<Awards> {
  const response = await fetch(`/api/cosmetics/${body ? 'award' : 'awards'}`, {
    method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Ödül işlemi tamamlanamadı.');
  return data;
}
function PremiumAwards() {
  const [data, setData] = useState<Awards | null>(null);
  const [steamId, setSteamId] = useState('');
  const [seasonStart, setSeasonStart] = useState('');
  const [reason, setReason] = useState('Sezon MVP');
  const [amount, setAmount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Preserve the exact request after an uncertain response. A changed form gets
  // a new key; the server rejects reusing a key with different award details.
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  async function load() {
    try { const result = await awardRequest(); setData(result); setSeasonStart(previous => previous || result.seasonStart); setError(''); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { void load(); }, []);
  async function award(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const body = { steamId, seasonStart, reason, amount };
    const fingerprint = JSON.stringify(body);
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, id: crypto.randomUUID() };
    setBusy(true); setError(''); setNotice('');
    try {
      await awardRequest({ ...body, requestId: pending.current.id });
      pending.current = null; setSteamId('');
      setNotice(`${amount} premium jeton verildi. Üye premium koleksiyondan kendi seçimini yapabilir.`);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <details className="equipment-admin"><summary><Award size={17} /> Yönetici · Premium ödül ver</summary>
    <p>Sezon MVP, şampiyon kaptan veya özel katkı ödülü. Bir premium jeton bir eşyayı kalıcı açar. Her ödül yönetici ve açıklamasıyla kaydedilir.</p>
    {error && <p role="alert">{error} <button type="button" onClick={() => void load()}>Listeyi yenile</button></p>}
    {notice && <p role="status">{notice}</p>}
    {data && <form onSubmit={event => void award(event)}><fieldset disabled={busy}>
      <label>Üye<select required value={steamId} onChange={e => setSteamId(e.target.value)}><option value="">Bağlı üyeyi seç</option>{data.members.map(member => <option key={member.steam_id} value={member.steam_id}>{member.email} · {member.steam_id}</option>)}</select></label>
      <label>Sezon<select value={seasonStart} onChange={e => setSeasonStart(e.target.value)}>{data.seasonStarts.map(season => <option key={season}>{season}</option>)}</select></label>
      <label>Jeton<input type="number" min={1} max={10} required value={amount} onChange={e => setAmount(Number(e.target.value))} /></label>
      <label>Ödül açıklaması<input required minLength={3} maxLength={200} list="equipment-award-reasons" value={reason} onChange={e => setReason(e.target.value)} /><datalist id="equipment-award-reasons"><option value="Sezon MVP" /><option value="Sezon şampiyonu kaptan" /><option value="Topluluğa özel katkı" /></datalist></label>
      <button className="equipment-primary" disabled={!steamId || busy} type="submit">{busy ? 'Veriliyor…' : `${amount} premium jeton ver`}</button>
    </fieldset></form>}
    {data && <div className="equipment-award-history"><strong>Son ödüller</strong>{data.awards.length === 0 && <p>Henüz premium ödül verilmedi.</p>}{data.awards.map(award => <p key={award.request_id}><b>+{award.amount} premium</b> · {data.members.find(member => member.steam_id === award.steam_id)?.email || award.steam_id}<br />{award.reason} · Sezon {award.season_start.slice(0, 10)}<br /><small>{new Date(award.awarded_at).toLocaleString('tr-TR')} · {award.admin_email}</small></p>)}</div>}
  </details>;
}

export default function EquipmentProgress({ account, refresh, busy }: { account: CosmeticAccount; refresh: () => void; busy: boolean }) {
  const p = account.progress;
  return <>
    <section className="equipment-progression" aria-label="Ekipman ilerlemesi">
      <div className="equipment-progress-top"><div><span className="equipment-eyebrow"><Trophy size={15} /> OYNA · KAZAN · TARZINI AÇ</span><h2>{p ? `Seviye ${p.level} · ${p.level >= 10 ? 'Batak efsanesi' : p.level >= 5 ? 'Gece ustası' : p.level >= 3 ? 'Müdavim' : 'Yeni yüz'}` : 'İlk ekipmanın bizden.'}</h2><p>{p ? `${p.matches} maç · ${p.nights} oyun gecesi · ${p.unlocks.length} kalıcı açılan eşya` : 'Steam hesabını bağla, 30 hoş geldin jetonuyla ilk seçimini yap.'}</p></div>
        <div className="equipment-wallet"><div><Coins size={19} /><strong>{p?.tokens ?? '30'}</strong><span>{p ? 'Jeton' : 'Hoş geldin'}</span></div><div className="premium"><Award size={19} /><strong>{p?.premiumTokens ?? 0}</strong><span>Premium</span></div></div></div>
      {p && <div className="equipment-xp"><div><span>{p.levelXp} / {p.nextLevelXp} XP</span><span>Seviye {p.level + 1}</span></div><progress aria-label="Sonraki seviyeye ilerleme" max={p.nextLevelXp} value={p.levelXp} /><button disabled={busy} onClick={refresh}>Maç ödüllerini yenile</button></div>}
      <div className="equipment-rewards"><span><b>Her maç</b> +10 jeton · +100 XP</span><span><b>Gecenin ilk maçı</b> +5 jeton · +50 XP</span><span><b>Galibiyet</b> +2 jeton · +20 XP</span><span><b>1,20 rating veya 5 asist</b> +2 jeton · +20 XP</span></div>
      <div className="equipment-tier-road">{account.tiers.map(tier => <div key={tier.tier} className={tier.tier === 'premium' ? 'premium' : ''}><strong>{tier.label}</strong><span>{tier.cost === 0 ? 'Ücretsiz' : tier.currency === 'premiumTokens' ? '1 premium · yönetici ödülü' : `${tier.cost} jeton · Sv. ${tier.level}`}</span></div>)}</div>
      <details className="equipment-rules"><summary>Ödüller nasıl işler?</summary><p>Bir açılış, eşyayı her sette ve desteklenen iki takımda kalıcı kullanıma açar. Seviye, jeton ve koleksiyon sezon sonunda sıfırlanmaz. Premium jetonlar yalnızca yönetici ödüllerinden gelir.</p><p>Ödüller sistemin açıldığı {new Date(account.startsAt).toLocaleDateString('tr-TR')} tarihinden sonraki, istatistikleri yayımlanmış ve en az 12 raund oynanmış kayıtlı haritalar içindir. Eski maçlar geriye dönük sayılmaz. İstatistikler işlenirken biraz bekleyip yenileyebilirsin. Oyun gecesi Türkiye saatiyle 06.00’da değişir; gece yarısından sonra da aynı gecede kalırsın. Performans bonusu maç başına bir kez verilir; kaçırılan geceler için ceza yok.</p></details>
      {account.removedLockedItems && <p className="equipment-migration-note">Yeni koleksiyon sistemiyle, henüz açmadığın eski seçimler ekipmandan çıkarıldı. İstediğin eşyayı açıp yeniden ekleyebilirsin.</p>}
    </section>
    {account.isAdmin && <PremiumAwards />}
  </>;
}
