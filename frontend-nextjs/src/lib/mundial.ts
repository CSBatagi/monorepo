/**
 * Batak Mundial – torbalı kura + grup aşaması + 8 kişilik eleme tablosu.
 *
 * - Torbalar bir önceki sezonun (Superliga) sıralamasına göre oluşturulur.
 * - Kura: her gruba her torbadan en fazla bir oyuncu (Dünya Kupası eleme grubu usulü).
 * - Grup aşaması: puanlama birebir Superliga ile aynıdır (bkz. superliga.ts);
 *   sıralama grup içinde yapılır. Düşme/çıkma yoktur.
 * - Grupların ilk iki oyuncusu çeyrek finale kalır; çeyrek final → yarı final → final.
 */

import type { SuperligaConfig, SuperligaPlayerStanding } from './superliga';

// ── Config ─────────────────────────────────────────────────────────────────────

export type MundialConfig = {
  version: number;
  name?: string;
  seasonStart?: string;
  /** Grup aşamasının gece sayısı; bu geceden sonraki geceler grup puanına sayılmaz. */
  groupStageLength?: number;
  groupCount?: number;
  scoring?: SuperligaConfig['scoring'];
  pots: Array<{ id: number; players: string[] }>;
  /** Katılımı kesin olmayan oyuncular; kura öncesi dahil edilip edilmeyeceği seçilir. */
  tentative?: string[];
  /** Düştüğü grubu "ölüm grubu" yapan oyuncular. */
  wildcards?: string[];
  notes?: Record<string, string>;
};

export const MUNDIAL_QUALIFIERS_PER_GROUP = 2;

// ── Kura (backend ile aynı şekil: backend/mundialDraw.js) ─────────────────────

export type MundialDrawStep = {
  potIndex: number;
  potId: number;
  steamId: string;
  name: string;
  groupId: string;
};

export type MundialDraw = {
  groupCount: number;
  pots: Array<{ id: number; players: Array<{ steamId: string; name: string }> }>;
  groups: Array<{ id: string; players: string[] }>;
  steps: MundialDrawStep[];
  createdAt: number;
  revealStartsAt: number;
  stepMs: number;
  potIntroMs: number;
  setByUid?: string;
  setByName?: string;
};

export const KNOCKOUT_SLOTS = ['qf1', 'qf2', 'qf3', 'qf4', 'sf1', 'sf2', 'final'] as const;
export type MundialKnockoutSlot = typeof KNOCKOUT_SLOTS[number];

export type MundialKnockoutResult = {
  player1SteamId: string;
  player2SteamId: string;
  winnerSteamId: string;
  score?: string;
  date?: string;
  setByUid?: string;
  setByName?: string;
  setAt?: number;
};

export type MundialLiveData = {
  version?: number;
  serverTime?: number;
  draw: MundialDraw | null;
  knockout: Partial<Record<MundialKnockoutSlot, MundialKnockoutResult>>;
};

// ── Tören zaman çizelgesi ─────────────────────────────────────────────────────
// Kura sunucuda tek seferde çekilir; tören herkeste aynı anda, revealStartsAt
// anından itibaren aynı zaman çizelgesiyle oynatılır.

/** Adım içinde oyuncunun gruba yerleştiği an (0..1). */
export const PLACE_AT = 0.72;
/** Adım içinde isim topunun açıldığı an (0..1). */
export const NAME_AT = 0.38;

type PotSegment = { potIndex: number; start: number; introEnd: number; end: number; stepIndices: number[] };

export function drawTimeline(draw: Pick<MundialDraw, 'steps' | 'stepMs' | 'potIntroMs'>): { segments: PotSegment[]; totalMs: number } {
  const byPot = new Map<number, number[]>();
  draw.steps.forEach((step, i) => {
    if (!byPot.has(step.potIndex)) byPot.set(step.potIndex, []);
    byPot.get(step.potIndex)!.push(i);
  });
  const segments: PotSegment[] = [];
  let t = 0;
  for (const potIndex of [...byPot.keys()].sort((a, b) => a - b)) {
    const stepIndices = byPot.get(potIndex)!;
    const start = t;
    const introEnd = start + draw.potIntroMs;
    const end = introEnd + stepIndices.length * draw.stepMs;
    segments.push({ potIndex, start, introEnd, end, stepIndices });
    t = end;
  }
  return { segments, totalMs: t };
}

