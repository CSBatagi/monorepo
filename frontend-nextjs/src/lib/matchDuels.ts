export type MatchDuels = {
  players: { steam_id: string; name: string }[];
  kills: Record<string, Record<string, number>>;
};

export function sumMatchDuels(datasets: MatchDuels[]): MatchDuels {
  const players = new Map<string, MatchDuels['players'][number]>();
  const kills: MatchDuels['kills'] = {};
  for (const data of datasets) {
    for (const player of data.players) players.set(player.steam_id, player);
    for (const [killer, victims] of Object.entries(data.kills)) {
      kills[killer] ||= {};
      for (const [victim, count] of Object.entries(victims)) kills[killer][victim] = (kills[killer][victim] || 0) + count;
    }
  }
  return { players: [...players.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr')), kills };
}
