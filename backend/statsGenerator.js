// In-memory stats generator (no filesystem writes)
// Returns all datasets used by the frontend.
// Uses direct pool queries for efficiency.

const fs = require('fs');
const path = require('path');

// Default will be overridden by caller passing options.seasonStart
let sezonbaslangic = process.env.SEZON_BASLANGIC || '2025-06-09';

// Canonical player names lookup
let canonicalNames = {};

// In-memory cache for historical (completed) season data.
// Keyed by period ID (e.g. 'season_2025-02-10').
// Only completed seasons are cached; current season and all-time are always recomputed.
const historicalSeasonAvgCache = {};
const historicalPlayersStatsCache = {};

function clearHistoricalCache() {
  for (const key of Object.keys(historicalSeasonAvgCache)) delete historicalSeasonAvgCache[key];
  for (const key of Object.keys(historicalPlayersStatsCache)) delete historicalPlayersStatsCache[key];
  console.log('[statsGenerator] Historical season cache cleared');
}

function loadCanonicalNames() {
  const paths = [
    process.env.PLAYERS_FILE,  // Explicit override
    path.join(__dirname, 'config', 'players.json'),
    path.join(__dirname, 'players.json'),
    path.join(__dirname, '..', 'frontend-nextjs', 'public', 'data', 'players.json')
  ].filter(Boolean);
  
  for (const p of paths) {
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      canonicalNames = {};
      data.forEach(player => {
        if (player.steamId) canonicalNames[player.steamId] = player.name;
      });
      console.log(`[statsGenerator] Loaded ${Object.keys(canonicalNames).length} canonical player names from ${p}`);
      return true;
    } catch (_) { }
  }
  console.warn('[statsGenerator] Could not load canonical player names, using database names');
  return false;
}

function normalizedName(steamId, fallbackName) {
  return canonicalNames[steamId] || fallbackName;
}

function q(s){return s}
const ALL_TIME_START = '1970-01-01';

