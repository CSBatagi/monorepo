// Batak Mundial kura çekimi — Dünya Kupası eleme grubu usulü, tıklamayla ilerler.
//
// Kura adım adım canlı çekilir: her tıklama tek bir top açar. Önce torbadan bir
// oyuncu topu, sonra o oyuncunun grup topu (o torbadan henüz oyuncu almamış
// gruplar arasından). Torbalar sırayla boşaltılır; böylece her grupta her
// torbadan en fazla bir oyuncu olur ve eksik torbada (ör. 4 grup, 3 oyuncu)
// hangi grubun eksik kalacağı da kurayla belirlenir. Sonuç önceden hesaplanmaz.

const crypto = require('crypto');

const GROUP_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

function secureRandomInt(maxExclusive) {
  return crypto.randomInt(maxExclusive);
}

function normalizePots(rawPots) {
  if (!Array.isArray(rawPots) || rawPots.length === 0) {
    throw new Error('pots required');
  }
  const seen = new Set();
  return rawPots.map((pot, potIndex) => {
    const players = (Array.isArray(pot?.players) ? pot.players : [])
      .map((p) => ({
        steamId: String(p?.steamId || '').trim(),
        name: String(p?.name || '').trim().slice(0, 64),
      }))
      .filter((p) => p.steamId);
    for (const p of players) {
      if (!/^\d{5,20}$/.test(p.steamId)) throw new Error(`invalid steamId: ${p.steamId}`);
      if (seen.has(p.steamId)) throw new Error(`duplicate player: ${p.steamId}`);
      seen.add(p.steamId);
      if (!p.name) p.name = p.steamId;
    }
    return { id: Number.isInteger(pot?.id) ? pot.id : potIndex + 1, players };
  });
}

/** Boş kura: torbalar ve gruplar hazır, henüz top çekilmedi. */
function createDrawState(rawPots, groupCount) {
  if (!Number.isInteger(groupCount) || groupCount < 2 || groupCount > GROUP_IDS.length) {
    throw new Error(`groupCount must be between 2 and ${GROUP_IDS.length}`);
  }
  const pots = normalizePots(rawPots);
  let total = 0;
  for (const pot of pots) {
    if (pot.players.length > groupCount) {
      throw new Error(`pot ${pot.id} has more players than groups`);
    }
    total += pot.players.length;
  }
  if (total < groupCount) throw new Error('not enough players for the groups');
  return {
    groupCount,
    pots,
    groups: GROUP_IDS.slice(0, groupCount).map((id) => ({ id, players: [] })),
    steps: [],
  };
}

function totalPlayers(state) {
  return state.pots.reduce((n, pot) => n + pot.players.length, 0);
}

/** Açılmış top sayısı (oyuncu topları + grup topları). */
function revealCount(state) {
  const last = state.steps[state.steps.length - 1];
  return state.steps.length * 2 - (last && !last.groupId ? 1 : 0);
}

function isDrawComplete(state) {
  return revealCount(state) === totalPlayers(state) * 2;
}

/**
 * Bir sonraki topu açar ve yeni durumu döndürür (girdi değiştirilmez).
 * @param {(maxExclusive: number) => number} [randomInt]
 */
function advanceDraw(state, randomInt = secureRandomInt, meta = {}) {
  const next = { ...state, groups: state.groups.map((g) => ({ ...g, players: [...g.players] })), steps: [...state.steps] };
  const at = meta.at || Date.now();
  const last = next.steps[next.steps.length - 1];

  if (last && !last.groupId) {
    const taken = new Set(next.steps.filter((s) => s.potIndex === last.potIndex && s.groupId).map((s) => s.groupId));
    const openGroups = next.groups.map((g) => g.id).filter((id) => !taken.has(id));
    const groupId = openGroups[randomInt(openGroups.length)];
    next.steps[next.steps.length - 1] = { ...last, groupId, groupAt: at, groupBy: meta.by };
    next.groups.find((g) => g.id === groupId).players.push(last.steamId);
    if (isDrawComplete(next)) next.completedAt = at;
    return { state: next, reveal: { kind: 'group', steamId: last.steamId, groupId } };
  }

  const drawn = new Set(next.steps.map((s) => s.steamId));
  const potIndex = next.pots.findIndex((pot) => pot.players.some((p) => !drawn.has(p.steamId)));
  if (potIndex === -1) throw new Error('draw complete');
  const remaining = next.pots[potIndex].players.filter((p) => !drawn.has(p.steamId));
  const player = remaining[randomInt(remaining.length)];
  next.steps.push({ potIndex, potId: next.pots[potIndex].id, steamId: player.steamId, name: player.name, playerAt: at, playerBy: meta.by });
  return { state: next, reveal: { kind: 'player', steamId: player.steamId, potIndex } };
}

/** Kurayı baştan sona tek seferde çeker (testler ve toplu kontroller için). */
function buildMundialDraw(rawPots, groupCount, randomInt = secureRandomInt) {
  let state = createDrawState(rawPots, groupCount);
  while (!isDrawComplete(state)) state = advanceDraw(state, randomInt).state;
  return state;
}

const KNOCKOUT_SLOTS = ['qf1', 'qf2', 'qf3', 'qf4', 'sf1', 'sf2', 'final'];

// Bir eşleşmenin sonucu silinince, o sonuca bağlı sonraki turlar da silinir.
const KNOCKOUT_DEPENDENTS = {
  qf1: ['sf1', 'final'],
  qf2: ['sf1', 'final'],
  qf3: ['sf2', 'final'],
  qf4: ['sf2', 'final'],
  sf1: ['final'],
  sf2: ['final'],
  final: [],
};

module.exports = {
  createDrawState,
  advanceDraw,
  revealCount,
  isDrawComplete,
  buildMundialDraw,
  KNOCKOUT_SLOTS,
  KNOCKOUT_DEPENDENTS,
  GROUP_IDS,
};
