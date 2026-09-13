'use client';

import { useEffect, useRef, useState } from 'react';
import { Award, Check, Coins, LockKeyhole, Trophy } from 'lucide-react';
import { CosmeticAccount } from '@/lib/cosmetics';
import { useSession } from '@/contexts/SessionContext';
import SteamAvatar from './SteamAvatar';

type Awards = {
  members: { display_name: string; steam_id: string }[];
  awards: { request_id: string; steam_id: string; admin_email: string | null; admin_steam_id: string | null; amount: number; reason: string; season_start: string; awarded_at: string }[];
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
      <label>Üye<select required value={steamId} onChange={e => setSteamId(e.target.value)}><option value="">Bağlı üyeyi seç</option>{data.members.map(member => <option key={member.steam_id} value={member.steam_id}>{member.display_name} · {member.steam_id}</option>)}</select></label>
      <label>Sezon<select value={seasonStart} onChange={e => setSeasonStart(e.target.value)}>{data.seasonStarts.map(season => <option key={season}>{season}</option>)}</select></label>
      <label>Jeton<input type="number" min={1} max={10} required value={amount} onChange={e => setAmount(Number(e.target.value))} /></label>
      <label>Ödül açıklaması<input required minLength={3} maxLength={200} list="equipment-award-reasons" value={reason} onChange={e => setReason(e.target.value)} /><datalist id="equipment-award-reasons"><option value="Sezon MVP" /><option value="Sezon şampiyonu kaptan" /><option value="Topluluğa özel katkı" /></datalist></label>
      <button className="equipment-primary" disabled={!steamId || busy} type="submit">{busy ? 'Veriliyor…' : `${amount} premium jeton ver`}</button>
    </fieldset></form>}
    {data && <div className="equipment-award-history"><strong>Son ödüller</strong>{data.awards.length === 0 && <p>Henüz premium ödül verilmedi.</p>}{data.awards.map(award => <p key={award.request_id}><b>+{award.amount} premium</b> · {data.members.find(member => member.steam_id === award.steam_id)?.display_name || award.steam_id}<br />{award.reason} · Sezon {award.season_start.slice(0, 10)}<br /><small>{new Date(award.awarded_at).toLocaleString('tr-TR')} · {data.members.find(member => member.steam_id === award.admin_steam_id)?.display_name || award.admin_steam_id || award.admin_email}</small></p>)}</div>}
  </details>;
}

export default function EquipmentProgress({ account, refresh, busy, selectTier }: { account: CosmeticAccount; refresh: () => void; busy: boolean; selectTier: (tier: string) => void }) {
  const p = account.progress;
  const { user } = useSession();
  const nextTier = p && account.tiers.find(tier => tier.currency === 'tokens' && tier.level > p.level);
  return <>
    <section className="equipment-progression" aria-label="Senin ekipmanın ve seviyen">
      <div className="equipment-personal-heading">
        <div className="equipment-identity">{account.steamId && <SteamAvatar key={account.steamId} steamId={account.steamId} playerName={user?.name || 'Oyuncu'} size="medium" showLink={false} />}<div><span className="equipment-eyebrow">SENİN OYUNUN · SENİN TARZIN</span><h1>{user?.name || 'Oyuncu'}, ekipmanın hazır mı?</h1><p>{p ? `${p.unlocks.length} açılan eşya · ${p.matches} maç · ${p.nights} oyun gecesi` : 'İlerlemen yüklenemedi. Yenilemeyi dene.'}</p></div></div>
        <a className="equipment-browse-link" href="#equipment-catalog">Koleksiyonu keşfet ↗</a>
      </div>
      <div className="equipment-dashboard">
        <div className="equipment-level-card"><span className="equipment-eyebrow"><Trophy size={16} /> SENİN SEVİYEN</span><div className="equipment-level-number">{p?.level ?? '—'}<span>{p ? p.level >= 10 ? 'Batak efsanesi' : p.level >= 5 ? 'Gece ustası' : p.level >= 3 ? 'Müdavim' : 'Yeni yüz' : 'Seviye bekleniyor'}</span></div>
          {p && <div className="equipment-xp"><div><span>{p.levelXp} / {p.nextLevelXp} XP</span><span>Seviye {p.level + 1} için {p.nextLevelXp - p.levelXp} XP</span></div><progress aria-label={`Seviye ${p.level + 1} ilerlemesi`} max={p.nextLevelXp} value={p.levelXp} /></div>}
          <p>XP, oynadıkça biriken deneyim puanın. Her 300 XP bir seviye.</p>
        </div>
        <div className="equipment-balance-card"><span className="equipment-eyebrow"><Coins size={16} /> JETONLARIN</span><strong>{p?.tokens ?? '—'}</strong><p>Maçlardan kazanırsın. Bir eşyayı kalıcı açmak için harcarsın.</p><span className="equipment-premium-balance"><Award size={16} /> {p?.premiumTokens ?? '—'} premium jeton <small>Özel yönetici ödülü</small></span></div>
        <div className="equipment-next-card"><span className="equipment-eyebrow"><LockKeyhole size={16} /> {nextTier ? 'SIRADAKİ HEDEFİN' : 'KOLEKSİYONUNU BÜYÜT'}</span><h2>{nextTier ? nextTier.label : p ? 'Tüm normal kademeler açık' : 'İlerlemeni yenile'}</h2><p>{nextTier ? `Seviye ${nextTier.level} olduğunda bu kademeden eşya açabilirsin. Her eşya ${nextTier.cost} jeton.` : 'Premium eşyalar için ayrıca premium jeton gerekir.'}</p><button onClick={refresh} disabled={busy}>{busy ? 'Kontrol ediliyor…' : 'Maç ödüllerimi yenile'}</button></div>
      </div>
      <div className="equipment-unlock-heading"><div><h2>Neleri açabilirsin?</h2><p>Seviye senindir; silahlar seviye atlamaz. Eşyanın kademesi, gereken seviyeyi ve jeton bedelini belirler.</p></div><a href="#equipment-help">Nasıl kazanırım?</a></div>
      <div className="equipment-tier-road">{account.tiers.map(tier => {
        const levelReady = !!p && p.level >= tier.level;
        const affordable = !!p && p[tier.currency] >= tier.cost;
        return <button key={tier.tier} className={`${tier.tier === 'premium' ? 'premium' : ''} ${levelReady ? 'is-open' : 'is-locked'}`} onClick={() => selectTier(tier.tier)}>
          <span className="equipment-tier-state">{levelReady ? <Check size={13} /> : <LockKeyhole size={13} />}{levelReady ? tier.cost === 0 ? 'Hemen kullan' : affordable ? 'Eşya açabilirsin' : 'Jeton biriktir' : `Seviye ${tier.level} gerekli`}</span><strong>{tier.label}</strong><span>{tier.cost === 0 ? 'Ücretsiz' : `${tier.cost} ${tier.currency === 'premiumTokens' ? 'premium jeton' : 'jeton'} / eşya`}</span><small>Eşyalara bak ↗</small>
        </button>;
      })}</div>
      {account.removedLockedItems && <p className="equipment-migration-note">Henüz açmadığın eski seçimler ekipmandan çıkarıldı. Eşyayı açıp yeniden ekleyebilirsin.</p>}
    </section>
  </>;
}

