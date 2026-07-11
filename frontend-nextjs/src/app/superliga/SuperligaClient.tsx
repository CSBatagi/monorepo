'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSession } from '@/contexts/SessionContext';
import { useLivePolling } from '@/lib/useLivePolling';
import { useStatsRefresh } from '@/lib/useStatsRefresh';
import {
  setSuperligaCaptain,
  setSuperligaMapOverride,
  deleteSuperligaMapOverride,
  setSuperligaManualNight,
  deleteSuperligaManualNight,
} from '@/lib/liveApi';
import { getDateKeyedPeriodData, isDateKeyedPeriodPayload } from '@/lib/statsPeriods';
import {
  ArrowDown,
  ArrowUp,
  CalendarPlus,
  Circle,
  Crown,
  PlusCircle,
  Sparkles,
  Star,
  Trash2,
  Trophy,
  Users,
} from 'lucide-react';

import type {
  CaptainRecord,
  CaptainsByDateSnapshot,
  SonmacByDate,
} from '@/lib/batakAllStars';
import {
  buildPlayersIndex,
  computeMapPoints,
  computeSuperligaStandings,
  deriveMainLeagueTeamsForDate,
  deriveSuperligaTeamsForDate,
  displayNameForSteamId,
  getMainLeagueMapsForDate,
  DEFAULT_SUPERLIGA_SCORING,
  type SuperligaConfig,
  type SuperligaManualNight,
  type SuperligaManualNightsByDate,
  type SuperligaMapOverride,
  type SuperligaMapOverridesByDate,
  type SuperligaNightEntry,
  type SuperligaPlayerStanding,
} from '@/lib/superliga';

const CLEAR_ATTENDANCE_PASSWORD = process.env.NEXT_PUBLIC_CLEAR_ATTENDANCE_PASSWORD || 'osirikler';

type TeamKey = 'team1' | 'team2';
type ActiveTab = 'standings' | 'raw' | 'kaptanlik' | 'overrides' | 'manual';

function sortDatesDesc(dates: string[]): string[] {
  return [...dates].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Bilinmeyen hata';
}

function PositionChangeIndicator({ change }: { change?: 'up' | 'down' | 'same' | 'new' }) {
  switch (change) {
    case 'up':
      return <span title="Yükseldi" className="inline-flex text-green-600"><ArrowUp className="h-4 w-4" strokeWidth={2.5} /></span>;
    case 'down':
      return <span title="Düştü" className="inline-flex text-red-600"><ArrowDown className="h-4 w-4" strokeWidth={2.5} /></span>;
    case 'same':
      return <span title="Aynı" className="inline-flex text-gray-400"><Circle className="h-3 w-3" /></span>;
    case 'new':
      return <span title="Yeni" className="inline-flex text-blue-500"><Sparkles className="h-4 w-4" /></span>;
    default:
      return <span className="text-gray-300">-</span>;
  }
}

function ScoringReference({ config }: { config: SuperligaConfig }) {
  const s = config.scoring || DEFAULT_SUPERLIGA_SCORING;
  return (
    <div className="rounded-lg bg-gray-50 p-4 text-sm">
      <h4 className="mb-2 flex items-center gap-1 font-semibold"><Star className="h-4 w-4" />Puanlama</h4>
      <ul className="list-inside list-disc space-y-1 text-gray-700">
        <li>Kazanılan her haritadan <span className="font-medium">{s.winPoints} puan + averaj</span> (skor farkı) kazanılır.</li>
        <li>Kaptanlar, kaptanlık yaptıkları her gece için <span className="font-medium">+{s.captainBonus} puan</span> alır.</li>
        <li>Uzatmaya giden haritalarda <span className="font-medium">kaybeden takım</span> her uzatma serisi için <span className="font-medium">+{s.overtimeConsolationPerSeries} teselli puanı</span> alır (en fazla {s.maxOvertimeConsolationSeries} seri = {s.maxOvertimeConsolationSeries * s.overtimeConsolationPerSeries} puan).</li>
        <li>Sıralama, oyuncunun <span className="font-medium">gece başına ortalama puanına</span> göre yapılır (toplam değil).</li>
        <li>Token sistemi, saldırı/savunma/koruma ve HLTV faktörü <span className="font-medium">yoktur</span>. En önemli kriter kazanmaktır.</li>
      </ul>
      <div className="mt-3 rounded border border-purple-100 bg-white p-3 text-xs text-gray-600">
        <div className="mb-1 font-medium text-gray-700">Örnek — Darbe 2 - Cago 1</div>
        <div>Mirage 13-9 (Darbe) → 15 + 4 = <span className="font-medium">19</span></div>
        <div>Dust2 13-10 (Cago) → 15 + 3 = <span className="font-medium">18</span></div>
        <div>Anubis 13-7 (Darbe) → 15 + 6 = <span className="font-medium">21</span></div>
        <div className="mt-1">Darbe oyuncuları 19+21 = <span className="font-medium">40</span>, Cago oyuncuları <span className="font-medium">18</span> puan. Kaptanlar +5 ile Darbe 45, Cago 23.</div>
      </div>
      <div className="mt-3 rounded border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800">
        <div className="mb-1 flex items-center gap-1 font-medium"><Trophy className="h-3.5 w-3.5" />Lig Sonu (Playoff)</div>
        1. ve 2. sıra doğrudan yarı finale çıkar. 3-6 ve 4-5 eşleşerek eleme oynar.
        Ardından 1 vs (4-5 galibi) ve 2 vs (3-6 galibi) yarı final oynar; galipler finalde karşılaşır.
      </div>
    </div>
  );
}

function SeasonProgressBar({
  played,
  total,
  selectedIndex,
  onSelectIndex,
  dates,
}: {
  played: number;
  total: number;
  selectedIndex: number | null;
  onSelectIndex: (i: number | null) => void;
  dates: string[];
}) {
  const effectiveIndex = selectedIndex === null ? played : Math.min(selectedIndex, played);
  const totalBoxes = Math.max(total, played);
  const gamesLeft = Math.max(0, total - played);
  const squares = [];

  for (let i = 0; i < totalBoxes; i++) {
    const matchNum = i + 1;
    const isPlayed = i < played;
    const isSelected = effectiveIndex === matchNum;
    const isBeforeSelected = matchNum <= effectiveIndex;
    const bgClass = isPlayed ? (isSelected ? 'bg-purple-600' : isBeforeSelected ? 'bg-purple-400' : 'bg-purple-200') : 'bg-gray-200';
    const textClass = isPlayed ? (isSelected || isBeforeSelected ? 'text-white' : 'text-purple-600') : 'text-gray-400';
    const borderClass = isSelected ? 'ring-2 ring-purple-800 ring-offset-1' : '';

    squares.push(
      <button
        key={i}
        type="button"
        onClick={() => (isPlayed ? onSelectIndex(selectedIndex === matchNum ? null : matchNum) : onSelectIndex(null))}
        className={`flex h-7 w-7 items-center justify-center rounded-sm text-xs font-medium transition-all duration-150 sm:h-8 sm:w-8 md:h-6 md:w-6 ${bgClass} ${textClass} ${borderClass} ${isPlayed ? 'cursor-pointer hover:scale-110' : 'cursor-default opacity-60'}`}
        title={isPlayed ? `Maç ${matchNum}: ${dates[i] || ''}` : `Maç ${matchNum} (oynanmadı)`}
      >
        {matchNum}
      </button>,
    );
  }

  const viewingText = selectedIndex === null || selectedIndex >= played ? `Güncel (${played} maç)` : `Maç ${selectedIndex} sonrası`;

  return (
    <div className="flex flex-col items-center gap-2 py-3">
      <div className="flex flex-wrap justify-center gap-1 sm:gap-1.5">{squares}</div>
      <div className="text-xs text-gray-500">
        {played} / {total} maç oynandı · <span className="font-medium text-purple-600">{gamesLeft} maç kaldı</span>
      </div>
      <div className="text-xs text-gray-500">
        Görüntülenen: <span className="font-medium text-purple-600">{viewingText}</span>
      </div>
      {selectedIndex !== null && selectedIndex < played && (
        <button type="button" onClick={() => onSelectIndex(null)} className="text-xs text-purple-500 underline hover:text-purple-700">
          Güncel duruma dön
        </button>
      )}
    </div>
  );
}

