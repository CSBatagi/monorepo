'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dices, Info, ListOrdered, Network, Trophy } from 'lucide-react';
import { useSession } from '@/contexts/SessionContext';
import { useLivePolling } from '@/lib/useLivePolling';
import { useStatsRefresh } from '@/lib/useStatsRefresh';
import { getDateKeyedPeriodData, isDateKeyedPeriodPayload } from '@/lib/statsPeriods';
import type { CaptainsByDateSnapshot, SonmacByDate } from '@/lib/batakAllStars';
import {
  buildPlayersIndex,
  computeSuperligaStandings,
  displayNameForSteamId,
  DEFAULT_SUPERLIGA_SCORING,
  type SuperligaConfig,
  type SuperligaManualNightsByDate,
  type SuperligaMapOverridesByDate,
  type SuperligaPlayerStanding,
} from '@/lib/superliga';
import {
  MUNDIAL_QUALIFIERS_PER_GROUP,
  buildBracket,
  drawParticipants,
  drawTimeline,
  potIndexBySteamId,
  splitStandingsIntoGroups,
  type MundialConfig,
  type MundialGroupTable,
  type MundialLiveData,
} from '@/lib/mundial';
import {
  CaptainAssignmentPanel,
  ManualNightPanel,
  MapOverridePanel,
  NightMapsDetail,
  PositionChangeIndicator,
  SeasonProgressBar,
  sortDatesDesc,
} from '@/components/superliga/SuperligaPanels';
import MundialDraw from './MundialDraw';
import MundialBracket from './MundialBracket';
import styles from './mundial.module.css';

const TABS = [
  { key: 'kura', label: 'Kura', icon: Dices },
  { key: 'gruplar', label: 'Gruplar', icon: ListOrdered },
  { key: 'eleme', label: 'Eleme Tablosu', icon: Network },
  { key: 'format', label: 'Format', icon: Info },
] as const;
const ADMIN_TABS = [
  { key: 'kaptanlik', label: 'Kaptan Atama' },
  { key: 'overrides', label: 'Eksik Maç Ekle' },
  { key: 'manual', label: 'Manuel Gece' },
] as const;
type TabKey = typeof TABS[number]['key'] | typeof ADMIN_TABS[number]['key'];
const TAB_KEYS = new Set<string>([...TABS, ...ADMIN_TABS].map((t) => t.key));
const TAB_PARAM = 'sekme';

const DEFAULT_CONFIG: MundialConfig = { version: 1, pots: [], groupCount: 4, groupStageLength: 15 };

