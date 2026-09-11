'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, Link2, Search, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { CosmeticAccount, CosmeticItem, CosmeticKind, CosmeticProgress, CosmeticSelection, CosmeticState, cosmeticKinds, selectionFor } from '@/lib/cosmetics';
import EquipmentProgress from './EquipmentProgress';
import './equipment.css';

async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/cosmetics/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'İstek tamamlanamadı.');
  return data;
}
type Listing = { items: CosmeticItem[]; total: number; weapons: string[] };
type Attachment = { kind: 'sticker' | 'charm'; slot: number };

export default function EquipmentClient() {
  const [account, setAccount] = useState<CosmeticAccount | null>(null);
  const [state, setState] = useState<CosmeticState | null>(null);
  const [known, setKnown] = useState<Record<string, CosmeticItem>>({});
  const [profile, setProfile] = useState(0);
  const [team, setTeam] = useState(2);
  const [kind, setKind] = useState<CosmeticKind>('weapon');
  const [query, setQuery] = useState('');
  const [weapon, setWeapon] = useState('');
  const [tier, setTier] = useState('');
  const [offset, setOffset] = useState(0);
  const [listing, setListing] = useState<Listing>({ items: [], total: 0, weapons: [] });
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [code, setCode] = useState('');
  const [editing, setEditing] = useState<CosmeticSelection | null>(null);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [attachmentQuery, setAttachmentQuery] = useState('');
  const [attachmentItems, setAttachmentItems] = useState<CosmeticItem[]>([]);
  const [pendingAttachment, setPendingAttachment] = useState<CosmeticItem | null>(null);
  const ownedIds = useMemo(() => new Set(account?.progress?.unlocks || []), [account?.progress?.unlocks]);
  const isOwned = (item: CosmeticItem) => item.access.cost === 0 || ownedIds.has(item.id);
  const canUnlock = (item: CosmeticItem) => !!account?.progress && account.progress.level >= item.access.level && account.progress[item.access.currency] >= item.access.cost;
  const priceLabel = (item: CosmeticItem) => item.access.cost === 0 ? 'Ücretsiz' : `${item.access.cost} ${item.access.currency === 'premiumTokens' ? 'premium jeton' : 'jeton'}`;
  const dirty = !!state && JSON.stringify(state) !== JSON.stringify(account?.state);
  const selectedItem = editing ? known[editing.id] : null;
  const selectedProfile = state?.profiles[profile];
  const currentItems = useMemo(() => selectedProfile?.items.filter(item => item.team === team || known[item.id]?.kind === 'music') || [], [selectedProfile, team, known]);

  function remember(items: CosmeticItem[]) { setKnown(previous => ({ ...previous, ...Object.fromEntries(items.map(item => [item.id, item])) })); }
  async function reload() {
    setError(''); setLoading(true); setCatalogRetry(value => value + 1);
    try { const result = await request<CosmeticAccount>('me'); setAccount(result); setState(result.state); setProfile(result.state.active); remember(result.items); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  useEffect(() => {
    const controller = new AbortController();
    setCatalogLoading(true);
    const timer = setTimeout(async () => {
      try { const result = await request<Listing>(`catalog?${new URLSearchParams({ kind, q: query, weapon, tier, offset: String(offset) })}`, undefined, controller.signal); setListing(result); remember(result.items); }
      catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
      finally { if (!controller.signal.aborted) setCatalogLoading(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [kind, query, weapon, tier, offset, catalogRetry]);
  useEffect(() => {
    if (!attachment) return;
    const controller = new AbortController();
    setAttachmentItems([]); setPendingAttachment(null);
    const timer = setTimeout(async () => {
      try { const result = await request<Listing>(`catalog?${new URLSearchParams({ kind: attachment.kind, q: attachmentQuery })}`, undefined, controller.signal); setAttachmentItems(result.items); remember(result.items); }
      catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [attachment, attachmentQuery]);

  function updateProfile(items: CosmeticSelection[]) {
    if (!state) return;
    setState({ ...state, profiles: state.profiles.map((p, index) => index === profile ? { ...p, items } : p) }); setNotice('');
  }
  function equip() {
    if (!editing || !selectedItem || !selectedProfile || !isOwned(selectedItem)) return;
    const items = selectedProfile.items.filter(selection => {
      const old = known[selection.id];
      return !((selection.team === editing.team || old?.kind === 'music') && old?.kind === selectedItem.kind && (old.kind !== 'weapon' || old.defindex === selectedItem.defindex));
    });
    updateProfile([...items, editing]); setEditing(null); setAttachment(null);
  }
  async function save() {
    if (!account || !state) return;
    setBusy(true); setError(''); setNotice('');
    try { const result = await request<{ state: CosmeticState; revision: number }>('save', { state, revision: account.revision }); setAccount({ ...account, ...result }); setState(result.state); setNotice('Kaydedildi. Sunucuda !ws yazın; ekipmanınız sonraki doğuşta uygulanır.'); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function linkCode() {
    setBusy(true); setError('');
    try { const result = await request<{ code: string }>('link-code', {}); setCode(result.code); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function refreshProgress() {
    setBusy(true); setError('');
    try {
      const result = await request<CosmeticAccount>('me');
      const gainedXp = (result.progress?.xp ?? 0) - (account?.progress?.xp ?? 0);
      const gainedTokens = (result.progress?.tokens ?? 0) - (account?.progress?.tokens ?? 0);
      const leveledUp = (result.progress?.level ?? 1) > (account?.progress?.level ?? 1);
      setAccount(previous => previous ? { ...previous, progress: result.progress } : result);
      setNotice(gainedXp > 0 ? `${leveledUp ? `Seviye ${result.progress!.level} oldun! ` : ''}+${Math.max(0, gainedTokens)} jeton · +${gainedXp} XP. İyi ki geldin!` : 'Bakiyen güncel. Yeni maçların istatistikleri işlenince ödüllerin burada görünecek.');
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function unlock(item: CosmeticItem) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<{ progress: CosmeticProgress; item: CosmeticItem }>('unlock', { itemId: item.id });
      setAccount(previous => previous ? { ...previous, progress: result.progress } : previous);
      remember([result.item]); setPendingAttachment(null);
      setNotice(`${item.name} kalıcı olarak açıldı. Artık setine ekleyebilirsin.`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="equipment">
    <header className="equipment-hero"><div><span className="equipment-eyebrow"><Sparkles size={14} /> CS BATAGI / ÖZEL SUNUCU</span><h1>Her gece bir adım.<br /><span>Her eşya bir hikâye.</span></h1><p>Maça gel, jeton kazan, koleksiyonunu büyüt. Tarzını kaydet, sunucuya taşı.</p></div><div className="equipment-hero-aside"><ShieldCheck size={30} /><strong>Kalıcı koleksiyon. Özel ödüller.</strong><span>Yalnızca CS Batagi sunucusunda görünür.<br />Steam envanterini değiştirmez.</span></div></header>
    {error && <div className="equipment-message error" role="alert">{error} <button onClick={() => void reload()} disabled={dirty || busy}>Yeniden yükle</button>{dirty && <span> Kaydedilmemiş değişiklikler var.</span>}</div>}
    {notice && <div className="equipment-message" role="status"><Check size={18} />{notice}</div>}
    {loading ? <p role="status">Ekipman yükleniyor…</p> : account && <>
      <section className="equipment-account"><div><span className="equipment-eyebrow">STEAM BAĞLANTISI</span><strong>{account.steamId ? `Bağlı · ${account.steamId}` : 'Oyun hesabını bir kez bağla'}</strong><p>{account.steamId ? (account.lastFetchedAt ? `Sunucu son okuma: ${new Date(account.lastFetchedAt).toLocaleString('tr-TR')}` : 'Sunucu henüz ekipmanı okumadı.') : 'Kodunu sunucuda kullan. Seçimler yalnızca kendi hesabına uygulanır.'}</p></div>{account.steamId ? <span className="equipment-linked"><Check size={16} /> Bağlandı</span> : <button className="equipment-primary" disabled={busy} onClick={() => void linkCode()}><Link2 size={16} /> Kod oluştur</button>}
        {code && !account.steamId && <div className="equipment-link-code"><p>Sunucu konsoluna yaz (10 dakika geçerli):</p><code>css_bagla {code}</code><p>Bağlantı mesajını gördükten sonra:</p><button onClick={() => void reload()}>Bağlantıyı kontrol et</button></div>}
      </section>
      <EquipmentProgress account={account} refresh={() => void refreshProgress()} busy={busy} />
      {state && <fieldset className="equipment-workspace" disabled={busy}>
        <div className="equipment-sets"><div><label htmlFor="equipment-profile">EKİPMAN SETİ</label><select id="equipment-profile" value={profile} onChange={event => setProfile(Number(event.target.value))}>{state.profiles.map((p, index) => <option value={index} key={index}>{p.name}{state.active === index ? ' · Aktif' : ''}</option>)}</select></div><input aria-label="Set adı" maxLength={40} value={selectedProfile?.name || ''} onChange={event => setState({ ...state, profiles: state.profiles.map((p, i) => i === profile ? { ...p, name: event.target.value } : p) })} /><button disabled={state.profiles.length >= 3} onClick={() => { setState({ ...state, profiles: [...state.profiles, { name: `Set ${state.profiles.length + 1}`, items: [] }] }); setProfile(state.profiles.length); }}>+ Yeni set</button><button disabled={state.active === profile} onClick={() => setState({ ...state, active: profile })}>{state.active === profile ? 'Aktif set' : 'Aktif yap'}</button><button className="equipment-primary" disabled={busy || !dirty || !account.steamId} onClick={() => void save()}>{busy ? 'Kaydediliyor…' : dirty ? 'Değişiklikleri kaydet' : 'Kaydedildi'}</button></div>
        <div className="equipment-columns"><main>
          <div className="equipment-tabs" aria-label="Eşya türü">{cosmeticKinds.map(tab => <button key={tab.id} aria-pressed={kind === tab.id} className={kind === tab.id ? 'active' : ''} onClick={() => { setKind(tab.id); setWeapon(''); setOffset(0); }}>{tab.label}</button>)}</div>
          <div className="equipment-filters"><label className="equipment-search"><Search size={17} /><input aria-label="Eşya ara" value={query} placeholder="Dragon Lore, Doppler, Crimson…" onChange={event => { setQuery(event.target.value); setOffset(0); }} /></label>{listing.weapons.length > 0 && <select aria-label="Silah modeli" value={weapon} onChange={event => { setWeapon(event.target.value); setOffset(0); }}><option value="">Tüm modeller</option>{listing.weapons.map(name => <option key={name}>{name}</option>)}</select>}<select aria-label="Eşya seviyesi" value={tier} onChange={event => { setTier(event.target.value); setOffset(0); }}><option value="">Tüm seviyeler</option>{account.tiers.map(t => <option key={t.tier} value={t.tier}>{t.label}</option>)}</select></div>
          <div className="equipment-results"><span>{catalogLoading ? 'Aranıyor…' : `${listing.total.toLocaleString('tr-TR')} seçenek`}</span><span>Önizlemeler temsilidir</span></div>
          <div className="equipment-grid" aria-busy={catalogLoading}>{!catalogLoading && listing.items.map(item => <button className="equipment-card" key={item.id} disabled={!item.teams.includes(team)} style={{ '--item-color': item.color } as React.CSSProperties} onClick={() => { const existing = selectedProfile?.items.find(i => i.id === item.id && i.team === team); setEditing(existing ? structuredClone(existing) : selectionFor(item, team)); setAttachment(null); }}>
            {item.image && <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}<span>{item.weapon || cosmeticKinds.find(k => k.id === item.kind)?.label}</span><strong>{item.name.replace(/^★ /, '').replace(`${item.weapon} | `, '')}</strong>{currentItems.some(i => i.id === item.id) && <span className="equipment-equipped"><Check size={12} /> Seçili</span>}{!item.teams.includes(team) && <small>Diğer takım</small>}
            <span className={`equipment-access ${item.access.tier}`}>{item.access.label} · {isOwned(item) ? item.access.cost === 0 ? 'Ücretsiz' : 'Koleksiyonunda' : priceLabel(item)}</span>{!isOwned(item) && item.access.level > 1 && <small>Seviye {item.access.level}</small>}
          </button>)}</div>
          {!catalogLoading && listing.total === 0 && <p className="equipment-empty">Eşya bulunamadı. Başka bir ad veya model deneyin.</p>}
          <div className="equipment-pagination"><button aria-label="Önceki sayfa" disabled={offset === 0 || catalogLoading} onClick={() => setOffset(offset - 48)}><ChevronLeft size={18} /></button><span>{Math.floor(offset / 48) + 1} / {Math.max(1, Math.ceil(listing.total / 48))}</span><button aria-label="Sonraki sayfa" disabled={offset + 48 >= listing.total || catalogLoading} onClick={() => setOffset(offset + 48)}><ChevronRight size={18} /></button></div>
        </main><aside className="equipment-loadout"><span className="equipment-eyebrow">{selectedProfile?.name}</span><h2>Maça hazır.</h2><div className="equipment-team">{[2, 3].map(value => <button key={value} aria-pressed={team === value} className={team === value ? 'active' : ''} onClick={() => setTeam(value)}>{value === 2 ? 'T' : 'CT'}</button>)}</div><p className="equipment-hint">Her takım için ayrı seçim yapabilirsin. Müzik iki takımda da aynı çalar.</p>
          {currentItems.length === 0 && <p className="equipment-empty">Bu takım için bir eşya seç.<br />Boş yuvalar Steam ekipmanını kullanır.</p>}
          {currentItems.map(selection => <div key={selection.id} className="equipment-loadout-item"><button onClick={() => { setEditing(structuredClone(selection)); setAttachment(null); }}>{known[selection.id]?.image && <img src={known[selection.id].image!} alt="" />}<span>{known[selection.id]?.name || selection.id}</span></button><button aria-label={`${known[selection.id]?.name} kaldır`} onClick={() => updateProfile(selectedProfile!.items.filter(i => i !== selection))}><Trash2 size={15} /></button></div>)}
          <div className="equipment-instructions"><strong>1. Seç ve kaydet</strong><span>Aktif setin sunucuya gönderilir.</span><strong>2. Sunucuda !ws yaz</strong><span>Sonraki doğuşta yeni ekipmanını gör.</span><a href="steam://connect/cs2.csbatagi.com:27015">Sunucuya katıl ↗</a></div>
        </aside></div>
      </fieldset>}
    </>}
    {editing && selectedItem && createPortal(<div className="equipment equipment-overlay" onClick={event => { if (event.target === event.currentTarget) setEditing(null); }}><section className="equipment-editor" role="dialog" aria-modal="true" aria-label="Eşyayı düzenle" onKeyDown={event => {
      if (event.key === 'Escape') setEditing(null);
      if (event.key === 'Tab') {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)'));
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}><button className="equipment-close" autoFocus onClick={() => setEditing(null)} aria-label="Kapat">×</button>{selectedItem.image && <img className="equipment-preview" src={selectedItem.image} alt={selectedItem.name} />}<span className="equipment-eyebrow">{editing.team === 2 ? 'TERRORIST' : 'COUNTER-TERRORIST'} · {selectedItem.access.label}</span><h2>{selectedItem.name}</h2>
      {error && <p className="equipment-message error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      {!isOwned(selectedItem) && <div className="equipment-unlock-info"><strong>{priceLabel(selectedItem)} · Kalıcı açılış</strong><p>{selectedItem.access.currency === 'premiumTokens' ? 'Özel ödül koleksiyonu. Sezon başarın veya katkın için yöneticinin verdiği premium jetonla seçebilirsin.' : `Seviye ${selectedItem.access.level} gerekli. Bir kez aç, her setinde kullan.`}</p><small>Bakiyen: {account?.progress?.tokens ?? 0} jeton · {account?.progress?.premiumTokens ?? 0} premium</small>{!account?.steamId && <p>Önce Steam hesabını bağla.</p>}</div>}
      {editing.wear !== undefined && <div className="equipment-editor-fields"><label>Float / aşınma<input type="number" min={selectedItem.minWear} max={selectedItem.maxWear} step="0.00001" value={editing.wear} onChange={event => setEditing({ ...editing, wear: Number(event.target.value) })} /><small>{selectedItem.minWear} – {selectedItem.maxWear}</small></label><label>Desen / seed<input type="number" min={0} max={1000} step={1} value={editing.seed} onChange={event => setEditing({ ...editing, seed: Number(event.target.value) })} /></label></div>}
      {editing.nametag !== undefined && <div className="equipment-editor-fields"><label>İsim etiketi<input maxLength={20} value={editing.nametag} onChange={event => setEditing({ ...editing, nametag: event.target.value })} placeholder="20 karaktere kadar" /></label><label className="equipment-checkbox"><input type="checkbox" checked={editing.stattrak} onChange={event => setEditing({ ...editing, stattrak: event.target.checked })} /> StatTrak (oturum sayacı)</label></div>}
      {editing.stickers && <><label>Çıkartmalar</label><div className="equipment-stickers">{editing.stickers.map((id, slot) => <button key={slot} onClick={() => { setAttachment({ kind: 'sticker', slot }); setAttachmentQuery(''); }}>{id && known[id]?.image ? <img src={known[id].image!} alt={known[id].name} /> : <span>+ {slot + 1}</span>}</button>)}</div><button onClick={() => { setAttachment({ kind: 'charm', slot: 0 }); setAttachmentQuery(''); }}>{editing.charm ? known[editing.charm]?.name : '+ Uğurluk / charm'}</button></>}
      {attachment && <section className="equipment-attachments"><div><input autoFocus aria-label={attachment.kind === 'sticker' ? 'Çıkartma ara' : 'Uğurluk ara'} placeholder="Ada göre ara…" value={attachmentQuery} onChange={event => setAttachmentQuery(event.target.value)} /><button onClick={() => { if (attachment.kind === 'sticker') { const stickers = [...editing.stickers!]; stickers[attachment.slot] = null; setEditing({ ...editing, stickers }); } else setEditing({ ...editing, charm: null }); setAttachment(null); }}>Kaldır</button></div><div>{attachmentItems.map(item => <button key={item.id} title={item.name} disabled={busy} onClick={() => { if (!isOwned(item)) { setPendingAttachment(item); return; } if (attachment.kind === 'sticker') { const stickers = [...editing.stickers!]; stickers[attachment.slot] = item.id; setEditing({ ...editing, stickers }); } else setEditing({ ...editing, charm: item.id }); setAttachment(null); }}>{item.image && <img src={item.image} alt="" loading="lazy" />}<small>{item.name}</small><small>{isOwned(item) ? 'Kullanılabilir' : `${priceLabel(item)} · Sv. ${item.access.level}`}</small></button>)}</div></section>}
      {attachment && pendingAttachment && <div className="equipment-unlock-info"><strong>{pendingAttachment.name}</strong><p>{pendingAttachment.access.label} · Seviye {pendingAttachment.access.level} · Bakiyen: {account?.progress?.[pendingAttachment.access.currency] ?? 0} {pendingAttachment.access.currency === 'premiumTokens' ? 'premium' : 'jeton'}</p><button disabled={busy || !canUnlock(pendingAttachment)} onClick={() => void unlock(pendingAttachment)}>{priceLabel(pendingAttachment)} ile kalıcı aç</button></div>}
      <p className="equipment-hint">Float ve desenin gerçek görünümü oyun içinde belirlenir.</p>{isOwned(selectedItem) ? <button className="equipment-primary equipment-wide" onClick={equip} disabled={busy || (editing.wear !== undefined && (!Number.isFinite(editing.wear) || editing.wear < selectedItem.minWear || editing.wear > selectedItem.maxWear || !Number.isInteger(editing.seed) || editing.seed! < 0 || editing.seed! > 1000))}>Sete ekle</button> : <button className="equipment-primary equipment-wide" disabled={busy || !canUnlock(selectedItem)} onClick={() => void unlock(selectedItem)}>{busy ? 'Açılıyor…' : `${priceLabel(selectedItem)} ile kalıcı aç`}</button>}
    </section></div>, document.body)}
  </div>;
}
