// In-memory stats generator (no filesystem writes)
// Returns all datasets used by the frontend.
// Uses direct pool queries for efficiency.

const fs = require('fs');
const path = require('path');

// Default will be overridden by caller passing options.seasonStart
let sezonbaslangic = process.env.SEZON_BASLANGIC || '2025-06-09';

// Canonical player names lookup
let canonicalNames = {};

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

// Build queries per invocation so updated seasonStart is reflected.
function buildQueries(seasonStart){
  return {
    seasonAvg: q(`WITH match_date_info AS (SELECT MAX(matches.date::date) AS latest_match_date FROM matches), season_start_info AS (SELECT '${seasonStart}'::date AS seasonstart), match_agg AS ( SELECT p1.steam_id, MAX(p1.name) AS name, AVG(p1.hltv_rating_2) AS hltv_2, AVG(p1.average_damage_per_round) AS adr, AVG(p1.kill_count) AS kills, AVG(p1.death_count) AS deaths, AVG(p1.assist_count) AS assists, AVG(p1.kill_death_ratio) AS kd, AVG(p1.headshot_count) AS headshot_kills, AVG(p1.headshot_percentage) AS headshot_killratio, AVG(p1.first_kill_count) AS first_kill_count, AVG(p1.first_death_count) AS first_death_count, AVG(p1.bomb_planted_count) AS bomb_planted, AVG(p1.bomb_defused_count) AS bomb_defused, AVG(p1.hltv_rating) AS hltv, AVG(p1.mvp_count) AS mvp, AVG(p1.kast) AS kast, AVG(p1.utility_damage) AS utl_dmg, AVG(p1.two_kill_count) AS two_kills, AVG(p1.three_kill_count) AS three_kills, AVG(p1.four_kill_count) AS four_kills, AVG(p1.five_kill_count) AS five_kills, AVG(p1.score) AS score, (SELECT latest_match_date FROM match_date_info) AS latest_match_date, COUNT(*) AS matches_in_interval, COUNT(CASE WHEN matches.winner_name = p1.team_name THEN 1 END) AS win_count, ROUND((COUNT(CASE WHEN matches.winner_name = p1.team_name THEN 1 END)::numeric / COUNT(*) * 100),2) AS win_rate_percentage FROM players p1 INNER JOIN matches ON p1.match_checksum = matches.checksum WHERE matches.date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) GROUP BY p1.steam_id ), clutch_agg AS ( SELECT c.clutcher_steam_id AS steam_id, COUNT(*)::numeric AS total_clutches, COUNT(CASE WHEN c.won THEN 1 END)::numeric AS total_clutches_won FROM clutches c JOIN matches m ON c.match_checksum = m.checksum GROUP BY c.clutcher_steam_id ) SELECT m.*, coalesce(c.total_clutches,0) AS total_clutches, coalesce(c.total_clutches_won,0) AS total_clutches_won FROM match_agg m LEFT JOIN clutch_agg c ON m.steam_id = c.steam_id`),
  nightAvg: q(`WITH season_start_info AS ( SELECT '${seasonStart}'::date AS seasonstart ), player_stats_per_date AS ( SELECT p1.steam_id, MAX(p1.name) AS name, matches.date::date AS match_date, AVG(p1.hltv_rating_2) AS hltv_2, AVG(p1.average_damage_per_round) AS adr, AVG(p1.kill_death_ratio) AS kd, AVG(p1.mvp_count) AS mvp, AVG(p1.kill_count) AS kills, AVG(p1.death_count) AS deaths, AVG(p1.assist_count) AS assists, AVG(p1.headshot_count) AS headshot_kills, AVG(p1.headshot_percentage) AS headshot_killratio, AVG(p1.first_kill_count) AS first_kill_count, AVG(p1.first_death_count) AS first_death_count, AVG(p1.bomb_planted_count) AS bomb_planted, AVG(p1.bomb_defused_count) AS bomb_defused, AVG(p1.hltv_rating) AS hltv, AVG(p1.kast) AS kast, AVG(p1.utility_damage) AS utl_dmg, AVG(p1.two_kill_count) AS two_kills, AVG(p1.three_kill_count) AS three_kills, AVG(p1.four_kill_count) AS four_kills, AVG(p1.five_kill_count) AS five_kills, COUNT(*) AS matches_in_interval FROM players p1 INNER JOIN matches ON p1.match_checksum = matches.checksum WHERE matches.date::date >= (SELECT seasonstart FROM season_start_info) GROUP BY p1.steam_id, matches.date::date ), all_player_stats_per_date AS ( SELECT p1.steam_id, matches.date::date AS match_date, AVG(p1.hltv_rating_2) AS hltv_2, AVG(p1.average_damage_per_round) AS adr FROM players p1 INNER JOIN matches ON p1.match_checksum = matches.checksum GROUP BY p1.steam_id, matches.date::date ), prev_10_dates AS ( SELECT psd.steam_id, psd.match_date, ( SELECT array_agg(dates.match_date ORDER BY dates.match_date DESC) FROM ( SELECT DISTINCT m.date::date AS match_date FROM matches m WHERE m.date::date < psd.match_date ORDER BY m.date::date DESC LIMIT 10 ) dates ) AS prev_dates FROM player_stats_per_date psd ), prev_10_agg AS ( SELECT p10.steam_id, p10.match_date, AVG(hist.hltv_2) AS hltv_2_10, AVG(hist.adr) AS adr_10 FROM prev_10_dates p10 LEFT JOIN all_player_stats_per_date hist ON hist.steam_id = p10.steam_id AND hist.match_date = ANY(p10.prev_dates) GROUP BY p10.steam_id, p10.match_date ), clutches_stats AS ( SELECT c.clutcher_steam_id AS steam_id, m.date::date AS match_date, COUNT(*) AS clutches, SUM(CASE WHEN c.won THEN 1 ELSE 0 END) AS clutches_won FROM clutches c INNER JOIN matches m ON c.match_checksum = m.checksum WHERE m.date::date >= (SELECT seasonstart FROM season_start_info) GROUP BY c.clutcher_steam_id, m.date::date ) SELECT psd.*, COALESCE(p10a.hltv_2_10,0) AS hltv_2_10, (psd.hltv_2-COALESCE(p10a.hltv_2_10,0)) AS hltv_2_diff, COALESCE(p10a.adr_10,0) AS adr_10, (psd.adr-COALESCE(p10a.adr_10,0)) AS adr_diff, COALESCE(cs.clutches,0) AS clutches, COALESCE(cs.clutches_won,0) AS clutches_won FROM player_stats_per_date psd LEFT JOIN prev_10_agg p10a ON psd.steam_id=p10a.steam_id AND psd.match_date=p10a.match_date LEFT JOIN clutches_stats cs ON psd.steam_id=cs.steam_id AND cs.match_date=psd.match_date ORDER BY psd.match_date ASC, psd.hltv_2 DESC`),
    last10: q(`WITH last_x_dates AS (SELECT DISTINCT matches.date::date AS unique_date FROM matches ORDER BY unique_date DESC LIMIT 10), date_range AS ( SELECT MIN(unique_date) AS x_days_before, MAX(unique_date) AS latest_match_date FROM last_x_dates ), match_agg AS ( SELECT p1.steam_id, MAX(p1.name) AS name, AVG(p1.hltv_rating_2) AS hltv_2, AVG(p1.average_damage_per_round) AS adr, AVG(p1.kill_count) AS kills, AVG(p1.death_count) AS deaths, AVG(p1.assist_count) AS assists, AVG(p1.kill_death_ratio) AS kd, AVG(p1.headshot_count) AS headshot_kills, AVG(p1.headshot_percentage) AS headshot_killratio, AVG(p1.first_kill_count) AS first_kill_count, AVG(p1.first_death_count) AS first_death_count, AVG(p1.bomb_planted_count) AS bomb_planted, AVG(p1.bomb_defused_count) AS bomb_defused, AVG(p1.hltv_rating) AS hltv, AVG(p1.mvp_count) AS mvp, AVG(p1.kast) AS kast, AVG(p1.utility_damage) AS utl_dmg, AVG(p1.two_kill_count) AS two_kills, AVG(p1.three_kill_count) AS three_kills, AVG(p1.four_kill_count) AS four_kills, AVG(p1.five_kill_count) AS five_kills, AVG(p1.score) AS score, (SELECT latest_match_date FROM date_range) AS latest_match_date, COUNT(*) AS matches_in_interval, ROUND((COUNT(CASE WHEN matches.winner_name = p1.team_name THEN 1 END)::numeric / COUNT(*) * 100),2) AS win_rate_percentage FROM players p1 INNER JOIN matches ON p1.match_checksum = matches.checksum WHERE matches.date::date BETWEEN (SELECT x_days_before FROM date_range) AND (SELECT latest_match_date FROM date_range) GROUP BY p1.steam_id ), clutch_agg AS ( SELECT c.clutcher_steam_id AS steam_id, COUNT(*)::numeric AS total_clutches, COUNT(CASE WHEN c.won THEN 1 END)::numeric AS total_clutches_won FROM clutches c JOIN matches m ON c.match_checksum = m.checksum WHERE m.date::date BETWEEN (SELECT x_days_before FROM date_range) AND (SELECT latest_match_date FROM date_range) GROUP BY c.clutcher_steam_id ) SELECT m.*, coalesce(c.total_clutches,0) AS total_clutches, coalesce(c.total_clutches_won,0) AS total_clutches_won FROM match_agg m LEFT JOIN clutch_agg c ON m.steam_id=c.steam_id`),
    sonmac: q(`WITH match_date_info AS ( SELECT MAX(matches.date::date) AS latest_match_date FROM matches ), season_start_info AS ( SELECT '${seasonStart}'::date AS seasonstart ) SELECT matches.date::date AS match_date, matches.map_name, teams.name AS team_name, p1.name, p1.steam_id, teams.score AS team_score, AVG(p1.hltv_rating_2) AS hltv_2, AVG(p1.average_damage_per_round) AS adr, AVG(p1.kill_count) AS kills, AVG(p1.death_count) AS deaths, AVG(p1.assist_count) AS assists, AVG(p1.kill_death_ratio) AS kd, AVG(p1.headshot_count) AS headshot_kills, AVG(p1.headshot_percentage) AS headshot_killratio, AVG(p1.first_kill_count) AS first_kill_count, AVG(p1.first_death_count) AS first_death_count, AVG(p1.bomb_planted_count) AS bomb_planted, AVG(p1.bomb_defused_count) AS bomb_defused, AVG(p1.hltv_rating) AS hltv, AVG(p1.mvp_count) AS mvp, AVG(p1.kast) AS kast, AVG(p1.utility_damage) AS utl_dmg, AVG(p1.two_kill_count) AS two_kills, AVG(p1.three_kill_count) AS three_kills, AVG(p1.four_kill_count) AS four_kills, AVG(p1.five_kill_count) AS five_kills, AVG(p1.score) AS score, COALESCE(c.num_clutches,0) AS number_of_clutches, COALESCE(c.num_successful_clutches,0) AS number_of_successful_clutches FROM players p1 INNER JOIN matches ON p1.match_checksum = matches.checksum INNER JOIN teams ON matches.checksum = teams.match_checksum AND p1.team_name = teams.name LEFT JOIN ( SELECT match_checksum, clutcher_steam_id, COUNT(*) AS num_clutches, SUM(CASE WHEN won THEN 1 ELSE 0 END) AS num_successful_clutches FROM clutches GROUP BY match_checksum, clutcher_steam_id ) c ON c.match_checksum = matches.checksum AND c.clutcher_steam_id = p1.steam_id WHERE matches.date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) GROUP BY matches.date::date, matches.map_name, teams.name, teams.score, p1.steam_id, p1.name, c.num_clutches, c.num_successful_clutches ORDER BY matches.date::date DESC, matches.map_name, teams.name, hltv_2 DESC`),
    sonmacRounds: q(`WITH match_date_info AS ( SELECT MAX(matches.date::date) AS latest_match_date FROM matches ), season_start_info AS ( SELECT '${seasonStart}'::date AS seasonstart ) SELECT matches.date::date AS match_date, matches.map_name, matches.checksum AS match_checksum, matches.max_rounds, rounds.number AS round_number, rounds.end_reason, rounds.winner_name, rounds.winner_side, rounds.team_a_name, rounds.team_b_name, rounds.team_a_side, rounds.team_b_side, rounds.team_a_score, rounds.team_b_score, rounds.overtime_number FROM rounds INNER JOIN matches ON rounds.match_checksum = matches.checksum WHERE matches.date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) ORDER BY matches.date::date DESC, matches.map_name, rounds.number ASC`),
    duello_son_mac: q(`WITH last_x_dates AS ( SELECT DISTINCT matches.date::date AS unique_date FROM matches ORDER BY unique_date DESC LIMIT 1 ), last_date_matches AS ( SELECT checksum FROM matches WHERE date::date = (SELECT MAX(unique_date) FROM last_x_dates) ), player_kills_deaths AS ( SELECT p1.steam_id AS killerSteamId, MIN(p1.name) AS killerName, p2.steam_id AS victimSteamId, MIN(p2.name) AS victimName, ( SELECT COUNT(*) FROM kills k WHERE k.killer_steam_id = p1.steam_id AND k.victim_steam_id = p2.steam_id AND k.match_checksum IN (SELECT checksum FROM last_date_matches) ) AS killCount, ( SELECT COUNT(*) FROM kills k2 WHERE k2.killer_steam_id = p2.steam_id AND k2.victim_steam_id = p1.steam_id AND k2.match_checksum IN (SELECT checksum FROM last_date_matches) ) AS deathCount FROM players p1 INNER JOIN players p2 ON p1.match_checksum = p2.match_checksum WHERE p1.match_checksum IN (SELECT checksum FROM last_date_matches) AND p2.match_checksum IN (SELECT checksum FROM last_date_matches) AND p1.team_name <> p2.team_name GROUP BY p1.steam_id, p2.steam_id ), distinct_players AS ( SELECT DISTINCT killerSteamId AS playerSteamId, killerName AS playerName FROM player_kills_deaths UNION SELECT DISTINCT victimSteamId, victimName FROM player_kills_deaths ) SELECT dp1.playerSteamId AS PlayerRowSteamId, dp1.playerName AS PlayerRow, dp2.playerSteamId AS PlayerColumnSteamId, dp2.playerName AS PlayerColumn, COALESCE(pkd.killCount,0)||'/'||COALESCE(pkd.deathCount,0) AS KillDeathRatio FROM distinct_players dp1 CROSS JOIN distinct_players dp2 LEFT JOIN player_kills_deaths pkd ON dp1.playerSteamId=pkd.killerSteamId AND dp2.playerSteamId=pkd.victimSteamId ORDER BY dp1.playerName, dp2.playerName`),
    duello_sezon: q(`WITH match_date_info AS ( SELECT MAX(matches.date::date) AS latest_match_date FROM matches ), season_start_info AS ( SELECT '${seasonStart}'::date AS seasonstart ), season_matches AS ( SELECT checksum FROM matches WHERE date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) ), player_kills_deaths AS ( SELECT p1.steam_id AS killerSteamId, MAX(p1.name) AS killerName, p2.steam_id AS victimSteamId, MAX(p2.name) AS victimName, ( SELECT COUNT(*) FROM kills k WHERE k.killer_steam_id = p1.steam_id AND k.victim_steam_id = p2.steam_id AND k.match_checksum IN (SELECT checksum FROM season_matches) ) AS killCount, ( SELECT COUNT(*) FROM kills k2 WHERE k2.killer_steam_id = p2.steam_id AND k2.victim_steam_id = p1.steam_id AND k2.match_checksum IN (SELECT checksum FROM season_matches) ) AS deathCount FROM players p1 INNER JOIN players p2 ON p1.match_checksum = p2.match_checksum WHERE p1.match_checksum IN (SELECT checksum FROM season_matches) AND p2.match_checksum IN (SELECT checksum FROM season_matches) AND p1.team_name <> p2.team_name GROUP BY p1.steam_id, p2.steam_id ), distinct_players AS ( SELECT DISTINCT killerSteamId AS playerSteamId, killerName AS playerName FROM player_kills_deaths UNION SELECT DISTINCT victimSteamId, victimName FROM player_kills_deaths ) SELECT dp1.playerSteamId AS PlayerRowSteamId, dp1.playerName AS PlayerRow, dp2.playerSteamId AS PlayerColumnSteamId, dp2.playerName AS PlayerColumn, COALESCE(pkd.killCount,0)||'/'||COALESCE(pkd.deathCount,0) AS KillDeathRatio FROM distinct_players dp1 CROSS JOIN distinct_players dp2 LEFT JOIN player_kills_deaths pkd ON dp1.playerSteamId=pkd.killerSteamId AND dp2.playerSteamId=pkd.victimSteamId ORDER BY dp1.playerName, dp2.playerName`),
    performanceGraphs: q(`WITH season_start_info AS ( SELECT '${seasonStart}'::date AS seasonstart ), match_date_info AS ( SELECT MAX(date::date) AS latest_match_date FROM matches ), match_dates AS ( SELECT DISTINCT date::date AS match_date FROM matches WHERE date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) ), distinct_players AS ( SELECT steam_id, MAX(name) AS name FROM players GROUP BY steam_id ), performance_data AS ( SELECT p.steam_id, m.date::date AS match_date, AVG(p.hltv_rating_2) AS hltv_2, AVG(p.average_damage_per_round) AS adr FROM players p INNER JOIN matches m ON p.match_checksum = m.checksum WHERE m.date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) GROUP BY p.steam_id, m.date::date ) SELECT dp.steam_id, dp.name, md.match_date::date, pd.hltv_2, pd.adr FROM distinct_players dp CROSS JOIN match_dates md LEFT JOIN performance_data pd ON pd.steam_id=dp.steam_id AND pd.match_date=md.match_date ORDER BY dp.name, md.match_date`)
  };
}

