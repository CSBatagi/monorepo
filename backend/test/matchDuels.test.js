const { generateHistoricalDateKeyedAllTime } = require('../statsGenerator');

test('SQL calendar dates stay aligned between averages and maps during British summer time', () => {
  const { execFileSync } = require('node:child_process');
  const path = require('node:path');
  const output = execFileSync(process.execPath, ['-e', `
    const { types } = require('pg');
    const { generateHistoricalDateKeyedAllTime } = require('./statsGenerator');
    const date = types.getTypeParser(1082)('2025-06-10');
    const responses = [
      [{ match_date: date, steam_id: '101', name: 'Alice' }],
      [{ match_date: date, match_checksum: 'first', map_name: 'de_mirage', steam_id: '101', name: 'Alice', team_name: 'A' }], [], [],
    ];
    const pool = { query: async () => ({ rows: responses.shift() }) };
    generateHistoricalDateKeyedAllTime(pool).then(data => console.log('DATES:' + JSON.stringify({ averages: Object.keys(data.night_avg_all), maps: Object.keys(data.sonmac_by_date_all) })));
  `], { cwd: path.join(__dirname, '..'), env: { ...process.env, TZ: 'Europe/London' }, encoding: 'utf8' });
  const result = JSON.parse(output.split('\n').find(line => line.startsWith('DATES:')).slice(6));
  expect(result).toEqual({ averages: ['2025-06-10'], maps: ['2025-06-10'] });
});

test('current-season publication keeps map counts and legacy night counts in their own datasets', async () => {
  const { generateAll } = require('../statsGenerator');
  const duel = { playerrowsteamid: '101', playercolumnsteamid: '102', playerrow: 'Alice', playercolumn: 'Bob', killdeathratio: '8/4' };
  const pool = { query: jest.fn(async sql => {
    if (sql.includes('COUNT(*) AS kills FROM kills k')) return { rows: [{ match_checksum: 'first', killer_steam_id: '101', victim_steam_id: '102', kills: '8' }] };
    if (sql.includes('AS PlayerRowSteamId')) return { rows: [duel] };
    if (sql.includes('teams.name AS team_name')) return { rows: [
      { match_date: '2026-10-16', map_name: 'de_mirage', match_checksum: 'first', steam_id: '101', name: 'Alice', team_name: 'A' },
      { match_date: '2026-10-16', map_name: 'de_mirage', match_checksum: 'first', steam_id: '102', name: 'Bob', team_name: 'B' },
    ] };
    return { rows: [] };
  }) };
  const stats = await generateAll(pool, { seasonStart: '2026-04-06', seasonStarts: ['2026-04-06'] });
  expect(stats.sonmac_by_date['2026-10-16'].maps.de_mirage.duels.kills).toEqual({ '101': { '102': 8 } });
  expect(stats.duello_son_mac.playerRows).toEqual(['Alice', 'Bob']);
  expect(stats.duello_son_mac.duels.Alice.Bob).toEqual({ kills: 8, deaths: 4 });
  expect(stats.duello_sezon.duels.Alice.Bob).toEqual({ kills: 8, deaths: 4 });
  expect(stats.__errors).toBeUndefined();
});

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
