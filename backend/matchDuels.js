// Store only directed kill counts; the browser derives deaths and night totals.
function attachMatchDuels(nights, rows, normalizeName) {
  const byChecksum = new Map();
  for (const night of Object.values(nights)) {
    for (const map of Object.values(night.maps)) {
      if (!map.match_checksum) continue;
      const players = [...(map.team1?.players || []), ...(map.team2?.players || [])];
      map.duels = {
        players: players.map(p => ({ steam_id: String(p.steam_id), name: normalizeName(p.steam_id, p.name) })),
        kills: {},
      };
      byChecksum.set(map.match_checksum, map.duels);
    }
  }
  for (const row of rows) {
    const data = byChecksum.get(row.match_checksum);
    const killer = String(row.killer_steam_id);
    const victim = String(row.victim_steam_id);
    if (!data || killer === victim || !data.players.some(p => p.steam_id === killer) || !data.players.some(p => p.steam_id === victim)) continue;
    if (!data.kills[killer]) data.kills[killer] = {};
    data.kills[killer][victim] = Number(row.kills) || 0;
  }
  return nights;
}

module.exports = { attachMatchDuels };