export type RevealFrame =
  | { phase: 'countdown'; msToStart: number; placedCount: 0 }
  | { phase: 'pot-intro'; potIndex: number; placedCount: number }
  | { phase: 'step'; potIndex: number; stepIndex: number; stepProgress: number; placedCount: number }
  | { phase: 'done'; placedCount: number };

/** elapsedMs: revealStartsAt anından bu yana geçen süre (negatifse geri sayım). */
export function revealFrameAt(draw: Pick<MundialDraw, 'steps' | 'stepMs' | 'potIntroMs'>, elapsedMs: number): RevealFrame {
  if (elapsedMs < 0) return { phase: 'countdown', msToStart: -elapsedMs, placedCount: 0 };
  const { segments, totalMs } = drawTimeline(draw);
  if (elapsedMs >= totalMs) return { phase: 'done', placedCount: draw.steps.length };
  for (const seg of segments) {
    if (elapsedMs >= seg.end) continue;
    const placedBefore = seg.stepIndices[0];
    if (elapsedMs < seg.introEnd) return { phase: 'pot-intro', potIndex: seg.potIndex, placedCount: placedBefore };
    const within = elapsedMs - seg.introEnd;
    const local = Math.min(seg.stepIndices.length - 1, Math.floor(within / draw.stepMs));
    const stepIndex = seg.stepIndices[local];
    const stepProgress = (within - local * draw.stepMs) / draw.stepMs;
    return {
      phase: 'step',
      potIndex: seg.potIndex,
      stepIndex,
      stepProgress,
      placedCount: stepIndex + (stepProgress >= PLACE_AT ? 1 : 0),
    };
  }
  return { phase: 'done', placedCount: draw.steps.length };
}

/**
 * Prova kurası: backend/mundialDraw.js ile aynı algoritma, tarayıcıda çalışır
 * ve hiçbir yere kaydedilmez. Gerçek kura her zaman sunucuda çekilir.
 */
export function buildRehearsalDraw(
  pots: MundialDraw['pots'],
  groupCount: number,
  timing: { startsInMs: number; stepMs: number; potIntroMs: number },
): MundialDraw {
  const randomInt = (max: number) => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % max;
  };
  const groupIds = 'ABCDEFGH'.slice(0, groupCount).split('');
  const groups = groupIds.map((id) => ({ id, players: [] as string[] }));
  const steps: MundialDrawStep[] = [];
  pots.forEach((pot, potIndex) => {
    const remaining = [...pot.players];
    const openGroups = [...groupIds];
    while (remaining.length && openGroups.length) {
      const player = remaining.splice(randomInt(remaining.length), 1)[0];
      const groupId = openGroups.splice(randomInt(openGroups.length), 1)[0];
      groups.find((g) => g.id === groupId)!.players.push(player.steamId);
      steps.push({ potIndex, potId: pot.id, steamId: player.steamId, name: player.name, groupId });
    }
  });
  const now = Date.now();
  return {
    groupCount,
    pots,
    groups,
    steps,
    createdAt: now,
    revealStartsAt: now + timing.startsInMs,
    stepMs: timing.stepMs,
    potIntroMs: timing.potIntroMs,
  };
}

// ── Gruplar ──────────────────────────────────────────────────────────────────

export function potIndexBySteamId(draw: MundialDraw | null): Map<string, number> {
  const map = new Map<string, number>();
  draw?.pots.forEach((pot, i) => pot.players.forEach((p) => map.set(p.steamId, i)));
  return map;
}

export function drawParticipants(draw: MundialDraw | null): string[] {
  return draw ? draw.groups.flatMap((g) => g.players) : [];
}

export type MundialGroupTable = {
  id: string;
  rows: SuperligaPlayerStanding[];
};

/** Genel sıralamayı (Superliga puanlaması) gruplara böler; grup içi sıra korunur. */
export function splitStandingsIntoGroups(
  standings: SuperligaPlayerStanding[],
  draw: MundialDraw,
): MundialGroupTable[] {
  return draw.groups.map((group) => {
    const members = new Set(group.players);
    return { id: group.id, rows: standings.filter((row) => members.has(row.steamId)) };
  });
}

// ── Eleme tablosu ────────────────────────────────────────────────────────────
// Klasik eşleşme: grup birincileri kendi grubunun ikincisiyle ancak finalde
// karşılaşabilir. A1–B2, C1–D2 (üst yarı) · B1–A2, D1–C2 (alt yarı).

export type BracketEntrant = { steamId: string; seed: string } | null;

