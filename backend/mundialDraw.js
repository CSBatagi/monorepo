// Batak Mundial kura çekimi — Dünya Kupası eleme grubu usulü.
//
// Her torba sırayla boşaltılır: torbadan rastgele bir oyuncu çekilir, ardından
// o torbadan henüz oyuncu almamış gruplar arasından rastgele bir grup çekilir.
// Böylece her grupta her torbadan en fazla bir oyuncu olur; eksik torbada
// (ör. 4 grup, 3 oyuncu) hangi grubun eksik kalacağı da kurayla belirlenir.

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

/**
 * @param {Array<{id?: number, players: Array<{steamId: string, name?: string}>}>} rawPots
 * @param {number} groupCount
 * @param {(maxExclusive: number) => number} [randomInt]
 */
function buildMundialDraw(rawPots, groupCount, randomInt = secureRandomInt) {
  if (!Number.isInteger(groupCount) || groupCount < 2 || groupCount > GROUP_IDS.length) {
    throw new Error(`groupCount must be between 2 and ${GROUP_IDS.length}`);
  }
  const pots = normalizePots(rawPots);
  const groupIds = GROUP_IDS.slice(0, groupCount);
  let total = 0;
  for (const pot of pots) {
    if (pot.players.length > groupCount) {
      throw new Error(`pot ${pot.id} has more players than groups`);
    }
    total += pot.players.length;
  }
  if (total < groupCount) throw new Error('not enough players for the groups');

  const groups = groupIds.map((id) => ({ id, players: [] }));
  const steps = [];

  pots.forEach((pot, potIndex) => {
    const remainingPlayers = [...pot.players];
    const openGroups = [...groupIds];
    while (remainingPlayers.length) {
      const player = remainingPlayers.splice(randomInt(remainingPlayers.length), 1)[0];
      const groupId = openGroups.splice(randomInt(openGroups.length), 1)[0];
      groups.find((g) => g.id === groupId).players.push(player.steamId);
      steps.push({ potIndex, potId: pot.id, steamId: player.steamId, name: player.name, groupId });
    }
  });

  return { groupCount, pots, groups, steps };
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

module.exports = { buildMundialDraw, KNOCKOUT_SLOTS, KNOCKOUT_DEPENDENTS, GROUP_IDS };
