const { generateHistoricalDateKeyedAllTime } = require('../statsGenerator');

test('keeps replayed maps, rosters, scores, rounds and directed kills separate', async () => {
  const player = (match_checksum, steam_id, name, team_name, team_score) => ({
    match_date: '2026-10-16', map_name: 'de_mirage', match_checksum, steam_id, name, team_name, team_score,
  });
  const pool = { query: jest.fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [
      player('first', '101', 'Alice', 'A', 13), player('first', '102', 'Bob', 'B', 8),
      player('second', '101', 'Alice', 'C', 5), player('second', '103', 'Charlie', 'D', 13),
    ] })
    .mockResolvedValueOnce({ rows: ['first', 'second'].map((match_checksum, i) => ({
      match_date: '2026-10-16', map_name: 'de_mirage', match_checksum, round_number: 1, team_a_score: i,
    })) })
    .mockResolvedValueOnce({ rows: [
      { match_checksum: 'first', killer_steam_id: '101', victim_steam_id: '102', kills: '8' },
      { match_checksum: 'first', killer_steam_id: '102', victim_steam_id: '101', kills: '4' },
      { match_checksum: 'second', killer_steam_id: '103', victim_steam_id: '101', kills: '7' },
      { match_checksum: 'first', killer_steam_id: '101', victim_steam_id: '101', kills: '1' },
      { match_checksum: 'first', killer_steam_id: '0', victim_steam_id: '102', kills: '1' },
      { match_checksum: 'unknown', killer_steam_id: '101', victim_steam_id: '102', kills: '99' },
    ] }) };
  const { sonmac_by_date_all } = await generateHistoricalDateKeyedAllTime(pool);
  const maps = sonmac_by_date_all['2026-10-16'].maps;
  expect(Object.keys(maps)).toEqual(['de_mirage', 'de_mirage · 2']);
  expect(maps.de_mirage.team1.score).toBe(13);
  expect(maps['de_mirage · 2'].team1.score).toBe(5);
  expect(maps.de_mirage.rounds.match_checksum).toBe('first');
  expect(maps['de_mirage · 2'].rounds.match_checksum).toBe('second');
  expect(maps.de_mirage.duels.kills).toEqual({ '101': { '102': 8 }, '102': { '101': 4 } });
  expect(maps['de_mirage · 2'].duels.kills).toEqual({ '103': { '101': 7 } });
  expect(maps['de_mirage · 2'].duels.players.map(p => p.steam_id)).toEqual(['101', '103']);
  expect(pool.query.mock.calls[3][0]).toContain('INNER JOIN demos dm ON dm.checksum = m.checksum');
  expect(pool.query.mock.calls[3][0]).toContain('dm.date::date');
});

test('retains players with no kills and a genuinely empty match', async () => {
  const { attachMatchDuels } = require('../matchDuels');
  const nights = { date: { maps: { empty: { match_checksum: 'empty', team1: { players: [{ steam_id: '101', name: 'Alice' }] } } } } };
  attachMatchDuels(nights, [], (_, name) => name);
  expect(nights.date.maps.empty.duels).toEqual({ players: [{ steam_id: '101', name: 'Alice' }], kills: {} });
});