function NightMapsDetail({ entry }: { entry: SuperligaNightEntry }) {
  if (!entry.maps.length) {
    return <span className="text-xs text-gray-400">Sadece kaptanlık (+{entry.captainBonus})</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {entry.maps.map((mp, i) => (
        <span
          key={`${mp.mapName}-${i}`}
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${mp.won ? 'bg-green-100 text-green-800' : mp.points > 0 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-500'}`}
          title={`${mp.mapName} ${mp.scoreFor}-${mp.scoreAgainst}${mp.overtimes ? ` (${mp.overtimes} uzatma)` : ''}${mp.manual ? ' · elle eklendi' : ''}`}
        >
          {mp.manual && <PlusCircle className="h-3 w-3 text-purple-500" />}
          {mp.mapName.replace(/^de_/, '')} {mp.scoreFor}-{mp.scoreAgainst}
          {mp.overtimes > 0 && <span className="rounded bg-orange-200 px-1 text-[9px] font-semibold text-orange-800">{mp.overtimes} OT</span>}
          <span className="font-mono font-semibold">+{mp.points}</span>
        </span>
      ))}
    </div>
  );
}

function MapOverridePanel({
  config,
  availableDates,
  sonmacByDate,
  mapOverrides,
  user,
  onSaved,
}: {
  config: SuperligaConfig;
  availableDates: string[];
  sonmacByDate: SonmacByDate;
  mapOverrides: SuperligaMapOverridesByDate | null;
  user: ReturnType<typeof useSession>['user'];
  onSaved: () => Promise<void> | void;
}) {
  const scoring = config.scoring || DEFAULT_SUPERLIGA_SCORING;
  const [date, setDate] = useState('');
  const [mapName, setMapName] = useState('');
  const [score1, setScore1] = useState('');
  const [score2, setScore2] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!date && availableDates.length) setDate(availableDates[0]);
  }, [availableDates, date]);

  const teams = useMemo(() => (date ? deriveMainLeagueTeamsForDate(sonmacByDate || {}, date) : null), [date, sonmacByDate]);
  const team1Name = teams?.team1Name || 'Takım 1';
  const team2Name = teams?.team2Name || 'Takım 2';

  const dateOverrides = useMemo(() => (date ? mapOverrides?.[date] || [] : []), [date, mapOverrides]);

  const preview = useMemo(() => {
    const s1 = Number(score1);
    const s2 = Number(score2);
    if (!Number.isInteger(s1) || !Number.isInteger(s2) || s1 < 0 || s2 < 0) return null;
    const r1 = computeMapPoints(s1, s2, scoring);
    const r2 = computeMapPoints(s2, s1, scoring);
    if (!r1 || !r2) return null;
    return { r1, r2, overtimes: r1.overtimes };
  }, [score1, score2, scoring]);

  const resetForm = () => {
    setMapName('');
    setScore1('');
    setScore2('');
  };

  const handleEdit = (ov: SuperligaMapOverride) => {
    setMapName(ov.mapName);
    // Align stored scores to the night's team1/team2 orientation for display
    if (ov.team1Name && ov.team2Name && ov.team1Name === team2Name && ov.team2Name === team1Name) {
      setScore1(String(ov.team2Score));
      setScore2(String(ov.team1Score));
    } else {
      setScore1(String(ov.team1Score));
      setScore2(String(ov.team2Score));
    }
    setMsg(null);
  };

  const handleSave = async () => {
    if (!user) {
      setMsg('Giriş yapmanız gerekiyor.');
      return;
    }
    if (!date || !mapName.trim()) {
      setMsg('Tarih ve harita adı gerekli.');
      return;
    }
    const s1 = Number(score1);
    const s2 = Number(score2);
    if (!Number.isInteger(s1) || !Number.isInteger(s2) || s1 < 0 || s2 < 0) {
      setMsg('Geçerli skorlar girin (negatif olmayan tam sayı).');
      return;
    }
    if (s1 === s2) {
      setMsg('Skorlar eşit olamaz (haritada berabere olmaz).');
      return;
    }
    if (!teams) {
      setMsg('Bu gece için takım kadrosu bulunamadı; en az bir gerçek harita gerekli.');
      return;
    }

    const password = window.prompt('Maç sonucu eklemek için şifre girin:');
    if (password !== CLEAR_ATTENDANCE_PASSWORD) {
      setMsg('Hatalı şifre.');
      return;
    }

    setSaving(true);
    setMsg(null);
    try {
      await setSuperligaMapOverride({
        date,
        mapName: mapName.trim(),
        team1Name,
        team1Score: s1,
        team2Name,
        team2Score: s2,
        setByUid: user.uid,
        setByName: user.name || user.email || '',
        setAt: Date.now(),
      });
      setMsg('Maç sonucu kaydedildi.');
      resetForm();
      await onSaved();
    } catch (error: unknown) {
      setMsg(`Hata: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (ov: SuperligaMapOverride) => {
    const password = window.prompt('Silmek için şifre girin:');
    if (password !== CLEAR_ATTENDANCE_PASSWORD) return;
    setSaving(true);
    try {
      await deleteSuperligaMapOverride({ date: ov.date, mapName: ov.mapName });
      await onSaved();
      setMsg('Silindi.');
    } catch (error: unknown) {
      setMsg(`Hata: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`);
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="rounded border border-slate-200 bg-slate-50 p-4 shadow-sm">
        <p className="text-sm text-gray-700">Manuel maç sonucu eklemek için giriş yapmalısınız.</p>
      </div>
    );
  }

  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-4 shadow-sm">
      <h4 className="mb-1 flex items-center gap-1 font-semibold text-gray-800"><PlusCircle className="h-4 w-4" />Eksik Maç Sonucu Ekle (Admin)</h4>
      <p className="mb-3 text-xs text-gray-500">
        Bazı gecelerde bazı haritaların sonuçları eksik olabilir. Buradan elle ekleyebilirsiniz; lig hesabına dahil edilir.
        Uzatmaya giden skorlar otomatik algılanır ve ek teselli puanı verilir.
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className="mb-1 block text-xs text-gray-600">Tarih</label>
          <select
            value={date}
            onChange={(e) => { setDate(e.target.value); setMsg(null); resetForm(); }}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm"
          >
            {availableDates.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-600">Harita</label>
          <input
            type="text"
            value={mapName}
            onChange={(e) => { setMapName(e.target.value); setMsg(null); }}
            placeholder="de_mirage"
            className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm"
          />
        </div>
        <div>
          <label className="mb-1 block max-w-[120px] truncate text-xs text-gray-600" title={team1Name}>{team1Name}</label>
          <input
            type="number" min={0}
            value={score1}
            onChange={(e) => { setScore1(e.target.value); setMsg(null); }}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm"
          />
        </div>
        <div>
          <label className="mb-1 block max-w-[120px] truncate text-xs text-gray-600" title={team2Name}>{team2Name}</label>
          <input
            type="number" min={0}
            value={score2}
            onChange={(e) => { setScore2(e.target.value); setMsg(null); }}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm"
          />
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="w-full rounded bg-purple-600 px-3 py-1.5 text-sm text-white shadow-sm transition-colors hover:bg-purple-700 disabled:opacity-50"
          >
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </div>

      <div className="mt-3 rounded border border-purple-100 bg-white px-3 py-2 text-sm text-gray-700">
        {preview ? (
          <span>
            <span className="font-medium">Önizleme: </span>
            {team1Name} {preview.r1.won ? 'kazanır' : 'kaybeder'} (+{preview.r1.points}), {team2Name} {preview.r2.won ? 'kazanır' : 'kaybeder'} (+{preview.r2.points}).
            {preview.overtimes > 0 && (
              <span className="ml-1 font-medium text-orange-700">{preview.overtimes} uzatma — kaybeden takıma teselli puanı.</span>
            )}
          </span>
        ) : (
          <span className="text-gray-500">Skorları girince puan önizlemesi ve uzatma tespiti burada görünür.</span>
        )}
      </div>

      {msg && (
        <p className={`mt-3 text-sm ${msg.startsWith('Hata') ? 'text-red-600' : 'text-green-600'}`}>{msg}</p>
      )}

      {dateOverrides.length > 0 && (
        <div className="mt-4">
          <h5 className="mb-2 text-sm font-medium text-gray-700">{date} — Elle Eklenen Maçlar ({dateOverrides.length})</h5>
          <div className="space-y-1">
            {dateOverrides.map((ov) => {
              const r = computeMapPoints(Number(ov.team1Score), Number(ov.team2Score), scoring);
              return (
                <div key={ov.mapName} className="flex items-center justify-between rounded border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <PlusCircle className="h-3.5 w-3.5 text-purple-500" />
                    <span className="font-medium">{ov.mapName}</span>
                    <span className="text-gray-600">{ov.team1Name} {ov.team1Score} - {ov.team2Score} {ov.team2Name}</span>
                    {r && r.overtimes > 0 && (
                      <span className="rounded bg-orange-200 px-1.5 py-0.5 text-[10px] font-semibold text-orange-800">{r.overtimes} uzatma</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => handleEdit(ov)} className="text-xs text-blue-500 hover:text-blue-700">Düzenle</button>
                    <button type="button" onClick={() => handleDelete(ov)} className="text-xs text-red-400 hover:text-red-600" title="Sil">×</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

type MapDraft = { mapName: string; score1: string; score2: string };

const emptyMapDraft = (): MapDraft => ({ mapName: '', score1: '', score2: '' });

function ManualNightPanel({
  config,
  seasonStart,
  sonmacByDate,
  manualNights,
  captainsByDate,
  playersIndex,
  user,
  onSaved,
  refetchCaptains,
}: {
  config: SuperligaConfig;
  seasonStart: string | null;
  sonmacByDate: SonmacByDate;
  manualNights: SuperligaManualNightsByDate | null;
  captainsByDate: CaptainsByDateSnapshot | null;
  playersIndex: ReturnType<typeof buildPlayersIndex>;
  user: ReturnType<typeof useSession>['user'];
  onSaved: () => Promise<void> | void;
  refetchCaptains: () => Promise<void> | void;
}) {
  const scoring = config.scoring || DEFAULT_SUPERLIGA_SCORING;

  // Yalnızca lig kadrosundaki oyuncular puan kazanır; seçim havuzu bu listedir.
  const leaguePool = useMemo(() => {
    const ids = config.leagues?.[0]?.players || [];
    return ids
      .map((steamId) => ({ steamId, name: displayNameForSteamId(steamId, playersIndex) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }, [config, playersIndex]);

  const [date, setDate] = useState('');
  const [team1Name, setTeam1Name] = useState('');
  const [team2Name, setTeam2Name] = useState('');
  const [assignment, setAssignment] = useState<Record<string, '' | TeamKey>>({});
  const [maps, setMaps] = useState<MapDraft[]>([emptyMapDraft()]);
  const [captain, setCaptain] = useState<Record<TeamKey, string>>({ team1: '', team2: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState<string | null>(null);

  const team1Roster = useMemo(() => leaguePool.filter((p) => assignment[p.steamId] === 'team1'), [leaguePool, assignment]);
  const team2Roster = useMemo(() => leaguePool.filter((p) => assignment[p.steamId] === 'team2'), [leaguePool, assignment]);

  const existingNights = useMemo(
    () => Object.values(manualNights || {}).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [manualNights],
  );

  const dateHasDemo = useMemo(() => {
    if (!date) return false;
    const mn = getMainLeagueMapsForDate(sonmacByDate || {}, date);
    return !!(mn && mn.length);
  }, [date, sonmacByDate]);

  const dateBeforeSeason = !!(date && seasonStart && date < seasonStart);

  const resetForm = () => {
    setDate('');
    setTeam1Name('');
    setTeam2Name('');
    setAssignment({});
    setMaps([emptyMapDraft()]);
    setCaptain({ team1: '', team2: '' });
    setEditingDate(null);
    setMsg(null);
  };

  const loadNight = (mn: SuperligaManualNight) => {
    setDate(mn.date);
    setTeam1Name(mn.team1Name || '');
    setTeam2Name(mn.team2Name || '');
    const nextAssign: Record<string, '' | TeamKey> = {};
    for (const p of mn.team1Players || []) nextAssign[String(p.steamId)] = 'team1';
    for (const p of mn.team2Players || []) nextAssign[String(p.steamId)] = 'team2';
    setAssignment(nextAssign);
    setMaps((mn.maps || []).length
      ? mn.maps.map((m) => ({ mapName: m.mapName, score1: String(m.team1Score), score2: String(m.team2Score) }))
      : [emptyMapDraft()]);
    const capRec = captainsByDate?.[mn.date];
    setCaptain({ team1: capRec?.team1?.steamId || '', team2: capRec?.team2?.steamId || '' });
    setEditingDate(mn.date);
    setMsg(null);
  };

  const setPlayerTeam = (steamId: string, team: '' | TeamKey) => {
    setAssignment((prev) => ({ ...prev, [steamId]: team }));
    // Oyuncu takımdan çıkarıldıysa/başka takıma geçtiyse kaptanlık seçimini temizle.
    setCaptain((prev) => ({
      team1: prev.team1 === steamId && team !== 'team1' ? '' : prev.team1,
      team2: prev.team2 === steamId && team !== 'team2' ? '' : prev.team2,
    }));
    setMsg(null);
  };

  const updateMap = (idx: number, patch: Partial<MapDraft>) => {
    setMaps((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
    setMsg(null);
  };
  const addMap = () => setMaps((prev) => [...prev, emptyMapDraft()]);
  const removeMap = (idx: number) => setMaps((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));

  const t1Label = team1Name.trim() || 'Takım 1';
  const t2Label = team2Name.trim() || 'Takım 2';

  // Skor önizlemesi: harita başına puan + takım toplamları.
  const preview = useMemo(() => {
    let t1 = 0;
    let t2 = 0;
    const rows = maps.map((m) => {
      const s1 = Number(m.score1);
      const s2 = Number(m.score2);
      if (!m.mapName.trim() || !Number.isInteger(s1) || !Number.isInteger(s2) || s1 < 0 || s2 < 0 || s1 === s2) return null;
      const r1 = computeMapPoints(s1, s2, scoring);
      const r2 = computeMapPoints(s2, s1, scoring);
      if (!r1 || !r2) return null;
      t1 += r1.points;
      t2 += r2.points;
      return { mapName: m.mapName.trim(), s1, s2, r1, r2 };
    });
    return { rows, t1, t2, hasAny: rows.some(Boolean) };
  }, [maps, scoring]);

  const handleSave = async () => {
    if (!user) { setMsg('Giriş yapmanız gerekiyor.'); return; }
    if (!date) { setMsg('Tarih gerekli.'); return; }
    if (dateHasDemo) { setMsg('Bu tarihte zaten demo verisi var; manuel gece yerine "Eksik Maç Ekle" veya "Kaptan Atama" sekmesini kullanın.'); return; }
    if (!team1Roster.length || !team2Roster.length) { setMsg('Her iki takıma da en az bir oyuncu ekleyin.'); return; }

    const parsedMaps: Array<{ mapName: string; team1Score: number; team2Score: number }> = [];
    const seenMaps = new Set<string>();
    for (const m of maps) {
      const name = m.mapName.trim();
      if (!name && m.score1 === '' && m.score2 === '') continue; // tamamen boş satırı atla
      if (!name) { setMsg('Harita adı boş olamaz.'); return; }
      const s1 = Number(m.score1);
      const s2 = Number(m.score2);
      if (!Number.isInteger(s1) || !Number.isInteger(s2) || s1 < 0 || s2 < 0) { setMsg(`Geçersiz skor: ${name} (negatif olmayan tam sayı girin).`); return; }
      if (s1 === s2) { setMsg(`Skorlar eşit olamaz (haritada berabere olmaz): ${name}.`); return; }
      const key = name.toLowerCase();
      if (seenMaps.has(key)) { setMsg(`Aynı harita iki kez girildi: ${name}.`); return; }
      seenMaps.add(key);
      parsedMaps.push({ mapName: name, team1Score: s1, team2Score: s2 });
    }
    if (!parsedMaps.length) { setMsg('En az bir geçerli harita sonucu girin.'); return; }

    if (captain.team1 && !team1Roster.some((p) => p.steamId === captain.team1)) { setMsg(`${t1Label} kaptanı kadroda değil.`); return; }
    if (captain.team2 && !team2Roster.some((p) => p.steamId === captain.team2)) { setMsg(`${t2Label} kaptanı kadroda değil.`); return; }

    const password = window.prompt('Manuel gece kaydetmek için şifre girin:');
    if (password !== CLEAR_ATTENDANCE_PASSWORD) { setMsg('Hatalı şifre.'); return; }

    setSaving(true);
    setMsg(null);
    try {
      await setSuperligaManualNight({
        date,
        team1Name: t1Label,
        team2Name: t2Label,
        team1Players: team1Roster.map((p) => ({ steamId: p.steamId, name: p.name })),
        team2Players: team2Roster.map((p) => ({ steamId: p.steamId, name: p.name })),
        maps: parsedMaps,
        setByUid: user.uid,
        setByName: user.name || user.email || '',
        setAt: Date.now(),
      });

      const capJobs: Array<Promise<unknown>> = [];
      if (captain.team1) {
        capJobs.push(setSuperligaCaptain({
          date, teamKey: 'team1', steamId: captain.team1,
          steamName: displayNameForSteamId(captain.team1, playersIndex),
          teamName: t1Label, setByUid: user.uid, setByName: user.name || user.email || '', setAt: Date.now(),
        }));
      }
      if (captain.team2) {
        capJobs.push(setSuperligaCaptain({
          date, teamKey: 'team2', steamId: captain.team2,
          steamName: displayNameForSteamId(captain.team2, playersIndex),
          teamName: t2Label, setByUid: user.uid, setByName: user.name || user.email || '', setAt: Date.now(),
        }));
      }
      if (capJobs.length) await Promise.all(capJobs);

      setMsg('Manuel gece kaydedildi.');
      await onSaved();
      if (capJobs.length) await refetchCaptains();
      setEditingDate(date);
    } catch (error: unknown) {
      setMsg(`Hata: ${getErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (mn: SuperligaManualNight) => {
    const password = window.prompt(`${mn.date} manuel gecesini silmek için şifre girin:`);
    if (password !== CLEAR_ATTENDANCE_PASSWORD) return;
    setSaving(true);
    try {
      await deleteSuperligaManualNight({ date: mn.date });
      await onSaved();
      if (editingDate === mn.date) resetForm();
      setMsg('Manuel gece silindi.');
    } catch (error: unknown) {
      setMsg(`Hata: ${getErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="rounded border border-slate-200 bg-slate-50 p-4 shadow-sm">
        <p className="text-sm text-gray-700">Manuel gece eklemek için giriş yapmalısınız.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded border border-slate-200 bg-slate-50 p-4 shadow-sm">
        <h4 className="mb-1 flex items-center gap-1 font-semibold text-gray-800"><CalendarPlus className="h-4 w-4" />Manuel Gece Ekle (Admin)</h4>
        <p className="mb-3 text-xs text-gray-500">
          Demo/istatistik olmayan geceler için (ör. sadece oyun gecesi) takımları, kadroları ve harita
          skorlarını buradan elle girebilirsiniz. Gece, lig puan durumuna normal bir gece gibi eklenir.
          Kaptan da burada atanabilir. Yalnızca lig kadrosundaki oyuncular puan kazanır.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-gray-600">Tarih</label>
            <input
              type="date"
              value={date}
              onChange={(e) => { setDate(e.target.value); setMsg(null); }}
              className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-600">1. Takım Adı</label>
            <input
              type="text"
              value={team1Name}
              onChange={(e) => { setTeam1Name(e.target.value); setMsg(null); }}
              placeholder="Takım 1"
              className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-600">2. Takım Adı</label>
            <input
              type="text"
              value={team2Name}
              onChange={(e) => { setTeam2Name(e.target.value); setMsg(null); }}
              placeholder="Takım 2"
              className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm"
            />
          </div>
        </div>

        {dateHasDemo && (
          <p className="mt-2 text-xs text-red-600">⚠️ Bu tarihte demo verisi var. Manuel gece bu tarih için puanlamaya alınmaz.</p>
        )}
        {dateBeforeSeason && !dateHasDemo && (
          <p className="mt-2 text-xs text-amber-600">⚠️ Bu tarih sezon başlangıcından ({seasonStart}) önce; puan durumuna dahil edilmez.</p>
        )}

        {/* Kadro atama */}
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-700">
            <Users className="h-4 w-4" />Kadrolar
            <span className="ml-2 rounded bg-purple-100 px-1.5 py-0.5 text-[11px] text-purple-700">{t1Label}: {team1Roster.length}</span>
            <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] text-indigo-700">{t2Label}: {team2Roster.length}</span>
          </div>
          {leaguePool.length === 0 ? (
            <p className="text-xs text-gray-500">Lig kadrosu tanımlı değil.</p>
          ) : (
            <div className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto rounded border border-gray-200 bg-white p-2 sm:grid-cols-2 lg:grid-cols-3">
              {leaguePool.map((p) => {
                const cur = assignment[p.steamId] || '';
                return (
                  <div key={p.steamId} className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-gray-50">
                    <span className="truncate text-sm text-gray-800" title={p.name}>{p.name}</span>
                    <div className="flex shrink-0 overflow-hidden rounded border border-gray-300">
                      {([['', '—'], ['team1', 'T1'], ['team2', 'T2']] as const).map(([val, label]) => {
                        const active = cur === val;
                        const activeClass = val === 'team1' ? 'bg-purple-600 text-white' : val === 'team2' ? 'bg-indigo-600 text-white' : 'bg-gray-400 text-white';
                        return (
                          <button
                            key={label}
                            type="button"
                            onClick={() => setPlayerTeam(p.steamId, val)}
                            className={`px-2 py-0.5 text-xs transition-colors ${active ? activeClass : 'bg-white text-gray-500 hover:bg-gray-100'}`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Kaptan atama */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(['team1', 'team2'] as const).map((teamKey) => {
            const roster = teamKey === 'team1' ? team1Roster : team2Roster;
            const label = teamKey === 'team1' ? t1Label : t2Label;
            return (
              <div key={teamKey}>
                <label className="mb-1 flex items-center gap-1 text-xs text-gray-600"><Crown className="h-3.5 w-3.5 text-yellow-500" />{label} Kaptanı (opsiyonel)</label>
                <select
                  value={captain[teamKey]}
                  onChange={(e) => { setCaptain((prev) => ({ ...prev, [teamKey]: e.target.value })); setMsg(null); }}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm"
                >
                  <option value="">Kaptan yok</option>
                  {roster.map((p) => (
                    <option key={p.steamId} value={p.steamId}>{p.name}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        {/* Harita skorları */}
        <div className="mt-4">
          <div className="mb-2 text-sm font-medium text-gray-700">Harita Skorları</div>
          <div className="space-y-2">
            <div className="hidden grid-cols-[1fr_5rem_5rem_2rem] gap-2 text-[11px] text-gray-500 sm:grid">
              <span>Harita</span>
              <span className="truncate" title={t1Label}>{t1Label}</span>
              <span className="truncate" title={t2Label}>{t2Label}</span>
              <span></span>
            </div>
            {maps.map((m, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_4.5rem_4.5rem_2rem] items-center gap-2 sm:grid-cols-[1fr_5rem_5rem_2rem]">
                <input
                  type="text"
                  value={m.mapName}
                  onChange={(e) => updateMap(idx, { mapName: e.target.value })}
                  placeholder="de_mirage"
                  className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm"
                />
                <input
                  type="number" min={0}
                  value={m.score1}
                  onChange={(e) => updateMap(idx, { score1: e.target.value })}
                  className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm"
                />
                <input
                  type="number" min={0}
                  value={m.score2}
                  onChange={(e) => updateMap(idx, { score2: e.target.value })}
                  className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 shadow-sm"
                />
                <button
                  type="button"
                  onClick={() => removeMap(idx)}
                  disabled={maps.length <= 1}
                  className="flex items-center justify-center rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                  title="Haritayı sil"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addMap} className="mt-2 inline-flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800">
            <PlusCircle className="h-3.5 w-3.5" />Harita ekle
          </button>
        </div>

        {/* Önizleme */}
        <div className="mt-3 rounded border border-purple-100 bg-white px-3 py-2 text-sm text-gray-700">
          {preview.hasAny ? (
            <div className="space-y-0.5">
              <div className="mb-1 font-medium">Önizleme (harita puanları):</div>
              {preview.rows.map((r, i) => (
                r ? (
                  <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium">{r.mapName.replace(/^de_/, '')}</span>
                    <span className="text-gray-600">{r.s1}-{r.s2}</span>
                    {r.r1.overtimes > 0 && <span className="rounded bg-orange-200 px-1 text-[10px] font-semibold text-orange-800">{r.r1.overtimes} uzatma</span>}
                    <span className="font-mono">{t1Label}: +{r.r1.points}</span>
                    <span className="font-mono">{t2Label}: +{r.r2.points}</span>
                  </div>
                ) : null
              ))}
              <div className="mt-1 border-t pt-1 text-xs font-medium">
                Toplam — <span className="text-purple-700">{t1Label}: {preview.t1}</span> · <span className="text-indigo-700">{t2Label}: {preview.t2}</span>
                <span className="ml-1 text-gray-500">(kaptanlara +{scoring.captainBonus} eklenir)</span>
              </div>
            </div>
          ) : (
            <span className="text-gray-500">Harita skorlarını girince puan önizlemesi burada görünür.</span>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-purple-600 px-4 py-1.5 text-sm text-white shadow-sm transition-colors hover:bg-purple-700 disabled:opacity-50"
          >
            {saving ? 'Kaydediliyor...' : editingDate ? 'Geceyi Güncelle' : 'Geceyi Kaydet'}
          </button>
          {editingDate && (
            <button type="button" onClick={resetForm} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
              Yeni gece
            </button>
          )}
        </div>

        {msg && (
          <p className={`mt-3 text-sm ${msg.startsWith('Hata') || msg.startsWith('Hatalı') ? 'text-red-600' : 'text-green-600'}`}>{msg}</p>
        )}
      </div>

      {existingNights.length > 0 && (
        <div className="rounded border border-slate-200 bg-white p-4 shadow-sm">
          <h5 className="mb-2 text-sm font-medium text-gray-700">Elle Eklenen Geceler ({existingNights.length})</h5>
          <div className="space-y-2">
            {existingNights.map((mn) => {
              const capRec = captainsByDate?.[mn.date];
              return (
                <div key={mn.date} className={`rounded border px-3 py-2 text-sm shadow-sm ${editingDate === mn.date ? 'border-purple-300 bg-purple-50' : 'border-gray-200 bg-white'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <CalendarPlus className="h-3.5 w-3.5 text-purple-500" />
                      <span className="font-medium">{mn.date}</span>
                      <span className="text-gray-600">{mn.team1Name || 'Takım 1'} vs {mn.team2Name || 'Takım 2'}</span>
                      <span className="text-[11px] text-gray-400">{(mn.team1Players || []).length}v{(mn.team2Players || []).length} · {(mn.maps || []).length} harita</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => loadNight(mn)} className="text-xs text-blue-500 hover:text-blue-700">Düzenle</button>
                      <button type="button" onClick={() => handleDelete(mn)} className="text-xs text-red-400 hover:text-red-600" title="Sil"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(mn.maps || []).map((m, i) => (
                      <span key={`${m.mapName}-${i}`} className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700">
                        {m.mapName.replace(/^de_/, '')} {m.team1Score}-{m.team2Score}
                      </span>
                    ))}
                    {capRec?.team1?.steamId && (
                      <span className="inline-flex items-center gap-1 rounded bg-yellow-100 px-1.5 py-0.5 text-[11px] text-yellow-800"><Crown className="h-3 w-3" />{displayNameForSteamId(capRec.team1.steamId, playersIndex)}</span>
                    )}
                    {capRec?.team2?.steamId && (
                      <span className="inline-flex items-center gap-1 rounded bg-yellow-100 px-1.5 py-0.5 text-[11px] text-yellow-800"><Crown className="h-3 w-3" />{displayNameForSteamId(capRec.team2.steamId, playersIndex)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SuperligaClient({
  sonmacByDate: initialSonmacByDate,
  seasonStart,
  players,
  config,
}: {
  sonmacByDate: SonmacByDate;
  seasonStart: string | null;
  players: unknown;
  config: SuperligaConfig | null;
}) {
  const { user } = useSession();
  const [sonmacByDateData, setSonmacByDateData] = useState<SonmacByDate>(initialSonmacByDate || {});
  const sonmacByDate = sonmacByDateData;

  useEffect(() => {
    setSonmacByDateData(initialSonmacByDate || {});
  }, [initialSonmacByDate]);

  const effectiveConfig: SuperligaConfig = useMemo(() => {
    return config || {
      version: 1,
      scoring: DEFAULT_SUPERLIGA_SCORING,
      leagues: [{ id: 'superliga', name: 'Superliga', players: [] }],
    };
  }, [config]);

  const playersIndex = useMemo(() => buildPlayersIndex(players), [players]);

  useStatsRefresh({
    keys: ['sonmac_by_date_periods', 'sonmac_by_date'],
    onData: (payload) => {
      const nextSonmacByDate = isDateKeyedPeriodPayload<any>(payload?.sonmac_by_date_periods) && payload.sonmac_by_date_periods.current_period
        ? getDateKeyedPeriodData(payload.sonmac_by_date_periods, payload.sonmac_by_date_periods.current_period)
        : payload?.sonmac_by_date;
      if (nextSonmacByDate && typeof nextSonmacByDate === 'object') {
        setSonmacByDateData(nextSonmacByDate as SonmacByDate);
      }
    },
  });

  const { data: captainsData, refetch: refetchCaptains } = useLivePolling<{ captainsByDate: CaptainsByDateSnapshot }>({
    url: '/api/live/superliga-captains',
    intervalMs: 5000,
    initialData: { captainsByDate: {} },
  });
  const captainsByDate = captainsData.captainsByDate || null;

  const { data: overridesData, refetch: refetchOverrides } = useLivePolling<{ overridesByDate: SuperligaMapOverridesByDate }>({
    url: '/api/live/superliga-map-overrides',
    intervalMs: 5000,
    initialData: { overridesByDate: {} },
  });
  const mapOverrides = overridesData.overridesByDate || null;

  const { data: manualNightsData, refetch: refetchManualNights } = useLivePolling<{ manualNightsByDate: SuperligaManualNightsByDate }>({
    url: '/api/live/superliga-manual-nights',
    intervalMs: 5000,
    initialData: { manualNightsByDate: {} },
  });
  const manualNights = manualNightsData.manualNightsByDate || null;

  // Demo (sonmac) gecelerinin tarihleri — "Eksik Maç Ekle" ve puanlama için.
  const demoDates = useMemo(() => {
    const dates = Object.keys(sonmacByDate || {});
    const filtered = seasonStart ? dates.filter((date) => date >= seasonStart) : dates;
    return sortDatesDesc(filtered);
  }, [sonmacByDate, seasonStart]);

  // Demo + manuel gece tarihlerinin birleşimi — kaptan atama gibi akışlar için.
  const availableDates = useMemo(() => {
    const set = new Set<string>(Object.keys(sonmacByDate || {}));
    for (const d of Object.keys(manualNights || {})) set.add(d);
    const arr = [...set];
    const filtered = seasonStart ? arr.filter((date) => date >= seasonStart) : arr;
    return sortDatesDesc(filtered);
  }, [sonmacByDate, manualNights, seasonStart]);

  const seasonLength = effectiveConfig.seasonLength && effectiveConfig.seasonLength > 0 ? effectiveConfig.seasonLength : 15;

  const [activeTab, setActiveTab] = useState<ActiveTab>('standings');
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [selectedProgressIndex, setSelectedProgressIndex] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [captainDraftSteamIds, setCaptainDraftSteamIds] = useState<Record<TeamKey, string>>({ team1: '', team2: '' });
  const [captainDraftDirty, setCaptainDraftDirty] = useState<Record<TeamKey, boolean>>({ team1: false, team2: false });
  const [savedCaptains, setSavedCaptains] = useState<Record<TeamKey, CaptainRecord | null>>({ team1: null, team2: null });
  const [savingTeam, setSavingTeam] = useState<Record<TeamKey, boolean>>({ team1: false, team2: false });
  const [message, setMessage] = useState<string | null>(null);

  const teams = useMemo(() => {
    if (!selectedDate) return null;
    return deriveSuperligaTeamsForDate(sonmacByDate || {}, manualNights, selectedDate);
  }, [selectedDate, sonmacByDate, manualNights]);

  const standingsData = useMemo(() => {
    return computeSuperligaStandings({
      config: effectiveConfig,
      sonmacByDate,
      captainsByDate,
      mapOverrides,
      manualNights,
      seasonStart,
      playersIndex,
    });
  }, [captainsByDate, mapOverrides, manualNights, effectiveConfig, playersIndex, seasonStart, sonmacByDate]);

  const totalPlayedNights = standingsData?.datesIncluded?.length ?? 0;
  const effectiveProgressIndex = selectedProgressIndex === null ? null : Math.min(selectedProgressIndex, totalPlayedNights);

  // Standings as of the selected night (history viewing). Null/last → current.
  const filteredStandingsData = useMemo(() => {
    if (effectiveProgressIndex === null || effectiveProgressIndex >= totalPlayedNights) return standingsData;
    return computeSuperligaStandings({
      config: effectiveConfig,
      sonmacByDate,
      captainsByDate,
      mapOverrides,
      manualNights,
      seasonStart,
      playersIndex,
      upToNight: effectiveProgressIndex,
    });
  }, [captainsByDate, mapOverrides, manualNights, effectiveConfig, effectiveProgressIndex, playersIndex, seasonStart, sonmacByDate, standingsData, totalPlayedNights]);

  // The night before the currently-viewed one, for position-change arrows.
  const previousStandingsData = useMemo(() => {
    const currentNightCount = effectiveProgressIndex ?? totalPlayedNights;
    if (currentNightCount <= 1) return null;
    return computeSuperligaStandings({
      config: effectiveConfig,
      sonmacByDate,
      captainsByDate,
      mapOverrides,
      manualNights,
      seasonStart,
      playersIndex,
      upToNight: currentNightCount - 1,
    });
  }, [captainsByDate, mapOverrides, manualNights, effectiveConfig, effectiveProgressIndex, playersIndex, seasonStart, sonmacByDate, totalPlayedNights]);

  const standingsWithChange = useMemo(() => {
    const rows = filteredStandingsData?.league?.standings || [];
    const prevMap = new Map<string, number>();
    previousStandingsData?.league?.standings?.forEach((player, idx) => prevMap.set(player.steamId, idx));

    return rows.map((player, idx) => {
      const prevIdx = prevMap.get(player.steamId);
      let positionChange: SuperligaPlayerStanding['positionChange'] = 'new';
      if (!previousStandingsData) positionChange = undefined;
      else if (prevIdx !== undefined) positionChange = idx < prevIdx ? 'up' : idx > prevIdx ? 'down' : 'same';
      return { ...player, positionChange };
    });
  }, [filteredStandingsData, previousStandingsData]);

  const rawDates = useMemo(() => sortDatesDesc(standingsData?.datesIncluded || []), [standingsData]);

  useEffect(() => {
    if (!selectedDate && availableDates.length) {
      setSelectedDate(availableDates[0]);
    }
  }, [availableDates, selectedDate]);

  useEffect(() => {
    setMessage(null);
    setCaptainDraftDirty({ team1: false, team2: false });
    setCaptainDraftSteamIds({ team1: '', team2: '' });
  }, [selectedDate]);

  useEffect(() => {
    if (!selectedDate || !captainsByDate) {
      setSavedCaptains({ team1: null, team2: null });
      return;
    }
    const dateData = captainsByDate[selectedDate];
    setSavedCaptains({ team1: dateData?.team1 || null, team2: dateData?.team2 || null });
  }, [captainsByDate, selectedDate]);

  const captainSteamIds = useMemo<Record<TeamKey, string>>(() => ({
    team1: captainDraftDirty.team1 ? captainDraftSteamIds.team1 : savedCaptains.team1?.steamId || '',
    team2: captainDraftDirty.team2 ? captainDraftSteamIds.team2 : savedCaptains.team2?.steamId || '',
  }), [captainDraftDirty, captainDraftSteamIds, savedCaptains]);

  const handleSaveTeamCaptain = async (teamKey: TeamKey) => {
    if (!user) {
      setMessage('Giriş gerekli.');
      return;
    }
    if (!selectedDate || !teams) {
      setMessage('Tarih veya takım verisi yok.');
      return;
    }

    const roster = teamKey === 'team1' ? teams.team1Players : teams.team2Players;
    const teamName = teamKey === 'team1' ? teams.team1Name : teams.team2Name;
    const chosenSteamId = captainSteamIds[teamKey];

    if (!chosenSteamId || !roster.some((player) => player.steamId === chosenSteamId)) {
      setMessage('Kaptan takım kadrosunda olmalı.');
      return;
    }

    const password = window.prompt('Şifre girin:');
    if (password !== CLEAR_ATTENDANCE_PASSWORD) {
      setMessage('Hatalı şifre.');
      return;
    }

    setSavingTeam((state) => ({ ...state, [teamKey]: true }));
    try {
      await setSuperligaCaptain({
        date: selectedDate,
        teamKey,
        steamId: chosenSteamId,
        steamName: displayNameForSteamId(chosenSteamId, playersIndex),
        teamName,
        setByUid: user.uid,
        setByName: user.name || user.email || '',
        setAt: Date.now(),
      });
      setMessage(`${teamName} kaptanı kaydedildi.`);
      await refetchCaptains();
    } catch (error: unknown) {
      setMessage(`Hata: ${getErrorMessage(error)}`);
    } finally {
      setSavingTeam((state) => ({ ...state, [teamKey]: false }));
    }
  };

  return (
    <div className="space-y-4">
      <ScoringReference config={effectiveConfig} />

      <div className="mb-3 flex flex-wrap gap-1 border-b border-gray-200 pb-1">
        {[
          { key: 'standings', label: 'Puan Durumu' },
          { key: 'raw', label: 'Ham Veri' },
          { key: 'kaptanlik', label: 'Kaptan Atama' },
          { key: 'overrides', label: 'Eksik Maç Ekle' },
          { key: 'manual', label: 'Manuel Gece' },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key as ActiveTab)}
            className={`rounded-t-md px-3 py-1.5 text-sm transition-colors ${activeTab === tab.key ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'standings' && (
        <div className="rounded border p-3">
          {totalPlayedNights > 0 && (
            <SeasonProgressBar
              played={totalPlayedNights}
              total={seasonLength}
              selectedIndex={selectedProgressIndex}
              onSelectIndex={setSelectedProgressIndex}
              dates={standingsData?.datesIncluded || []}
            />
          )}
          {(effectiveConfig.leagues?.[0]?.players || []).length === 0 ? (
            <div className="text-sm text-gray-700">Oyuncular tanımlı değil.</div>
          ) : (
            <div className="overflow-x-auto rounded border">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-200">
                  <tr>
                    <th className="w-10 px-2 py-2 text-center font-semibold text-gray-800">#</th>
                    <th className="w-8 px-1 py-2 text-center font-semibold text-gray-800" title="Pozisyon değişimi"></th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-800">Oyuncu</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-800" title="Oynanan gece">Gece</th>
                    <th className="hidden px-2 py-2 text-right font-semibold text-gray-800 sm:table-cell" title="Kazanılan / oynanan harita">Harita</th>
                    <th className="hidden px-2 py-2 text-right font-semibold text-gray-800 sm:table-cell" title="Kaptanlık gecesi">Kpt.</th>
                    <th className="hidden px-2 py-2 text-right font-semibold text-gray-800 sm:table-cell" title="Toplam puan">Top.</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-800" title="Gece başına ortalama puan">Ort.</th>
                  </tr>
                </thead>
                <tbody>
                  {standingsWithChange.map((player, idx) => {
                    const isExpanded = expandedPlayer === player.steamId;
                    const rankTone = idx === 0 ? 'bg-yellow-50' : idx === 1 ? 'bg-gray-50' : idx <= 5 ? 'bg-green-50/40' : '';
                    const rowClass = isExpanded ? 'bg-blue-50' : rankTone;

                    return (
                      <React.Fragment key={player.steamId}>
                        <tr
                          className={`cursor-pointer border-t hover:bg-gray-50 ${rowClass}`}
                          onClick={() => setExpandedPlayer(isExpanded ? null : player.steamId)}
                        >
                          <td className="px-2 py-2 text-center font-semibold text-gray-700">
                            <span className="inline-flex items-center gap-1">
                              {idx <= 1 && <Crown className="h-3.5 w-3.5 text-yellow-500" />}
                              {idx + 1}
                            </span>
                          </td>
                          <td className="px-1 py-2 text-center"><PositionChangeIndicator change={player.positionChange} /></td>
                          <td className="max-w-[120px] truncate px-2 py-2 font-medium sm:max-w-none">{player.name}</td>
                          <td className="px-2 py-2 text-right">{player.nightsPlayed}</td>
                          <td className="hidden px-2 py-2 text-right font-mono text-xs sm:table-cell">{player.mapsWon}/{player.mapsPlayed}</td>
                          <td className="hidden px-2 py-2 text-right sm:table-cell">{player.captainNights}</td>
                          <td className="hidden px-2 py-2 text-right font-mono text-xs text-gray-500 sm:table-cell">{player.totalPoints}</td>
                          <td className="px-2 py-2 text-right font-mono font-semibold text-purple-700">{player.avgPoints.toFixed(1)}</td>
                        </tr>
                        {isExpanded && player.nightBreakdown.length > 0 && (
                          <tr className="border-t bg-gray-50">
                            <td colSpan={8} className="px-3 py-2">
                              <table className="w-full text-xs">
                                <thead className="text-gray-500">
                                  <tr>
                                    <th className="px-2 py-1 text-left">Tarih</th>
                                    <th className="px-2 py-1 text-left">Haritalar</th>
                                    <th className="px-2 py-1 text-right">Kaptan</th>
                                    <th className="px-2 py-1 text-right">Gece Puanı</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {player.nightBreakdown.map((entry) => (
                                    <tr key={entry.date} className="border-t">
                                      <td className="whitespace-nowrap px-2 py-1 text-gray-600">{entry.date}</td>
                                      <td className="px-2 py-1"><NightMapsDetail entry={entry} /></td>
                                      <td className="px-2 py-1 text-right">{entry.isCaptain ? `+${entry.captainBonus}` : '-'}</td>
                                      <td className="px-2 py-1 text-right font-mono font-medium">{entry.points}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {standingsData?.warnings?.map((w, i) => (
            <p key={i} className="mt-2 text-sm text-amber-600">{w}</p>
          ))}
        </div>
      )}

      {activeTab === 'raw' && (
        <div className="rounded border p-3">
          {rawDates.length === 0 ? (
            <div className="text-sm text-gray-500">Henüz veri yok.</div>
          ) : (
            <div className="overflow-x-auto rounded border">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-200">
                  <tr>
                    <th className="sticky left-0 bg-gray-200 px-3 py-2 text-left font-semibold text-gray-800">Oyuncu</th>
                    {rawDates.map((date) => (
                      <th key={date} className="px-3 py-2 text-center font-semibold text-gray-800" title={date}>
                        <span className="font-mono">{date.slice(5)}</span>
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right font-semibold text-gray-800">Toplam</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-800">Ort.</th>
                  </tr>
                </thead>
                <tbody>
                  {(standingsData?.league?.standings || []).map((player) => {
                    const byDate = new Map(player.nightBreakdown.map((entry) => [entry.date, entry] as const));
                    return (
                      <tr key={player.steamId} className="border-t">
                        <td className="sticky left-0 whitespace-nowrap bg-white px-3 py-2 font-medium">{player.name}</td>
                        {rawDates.map((date) => {
                          const entry = byDate.get(date);
                          if (!entry) {
                            return <td key={date} className="px-3 py-2 text-center text-gray-400">-</td>;
                          }
                          return (
                            <td key={date} className="px-3 py-2 text-center">
                              <div className="font-mono font-semibold text-gray-900">{entry.points}</div>
                              <div className="text-[10px] font-mono text-gray-500">
                                {entry.mapPoints}{entry.captainBonus ? `+${entry.captainBonus}k` : ''}
                              </div>
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right font-mono font-semibold text-gray-700">{player.totalPoints}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-purple-700">{player.avgPoints.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'kaptanlik' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Tarih:</label>
            <select value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="rounded border px-2 py-1 text-sm">
              {availableDates.map((date) => (
                <option key={date} value={date}>{date}</option>
              ))}
            </select>
          </div>

          {teams ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {(['team1', 'team2'] as const).map((teamKey) => {
                const roster = teamKey === 'team1' ? teams.team1Players : teams.team2Players;
                const teamName = teamKey === 'team1' ? teams.team1Name : teams.team2Name;
                const saved = savedCaptains[teamKey];

                return (
                  <div key={teamKey} className="rounded-lg bg-white p-4 shadow">
                    <h4 className="text-sm font-semibold">{teamName}</h4>
                    {saved ? (
                      <p className="mt-2 text-sm text-green-700">
                        Kaptan: <span className="font-medium">{displayNameForSteamId(saved.steamId, playersIndex)}</span>
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-gray-500">Kaptan atanmadı</p>
                    )}
                    <select
                      value={captainSteamIds[teamKey]}
                      onChange={(e) => {
                        const nextSteamId = e.target.value;
                        setCaptainDraftSteamIds((state) => ({ ...state, [teamKey]: nextSteamId }));
                        setCaptainDraftDirty((state) => ({ ...state, [teamKey]: true }));
                      }}
                      className="mt-2 w-full rounded border px-2 py-1 text-sm"
                    >
                      <option value="">Seçin...</option>
                      {roster.map((player) => (
                        <option key={player.steamId} value={player.steamId}>{displayNameForSteamId(player.steamId, playersIndex)}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleSaveTeamCaptain(teamKey)}
                      disabled={savingTeam[teamKey]}
                      className="mt-2 rounded bg-purple-600 px-3 py-1 text-sm text-white hover:bg-purple-700 disabled:opacity-50"
                    >
                      {savingTeam[teamKey] ? 'Kaydediliyor...' : 'Kaydet'}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500">{selectedDate ? 'Bu tarih için takım verisi yok.' : 'Bir tarih seçin.'}</p>
          )}

          {message && <p className="text-sm text-amber-600">{message}</p>}
        </div>
      )}

      {activeTab === 'overrides' && (
        <MapOverridePanel
          config={effectiveConfig}
          availableDates={demoDates}
          sonmacByDate={sonmacByDate}
          mapOverrides={mapOverrides}
          user={user}
          onSaved={refetchOverrides}
        />
      )}

      {activeTab === 'manual' && (
        <ManualNightPanel
          config={effectiveConfig}
          seasonStart={seasonStart}
          sonmacByDate={sonmacByDate}
          manualNights={manualNights}
          captainsByDate={captainsByDate}
          playersIndex={playersIndex}
          user={user}
          onSaved={refetchManualNights}
          refetchCaptains={refetchCaptains}
        />
      )}
    </div>
  );
}