async function generateAll(pool, opts={}){
  loadCanonicalNames();
  if (opts.seasonStart) {
    sezonbaslangic = opts.seasonStart;
  }
  const results = {};
  // Season Avg
  const qset = buildQueries(sezonbaslangic);
  let seasonRows = [];
  let errors = [];
  try { seasonRows = (await pool.query(qset.seasonAvg)).rows; } catch(e){ console.error('[statsGenerator] seasonAvg query failed', e.message); errors.push({ dataset:'season_avg', error:e.message }); }
  results.season_avg = seasonRows.map(r=>({
    steam_id: r.steam_id, name: normalizedName(r.steam_id, r.name), hltv_2: num(r.hltv_2), adr: num(r.adr), kd: num(r.kd), mvp: num(r.mvp), kills: num(r.kills), deaths: num(r.deaths), assists: num(r.assists), hs: num(r.headshot_kills), hs_ratio: num(r.headshot_killratio), first_kill: num(r.first_kill_count), first_death: num(r.first_death_count), bomb_planted: num(r.bomb_planted), bomb_defused: num(r.bomb_defused), hltv: num(r.hltv), kast: num(r.kast), utl_dmg: num(r.utl_dmg), two_kills: num(r.two_kills), three_kills: num(r.three_kills), four_kills: num(r.four_kills), five_kills: num(r.five_kills), matches: num(r.matches_in_interval), win_rate: num(r.win_rate_percentage), avg_clutches: safeAvg(num(r.total_clutches), num(r.matches_in_interval)), avg_clutches_won: safeAvg(num(r.total_clutches_won), num(r.matches_in_interval)), clutch_success: pct(num(r.total_clutches_won), num(r.total_clutches)) }));
  // Night Avg
  let nightRows = [];
  try { nightRows = (await pool.query(qset.nightAvg)).rows; } catch(e){ console.error('[statsGenerator] nightAvg query failed', e.message); }
  const nightGrouped = {};
  for(const r of nightRows){
    const dateKey = isoDate(r.match_date); if(!dateKey) continue;
    if(!nightGrouped[dateKey]) nightGrouped[dateKey]=[];
    nightGrouped[dateKey].push({ steam_id:r.steam_id, name:normalizedName(r.steam_id, r.name), 'HLTV 2': num(r.hltv_2), 'ADR': num(r.adr), 'K/D': num(r.kd), 'MVP': num(r.mvp), 'Kills': num(r.kills), 'Deaths': num(r.deaths), 'Assists': num(r.assists), 'HS': num(r.headshot_kills), 'HS/Kill ratio': num(r.headshot_killratio), 'First Kill': num(r.first_kill_count), 'First Death': num(r.first_death_count), 'Bomb Planted': num(r.bomb_planted), 'Bomb Defused': num(r.bomb_defused), 'HLTV': num(r.hltv), 'KAST': num(r.kast), 'Utility Damage': num(r.utl_dmg), '2 kills': num(r.two_kills), '3 kills': num(r.three_kills), '4 kills': num(r.four_kills), '5 kills': num(r.five_kills), 'Nr of Matches': num(r.matches_in_interval), 'HLTV2 DIFF': num(r.hltv_2_diff), 'ADR DIFF': num(r.adr_diff), 'Clutch Opportunity': num(r.clutches), 'Clutches Won': num(r.clutches_won) });
  }
  results.night_avg = nightGrouped;
  // Last10
  let last10Rows = [];
  try { last10Rows = (await pool.query(qset.last10)).rows; } catch(e){ console.error('[statsGenerator] last10 query failed', e.message); }
  results.last10 = last10Rows.map(r=>({ steam_id:r.steam_id, name:r.name, hltv_2:num(r.hltv_2), adr:num(r.adr), kd:num(r.kd), mvp:num(r.mvp), kills:num(r.kills), deaths:num(r.deaths), assists:num(r.assists), hs:num(r.headshot_kills), hs_ratio:num(r.headshot_killratio), first_kill:num(r.first_kill_count), first_death:num(r.first_death_count), bomb_planted:num(r.bomb_planted), bomb_defused:num(r.bomb_defused), hltv:num(r.hltv), kast:num(r.kast), utl_dmg:num(r.utl_dmg), two_kills:num(r.two_kills), three_kills:num(r.three_kills), four_kills:num(r.four_kills), five_kills:num(r.five_kills), matches:num(r.matches_in_interval), win_rate:num(r.win_rate_percentage), avg_clutches: safeAvg(num(r.total_clutches), num(r.matches_in_interval)), avg_clutches_won: safeAvg(num(r.total_clutches_won), num(r.matches_in_interval)), clutch_success: pct(num(r.total_clutches_won), num(r.total_clutches)) }));
  // Sonmac by date
  let sonmacRows = [];
  try { sonmacRows = (await pool.query(qset.sonmac)).rows; } catch(e){ console.error('[statsGenerator] sonmac query failed', e.message); }
  const sonmacGrouped = {};
  for(const r of sonmacRows){
    const dateKey = isoDate(r.match_date); if(!dateKey) continue;
    if(!sonmacGrouped[dateKey]) sonmacGrouped[dateKey]={ maps:{} };
    const maps=sonmacGrouped[dateKey].maps; const map=r.map_name; const team=r.team_name; const teamScore=r.team_score;
    if(!maps[map]) maps[map]={ team1:null, team2:null, rounds: null };
    let slot = (!maps[map].team1 || maps[map].team1.name===team) ? 'team1' : (!maps[map].team2 || maps[map].team2.name===team ? 'team2': null);
    if(!slot) continue;
    if(!maps[map][slot]) maps[map][slot]={ name: team, score: teamScore, players: [] }; else maps[map][slot].score=teamScore;
    maps[map][slot].players.push({ name:normalizedName(r.steam_id, r.name), steam_id:r.steam_id, hltv_2:num(r.hltv_2), adr:num(r.adr), kd:num(r.kd), mvp:num(r.mvp), kills:num(r.kills), deaths:num(r.deaths), assists:num(r.assists), hs:num(r.headshot_kills), hs_ratio:num(r.headshot_killratio), first_kill:num(r.first_kill_count), first_death:num(r.first_death_count), bomb_planted:num(r.bomb_planted), bomb_defused:num(r.bomb_defused), hltv:num(r.hltv), kast:num(r.kast), utl_dmg:num(r.utl_dmg), two_kills:num(r.two_kills), three_kills:num(r.three_kills), four_kills:num(r.four_kills), five_kills:num(r.five_kills), score:num(r.score), clutches:num(r.number_of_clutches), clutches_won:num(r.number_of_successful_clutches) });
  }
  results.sonmac_by_date = sonmacGrouped;
  // Sonmac rounds
  let roundRows = [];
  try { roundRows = (await pool.query(qset.sonmacRounds)).rows; } catch(e){ console.error('[statsGenerator] sonmacRounds query failed', e.message); }
  const roundsGrouped = {};
  for (const r of roundRows) {
    const dateKey = isoDate(r.match_date); if (!dateKey) continue;
    if (!roundsGrouped[dateKey]) roundsGrouped[dateKey] = {};
    const map = r.map_name;
    if (!roundsGrouped[dateKey][map]) {
      roundsGrouped[dateKey][map] = {
        match_checksum: r.match_checksum,
        max_rounds: num(r.max_rounds),
        rounds: []
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
      overtime_number: num(r.overtime_number)
    });
  }
  for (const [dateKey, night] of Object.entries(sonmacGrouped)) {
    const maps = night.maps || {};
    for (const [mapName, mapData] of Object.entries(maps)) {
      const roundInfo = roundsGrouped?.[dateKey]?.[mapName];
      if (roundInfo) {
        mapData.rounds = roundInfo;
      }
    }
  }
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
  const perfGrouped = {};
  for(const r of perfRows){
    const name = normalizedName(r.steam_id, r.name); if(!perfGrouped[name]) perfGrouped[name]={ name, steam_id: r.steam_id, performance: [] };
    perfGrouped[name].performance.push({ match_date: r.match_date ? new Date(r.match_date).toISOString() : null, hltv_2: numOrNull(r.hltv_2), adr: numOrNull(r.adr) });
  }
  results.performance_data = Object.values(perfGrouped).sort((a,b)=>a.name.localeCompare(b.name));
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
  const qset = buildQueries(sezonbaslangic);
  const out = {};
  // season_avg
  let seasonRows = [];
  try { seasonRows = (await pool.query(qset.seasonAvg)).rows; } catch (e) { console.error('[statsGenerator] seasonAvg (aggregates) failed', e.message); }
  out.season_avg = seasonRows.map(r => ({
    steam_id: r.steam_id, name: normalizedName(r.steam_id, r.name), hltv_2: num(r.hltv_2), adr: num(r.adr), kd: num(r.kd), mvp: num(r.mvp), kills: num(r.kills), deaths: num(r.deaths), assists: num(r.assists), hs: num(r.headshot_kills), hs_ratio: num(r.headshot_killratio), first_kill: num(r.first_kill_count), first_death: num(r.first_death_count), bomb_planted: num(r.bomb_planted), bomb_defused: num(r.bomb_defused), hltv: num(r.hltv), kast: num(r.kast), utl_dmg: num(r.utl_dmg), two_kills: num(r.two_kills), three_kills: num(r.three_kills), four_kills: num(r.four_kills), five_kills: num(r.five_kills), matches: num(r.matches_in_interval), win_rate: num(r.win_rate_percentage), avg_clutches: safeAvg(num(r.total_clutches), num(r.matches_in_interval)), avg_clutches_won: safeAvg(num(r.total_clutches_won), num(r.matches_in_interval)), clutch_success: pct(num(r.total_clutches_won), num(r.total_clutches))
  }));
  // last10
  let last10Rows = [];
  try { last10Rows = (await pool.query(qset.last10)).rows; } catch (e) { console.error('[statsGenerator] last10 (aggregates) failed', e.message); }
  out.last10 = last10Rows.map(r => ({ steam_id: r.steam_id, name: normalizedName(r.steam_id, r.name), hltv_2: num(r.hltv_2), adr: num(r.adr), kd: num(r.kd), mvp: num(r.mvp), kills: num(r.kills), deaths: num(r.deaths), assists: num(r.assists), hs: num(r.headshot_kills), hs_ratio: num(r.headshot_killratio), first_kill: num(r.first_kill_count), first_death: num(r.first_death_count), bomb_planted: num(r.bomb_planted), bomb_defused: num(r.bomb_defused), hltv: num(r.hltv), kast: num(r.kast), utl_dmg: num(r.utl_dmg), two_kills: num(r.two_kills), three_kills: num(r.three_kills), four_kills: num(r.four_kills), five_kills: num(r.five_kills), matches: num(r.matches_in_interval), win_rate: num(r.win_rate_percentage), avg_clutches: safeAvg(num(r.total_clutches), num(r.matches_in_interval)), avg_clutches_won: safeAvg(num(r.total_clutches_won), num(r.matches_in_interval)), clutch_success: pct(num(r.total_clutches_won), num(r.total_clutches)) }));
  return out;
}

module.exports = { generateAll, generateAggregates };