function GroupTable({
  group,
  previousRanks,
  potOf,
  wildcardIds,
  showQualifiers,
  expanded,
  onToggle,
}: {
  group: MundialGroupTable;
  previousRanks: Map<string, number> | null;
  potOf: Map<string, number>;
  wildcardIds: Set<string>;
  showQualifiers: boolean;
  expanded: string | null;
  onToggle: (steamId: string) => void;
}) {
  const isDeath = group.rows.some((row) => wildcardIds.has(row.steamId));
  return (
    <div className={styles.groupCard}>
      <div className={styles.groupHead}>
        <span>GRUP {group.id}</span>
        {isDeath && <span className={styles.deathBadge}>ÖLÜM GRUBU 💀</span>}
      </div>
      <div className="overflow-x-auto">
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ width: 34 }}>#</th>
              <th style={{ width: 24 }} aria-label="Pozisyon değişimi"></th>
              <th>Oyuncu</th>
              <th title="Oynanan gece">Gece</th>
              <th className={styles.hideSm} title="Kazanılan / oynanan harita">Harita</th>
              <th className={styles.hideSm} title="Kaptanlık gecesi">Kpt.</th>
              <th className={styles.hideSm} title="Toplam puan">Top.</th>
              <th title="Gece başına ortalama puan">Ort.</th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row, idx) => {
              const qualifies = showQualifiers && idx < MUNDIAL_QUALIFIERS_PER_GROUP;
              const prev = previousRanks?.get(row.steamId);
              const change: SuperligaPlayerStanding['positionChange'] = !previousRanks
                ? undefined
                : prev === undefined ? 'new' : idx < prev ? 'up' : idx > prev ? 'down' : 'same';
              const pot = potOf.get(row.steamId);
              const isOpen = expanded === row.steamId;
              return (
                <React.Fragment key={row.steamId}>
                  <tr className={qualifies ? styles.qualifyRow : ''} onClick={() => onToggle(row.steamId)}>
                    <td><b>{idx + 1}</b></td>
                    <td><PositionChangeIndicator change={change} /></td>
                    <td>
                      <span className="inline-flex items-center gap-2">
                        {pot !== undefined && <span className={styles.potBadge} data-pot={pot + 1} title={`${pot + 1}. torba`}>{pot + 1}</span>}
                        <span className="font-semibold">{row.name}</span>
                        {qualifies && <span className={styles.qualifyTag}>ÇF</span>}
                      </span>
                    </td>
                    <td>{row.nightsPlayed}</td>
                    <td className={styles.hideSm}>{row.mapsWon}/{row.mapsPlayed}</td>
                    <td className={styles.hideSm}>{row.captainNights}</td>
                    <td className={styles.hideSm}>{row.totalPoints}</td>
                    <td><span className={styles.avg}>{row.avgPoints.toFixed(1)}</span></td>
                  </tr>
                  {isOpen && (
                    <tr className={styles.breakdown}>
                      <td colSpan={8}>
                        {row.nightBreakdown.length === 0 ? (
                          <span className={styles.muted}>Henüz sayılan gece yok.</span>
                        ) : (
                          <div className="flex flex-col gap-2 py-1">
                            {row.nightBreakdown.map((entry) => (
                              <div key={entry.date} className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="font-mono">{entry.date}</span>
                                <NightMapsDetail entry={entry} />
                                {entry.isCaptain && <span>Kaptan +{entry.captainBonus}</span>}
                                <b className="ml-auto font-mono">{entry.points}</b>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FormatPanel({ config, nameOf }: { config: MundialConfig; nameOf: (id: string) => string }) {
  const s = config.scoring || DEFAULT_SUPERLIGA_SCORING;
  const groupCount = config.groupCount || 4;
  return (
    <div className={styles.formatGrid}>
      <div className={styles.panel}>
        <div className={styles.panelTitle}><Trophy className="h-5 w-5" />Format</div>
        <ul className={styles.formatList}>
          <li>Superliga&apos;nın sezon sonu sıralamasına göre <b>{config.pots.length} torba</b> oluşturuldu: 1-4 → 1. torba, 5-8 → 2. torba …</li>
          <li>Kurayla <b>{groupCount} gruba</b> ayrılıyoruz; her grupta her torbadan <b>en fazla bir</b> oyuncu var (Dünya Kupası eleme grubu usulü).</li>
          <li><b>Düşme/çıkma yok.</b> Bu sezonu &quot;altta kalan alt ligden başlar&quot; diye oynamadık.</li>
          <li>Grup aşaması <b>{config.groupStageLength || 15} gece</b> sürer. Maçlar her zamanki gibi karışık takımlarla oynanır; sıralama grup içinde yapılır.</li>
          <li>Her grubun <b>ilk iki</b> oyuncusu çeyrek finale kalır; oradan 8 kişilik klasik eleme tablosu.</li>
          <li>Gruptan çıkan bir oyuncu en fazla <b>3 maç</b> daha oynar (çeyrek final, yarı final, final).</li>
          <li>Format tutarsa bir sonraki sezonun torbaları bu sezonun puanlarına göre yeniden oluşturulur ve yeniden kura çekilir.</li>
        </ul>
        <div className={styles.pairings}>
          <span>ÇF1 · A1 – B2</span>
          <span>ÇF3 · B1 – A2</span>
          <span>ÇF2 · C1 – D2</span>
          <span>ÇF4 · D1 – C2</span>
          <span>YF1 · ÇF1 – ÇF2</span>
          <span>YF2 · ÇF3 – ÇF4</span>
        </div>
      </div>
      <div className={styles.panel}>
        <div className={styles.panelTitle}>Puanlama (Superliga ile aynı)</div>
        <ul className={styles.formatList}>
          <li>Kazanılan her haritadan <b>{s.winPoints} puan + averaj</b> (skor farkı).</li>
          <li>Kaptanlar kaptanlık yaptıkları her gece için <b>+{s.captainBonus} puan</b> alır.</li>
          <li>Uzatmaya giden haritada kaybeden takım her uzatma serisi için <b>+{s.overtimeConsolationPerSeries}</b> teselli puanı alır (en fazla {s.maxOvertimeConsolationSeries} seri).</li>
          <li>Sıralama <b>gece başına ortalama puana</b> göre; eşitlikte kazanılan harita sayısı.</li>
          <li>Bir gecenin sayılması için <b>her iki takıma da kaptan atanmış</b> olmalı.</li>
        </ul>
        <div className="mt-4">
          <div className={styles.panelTitle}>Torbalar</div>
          <div className="flex flex-col gap-1 text-sm">
            {config.pots.map((pot, i) => (
              <div key={pot.id} className="flex flex-wrap items-center gap-2">
                <span className={styles.potBadge} data-pot={i + 1}>{pot.id}</span>
                <span>{pot.players.map(nameOf).join(', ')}{(config.tentative || []).some((id) => pot.players.includes(id)) ? ' (katılımı kurada belirlenir)' : ''}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MundialClient({
  sonmacByDate: initialSonmacByDate,
  players,
  config: rawConfig,
}: {
  sonmacByDate: SonmacByDate;
  players: unknown;
  config: MundialConfig | null;
}) {
  const { user } = useSession();
  const config = rawConfig && Array.isArray(rawConfig.pots) ? rawConfig : DEFAULT_CONFIG;
  const scoring = config.scoring || DEFAULT_SUPERLIGA_SCORING;
  const seasonStart = config.seasonStart || null;
  const groupStageLength = config.groupStageLength && config.groupStageLength > 0 ? config.groupStageLength : 15;
  const leagueName = config.name || 'Batak Mundial';

  const [sonmacByDate, setSonmacByDate] = useState<SonmacByDate>(initialSonmacByDate || {});
  useEffect(() => { setSonmacByDate(initialSonmacByDate || {}); }, [initialSonmacByDate]);
  useStatsRefresh({
    keys: ['sonmac_by_date_periods', 'sonmac_by_date'],
    onData: (payload) => {
      const next = isDateKeyedPeriodPayload<SonmacByDate[string]>(payload?.sonmac_by_date_periods) && payload.sonmac_by_date_periods.current_period
        ? getDateKeyedPeriodData(payload.sonmac_by_date_periods, payload.sonmac_by_date_periods.current_period)
        : payload?.sonmac_by_date;
      if (next && typeof next === 'object') setSonmacByDate((prev) => ({ ...prev, ...(next as SonmacByDate) }));
    },
  });

  const playersIndex = useMemo(() => buildPlayersIndex(players), [players]);
  const nameOf = useCallback(
    (steamId: string) => {
      const name = displayNameForSteamId(steamId, playersIndex);
      return name && name !== steamId ? name : config.notes?.[steamId] || steamId;
    },
    [playersIndex, config.notes],
  );

  // ── Live data ──
  const { data: mundialData, loading: mundialLoading, refetch: refetchMundial } = useLivePolling<MundialLiveData>({
    url: '/api/live/mundial',
    intervalMs: 3000,
    initialData: { draw: null, knockout: {} },
  });
  const draw = mundialData.draw || null;
  const knockoutResults = useMemo(() => mundialData.knockout || {}, [mundialData.knockout]);

  const { data: captainsData, refetch: refetchCaptains } = useLivePolling<{ captainsByDate: CaptainsByDateSnapshot }>({
    url: '/api/live/superliga-captains', intervalMs: 5000, initialData: { captainsByDate: {} },
  });
  const captainsByDate = captainsData.captainsByDate || null;
  const { data: overridesData, refetch: refetchOverrides } = useLivePolling<{ overridesByDate: SuperligaMapOverridesByDate }>({
    url: '/api/live/superliga-map-overrides', intervalMs: 5000, initialData: { overridesByDate: {} },
  });
  const mapOverrides = overridesData.overridesByDate || null;
  const { data: manualNightsData, refetch: refetchManualNights } = useLivePolling<{ manualNightsByDate: SuperligaManualNightsByDate }>({
    url: '/api/live/superliga-manual-nights', intervalMs: 5000, initialData: { manualNightsByDate: {} },
  });
  const manualNights = manualNightsData.manualNightsByDate || null;

  // Sunucu saatine hizalama: tören herkeste aynı anda oynasın.
  const [clockOffset, setClockOffset] = useState(0);
  useEffect(() => {
    if (typeof mundialData.serverTime === 'number') setClockOffset(mundialData.serverTime - Date.now());
  }, [mundialData.serverTime]);

  const revealEndsAt = draw ? draw.revealStartsAt + drawTimeline(draw).totalMs : 0;
  const ceremonyLive = !!draw && Date.now() + clockOffset < revealEndsAt;
  // Re-render once the ceremony ends so the live status clears.
  const [, setCeremonyTick] = useState(0);
  useEffect(() => {
    if (!ceremonyLive) return;
    const id = window.setTimeout(() => setCeremonyTick((t) => t + 1), Math.max(0, revealEndsAt - (Date.now() + clockOffset)) + 50);
    return () => window.clearTimeout(id);
  }, [ceremonyLive, revealEndsAt, clockOffset]);

  // ── Tabs ──
  const [tab, setTab] = useState<TabKey | null>(null);
  const seenDrawRef = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (mundialLoading) return;
    const drawKey = draw?.createdAt ?? null;
    if (seenDrawRef.current === undefined) {
      // İlk yükleme: URL'deki sekme, yoksa kuranın durumuna göre.
      seenDrawRef.current = drawKey;
      let requested: string | null = null;
      try { requested = new URLSearchParams(window.location.search).get(TAB_PARAM); } catch {}
      if (ceremonyLive) setTab('kura');
      else if (requested && TAB_KEYS.has(requested)) setTab(requested as TabKey);
      else setTab(draw ? 'gruplar' : 'kura');
      return;
    }
    if (drawKey !== seenDrawRef.current) {
      seenDrawRef.current = drawKey;
      // Kura canlı başladıysa herkesi törene al.
      if (ceremonyLive) setTab('kura');
    }
  }, [mundialLoading, draw, ceremonyLive]);

  const selectTab = (next: TabKey) => {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set(TAB_PARAM, next);
      window.history.replaceState(window.history.state, '', url);
    } catch {}
  };

  // ── Standings ──
  const participants = useMemo(
    () => (draw ? drawParticipants(draw) : config.pots.flatMap((pot) => pot.players)),
    [draw, config.pots],
  );
  const leagueConfig: SuperligaConfig = useMemo(() => ({
    version: 1,
    scoring,
    leagues: [{ id: 'mundial', name: leagueName, players: participants }],
  }), [scoring, leagueName, participants]);

  const standingsFor = useCallback((upToNight: number) => computeSuperligaStandings({
    config: leagueConfig,
    sonmacByDate,
    captainsByDate,
    mapOverrides,
    manualNights,
    seasonStart,
    playersIndex,
    upToNight,
  }), [leagueConfig, sonmacByDate, captainsByDate, mapOverrides, manualNights, seasonStart, playersIndex]);

  // Grup aşaması groupStageLength gece ile sınırlıdır; sonraki geceler (eleme) sayılmaz.
  const groupStage = useMemo(() => standingsFor(groupStageLength), [standingsFor, groupStageLength]);
  const playedNights = groupStage.datesIncluded.length;
  const groupStageComplete = playedNights >= groupStageLength;

  const [selectedNight, setSelectedNight] = useState<number | null>(null);
  const viewNight = selectedNight === null ? playedNights : Math.min(selectedNight, playedNights);
  const viewed = useMemo(
    () => (viewNight >= playedNights ? groupStage : standingsFor(viewNight)),
    [viewNight, playedNights, groupStage, standingsFor],
  );
  const previous = useMemo(() => (viewNight > 1 ? standingsFor(viewNight - 1) : null), [viewNight, standingsFor]);

  const groups = useMemo(() => (draw ? splitStandingsIntoGroups(viewed.league.standings, draw) : null), [draw, viewed]);
  const previousGroupRanks = useMemo(() => {
    if (!draw || !previous) return null;
    const map = new Map<string, Map<string, number>>();
    for (const g of splitStandingsIntoGroups(previous.league.standings, draw)) {
      map.set(g.id, new Map(g.rows.map((row, i) => [row.steamId, i] as const)));
    }
    return map;
  }, [draw, previous]);

  const finalGroups = useMemo(() => (draw ? splitStandingsIntoGroups(groupStage.league.standings, draw) : null), [draw, groupStage]);
  const seedsKnown = !!draw && playedNights > 0;
  const bracket = useMemo(
    () => buildBracket(finalGroups, knockoutResults, { seedsKnown }),
    [finalGroups, knockoutResults, seedsKnown],
  );

  const potOf = useMemo(() => potIndexBySteamId(draw), [draw]);
  const wildcardIds = useMemo(() => new Set(config.wildcards || []), [config.wildcards]);
  const [expanded, setExpanded] = useState<string | null>(null);

  // ── Admin date pools ──
  const inSeason = useCallback((d: string) => !seasonStart || d >= seasonStart, [seasonStart]);
  const demoDates = useMemo(() => sortDatesDesc(Object.keys(sonmacByDate || {}).filter(inSeason)), [sonmacByDate, inSeason]);
  const availableDates = useMemo(() => {
    const set = new Set<string>([...Object.keys(sonmacByDate || {}), ...Object.keys(manualNights || {})]);
    return sortDatesDesc([...set].filter(inSeason));
  }, [sonmacByDate, manualNights, inSeason]);

  // ── Status ──
  const status = !draw
    ? { live: false, text: 'Kura bekleniyor' }
    : ceremonyLive
      ? { live: true, text: 'CANLI · Kura çekiliyor' }
      : bracket.championSteamId
        ? { live: false, text: `Şampiyon: ${nameOf(bracket.championSteamId)}` }
        : groupStageComplete
          ? { live: false, text: 'Eleme turu' }
          : { live: false, text: `Grup aşaması · ${playedNights}/${groupStageLength} gece` };

  const participantCount = draw ? participants.length : config.pots.reduce((n, p) => n + p.players.length, 0) - (config.tentative?.length || 0);

  return (
    <div className={styles.root}>
      <section className={styles.hero}>
        <div className={styles.heroKicker}>YENİ SEZON · SUPERLIGA&apos;NIN DEVAMI</div>
        <div className={styles.heroTitle}>Kura · Gruplar · Kupa</div>
        <p className={styles.heroText}>
          Torbalar, kura, 5&apos;er kişilik gruplar. Gruplarda ilk ikiye giren çeyrek finale kalır, gerisi klasik eleme.
          Düşme yok, puanlama Superliga ile aynı.
        </p>
        <div className={styles.heroFacts}>
          <span className={`${styles.heroFact} ${status.live ? styles.statusLive : ''}`}>
            {status.live && <span className={styles.liveDot} />}{status.text}
          </span>
          <span className={styles.heroFact}>{participantCount}{draw ? '' : '+'} oyuncu</span>
          <span className={styles.heroFact}>{config.pots.length} torba · {config.groupCount || 4} grup</span>
          <span className={styles.heroFact}>İlk 2 → çeyrek final</span>
          {seasonStart && <span className={styles.heroFact}>Başlangıç: {seasonStart}</span>}
        </div>
      </section>

      <nav className={styles.tabs} aria-label={`${leagueName} bölümleri`}>
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => selectTab(key)}
            className={`${styles.tab} ${tab === key ? styles.tabActive : ''}`}
            aria-current={tab === key ? 'page' : undefined}
          >
            <Icon className="h-4 w-4" />{label}
            {key === 'kura' && ceremonyLive && <span className={styles.liveDot} />}
          </button>
        ))}
        <span className={styles.tabDivider} aria-hidden="true" />
        {ADMIN_TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => selectTab(key)}
            className={`${styles.tab} ${styles.tabAdmin} ${tab === key ? styles.tabActive : ''}`}
            aria-current={tab === key ? 'page' : undefined}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === null && <p className={styles.muted}>Yükleniyor…</p>}

      {tab === 'kura' && (
        <MundialDraw
          config={config}
          draw={draw}
          clockOffset={clockOffset}
          nameOf={nameOf}
          user={user}
          onChanged={refetchMundial}
        />
      )}

      {tab === 'gruplar' && (
        !draw ? (
          <div className={styles.panel}>
            <div className={styles.panelTitle}>Kura henüz çekilmedi</div>
            <p className={styles.muted}>Gruplar kura töreninden sonra burada görünecek.</p>
            <button type="button" className={`${styles.ghostButton} mt-3`} onClick={() => selectTab('kura')}><Dices className="h-4 w-4" />Kura sekmesine git</button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {playedNights > 0 && (
              <div className={styles.panel}>
                <SeasonProgressBar
                  played={playedNights}
                  total={groupStageLength}
                  selectedIndex={selectedNight}
                  onSelectIndex={setSelectedNight}
                  dates={groupStage.datesIncluded}
                  unit="gece"
                />
              </div>
            )}
            <div className={styles.legend}>
              <span><span className={styles.legendSwatch} />İlk iki: çeyrek final</span>
              <span>Sıralama: gece başına ortalama puan</span>
              <span>Satıra tıkla: gece gece puanlar</span>
            </div>
            <div className={styles.standingsGrid}>
              {groups?.map((group) => (
                <GroupTable
                  key={group.id}
                  group={group}
                  previousRanks={previousGroupRanks?.get(group.id) || null}
                  potOf={potOf}
                  wildcardIds={wildcardIds}
                  showQualifiers={viewNight > 0}
                  expanded={expanded}
                  onToggle={(id) => setExpanded((cur) => (cur === id ? null : id))}
                />
              ))}
            </div>
            {groupStage.warnings.map((w, i) => (
              <p key={i} className={styles.message}>{w}</p>
            ))}
          </div>
        )
      )}

      {tab === 'eleme' && (
        !draw ? (
          <div className={styles.panel}>
            <div className={styles.panelTitle}>Eleme tablosu</div>
            <p className={styles.muted}>Kura çekilip grup aşaması başlayınca eşleşmeler burada görünecek.</p>
          </div>
        ) : (
          <MundialBracket
            matches={bracket.matches}
            championSteamId={bracket.championSteamId}
            nameOf={nameOf}
            user={user}
            groupStageComplete={groupStageComplete}
            seedsKnown={seedsKnown}
            onChanged={refetchMundial}
          />
        )
      )}

      {tab === 'format' && <FormatPanel config={config} nameOf={nameOf} />}

      {tab === 'kaptanlik' && (
        <CaptainAssignmentPanel
          availableDates={availableDates}
          sonmacByDate={sonmacByDate}
          manualNights={manualNights}
          captainsByDate={captainsByDate}
          playersIndex={playersIndex}
          user={user}
          refetchCaptains={refetchCaptains}
        />
      )}

      {tab === 'overrides' && (
        <MapOverridePanel
          scoring={scoring}
          availableDates={demoDates}
          sonmacByDate={sonmacByDate}
          mapOverrides={mapOverrides}
          user={user}
          onSaved={refetchOverrides}
        />
      )}

      {tab === 'manual' && (
        <ManualNightPanel
          scoring={scoring}
          poolSteamIds={participants}
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