function normalizeIsoDate(value) {
  if (typeof value !== 'string') return null;
  const dateOnly = value.split('T')[0]?.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  return dateOnly;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function normalizeSeasonStarts(rawStarts, fallbackStart) {
  const starts = Array.isArray(rawStarts) ? rawStarts : [];
  const normalized = new Set();
  for (const start of starts) {
    const value = normalizeIsoDate(start);
    if (value) normalized.add(value);
  }
  const fallback = normalizeIsoDate(fallbackStart);
  if (fallback) normalized.add(fallback);
  return Array.from(normalized).sort();
}

function buildSeasonPeriods(seasonStarts) {
  const periods = [];
  for (let i = 0; i < seasonStarts.length; i += 1) {
    const start = seasonStarts[i];
    const next = seasonStarts[i + 1];
    const end = next ? addDays(next, -1) : null;
    const isCurrent = !next;
    periods.push({
      id: `season_${start}`,
      label: isCurrent ? `Guncel Sezon (${start} - ...)` : `Sezon (${start} - ${end})`,
      start_date: start,
      end_date: end,
      is_current: isCurrent,
    });
  }
  return periods;
}

function buildSeasonAvgRangeQuery(startDate, endDate) {
  const startExpr = startDate
    ? `'${startDate}'::date`
    : `(SELECT COALESCE(MIN(matches.date::date), '${ALL_TIME_START}'::date) FROM matches)`;
  const endExpr = endDate
    ? `'${endDate}'::date`
    : `(SELECT COALESCE(MAX(matches.date::date), CURRENT_DATE) FROM matches)`;

  return q(`
    WITH season_window AS (
      SELECT ${startExpr} AS season_start, ${endExpr} AS season_end
    ),
    match_agg AS (
      SELECT
        p1.steam_id,
        MAX(p1.name) AS name,
        AVG(p1.hltv_rating_2) AS hltv_2,
        AVG(p1.average_damage_per_round) AS adr,
        AVG(p1.kill_count) AS kills,
        AVG(p1.death_count) AS deaths,
        AVG(p1.assist_count) AS assists,
        AVG(p1.kill_death_ratio) AS kd,
        AVG(p1.headshot_count) AS headshot_kills,
        AVG(p1.headshot_percentage) AS headshot_killratio,
        AVG(p1.first_kill_count) AS first_kill_count,
        AVG(p1.first_death_count) AS first_death_count,
        AVG(p1.bomb_planted_count) AS bomb_planted,
        AVG(p1.bomb_defused_count) AS bomb_defused,
        AVG(p1.hltv_rating) AS hltv,
        AVG(p1.mvp_count) AS mvp,
        AVG(p1.kast) AS kast,
        AVG(p1.utility_damage) AS utl_dmg,
        AVG(p1.two_kill_count) AS two_kills,
        AVG(p1.three_kill_count) AS three_kills,
        AVG(p1.four_kill_count) AS four_kills,
        AVG(p1.five_kill_count) AS five_kills,
        AVG(p1.score) AS score,
        COUNT(*) AS matches_in_interval,
        ROUND((COUNT(CASE WHEN matches.winner_name = p1.team_name THEN 1 END)::numeric / COUNT(*) * 100),2) AS win_rate_percentage
      FROM players p1
      INNER JOIN matches ON p1.match_checksum = matches.checksum
      WHERE matches.date::date BETWEEN (SELECT season_start FROM season_window) AND (SELECT season_end FROM season_window)
      GROUP BY p1.steam_id
    ),
    clutch_agg AS (
      SELECT
        c.clutcher_steam_id AS steam_id,
        COUNT(*)::numeric AS total_clutches,
        COUNT(CASE WHEN c.won THEN 1 END)::numeric AS total_clutches_won
      FROM clutches c
      INNER JOIN matches m ON c.match_checksum = m.checksum
      WHERE m.date::date BETWEEN (SELECT season_start FROM season_window) AND (SELECT season_end FROM season_window)
      GROUP BY c.clutcher_steam_id
    )
    SELECT
      m.*,
      COALESCE(c.total_clutches, 0) AS total_clutches,
      COALESCE(c.total_clutches_won, 0) AS total_clutches_won
    FROM match_agg m
    LEFT JOIN clutch_agg c ON m.steam_id = c.steam_id
  `);
}

function mapSeasonAvgRows(rows) {
  return rows.map(r => ({
    steam_id: r.steam_id,
    name: normalizedName(r.steam_id, r.name),
    hltv_2: num(r.hltv_2),
    adr: num(r.adr),
    kd: num(r.kd),
    mvp: num(r.mvp),
    kills: num(r.kills),
    deaths: num(r.deaths),
    assists: num(r.assists),
    hs: num(r.headshot_kills),
    hs_ratio: num(r.headshot_killratio),
    first_kill: num(r.first_kill_count),
    first_death: num(r.first_death_count),
    bomb_planted: num(r.bomb_planted),
    bomb_defused: num(r.bomb_defused),
    hltv: num(r.hltv),
    kast: num(r.kast),
    utl_dmg: num(r.utl_dmg),
    two_kills: num(r.two_kills),
    three_kills: num(r.three_kills),
    four_kills: num(r.four_kills),
    five_kills: num(r.five_kills),
    matches: num(r.matches_in_interval),
    win_rate: num(r.win_rate_percentage),
    avg_clutches: safeAvg(num(r.total_clutches), num(r.matches_in_interval)),
    avg_clutches_won: safeAvg(num(r.total_clutches_won), num(r.matches_in_interval)),
    clutch_success: pct(num(r.total_clutches_won), num(r.total_clutches)),
  }));
}

async function buildSeasonAvgPeriodsDataset(pool, currentSeasonStart, configuredSeasonStarts, errors = []) {
  const normalizedSeasonStarts = normalizeSeasonStarts(configuredSeasonStarts, currentSeasonStart);
  const seasonPeriods = buildSeasonPeriods(normalizedSeasonStarts);
  const seasonPeriodsDesc = [...seasonPeriods].sort((a, b) => b.start_date.localeCompare(a.start_date));

  const currentPeriodId =
    seasonPeriods.find((p) => p.start_date === currentSeasonStart)?.id ||
    seasonPeriodsDesc[0]?.id ||
    'all_time';

  const payload = {
    current_period: currentPeriodId,
    season_starts: normalizedSeasonStarts,
    periods: [
      ...seasonPeriodsDesc,
      { id: 'all_time', label: 'Tum Zamanlar', start_date: null, end_date: null, is_current: false },
    ],
    data: {},
  };

  for (const period of seasonPeriods) {
    // Use cache for completed (non-current) seasons
    if (!period.is_current && historicalSeasonAvgCache[period.id]) {
      console.log(`[statsGenerator] Using cached season_avg for ${period.id}`);
      payload.data[period.id] = historicalSeasonAvgCache[period.id];
      continue;
    }
    try {
      const rows = (await pool.query(buildSeasonAvgRangeQuery(period.start_date, period.end_date))).rows;
      payload.data[period.id] = mapSeasonAvgRows(rows);
      // Cache completed seasons
      if (!period.is_current) {
        historicalSeasonAvgCache[period.id] = payload.data[period.id];
        console.log(`[statsGenerator] Cached season_avg for ${period.id}`);
      }
    } catch (e) {
      console.error(`[statsGenerator] season_avg period query failed (${period.id})`, e.message);
      payload.data[period.id] = [];
      errors.push({ dataset: `season_avg:${period.id}`, error: e.message });
    }
  }

  try {
    const allTimeRows = (await pool.query(buildSeasonAvgRangeQuery(null, null))).rows;
    payload.data.all_time = mapSeasonAvgRows(allTimeRows);
  } catch (e) {
    console.error('[statsGenerator] season_avg period query failed (all_time)', e.message);
    payload.data.all_time = [];
    errors.push({ dataset: 'season_avg:all_time', error: e.message });
  }

  return payload;
}

function buildSonmacByDate(sonmacRows, roundRows) {
  const sonmacGrouped = {};
  for (const r of sonmacRows) {
    const dateKey = isoDate(r.match_date);
    if (!dateKey) continue;
    if (!sonmacGrouped[dateKey]) sonmacGrouped[dateKey] = { maps: {} };
    const maps = sonmacGrouped[dateKey].maps;
    const map = r.map_name;
    const team = r.team_name;
    const teamScore = r.team_score;
    if (!maps[map]) maps[map] = { team1: null, team2: null, rounds: null };
    const slot = (!maps[map].team1 || maps[map].team1.name === team)
      ? 'team1'
      : (!maps[map].team2 || maps[map].team2.name === team ? 'team2' : null);
    if (!slot) continue;
    if (!maps[map][slot]) maps[map][slot] = { name: team, score: teamScore, players: [] };
    else maps[map][slot].score = teamScore;
    maps[map][slot].players.push({
      name: normalizedName(r.steam_id, r.name),
      steam_id: r.steam_id,
      hltv_2: num(r.hltv_2),
      adr: num(r.adr),
      kd: num(r.kd),
      mvp: num(r.mvp),
      kills: num(r.kills),
      deaths: num(r.deaths),
      assists: num(r.assists),
      hs: num(r.headshot_kills),
      hs_ratio: num(r.headshot_killratio),
      first_kill: num(r.first_kill_count),
      first_death: num(r.first_death_count),
      bomb_planted: num(r.bomb_planted),
      bomb_defused: num(r.bomb_defused),
      hltv: num(r.hltv),
      kast: num(r.kast),
      utl_dmg: num(r.utl_dmg),
      two_kills: num(r.two_kills),
      three_kills: num(r.three_kills),
      four_kills: num(r.four_kills),
      five_kills: num(r.five_kills),
      score: num(r.score),
      clutches: num(r.number_of_clutches),
      clutches_won: num(r.number_of_successful_clutches),
    });
  }

  const roundsGrouped = {};
  for (const r of roundRows) {
    const dateKey = isoDate(r.match_date);
    if (!dateKey) continue;
    if (!roundsGrouped[dateKey]) roundsGrouped[dateKey] = {};
    const map = r.map_name;
    if (!roundsGrouped[dateKey][map]) {
      roundsGrouped[dateKey][map] = {
        match_checksum: r.match_checksum,
        max_rounds: num(r.max_rounds),
        rounds: [],
      };
    }
    roundsGrouped[dateKey][map].rounds.push({
      round_number: num(r.round_number),
      end_reason: num(r.end_reason),
      winner_name: r.winner_name,
      winner_side: num(r.winner_side),
      team_a_name: r.team_a_name,
      team_b_name: r.team_b_name,
      team_a_side: num(r.team_a_side),
      team_b_side: num(r.team_b_side),
      team_a_score: num(r.team_a_score),
      team_b_score: num(r.team_b_score),
      overtime_number: num(r.overtime_number),
    });
  }

  for (const [dateKey, night] of Object.entries(sonmacGrouped)) {
    const maps = night.maps || {};
    for (const [mapName, mapData] of Object.entries(maps)) {
      const roundInfo = roundsGrouped?.[dateKey]?.[mapName];
      if (roundInfo) mapData.rounds = roundInfo;
    }
  }
  return sonmacGrouped;
}

function applySeasonEndBounds(query, seasonEnd) {
  if (!seasonEnd) return query;
  const boundedEndExpr = `'${seasonEnd}'::date`;
  return query
    .split('(SELECT latest_match_date FROM match_date_info)').join(boundedEndExpr)
    .split('WHERE matches.date::date >= (SELECT seasonstart FROM season_start_info)').join(`WHERE matches.date::date >= (SELECT seasonstart FROM season_start_info) AND matches.date::date <= ${boundedEndExpr}`)
    .split('WHERE m.date::date >= (SELECT seasonstart FROM season_start_info)').join(`WHERE m.date::date >= (SELECT seasonstart FROM season_start_info) AND m.date::date <= ${boundedEndExpr}`);
}

// Build queries per invocation so updated seasonStart is reflected.
function buildQueries(seasonStart, seasonEnd = null){
  const queries = {
    seasonAvg: q(`WITH match_date_info AS (SELECT MAX(matches.date::date) AS latest_match_date FROM matches), season_start_info AS (SELECT '${seasonStart}'::date AS seasonstart), match_agg AS ( SELECT p1.steam_id, MAX(p1.name) AS name, AVG(p1.hltv_rating_2) AS hltv_2, AVG(p1.average_damage_per_round) AS adr, AVG(p1.kill_count) AS kills, AVG(p1.death_count) AS deaths, AVG(p1.assist_count) AS assists, AVG(p1.kill_death_ratio) AS kd, AVG(p1.headshot_count) AS headshot_kills, AVG(p1.headshot_percentage) AS headshot_killratio, AVG(p1.first_kill_count) AS first_kill_count, AVG(p1.first_death_count) AS first_death_count, AVG(p1.bomb_planted_count) AS bomb_planted, AVG(p1.bomb_defused_count) AS bomb_defused, AVG(p1.hltv_rating) AS hltv, AVG(p1.mvp_count) AS mvp, AVG(p1.kast) AS kast, AVG(p1.utility_damage) AS utl_dmg, AVG(p1.two_kill_count) AS two_kills, AVG(p1.three_kill_count) AS three_kills, AVG(p1.four_kill_count) AS four_kills, AVG(p1.five_kill_count) AS five_kills, AVG(p1.score) AS score, (SELECT latest_match_date FROM match_date_info) AS latest_match_date, COUNT(*) AS matches_in_interval, COUNT(CASE WHEN matches.winner_name = p1.team_name THEN 1 END) AS win_count, ROUND((COUNT(CASE WHEN matches.winner_name = p1.team_name THEN 1 END)::numeric / COUNT(*) * 100),2) AS win_rate_percentage FROM players p1 INNER JOIN matches ON p1.match_checksum = matches.checksum WHERE matches.date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) GROUP BY p1.steam_id ), clutch_agg AS ( SELECT c.clutcher_steam_id AS steam_id, COUNT(*)::numeric AS total_clutches, COUNT(CASE WHEN c.won THEN 1 END)::numeric AS total_clutches_won FROM clutches c JOIN matches m ON c.match_checksum = m.checksum GROUP BY c.clutcher_steam_id ) SELECT m.*, coalesce(c.total_clutches,0) AS total_clutches, coalesce(c.total_clutches_won,0) AS total_clutches_won FROM match_agg m LEFT JOIN clutch_agg c ON m.steam_id = c.steam_id`),
  nightAvg: q(`WITH season_start_info AS ( SELECT '${seasonStart}'::date AS seasonstart ), player_stats_per_date AS ( SELECT p1.steam_id, MAX(p1.name) AS name, matches.date::date AS match_date, AVG(p1.hltv_rating_2) AS hltv_2, AVG(p1.average_damage_per_round) AS adr, AVG(p1.kill_death_ratio) AS kd, AVG(p1.mvp_count) AS mvp, AVG(p1.kill_count) AS kills, AVG(p1.death_count) AS deaths, AVG(p1.assist_count) AS assists, AVG(p1.headshot_count) AS headshot_kills, AVG(p1.headshot_percentage) AS headshot_killratio, AVG(p1.first_kill_count) AS first_kill_count, AVG(p1.first_death_count) AS first_death_count, AVG(p1.bomb_planted_count) AS bomb_planted, AVG(p1.bomb_defused_count) AS bomb_defused, AVG(p1.hltv_rating) AS hltv, AVG(p1.kast) AS kast, AVG(p1.utility_damage) AS utl_dmg, AVG(p1.two_kill_count) AS two_kills, AVG(p1.three_kill_count) AS three_kills, AVG(p1.four_kill_count) AS four_kills, AVG(p1.five_kill_count) AS five_kills, COUNT(*) AS matches_in_interval FROM players p1 INNER JOIN matches ON p1.match_checksum = matches.checksum WHERE matches.date::date >= (SELECT seasonstart FROM season_start_info) GROUP BY p1.steam_id, matches.date::date ), all_player_stats_per_date AS ( SELECT p1.steam_id, matches.date::date AS match_date, AVG(p1.hltv_rating_2) AS hltv_2, AVG(p1.average_damage_per_round) AS adr FROM players p1 INNER JOIN matches ON p1.match_checksum = matches.checksum GROUP BY p1.steam_id, matches.date::date ), prev_10_dates AS ( SELECT psd.steam_id, psd.match_date, ( SELECT array_agg(dates.match_date ORDER BY dates.match_date DESC) FROM ( SELECT DISTINCT m.date::date AS match_date FROM matches m WHERE m.date::date < psd.match_date ORDER BY m.date::date DESC LIMIT 10 ) dates ) AS prev_dates FROM player_stats_per_date psd ), prev_10_agg AS ( SELECT p10.steam_id, p10.match_date, AVG(hist.hltv_2) AS hltv_2_10, AVG(hist.adr) AS adr_10 FROM prev_10_dates p10 LEFT JOIN all_player_stats_per_date hist ON hist.steam_id = p10.steam_id AND hist.match_date = ANY(p10.prev_dates) GROUP BY p10.steam_id, p10.match_date ), clutches_stats AS ( SELECT c.clutcher_steam_id AS steam_id, m.date::date AS match_date, COUNT(*) AS clutches, SUM(CASE WHEN c.won THEN 1 ELSE 0 END) AS clutches_won FROM clutches c INNER JOIN matches m ON c.match_checksum = m.checksum WHERE m.date::date >= (SELECT seasonstart FROM season_start_info) GROUP BY c.clutcher_steam_id, m.date::date ) SELECT psd.*, COALESCE(p10a.hltv_2_10,0) AS hltv_2_10, (psd.hltv_2-COALESCE(p10a.hltv_2_10,0)) AS hltv_2_diff, COALESCE(p10a.adr_10,0) AS adr_10, (psd.adr-COALESCE(p10a.adr_10,0)) AS adr_diff, COALESCE(cs.clutches,0) AS clutches, COALESCE(cs.clutches_won,0) AS clutches_won FROM player_stats_per_date psd LEFT JOIN prev_10_agg p10a ON psd.steam_id=p10a.steam_id AND psd.match_date=p10a.match_date LEFT JOIN clutches_stats cs ON psd.steam_id=cs.steam_id AND cs.match_date=psd.match_date ORDER BY psd.match_date ASC, psd.hltv_2 DESC`),
    last10: q(`WITH last_x_dates AS (SELECT DISTINCT matches.date::date AS unique_date FROM matches ORDER BY unique_date DESC LIMIT 10), date_range AS ( SELECT MIN(unique_date) AS x_days_before, MAX(unique_date) AS latest_match_date FROM last_x_dates ), match_agg AS ( SELECT p1.steam_id, MAX(p1.name) AS name, AVG(p1.hltv_rating_2) AS hltv_2, AVG(p1.average_damage_per_round) AS adr, AVG(p1.kill_count) AS kills, AVG(p1.death_count) AS deaths, AVG(p1.assist_count) AS assists, AVG(p1.kill_death_ratio) AS kd, AVG(p1.headshot_count) AS headshot_kills, AVG(p1.headshot_percentage) AS headshot_killratio, AVG(p1.first_kill_count) AS first_kill_count, AVG(p1.first_death_count) AS first_death_count, AVG(p1.bomb_planted_count) AS bomb_planted, AVG(p1.bomb_defused_count) AS bomb_defused, AVG(p1.hltv_rating) AS hltv, AVG(p1.mvp_count) AS mvp, AVG(p1.kast) AS kast, AVG(p1.utility_damage) AS utl_dmg, AVG(p1.two_kill_count) AS two_kills, AVG(p1.three_kill_count) AS three_kills, AVG(p1.four_kill_count) AS four_kills, AVG(p1.five_kill_count) AS five_kills, AVG(p1.score) AS score, (SELECT latest_match_date FROM date_range) AS latest_match_date, COUNT(*) AS matches_in_interval, ROUND((COUNT(CASE WHEN matches.winner_name = p1.team_name THEN 1 END)::numeric / COUNT(*) * 100),2) AS win_rate_percentage FROM players p1 INNER JOIN matches ON p1.match_checksum = matches.checksum WHERE matches.date::date BETWEEN (SELECT x_days_before FROM date_range) AND (SELECT latest_match_date FROM date_range) GROUP BY p1.steam_id ), clutch_agg AS ( SELECT c.clutcher_steam_id AS steam_id, COUNT(*)::numeric AS total_clutches, COUNT(CASE WHEN c.won THEN 1 END)::numeric AS total_clutches_won FROM clutches c JOIN matches m ON c.match_checksum = m.checksum WHERE m.date::date BETWEEN (SELECT x_days_before FROM date_range) AND (SELECT latest_match_date FROM date_range) GROUP BY c.clutcher_steam_id ) SELECT m.*, coalesce(c.total_clutches,0) AS total_clutches, coalesce(c.total_clutches_won,0) AS total_clutches_won FROM match_agg m LEFT JOIN clutch_agg c ON m.steam_id=c.steam_id`),
    sonmac: q(`WITH match_date_info AS ( SELECT MAX(matches.date::date) AS latest_match_date FROM matches ), season_start_info AS ( SELECT '${seasonStart}'::date AS seasonstart ) SELECT matches.date::date AS match_date, matches.map_name, teams.name AS team_name, p1.name, p1.steam_id, teams.score AS team_score, AVG(p1.hltv_rating_2) AS hltv_2, AVG(p1.average_damage_per_round) AS adr, AVG(p1.kill_count) AS kills, AVG(p1.death_count) AS deaths, AVG(p1.assist_count) AS assists, AVG(p1.kill_death_ratio) AS kd, AVG(p1.headshot_count) AS headshot_kills, AVG(p1.headshot_percentage) AS headshot_killratio, AVG(p1.first_kill_count) AS first_kill_count, AVG(p1.first_death_count) AS first_death_count, AVG(p1.bomb_planted_count) AS bomb_planted, AVG(p1.bomb_defused_count) AS bomb_defused, AVG(p1.hltv_rating) AS hltv, AVG(p1.mvp_count) AS mvp, AVG(p1.kast) AS kast, AVG(p1.utility_damage) AS utl_dmg, AVG(p1.two_kill_count) AS two_kills, AVG(p1.three_kill_count) AS three_kills, AVG(p1.four_kill_count) AS four_kills, AVG(p1.five_kill_count) AS five_kills, AVG(p1.score) AS score, COALESCE(c.num_clutches,0) AS number_of_clutches, COALESCE(c.num_successful_clutches,0) AS number_of_successful_clutches FROM players p1 INNER JOIN matches ON p1.match_checksum = matches.checksum INNER JOIN teams ON matches.checksum = teams.match_checksum AND p1.team_name = teams.name LEFT JOIN ( SELECT match_checksum, clutcher_steam_id, COUNT(*) AS num_clutches, SUM(CASE WHEN won THEN 1 ELSE 0 END) AS num_successful_clutches FROM clutches GROUP BY match_checksum, clutcher_steam_id ) c ON c.match_checksum = matches.checksum AND c.clutcher_steam_id = p1.steam_id WHERE matches.date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) GROUP BY matches.date::date, matches.map_name, teams.name, teams.score, p1.steam_id, p1.name, c.num_clutches, c.num_successful_clutches ORDER BY matches.date::date DESC, matches.map_name, teams.name, hltv_2 DESC`),
    sonmacRounds: q(`WITH match_date_info AS ( SELECT MAX(matches.date::date) AS latest_match_date FROM matches ), season_start_info AS ( SELECT '${seasonStart}'::date AS seasonstart ) SELECT matches.date::date AS match_date, matches.map_name, matches.checksum AS match_checksum, matches.max_rounds, rounds.number AS round_number, rounds.end_reason, rounds.winner_name, rounds.winner_side, rounds.team_a_name, rounds.team_b_name, rounds.team_a_side, rounds.team_b_side, rounds.team_a_score, rounds.team_b_score, rounds.overtime_number FROM rounds INNER JOIN matches ON rounds.match_checksum = matches.checksum WHERE matches.date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) ORDER BY matches.date::date DESC, matches.map_name, rounds.number ASC`),
    duello_son_mac: q(`WITH last_x_dates AS ( SELECT DISTINCT matches.date::date AS unique_date FROM matches ORDER BY unique_date DESC LIMIT 1 ), last_date_matches AS ( SELECT checksum FROM matches WHERE date::date = (SELECT MAX(unique_date) FROM last_x_dates) ), player_kills_deaths AS ( SELECT p1.steam_id AS killerSteamId, MIN(p1.name) AS killerName, p2.steam_id AS victimSteamId, MIN(p2.name) AS victimName, ( SELECT COUNT(*) FROM kills k WHERE k.killer_steam_id = p1.steam_id AND k.victim_steam_id = p2.steam_id AND k.match_checksum IN (SELECT checksum FROM last_date_matches) ) AS killCount, ( SELECT COUNT(*) FROM kills k2 WHERE k2.killer_steam_id = p2.steam_id AND k2.victim_steam_id = p1.steam_id AND k2.match_checksum IN (SELECT checksum FROM last_date_matches) ) AS deathCount FROM players p1 INNER JOIN players p2 ON p1.match_checksum = p2.match_checksum WHERE p1.match_checksum IN (SELECT checksum FROM last_date_matches) AND p2.match_checksum IN (SELECT checksum FROM last_date_matches) AND p1.team_name <> p2.team_name GROUP BY p1.steam_id, p2.steam_id ), distinct_players AS ( SELECT DISTINCT killerSteamId AS playerSteamId, killerName AS playerName FROM player_kills_deaths UNION SELECT DISTINCT victimSteamId, victimName FROM player_kills_deaths ) SELECT dp1.playerSteamId AS PlayerRowSteamId, dp1.playerName AS PlayerRow, dp2.playerSteamId AS PlayerColumnSteamId, dp2.playerName AS PlayerColumn, COALESCE(pkd.killCount,0)||'/'||COALESCE(pkd.deathCount,0) AS KillDeathRatio FROM distinct_players dp1 CROSS JOIN distinct_players dp2 LEFT JOIN player_kills_deaths pkd ON dp1.playerSteamId=pkd.killerSteamId AND dp2.playerSteamId=pkd.victimSteamId ORDER BY dp1.playerName, dp2.playerName`),
    duello_sezon: q(`WITH match_date_info AS ( SELECT MAX(matches.date::date) AS latest_match_date FROM matches ), season_start_info AS ( SELECT '${seasonStart}'::date AS seasonstart ), season_matches AS ( SELECT checksum FROM matches WHERE date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) ), player_kills_deaths AS ( SELECT p1.steam_id AS killerSteamId, MAX(p1.name) AS killerName, p2.steam_id AS victimSteamId, MAX(p2.name) AS victimName, ( SELECT COUNT(*) FROM kills k WHERE k.killer_steam_id = p1.steam_id AND k.victim_steam_id = p2.steam_id AND k.match_checksum IN (SELECT checksum FROM season_matches) ) AS killCount, ( SELECT COUNT(*) FROM kills k2 WHERE k2.killer_steam_id = p2.steam_id AND k2.victim_steam_id = p1.steam_id AND k2.match_checksum IN (SELECT checksum FROM season_matches) ) AS deathCount FROM players p1 INNER JOIN players p2 ON p1.match_checksum = p2.match_checksum WHERE p1.match_checksum IN (SELECT checksum FROM season_matches) AND p2.match_checksum IN (SELECT checksum FROM season_matches) AND p1.team_name <> p2.team_name GROUP BY p1.steam_id, p2.steam_id ), distinct_players AS ( SELECT DISTINCT killerSteamId AS playerSteamId, killerName AS playerName FROM player_kills_deaths UNION SELECT DISTINCT victimSteamId, victimName FROM player_kills_deaths ) SELECT dp1.playerSteamId AS PlayerRowSteamId, dp1.playerName AS PlayerRow, dp2.playerSteamId AS PlayerColumnSteamId, dp2.playerName AS PlayerColumn, COALESCE(pkd.killCount,0)||'/'||COALESCE(pkd.deathCount,0) AS KillDeathRatio FROM distinct_players dp1 CROSS JOIN distinct_players dp2 LEFT JOIN player_kills_deaths pkd ON dp1.playerSteamId=pkd.killerSteamId AND dp2.playerSteamId=pkd.victimSteamId ORDER BY dp1.playerName, dp2.playerName`),
    performanceGraphs: q(`WITH season_start_info AS ( SELECT '${seasonStart}'::date AS seasonstart ), match_date_info AS ( SELECT MAX(date::date) AS latest_match_date FROM matches ), match_dates AS ( SELECT DISTINCT date::date AS match_date FROM matches WHERE date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) ), distinct_players AS ( SELECT steam_id, MAX(name) AS name FROM players GROUP BY steam_id ), performance_data AS ( SELECT p.steam_id, m.date::date AS match_date, AVG(p.hltv_rating_2) AS hltv_2, AVG(p.average_damage_per_round) AS adr FROM players p INNER JOIN matches m ON p.match_checksum = m.checksum WHERE m.date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) GROUP BY p.steam_id, m.date::date ) SELECT dp.steam_id, dp.name, md.match_date::date, pd.hltv_2, pd.adr FROM distinct_players dp CROSS JOIN match_dates md LEFT JOIN performance_data pd ON pd.steam_id=dp.steam_id AND pd.match_date=md.match_date ORDER BY dp.name, md.match_date`),
    mapStats: q(`WITH match_date_info AS ( SELECT MAX(matches.date::date) AS latest_match_date FROM matches ), season_start_info AS ( SELECT '${seasonStart}'::date AS seasonstart ), season_matches AS ( SELECT m.checksum, m.map_name FROM matches m WHERE m.date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) AND m.map_name IS NOT NULL AND m.map_name <> '' ), team_sizes AS ( SELECT p.match_checksum, p.team_name, COUNT(DISTINCT p.steam_id) AS team_size FROM players p INNER JOIN season_matches sm ON p.match_checksum = sm.checksum GROUP BY p.match_checksum, p.team_name ), match_sizes AS ( SELECT match_checksum, MAX(team_size) AS players_per_team FROM team_sizes GROUP BY match_checksum ), round_wins AS ( SELECT r.match_checksum, COUNT(*) FILTER (WHERE r.winner_side = 2) AS ct_round_wins, COUNT(*) FILTER (WHERE r.winner_side = 3) AS t_round_wins FROM rounds r INNER JOIN season_matches sm ON r.match_checksum = sm.checksum GROUP BY r.match_checksum ), match_summaries AS ( SELECT sm.map_name, sm.checksum AS match_checksum, COALESCE(ms.players_per_team, 0) AS players_per_team, COALESCE(rw.ct_round_wins, 0) AS ct_round_wins, COALESCE(rw.t_round_wins, 0) AS t_round_wins FROM season_matches sm LEFT JOIN match_sizes ms ON ms.match_checksum = sm.checksum LEFT JOIN round_wins rw ON rw.match_checksum = sm.checksum ) SELECT map_name, NULL::int AS players_bucket, COUNT(*) AS matches_played, SUM(ct_round_wins) AS ct_round_wins, SUM(t_round_wins) AS t_round_wins FROM match_summaries GROUP BY map_name UNION ALL SELECT map_name, CASE WHEN players_per_team >= 7 THEN 7 WHEN players_per_team = 6 THEN 6 WHEN players_per_team = 5 THEN 5 ELSE players_per_team END AS players_bucket, COUNT(*) AS matches_played, SUM(ct_round_wins) AS ct_round_wins, SUM(t_round_wins) AS t_round_wins FROM match_summaries GROUP BY map_name, CASE WHEN players_per_team >= 7 THEN 7 WHEN players_per_team = 6 THEN 6 WHEN players_per_team = 5 THEN 5 ELSE players_per_team END ORDER BY map_name, players_bucket NULLS FIRST`),
    playerOverview: q(`WITH match_date_info AS ( SELECT MAX(matches.date::date) AS latest_match_date FROM matches ), season_start_info AS ( SELECT '${seasonStart}'::date AS seasonstart ), season_matches AS ( SELECT matches.checksum, matches.winner_name, matches.date::date AS match_date FROM matches WHERE matches.date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) ), player_match_stats AS ( SELECT p.steam_id, MAX(p.name) AS name, COUNT(*) AS matches_played, COUNT(CASE WHEN season_matches.winner_name = p.team_name THEN 1 END) AS wins, COUNT(CASE WHEN season_matches.winner_name IS NULL OR season_matches.winner_name = '' THEN 1 END) AS ties, SUM(p.kill_count) AS kills, SUM(p.death_count) AS deaths, SUM(p.assist_count) AS assists, SUM(p.headshot_count) AS headshots, AVG(p.hltv_rating_2) AS hltv_2, AVG(p.hltv_rating) AS hltv, AVG(p.average_damage_per_round) AS adr, AVG(p.kast) AS kast, SUM(p.first_kill_count) AS first_kills, SUM(p.first_death_count) AS first_deaths, SUM(p.first_trade_kill_count) AS first_trade_kills, SUM(p.first_trade_death_count) AS first_trade_deaths, SUM(p.bomb_planted_count) AS bomb_planted, SUM(p.bomb_defused_count) AS bomb_defused, SUM(p.hostage_rescued_count) AS hostage_rescued, SUM(p.one_kill_count) AS one_kill_count, SUM(p.two_kill_count) AS two_kill_count, SUM(p.three_kill_count) AS three_kill_count, SUM(p.four_kill_count) AS four_kill_count, SUM(p.five_kill_count) AS five_kill_count, SUM(p.inspect_weapon_count) AS inspect_weapon_count FROM players p INNER JOIN season_matches ON p.match_checksum = season_matches.checksum GROUP BY p.steam_id ) SELECT *, CASE WHEN matches_played > 0 THEN ROUND((wins::numeric / matches_played) * 100, 2) ELSE 0 END AS win_rate FROM player_match_stats`),
    playerRounds: q(`WITH match_date_info AS ( SELECT MAX(matches.date::date) AS latest_match_date FROM matches ), season_start_info AS ( SELECT '${seasonStart}'::date AS seasonstart ), season_matches AS ( SELECT matches.checksum FROM matches WHERE matches.date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) ), player_match_teams AS ( SELECT p.steam_id, p.team_name, p.match_checksum FROM players p INNER JOIN season_matches ON p.match_checksum = season_matches.checksum ), rounds_team_sides AS ( SELECT r.match_checksum, r.team_a_name, r.team_b_name, r.team_a_side, r.team_b_side FROM rounds r INNER JOIN season_matches ON r.match_checksum = season_matches.checksum ) SELECT pmt.steam_id, COUNT(*) AS rounds_total, COUNT(*) FILTER (WHERE (rts.team_a_name = pmt.team_name AND rts.team_a_side = 2) OR (rts.team_b_name = pmt.team_name AND rts.team_b_side = 2)) AS rounds_ct, COUNT(*) FILTER (WHERE (rts.team_a_name = pmt.team_name AND rts.team_a_side = 3) OR (rts.team_b_name = pmt.team_name AND rts.team_b_side = 3)) AS rounds_t FROM player_match_teams pmt INNER JOIN rounds_team_sides rts ON rts.match_checksum = pmt.match_checksum GROUP BY pmt.steam_id`),
    playerWeaponKills: q(`WITH match_date_info AS ( SELECT MAX(matches.date::date) AS latest_match_date FROM matches ), season_start_info AS ( SELECT '${seasonStart}'::date AS seasonstart ), season_matches AS ( SELECT matches.checksum FROM matches WHERE matches.date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) ) SELECT k.killer_steam_id AS steam_id, k.weapon_name, COUNT(*) AS kills, SUM(CASE WHEN k.is_headshot THEN 1 ELSE 0 END) AS headshots FROM kills k INNER JOIN season_matches ON k.match_checksum = season_matches.checksum WHERE k.killer_steam_id IS NOT NULL GROUP BY k.killer_steam_id, k.weapon_name`),
    playerWeaponShots: q(`WITH match_date_info AS ( SELECT MAX(matches.date::date) AS latest_match_date FROM matches ), season_start_info AS ( SELECT '${seasonStart}'::date AS seasonstart ), season_matches AS ( SELECT matches.checksum FROM matches WHERE matches.date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) ) SELECT s.player_steam_id AS steam_id, s.weapon_name, COUNT(*) AS shots FROM shots s INNER JOIN season_matches ON s.match_checksum = season_matches.checksum WHERE s.player_steam_id IS NOT NULL GROUP BY s.player_steam_id, s.weapon_name`),
    playerWeaponDamage: q(`WITH match_date_info AS ( SELECT MAX(matches.date::date) AS latest_match_date FROM matches ), season_start_info AS ( SELECT '${seasonStart}'::date AS seasonstart ), season_matches AS ( SELECT matches.checksum FROM matches WHERE matches.date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) ) SELECT d.attacker_steam_id AS steam_id, d.weapon_name, COUNT(*) AS hits, SUM(d.health_damage + d.armor_damage) AS damage FROM damages d INNER JOIN season_matches ON d.match_checksum = season_matches.checksum WHERE d.attacker_steam_id IS NOT NULL GROUP BY d.attacker_steam_id, d.weapon_name`),
    playerUtilities: q(`WITH match_date_info AS ( SELECT MAX(matches.date::date) AS latest_match_date FROM matches ), season_start_info AS ( SELECT '${seasonStart}'::date AS seasonstart ), season_matches AS ( SELECT matches.checksum FROM matches WHERE matches.date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) ), flashes AS ( SELECT pb.flasher_steam_id AS steam_id, COUNT(*) FILTER (WHERE pb.flasher_side <> pb.flashed_side) AS enemy_flashes, AVG(CASE WHEN pb.flasher_side <> pb.flashed_side THEN pb.duration END) AS avg_blind_time FROM player_blinds pb INNER JOIN season_matches ON pb.match_checksum = season_matches.checksum GROUP BY pb.flasher_steam_id ), smokes AS ( SELECT ss.thrower_steam_id AS steam_id, COUNT(*) AS smokes_thrown FROM smokes_start ss INNER JOIN season_matches ON ss.match_checksum = season_matches.checksum GROUP BY ss.thrower_steam_id ), he_damage AS ( SELECT d.attacker_steam_id AS steam_id, SUM(d.health_damage + d.armor_damage) AS he_damage FROM damages d INNER JOIN season_matches ON d.match_checksum = season_matches.checksum WHERE d.attacker_steam_id IS NOT NULL AND ( LOWER(d.weapon_name) IN ('hegrenade','he_grenade','he grenade','he grenade projectile','hegrenade_projectile') OR LOWER(d.weapon_name) LIKE 'he%' ) GROUP BY d.attacker_steam_id ) SELECT COALESCE(f.steam_id, s.steam_id, h.steam_id) AS steam_id, COALESCE(f.enemy_flashes, 0) AS enemy_flashes, COALESCE(f.avg_blind_time, 0) AS avg_blind_time, COALESCE(s.smokes_thrown, 0) AS smokes_thrown, COALESCE(h.he_damage, 0) AS he_damage FROM flashes f FULL OUTER JOIN smokes s ON f.steam_id = s.steam_id FULL OUTER JOIN he_damage h ON COALESCE(f.steam_id, s.steam_id) = h.steam_id`),
    playerInspectionDeaths: q(`WITH match_date_info AS ( SELECT MAX(matches.date::date) AS latest_match_date FROM matches ), season_start_info AS ( SELECT '${seasonStart}'::date AS seasonstart ), season_matches AS ( SELECT matches.checksum FROM matches WHERE matches.date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) ) SELECT k.victim_steam_id AS steam_id, COUNT(*) AS deaths_while_inspecting FROM kills k INNER JOIN season_matches ON k.match_checksum = season_matches.checksum WHERE k.is_victim_inspecting_weapon = true GROUP BY k.victim_steam_id`),
    playerWallbangCollateral: q(`WITH match_date_info AS ( SELECT MAX(matches.date::date) AS latest_match_date FROM matches ), season_start_info AS ( SELECT '${seasonStart}'::date AS seasonstart ), season_matches AS ( SELECT matches.checksum FROM matches WHERE matches.date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) ), wallbangs AS ( SELECT k.killer_steam_id AS steam_id, COUNT(*) AS wallbang_kills FROM kills k INNER JOIN season_matches ON k.match_checksum = season_matches.checksum WHERE k.killer_steam_id IS NOT NULL AND k.penetrated_objects > 0 GROUP BY k.killer_steam_id ), collaterals AS ( SELECT k.killer_steam_id AS steam_id, SUM(k.kill_count - 1) AS collateral_kills FROM ( SELECT killer_steam_id, match_checksum, round_number, tick, COUNT(*) AS kill_count FROM kills k INNER JOIN season_matches ON k.match_checksum = season_matches.checksum WHERE k.killer_steam_id IS NOT NULL GROUP BY killer_steam_id, match_checksum, round_number, tick HAVING COUNT(*) > 1 ) k GROUP BY k.killer_steam_id ) SELECT COALESCE(w.steam_id, c.steam_id) AS steam_id, COALESCE(w.wallbang_kills, 0) AS wallbang_kills, COALESCE(c.collateral_kills, 0) AS collateral_kills FROM wallbangs w FULL OUTER JOIN collaterals c ON w.steam_id = c.steam_id`),
    playerClutches: q(`WITH match_date_info AS ( SELECT MAX(matches.date::date) AS latest_match_date FROM matches ), season_start_info AS ( SELECT '${seasonStart}'::date AS seasonstart ), season_matches AS ( SELECT matches.checksum FROM matches WHERE matches.date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) ) SELECT c.clutcher_steam_id AS steam_id, c.opponent_count, COUNT(*) AS total, COUNT(*) FILTER (WHERE c.won) AS won, COUNT(*) FILTER (WHERE NOT c.won) AS lost, AVG(c.clutcher_kill_count) AS avg_kills, COUNT(*) FILTER (WHERE c.has_clutcher_survived AND NOT c.won) AS saved FROM clutches c INNER JOIN season_matches ON c.match_checksum = season_matches.checksum GROUP BY c.clutcher_steam_id, c.opponent_count`)
  };
  if (!seasonEnd) return queries;
  const bounded = {};
  for (const [key, value] of Object.entries(queries)) {
    bounded[key] = applySeasonEndBounds(value, seasonEnd);
  }
  return bounded;
}


async function buildPlayersStats(pool, qset, errors, labelPrefix = 'players_stats') {
  let playerOverviewRows = [];
  let playerRoundsRows = [];
  let weaponKillsRows = [];
  let weaponShotsRows = [];
  let weaponDamageRows = [];
  let utilitiesRows = [];
  let inspectionDeathRows = [];
  let wallbangCollateralRows = [];
  let clutchRows = [];
  try { playerOverviewRows = (await pool.query(qset.playerOverview)).rows; } catch(e){ console.error('[statsGenerator] playerOverview query failed', e.message); errors.push({ dataset: `${labelPrefix}:player_overview`, error:e.message }); }
  try { playerRoundsRows = (await pool.query(qset.playerRounds)).rows; } catch(e){ console.error('[statsGenerator] playerRounds query failed', e.message); errors.push({ dataset: `${labelPrefix}:player_rounds`, error:e.message }); }
  try { weaponKillsRows = (await pool.query(qset.playerWeaponKills)).rows; } catch(e){ console.error('[statsGenerator] playerWeaponKills query failed', e.message); errors.push({ dataset: `${labelPrefix}:player_weapon_kills`, error:e.message }); }
  try { weaponShotsRows = (await pool.query(qset.playerWeaponShots)).rows; } catch(e){ console.error('[statsGenerator] playerWeaponShots query failed', e.message); errors.push({ dataset: `${labelPrefix}:player_weapon_shots`, error:e.message }); }
  try { weaponDamageRows = (await pool.query(qset.playerWeaponDamage)).rows; } catch(e){ console.error('[statsGenerator] playerWeaponDamage query failed', e.message); errors.push({ dataset: `${labelPrefix}:player_weapon_damage`, error:e.message }); }
  try { utilitiesRows = (await pool.query(qset.playerUtilities)).rows; } catch(e){ console.error('[statsGenerator] playerUtilities query failed', e.message); errors.push({ dataset: `${labelPrefix}:player_utilities`, error:e.message }); }
  try { inspectionDeathRows = (await pool.query(qset.playerInspectionDeaths)).rows; } catch(e){ console.error('[statsGenerator] playerInspectionDeaths query failed', e.message); errors.push({ dataset: `${labelPrefix}:player_inspection_deaths`, error:e.message }); }
  try { wallbangCollateralRows = (await pool.query(qset.playerWallbangCollateral)).rows; } catch(e){ console.error('[statsGenerator] playerWallbangCollateral query failed', e.message); errors.push({ dataset: `${labelPrefix}:player_wallbang_collateral`, error:e.message }); }
  try { clutchRows = (await pool.query(qset.playerClutches)).rows; } catch(e){ console.error('[statsGenerator] playerClutches query failed', e.message); errors.push({ dataset: `${labelPrefix}:player_clutches`, error:e.message }); }

  const playersById = {};
  const weaponsByPlayer = {};
  const clutchAggByPlayer = {};
  const roundValue = (value, decimals = 2) => {
    const n = num(value);
    return parseFloat(n.toFixed(decimals));
  };
  const ensurePlayer = (steamId, fallbackName) => {
    if (!steamId) return null;
    const name = normalizedName(steamId, fallbackName);
    if (!playersById[steamId]) {
      playersById[steamId] = {
        steam_id: steamId,
        name,
        matches_played: 0,
        wins: 0,
        ties: 0,
        losses: 0,
        win_rate: 0,
        hltv_2: 0,
        hltv: 0,
        kast: 0,
        adr: 0,
        kd: 0,
        avg_kills_per_round: 0,
        avg_deaths_per_round: 0,
        hs_pct: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        headshots: 0,
        wallbang_kills: 0,
        collateral_kills: 0,
        opening_duels: { success_pct: 0, traded_pct: 0, first_kills: 0, first_deaths: 0, best_weapon: null },
        rounds: { total: 0, ct: 0, t: 0 },
        multi_kills: { k1: 0, k2: 0, k3: 0, k4: 0, k5: 0 },
        inspections: { total: 0, deaths_while_inspecting: 0 },
        objectives: { bomb_planted: 0, bomb_defused: 0, hostage_rescued: 0 },
        utilities: { avg_blind_time: 0, enemies_flashed: 0, avg_he_damage: 0, avg_smokes_thrown: 0 },
        weapons: [],
        clutches: { overall: { total: 0, won: 0, lost: 0, avg_kills: 0, win_rate: 0, save_rate: 0 }, by_type: {} }
      };
    } else if (name && playersById[steamId].name !== name) {
      playersById[steamId].name = name;
    }
    return playersById[steamId];
  };
  const ensureWeapon = (steamId, weaponName) => {
    if (!steamId || !weaponName) return null;
    if (!weaponsByPlayer[steamId]) weaponsByPlayer[steamId] = {};
    if (!weaponsByPlayer[steamId][weaponName]) {
      weaponsByPlayer[steamId][weaponName] = { name: weaponName, kills: 0, headshots: 0, shots: 0, hits: 0, damage: 0 };
    }
    return weaponsByPlayer[steamId][weaponName];
  };

  for (const r of playerOverviewRows) {
    const player = ensurePlayer(r.steam_id, r.name);
    if (!player) continue;
    const matchesPlayed = num(r.matches_played);
    const wins = num(r.wins);
    const ties = num(r.ties);
    const kills = num(r.kills);
    const deaths = num(r.deaths);
    const headshots = num(r.headshots);
    player.matches_played = matchesPlayed;
    player.wins = wins;
    player.ties = ties;
    player.losses = Math.max(0, matchesPlayed - wins - ties);
    player.win_rate = num(r.win_rate);
    player.hltv_2 = num(r.hltv_2);
    player.hltv = num(r.hltv);
    player.kast = num(r.kast);
    player.adr = num(r.adr);
    player.kills = kills;
    player.deaths = deaths;
    player.assists = num(r.assists);
    player.headshots = headshots;
    player.kd = deaths > 0 ? roundValue(kills / deaths, 2) : kills;
    player.hs_pct = pct(headshots, kills);
    const firstKills = num(r.first_kills);
    const firstDeaths = num(r.first_deaths);
    const firstTrades = num(r.first_trade_kills) + num(r.first_trade_deaths);
    const firstTotal = firstKills + firstDeaths;
    player.opening_duels = {
      success_pct: pct(firstKills, firstTotal),
      traded_pct: pct(firstTrades, firstTotal),
      first_kills: firstKills,
      first_deaths: firstDeaths,
      best_weapon: player.opening_duels?.best_weapon || null
    };
    player.multi_kills = {
      k1: num(r.one_kill_count),
      k2: num(r.two_kill_count),
      k3: num(r.three_kill_count),
      k4: num(r.four_kill_count),
      k5: num(r.five_kill_count)
    };
    player.inspections.total = num(r.inspect_weapon_count);
    player.objectives = {
      bomb_planted: num(r.bomb_planted),
      bomb_defused: num(r.bomb_defused),
      hostage_rescued: num(r.hostage_rescued)
    };
  }

  for (const r of playerRoundsRows) {
    const player = ensurePlayer(r.steam_id, r.name);
    if (!player) continue;
    player.rounds = {
      total: num(r.rounds_total),
      ct: num(r.rounds_ct),
      t: num(r.rounds_t)
    };
  }

  for (const r of utilitiesRows) {
    const player = ensurePlayer(r.steam_id, r.name);
    if (!player) continue;
    const matchesPlayed = player.matches_played || 0;
    player.utilities = {
      avg_blind_time: roundValue(num(r.avg_blind_time), 1),
      enemies_flashed: matchesPlayed ? roundValue(num(r.enemy_flashes) / matchesPlayed, 1) : 0,
      avg_he_damage: matchesPlayed ? roundValue(num(r.he_damage) / matchesPlayed, 1) : 0,
      avg_smokes_thrown: matchesPlayed ? roundValue(num(r.smokes_thrown) / matchesPlayed, 1) : 0
    };
  }

  for (const r of inspectionDeathRows) {
    const player = ensurePlayer(r.steam_id, r.name);
    if (!player) continue;
    player.inspections.deaths_while_inspecting = num(r.deaths_while_inspecting);
  }

  for (const r of wallbangCollateralRows) {
    const player = ensurePlayer(r.steam_id, r.name);
    if (!player) continue;
    player.wallbang_kills = num(r.wallbang_kills);
    player.collateral_kills = num(r.collateral_kills);
  }

  for (const r of weaponKillsRows) {
    const weapon = ensureWeapon(r.steam_id, r.weapon_name);
    if (!weapon) continue;
    weapon.kills += num(r.kills);
    weapon.headshots += num(r.headshots);
  }
  for (const r of weaponShotsRows) {
    const weapon = ensureWeapon(r.steam_id, r.weapon_name);
    if (!weapon) continue;
    weapon.shots += num(r.shots);
  }
  for (const r of weaponDamageRows) {
    const weapon = ensureWeapon(r.steam_id, r.weapon_name);
    if (!weapon) continue;
    weapon.hits += num(r.hits);
    weapon.damage += num(r.damage);
  }

  for (const r of clutchRows) {
    const player = ensurePlayer(r.steam_id, r.name);
    if (!player) continue;
    const total = num(r.total);
    const won = num(r.won);
    const lost = num(r.lost);
    const avgKills = num(r.avg_kills);
    const saved = num(r.saved);
    const typeKey = `1v${num(r.opponent_count)}`;
    player.clutches.by_type[typeKey] = {
      total,
      won,
      lost,
      avg_kills: roundValue(avgKills, 2),
      win_rate: pct(won, total),
      save_rate: pct(saved, total)
    };
    if (!clutchAggByPlayer[player.steam_id]) {
      clutchAggByPlayer[player.steam_id] = { total: 0, won: 0, lost: 0, saved: 0, killSum: 0 };
    }
    const agg = clutchAggByPlayer[player.steam_id];
    agg.total += total;
    agg.won += won;
    agg.lost += lost;
    agg.saved += saved;
    agg.killSum += avgKills * total;
  }

  for (const [steamId, weapons] of Object.entries(weaponsByPlayer)) {
    const player = ensurePlayer(steamId, null);
    if (!player) continue;
    const list = Object.values(weapons).map((w) => ({
      name: w.name,
      kills: num(w.kills),
      hs_pct: pct(num(w.headshots), num(w.kills)),
      damage: num(w.damage),
      shots: num(w.shots),
      hits: num(w.hits),
      accuracy: pct(num(w.hits), num(w.shots))
    }));
    list.sort((a, b) => (b.kills - a.kills) || (b.damage - a.damage) || a.name.localeCompare(b.name));
    player.weapons = list.slice(0, 10);
    if (list[0]) {
      player.opening_duels.best_weapon = list[0].name;
    }
  }

  for (const player of Object.values(playersById)) {
    if (player.rounds.total > 0) {
      player.avg_kills_per_round = roundValue(player.kills / player.rounds.total, 2);
      player.avg_deaths_per_round = roundValue(player.deaths / player.rounds.total, 2);
    }
    const agg = clutchAggByPlayer[player.steam_id];
    if (agg && agg.total > 0) {
      player.clutches.overall = {
        total: agg.total,
        won: agg.won,
        lost: agg.lost,
        avg_kills: roundValue(agg.killSum / agg.total, 2),
        win_rate: pct(agg.won, agg.total),
        save_rate: pct(agg.saved, agg.total)
      };
    }
    const clutchSlots = [1, 2, 3, 4, 5];
    clutchSlots.forEach((slot) => {
      const key = `1v${slot}`;
      if (!player.clutches.by_type[key]) {
        player.clutches.by_type[key] = { total: 0, won: 0, lost: 0, avg_kills: 0, win_rate: 0, save_rate: 0 };
      }
    });
  }

  for (const [steamId, name] of Object.entries(canonicalNames)) {
    ensurePlayer(steamId, name);
  }
  return Object.values(playersById).sort((a, b) => a.name.localeCompare(b.name));
}

function mapNightAvgRows(rows) {
  const grouped = {};
  for (const r of rows) {
    const dateKey = isoDate(r.match_date);
    if (!dateKey) continue;
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push({
      steam_id: r.steam_id,
      name: normalizedName(r.steam_id, r.name),
      'HLTV 2': num(r.hltv_2),
      'ADR': num(r.adr),
      'K/D': num(r.kd),
      'MVP': num(r.mvp),
      'Kills': num(r.kills),
      'Deaths': num(r.deaths),
      'Assists': num(r.assists),
      'HS': num(r.headshot_kills),
      'HS/Kill ratio': num(r.headshot_killratio),
      'First Kill': num(r.first_kill_count),
      'First Death': num(r.first_death_count),
      'Bomb Planted': num(r.bomb_planted),
      'Bomb Defused': num(r.bomb_defused),
      'HLTV': num(r.hltv),
      'KAST': num(r.kast),
      'Utility Damage': num(r.utl_dmg),
      '2 kills': num(r.two_kills),
      '3 kills': num(r.three_kills),
      '4 kills': num(r.four_kills),
      '5 kills': num(r.five_kills),
      'Nr of Matches': num(r.matches_in_interval),
      'HLTV2 DIFF': num(r.hltv_2_diff),
      'ADR DIFF': num(r.adr_diff),
      'Clutch Opportunity': num(r.clutches),
      'Clutches Won': num(r.clutches_won),
    });
  }
  return grouped;
}

function mapPerformanceRows(rows) {
  const grouped = {};
  for (const r of rows) {
    const name = normalizedName(r.steam_id, r.name);
    if (!grouped[name]) grouped[name] = { name, steam_id: r.steam_id, performance: [] };
    grouped[name].performance.push({
      match_date: r.match_date ? new Date(r.match_date).toISOString() : null,
      hltv_2: numOrNull(r.hltv_2),
      adr: numOrNull(r.adr),
    });
  }
  return Object.values(grouped).sort((a, b) => a.name.localeCompare(b.name));
}

async function generateAll(pool, opts={}){
  loadCanonicalNames();
  if (opts.seasonStart) {
    sezonbaslangic = opts.seasonStart;
  }
  const seasonStarts = normalizeSeasonStarts(opts.seasonStarts, sezonbaslangic);
  const results = {};
  let errors = [];
  const qset = buildQueries(sezonbaslangic);
  const allTimeQset = sezonbaslangic === ALL_TIME_START ? qset : buildQueries(ALL_TIME_START);
  const seasonAvgPeriods = await buildSeasonAvgPeriodsDataset(pool, sezonbaslangic, seasonStarts, errors);
  results.season_avg_periods = seasonAvgPeriods;
  results.season_avg = seasonAvgPeriods.data?.[seasonAvgPeriods.current_period] || [];
  // Night Avg
  let nightRows = [];
  try { nightRows = (await pool.query(qset.nightAvg)).rows; } catch(e){ console.error('[statsGenerator] nightAvg query failed', e.message); }
  results.night_avg = mapNightAvgRows(nightRows);
  let nightRowsAll = nightRows;
  if (sezonbaslangic !== ALL_TIME_START) {
    try { nightRowsAll = (await pool.query(allTimeQset.nightAvg)).rows; } catch(e){ console.error('[statsGenerator] nightAvg all-time query failed', e.message); errors.push({ dataset:'night_avg_all', error:e.message }); }
  }
  results.night_avg_all = mapNightAvgRows(nightRowsAll);
  // Last10
  let last10Rows = [];
  try { last10Rows = (await pool.query(qset.last10)).rows; } catch(e){ console.error('[statsGenerator] last10 query failed', e.message); }
  results.last10 = last10Rows.map(r=>({ steam_id:r.steam_id, name:r.name, hltv_2:num(r.hltv_2), adr:num(r.adr), kd:num(r.kd), mvp:num(r.mvp), kills:num(r.kills), deaths:num(r.deaths), assists:num(r.assists), hs:num(r.headshot_kills), hs_ratio:num(r.headshot_killratio), first_kill:num(r.first_kill_count), first_death:num(r.first_death_count), bomb_planted:num(r.bomb_planted), bomb_defused:num(r.bomb_defused), hltv:num(r.hltv), kast:num(r.kast), utl_dmg:num(r.utl_dmg), two_kills:num(r.two_kills), three_kills:num(r.three_kills), four_kills:num(r.four_kills), five_kills:num(r.five_kills), matches:num(r.matches_in_interval), win_rate:num(r.win_rate_percentage), avg_clutches: safeAvg(num(r.total_clutches), num(r.matches_in_interval)), avg_clutches_won: safeAvg(num(r.total_clutches_won), num(r.matches_in_interval)), clutch_success: pct(num(r.total_clutches_won), num(r.total_clutches)) }));
  // Sonmac by date
  let sonmacRows = [];
  try { sonmacRows = (await pool.query(qset.sonmac)).rows; } catch(e){ console.error('[statsGenerator] sonmac query failed', e.message); }
  // Sonmac rounds
  let roundRows = [];
  try { roundRows = (await pool.query(qset.sonmacRounds)).rows; } catch(e){ console.error('[statsGenerator] sonmacRounds query failed', e.message); }
  results.sonmac_by_date = buildSonmacByDate(sonmacRows, roundRows);
  let allTimeSonmacRows = sonmacRows;
  let allTimeRoundRows = roundRows;
  if (sezonbaslangic !== ALL_TIME_START) {
    try {
      allTimeSonmacRows = (await pool.query(allTimeQset.sonmac)).rows;
    } catch (e) {
      console.error('[statsGenerator] sonmac all-time query failed', e.message);
      errors.push({ dataset: 'sonmac_by_date_all', error: e.message });
      allTimeSonmacRows = sonmacRows;
    }
    try {
      allTimeRoundRows = (await pool.query(allTimeQset.sonmacRounds)).rows;
    } catch (e) {
      console.error('[statsGenerator] sonmacRounds all-time query failed', e.message);
      errors.push({ dataset: 'sonmac_by_date_all_rounds', error: e.message });
      allTimeRoundRows = roundRows;
    }
  }
  results.sonmac_by_date_all = buildSonmacByDate(allTimeSonmacRows, allTimeRoundRows);
  // Duello last match
  let dLastRows = [];
  try { dLastRows = (await pool.query(qset.duello_son_mac)).rows; } catch(e){ console.error('[statsGenerator] duello_son_mac query failed', e.message); }
  results.duello_son_mac = buildDuello(dLastRows);
  // Duello season
  let dSeasonRows = [];
  try { dSeasonRows = (await pool.query(qset.duello_sezon)).rows; } catch(e){ console.error('[statsGenerator] duello_sezon query failed', e.message); }
  results.duello_sezon = buildDuello(dSeasonRows);
  // Performance graphs
  let perfRows = [];
  try { perfRows = (await pool.query(qset.performanceGraphs)).rows; } catch(e){ console.error('[statsGenerator] performanceGraphs query failed', e.message); }
  results.performance_data = mapPerformanceRows(perfRows);
  // Map stats
  let mapStatsRows = [];
  try { mapStatsRows = (await pool.query(qset.mapStats)).rows; } catch(e){ console.error('[statsGenerator] mapStats query failed', e.message); errors.push({ dataset:'map_stats', error:e.message }); }
  const mapStatsByName = {};
  for (const r of mapStatsRows) {
    const mapName = r.map_name;
    if (!mapName) continue;
    if (!mapStatsByName[mapName]) {
      mapStatsByName[mapName] = {
        map_name: mapName,
        matches_played: 0,
        ct_round_wins: 0,
        t_round_wins: 0,
        ct_win_pct: 0,
        t_win_pct: 0,
        by_player_count: {}
      };
    }
    const matchesPlayed = num(r.matches_played);
    const ctRounds = num(r.ct_round_wins);
    const tRounds = num(r.t_round_wins);
    const bucket = r.players_bucket === null || r.players_bucket === undefined ? null : num(r.players_bucket);
    if (bucket === null) {
      mapStatsByName[mapName].matches_played = matchesPlayed;
      mapStatsByName[mapName].ct_round_wins = ctRounds;
      mapStatsByName[mapName].t_round_wins = tRounds;
    } else {
      mapStatsByName[mapName].by_player_count[String(bucket)] = {
        matches_played: matchesPlayed,
        ct_round_wins: ctRounds,
        t_round_wins: tRounds,
        ct_win_pct: pct(ctRounds, ctRounds + tRounds),
        t_win_pct: pct(tRounds, ctRounds + tRounds)
      };
    }
  }
  for (const stats of Object.values(mapStatsByName)) {
    const totalRounds = num(stats.ct_round_wins) + num(stats.t_round_wins);
    stats.ct_win_pct = pct(stats.ct_round_wins, totalRounds);
    stats.t_win_pct = pct(stats.t_round_wins, totalRounds);
  }
  results.map_stats = Object.values(mapStatsByName).sort((a,b)=>a.map_name.localeCompare(b.map_name));
  results.players_stats = await buildPlayersStats(pool, qset, errors);
  const playersStatsPeriods = {
    current_period: seasonAvgPeriods.current_period,
    season_starts: seasonAvgPeriods.season_starts,
    periods: seasonAvgPeriods.periods,
    data: {},
  };
  for (const period of seasonAvgPeriods.periods || []) {
    if (!period || !period.id) continue;
    if (period.id === seasonAvgPeriods.current_period) {
      playersStatsPeriods.data[period.id] = results.players_stats;
      continue;
    }
    // Use cache for completed (non-current, non-all-time) seasons
    if (period.id !== 'all_time' && !period.is_current && historicalPlayersStatsCache[period.id]) {
      console.log(`[statsGenerator] Using cached players_stats for ${period.id}`);
      playersStatsPeriods.data[period.id] = historicalPlayersStatsCache[period.id];
      continue;
    }
    if (period.id === 'all_time') {
      playersStatsPeriods.data[period.id] = await buildPlayersStats(pool, allTimeQset, errors, `players_stats:${period.id}`);
      continue;
    }
    const periodQset = buildQueries(period.start_date || sezonbaslangic, period.end_date || null);
    const periodData = await buildPlayersStats(pool, periodQset, errors, `players_stats:${period.id}`);
    playersStatsPeriods.data[period.id] = periodData;
    // Cache completed seasons
    if (!period.is_current) {
      historicalPlayersStatsCache[period.id] = periodData;
      console.log(`[statsGenerator] Cached players_stats for ${period.id}`);
    }
  }
  results.players_stats_periods = playersStatsPeriods;
  if(errors.length) results.__errors = errors;
  return results;
}

function buildDuello(rows){
  const duels = {}; const players = new Set(); const steamIdToName = {};
  for(const r of rows){
    const rowSteamId = r.playerrowsteamid; const colSteamId = r.playercolumnsteamid;
    const rowName = normalizedName(rowSteamId, r.playerrow); 
    const colName = normalizedName(colSteamId, r.playercolumn);
    const kd = r.killdeathratio || '0/0';
    players.add(rowName); players.add(colName);
    if(!duels[rowName]) duels[rowName]={};
    const [k,d]=kd.split('/');
    duels[rowName][colName]={kills:parseInt(k,10)||0,deaths:parseInt(d,10)||0};
  }
  const list=[...players].sort();
  list.forEach(r=>{ if(!duels[r]) duels[r]={}; list.forEach(c=>{ if(!duels[r][c]) duels[r][c]={kills:0,deaths:0}; }); });
  return { playerRows:list, playerCols:list, duels };
}

function num(v){ const n=parseFloat(v); return isNaN(n)?0:n; }
function numOrNull(v){ if(v===null||v===undefined) return null; const n=parseFloat(v); return isNaN(n)?null:n; }
function pct(a,b){ if(!b) return 0; return parseFloat(((a/b)*100).toFixed(2)); }
function safeAvg(a,b){ if(!b) return 0; return parseFloat((a/b).toFixed(2)); }
function isoDate(d){ if(!d) return null; try { return (typeof d==='string'? new Date(d):d).toISOString().split('T')[0]; } catch(_){ return null; } }

async function generateAggregates(pool, opts = {}) {
  loadCanonicalNames();
  if (opts.seasonStart) {
    sezonbaslangic = opts.seasonStart;
  }
  const seasonStarts = normalizeSeasonStarts(opts.seasonStarts, sezonbaslangic);
  const qset = buildQueries(sezonbaslangic);
  const out = {};
  const seasonAvgPeriods = await buildSeasonAvgPeriodsDataset(pool, sezonbaslangic, seasonStarts);
  out.season_avg_periods = seasonAvgPeriods;
  out.season_avg = seasonAvgPeriods.data?.[seasonAvgPeriods.current_period] || [];
  // last10
  let last10Rows = [];
  try { last10Rows = (await pool.query(qset.last10)).rows; } catch (e) { console.error('[statsGenerator] last10 (aggregates) failed', e.message); }
  out.last10 = last10Rows.map(r => ({ steam_id: r.steam_id, name: normalizedName(r.steam_id, r.name), hltv_2: num(r.hltv_2), adr: num(r.adr), kd: num(r.kd), mvp: num(r.mvp), kills: num(r.kills), deaths: num(r.deaths), assists: num(r.assists), hs: num(r.headshot_kills), hs_ratio: num(r.headshot_killratio), first_kill: num(r.first_kill_count), first_death: num(r.first_death_count), bomb_planted: num(r.bomb_planted), bomb_defused: num(r.bomb_defused), hltv: num(r.hltv), kast: num(r.kast), utl_dmg: num(r.utl_dmg), two_kills: num(r.two_kills), three_kills: num(r.three_kills), four_kills: num(r.four_kills), five_kills: num(r.five_kills), matches: num(r.matches_in_interval), win_rate: num(r.win_rate_percentage), avg_clutches: safeAvg(num(r.total_clutches), num(r.matches_in_interval)), avg_clutches_won: safeAvg(num(r.total_clutches_won), num(r.matches_in_interval)), clutch_success: pct(num(r.total_clutches_won), num(r.total_clutches)) }));
  return out;
}

module.exports = { generateAll, generateAggregates, clearHistoricalCache };
