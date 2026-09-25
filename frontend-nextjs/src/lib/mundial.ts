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
  /** Yöneticilere ek olarak kura toplarını açabilen oyuncular (Steam ID). */
  drawOperators?: string[];
  notes?: Record<string, string>;
};

export const MUNDIAL_QUALIFIERS_PER_GROUP = 2;

// ── Kura (backend ile aynı şekil: backend/mundialDraw.js) ─────────────────────
// Kura tıklamayla ilerler: her tıklama tek top açar — önce oyuncu, sonra o
// oyuncunun grubu. Adımın groupId'si yoksa grup topu henüz açılmamıştır.

export type MundialDrawStep = {
  potIndex: number;
  potId: number;
  steamId: string;
  name: string;
  groupId?: string;
  playerAt?: number;
  playerBy?: string;
  groupAt?: number;
  groupBy?: string;
};

export type MundialDraw = {
  groupCount: number;
  pots: Array<{ id: number; players: Array<{ steamId: string; name: string }> }>;
  groups: Array<{ id: string; players: string[] }>;
  steps: MundialDrawStep[];
  createdAt: number;
  completedAt?: number;
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

// ── Top sayacı (cursor) ──────────────────────────────────────────────────────
// Canlı kura, prova ve tekrar izleme aynı modeli kullanır: kuradaki toplar
// sırayla açılır (adım i → top 2i oyuncu, top 2i+1 grup). cursor, açılmış top
// sayısıdır; ekran o ana kadarki durumu gösterir.

export function drawTotalReveals(draw: Pick<MundialDraw, 'pots'>): number {
  return draw.pots.reduce((n, pot) => n + pot.players.length, 0) * 2;
}

export function drawRevealCount(draw: Pick<MundialDraw, 'steps'>): number {
  const last = draw.steps[draw.steps.length - 1];
  return draw.steps.length * 2 - (last && !last.groupId ? 1 : 0);
}

export function isDrawComplete(draw: MundialDraw | null): boolean {
  return !!draw && draw.steps.length > 0 && drawRevealCount(draw) >= drawTotalReveals(draw);
}

/** cursor kadar top açıldığında görünen adımlar (son adımın grubu gizli olabilir). */
export function stepsAtCursor(draw: Pick<MundialDraw, 'steps'>, cursor: number): MundialDrawStep[] {
  const count = Math.max(0, Math.min(cursor, drawRevealCount(draw)));
  const visible = draw.steps.slice(0, Math.ceil(count / 2));
  if (count % 2 === 1 && visible.length) {
    const last = visible[visible.length - 1];
    visible[visible.length - 1] = { ...last, groupId: undefined };
  }
  return visible;
}

export type NextBall =
  | { kind: 'player'; potIndex: number }
  | { kind: 'group'; step: MundialDrawStep }
  | null;

/** Açılacak sıradaki top (verilen adımlara göre); kura bittiyse null. */
export function nextBall(draw: Pick<MundialDraw, 'pots'>, steps: MundialDrawStep[]): NextBall {
  const last = steps[steps.length - 1];
  if (last && !last.groupId) return { kind: 'group', step: last };
  const drawn = new Set(steps.map((s) => s.steamId));
  const potIndex = draw.pots.findIndex((pot) => pot.players.some((p) => !drawn.has(p.steamId)));
  return potIndex === -1 ? null : { kind: 'player', potIndex };
}

/**
 * Prova kurası için tarayıcıda bir top açar (backend/mundialDraw.js advanceDraw
 * ile aynı kural). Prova hiçbir yere kaydedilmez.
 */
export function advanceRehearsalDraw(draw: MundialDraw): MundialDraw {
  const randomInt = (max: number) => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % max;
  };
  const ball = nextBall(draw, draw.steps);
  if (!ball) return draw;
  const steps = [...draw.steps];
  const groups = draw.groups.map((g) => ({ ...g, players: [...g.players] }));
  if (ball.kind === 'group') {
    const taken = new Set(steps.filter((s) => s.potIndex === ball.step.potIndex && s.groupId).map((s) => s.groupId));
    const open = groups.map((g) => g.id).filter((id) => !taken.has(id));
    const groupId = open[randomInt(open.length)];
    steps[steps.length - 1] = { ...ball.step, groupId };
    groups.find((g) => g.id === groupId)!.players.push(ball.step.steamId);
  } else {
    const drawn = new Set(steps.map((s) => s.steamId));
    const pot = draw.pots[ball.potIndex];
    const remaining = pot.players.filter((p) => !drawn.has(p.steamId));
    const player = remaining[randomInt(remaining.length)];
    steps.push({ potIndex: ball.potIndex, potId: pot.id, steamId: player.steamId, name: player.name });
  }
  return { ...draw, steps, groups };
}

export function emptyDraw(pots: MundialDraw['pots'], groupCount: number): MundialDraw {
  return {
    groupCount,
    pots,
    groups: 'ABCDEFGH'.slice(0, groupCount).split('').map((id) => ({ id, players: [] })),
    steps: [],
    createdAt: Date.now(),
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