export function EquipmentHelp({ account }: { account: CosmeticAccount }) {
  return <section className="equipment-help" id="equipment-help" aria-label="Ekipman rehberi">
    <h2>Ekipman rehberi</h2>
    <details className="equipment-rules"><summary>XP ve jeton nasıl kazanılır?</summary><div className="equipment-rewards"><span><b>Her kayıtlı harita</b>+10 jeton · +100 XP</span><span><b>Gecenin ilk haritası</b>+5 jeton · +50 XP</span><span><b>Galibiyet</b>+2 jeton · +20 XP</span><span><b>1,20 rating veya 5 asist</b>+2 jeton · +20 XP</span></div><p>Her 300 XP ile bir seviye yükselirsin. Seviye atlamak jeton harcamaz; eşya açmak XP azaltmaz. İlk girişte 30 hoş geldin jetonu verilir. Seviye, jeton ve açtığın eşyalar sezon sonunda sıfırlanmaz. Ekipman jetonları Token Wars puanlarından ayrıdır.</p><p>Ödüller {new Date(account.startsAt).toLocaleDateString('tr-TR')} sonrasında oynanan, en az 12 raundluk ve istatistikleri yayımlanmış haritalar içindir. Eski maçlar geriye dönük sayılmaz. İstatistikler işleniyorsa daha sonra yenile. Oyun gecesi Türkiye saatiyle 06.00’da değişir.</p></details>
    <details className="equipment-rules"><summary>Eşya açmak, kuşanmak ve set kaydetmek</summary><ol><li>Gereken seviyeye ulaş ve jetonla eşyayı bir kez kalıcı aç.</li><li>Eşyayı seç, T veya CT için setine ekle. En fazla üç set hazırlayabilirsin.</li><li>Kullanacağın seti aktif yap ve değişiklikleri kaydet.</li><li>Sunucuda <code>!ws</code> yaz. Ekipmanın sonraki doğuşta uygulanır.</li></ol><p>Açtığın eşya tüm setlerinde ve desteklediği takımlarda tekrar ücret ödemeden kullanılır. Müzik T ve CT için ortaktır. Premium jetonlar yalnızca yönetici ödüllerinden gelir; bir premium jeton bir premium eşyayı açar.</p></details>
    <details className="equipment-rules"><summary>Steam skinlerim ve sunucuda kullanma</summary><p>Kendi skinlerini CS2’nin ekipman ekranında kuşan. Burada seçim yapmadığın yuvalarda Steam ekipmanın kullanılır; kendi skinlerin için jeton gerekmez. Kulüp eşyaları yalnızca CS Batağı sunucusunda görünür, Steam envanterine eklenmez.</p><p>Bir yuvayı geri almak için setteki “Steam” düğmesini kullan. “Steam ekipmanımı kullan” seçili setin iki takımdaki kulüp seçimlerini kaldırır; açtığın eşyalar koleksiyonunda kalır. Değişiklikleri kaydet ve <code>!ws</code> yaz; 30 saniyelik yenileme aralığından sonra sonraki doğuşta uygulanır.</p><p>Steam ID: {account.steamId}<br />{account.lastFetchedAt ? `Sunucu son okuma: ${new Date(account.lastFetchedAt).toLocaleString('tr-TR')}` : 'Sunucu ekipmanını henüz okumadı.'}</p></details>
    {account.isAdmin && <PremiumAwards />}
  </section>;
}