export type BracketMatch = {
  slot: MundialKnockoutSlot;
  round: 'qf' | 'sf' | 'final';
  label: string;
  player1: BracketEntrant;
  player2: BracketEntrant;
  /** Oyuncu henüz belli değilse gösterilecek yer tutucu (ör. "A1", "ÇF1 galibi"). */
  placeholder1: string;
  placeholder2: string;
  result: MundialKnockoutResult | null;
  winnerSteamId: string | null;
};

const QF_SEEDS: Record<'qf1' | 'qf2' | 'qf3' | 'qf4', [string, string]> = {
  qf1: ['A1', 'B2'],
  qf2: ['C1', 'D2'],
  qf3: ['B1', 'A2'],
  qf4: ['D1', 'C2'],
};

const FEEDERS: Record<'sf1' | 'sf2' | 'final', [MundialKnockoutSlot, MundialKnockoutSlot]> = {
  sf1: ['qf1', 'qf2'],
  sf2: ['qf3', 'qf4'],
  final: ['sf1', 'sf2'],
};

const SLOT_LABELS: Record<MundialKnockoutSlot, string> = {
  qf1: 'Çeyrek Final 1',
  qf2: 'Çeyrek Final 2',
  qf3: 'Çeyrek Final 3',
  qf4: 'Çeyrek Final 4',
  sf1: 'Yarı Final 1',
  sf2: 'Yarı Final 2',
  final: 'Final',
};

const SHORT_LABELS: Record<MundialKnockoutSlot, string> = {
  qf1: 'ÇF1', qf2: 'ÇF2', qf3: 'ÇF3', qf4: 'ÇF4', sf1: 'YF1', sf2: 'YF2', final: 'Final',
};

export function buildBracket(
  groups: MundialGroupTable[] | null,
  results: Partial<Record<MundialKnockoutSlot, MundialKnockoutResult>>,
  options: { seedsKnown: boolean },
): { matches: Record<MundialKnockoutSlot, BracketMatch>; championSteamId: string | null } {
  const seedMap = new Map<string, string>();
  if (groups && options.seedsKnown) {
    for (const g of groups) {
      g.rows.slice(0, MUNDIAL_QUALIFIERS_PER_GROUP).forEach((row, i) => seedMap.set(`${g.id}${i + 1}`, row.steamId));
    }
  }
  const seedOfSteamId = new Map<string, string>();
  for (const [seed, id] of seedMap) seedOfSteamId.set(id, seed);

  const entrant = (steamId: string | undefined | null): BracketEntrant =>
    steamId ? { steamId, seed: seedOfSteamId.get(steamId) || '' } : null;

  const matches = {} as Record<MundialKnockoutSlot, BracketMatch>;
  const winnerOf = (slot: MundialKnockoutSlot) => matches[slot]?.winnerSteamId || null;

  for (const slot of KNOCKOUT_SLOTS) {
    const result = results[slot] || null;
    let p1: BracketEntrant;
    let p2: BracketEntrant;
    let ph1: string;
    let ph2: string;
    if (slot === 'qf1' || slot === 'qf2' || slot === 'qf3' || slot === 'qf4') {
      const [s1, s2] = QF_SEEDS[slot];
      ph1 = `${s1.slice(0, 1)} Grubu ${s1.slice(1)}.`;
      ph2 = `${s2.slice(0, 1)} Grubu ${s2.slice(1)}.`;
      p1 = entrant(seedMap.get(s1));
      p2 = entrant(seedMap.get(s2));
      if (p1) p1 = { ...p1, seed: s1 };
      if (p2) p2 = { ...p2, seed: s2 };
    } else {
      const [f1, f2] = FEEDERS[slot];
      ph1 = `${SHORT_LABELS[f1]} galibi`;
      ph2 = `${SHORT_LABELS[f2]} galibi`;
      p1 = entrant(winnerOf(f1));
      p2 = entrant(winnerOf(f2));
    }
    // Kaydedilmiş sonuç, kaydedildiği andaki eşleşmeyi korur.
    if (result) {
      p1 = entrant(result.player1SteamId);
      p2 = entrant(result.player2SteamId);
    }
    const winner = result && (result.winnerSteamId === p1?.steamId || result.winnerSteamId === p2?.steamId)
      ? result.winnerSteamId
      : null;
    matches[slot] = {
      slot,
      round: slot.startsWith('qf') ? 'qf' : slot.startsWith('sf') ? 'sf' : 'final',
      label: SLOT_LABELS[slot],
      player1: p1,
      player2: p2,
      placeholder1: ph1,
      placeholder2: ph2,
      result,
      winnerSteamId: winner,
    };
  }

  return { matches, championSteamId: winnerOf('final') };
}
