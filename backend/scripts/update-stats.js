// Backend stats generation script (full dataset coverage)
// Generates: season_avg.json, night_avg.json, last10.json, sonmac_by_date.json,
//            duello_son_mac.json, duello_sezon.json, performance_data.json

const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const API_ENDPOINT = process.env.INTERNAL_EXECUTE_QUERY_URL || 'http://localhost:3000/execute-query';
const MW_TOKEN = process.env.AUTH_TOKEN || process.env.MW_TOKEN;
const sezonbaslangic = process.env.SEZON_BASLANGIC || '2025-06-09';

function q(s){return s}
const selectClause = q(`
          AVG(p1.hltv_rating_2) AS HLTV_2,
          AVG(p1.average_damage_per_round) AS adr,
          AVG(p1.kill_count) AS KILLS,
          AVG(p1.death_count) AS DEATHS,
          AVG(p1.assist_count) AS ASSISTS,
          AVG(p1.kill_death_ratio) AS KD,
          AVG(p1.headshot_count) AS Headshot_kills,
          AVG(p1.headshot_percentage) AS Headshot_killratio,
          AVG(p1.first_kill_count) AS first_kill_count,
          AVG(p1.first_death_count) AS first_death_count,
          AVG(p1.bomb_planted_count) AS bomb_planted,
          AVG(p1.bomb_defused_count) AS bomb_defused,
          AVG(p1.hltv_rating) AS HLTV,
          AVG(p1.mvp_count) AS MVP,
          AVG(p1.kast) AS KAST,
          AVG(p1.utility_damage) AS UTL_DMG,
          AVG(p1.two_kill_count) AS two_kills,
          AVG(p1.three_kill_count) AS three_kills,
          AVG(p1.four_kill_count) AS four_kills,
          AVG(p1.five_kill_count) AS five_kills,
          AVG(p1.score) AS SCORE,
          `);

const queries = {
  seasonAvg: q(`
         WITH match_date_info AS (
            SELECT MAX(matches.date::date) AS latest_match_date 
            FROM matches
        ),
        season_start_info AS (
            SELECT '${sezonbaslangic}'::date AS seasonstart
        ),
        match_agg AS (
            SELECT
              p1.steam_id,
              MAX(p1.name) AS name,
              ${selectClause}
              (SELECT latest_match_date FROM match_date_info) AS latest_match_date,
              COUNT(*) AS matches_in_interval,
              COUNT(CASE WHEN matches.winner_name = p1.team_name THEN 1 END) AS win_count,
              ROUND(
                  (COUNT(CASE WHEN matches.winner_name = p1.team_name THEN 1 END)::numeric 
                  / COUNT(*) * 100)
                  , 2
              ) AS win_rate_percentage
            FROM players AS p1
            INNER JOIN matches ON p1.match_checksum = matches.checksum
            WHERE 
                matches.date::date BETWEEN 
                    (SELECT seasonstart FROM season_start_info) 
                    (SELECT latest_match_date FROM match_date_info)
            GROUP BY p1.steam_id
        ),
        clutch_agg AS (
            SELECT
              c.clutcher_steam_id AS steam_id,
              COUNT(*)::numeric AS total_clutches,
              COUNT(CASE WHEN c.won = TRUE THEN 1 END)::numeric AS total_clutches_won
            FROM clutches c
            JOIN matches m ON c.match_checksum = m.checksum
            WHERE m.date::date BETWEEN 
                    (SELECT seasonstart FROM season_start_info) 
                    AND 
                    (SELECT latest_match_date FROM match_date_info)
            GROUP BY c.clutcher_steam_id
        )
        SELECT
          m.*,
          ROUND(coalesce(c.total_clutches, 0) / m.matches_in_interval, 2) AS avg_clutches,
          ROUND(coalesce(c.total_clutches_won, 0) / m.matches_in_interval, 2) AS avg_clutches_won,
          CASE 
            WHEN coalesce(c.total_clutches, 0) = 0 THEN 0
            ELSE ROUND(c.total_clutches_won / c.total_clutches * 100, 2)
          END AS successful_clutch_percentage
        FROM match_agg m
        LEFT JOIN clutch_agg c ON m.steam_id = c.steam_id
        ORDER BY HLTV_2 DESC;`),
  nightAvg: q(`WITH season_start_info AS ( SELECT '${sezonbaslangic}'::date AS seasonstart ), player_stats_per_date AS ( SELECT p1.steam_id, MAX(p1.name) AS name, matches.date::date AS match_date, AVG(p1.hltv_rating_2) AS hltv_2, AVG(p1.average_damage_per_round) AS adr, AVG(p1.kill_death_ratio) AS kd, AVG(p1.mvp_count) AS mvp, AVG(p1.kill_count) AS kills, AVG(p1.death_count) AS deaths, AVG(p1.assist_count) AS assists, AVG(p1.headshot_count) AS headshot_kills, AVG(p1.headshot_percentage) AS headshot_killratio, AVG(p1.first_kill_count) AS first_kill_count, AVG(p1.first_death_count) AS first_death_count, AVG(p1.bomb_planted_count) AS bomb_planted, AVG(p1.bomb_defused_count) AS bomb_defused, AVG(p1.hltv_rating) AS hltv, AVG(p1.kast) AS kast, AVG(p1.utility_damage) AS utl_dmg, AVG(p1.two_kill_count) AS two_kills, AVG(p1.three_kill_count) AS three_kills, AVG(p1.four_kill_count) AS four_kills, AVG(p1.five_kill_count) AS five_kills, COUNT(*) AS matches_in_interval FROM players p1 INNER JOIN matches ON p1.match_checksum = matches.checksum WHERE matches.date::date >= (SELECT seasonstart FROM season_start_info) GROUP BY p1.steam_id, matches.date::date ), all_player_stats_per_date AS ( SELECT p1.steam_id, matches.date::date AS match_date, AVG(p1.hltv_rating_2) AS hltv_2, AVG(p1.average_damage_per_round) AS adr FROM players p1 INNER JOIN matches ON p1.match_checksum = matches.checksum GROUP BY p1.steam_id, matches.date::date ), prev_10_dates AS ( SELECT psd.steam_id, psd.match_date, ( SELECT array_agg(dates.match_date ORDER BY dates.match_date DESC) FROM ( SELECT DISTINCT m.date::date AS match_date FROM matches m WHERE m.date::date < psd.match_date ORDER BY m.date::date DESC LIMIT 10 ) dates ) AS prev_dates FROM player_stats_per_date psd ), prev_10_agg AS ( SELECT p10.steam_id, p10.match_date, AVG(hist.hltv_2) AS hltv_2_10, AVG(hist.adr) AS adr_10 FROM prev_10_dates p10 LEFT JOIN all_player_stats_per_date hist ON hist.steam_id = p10.steam_id AND hist.match_date = ANY(p10.prev_dates) GROUP BY p10.steam_id, p10.match_date ), clutches_stats AS ( SELECT c.clutcher_steam_id AS steam_id, m.date::date AS match_date, COUNT(*) AS clutches, SUM(CASE WHEN c.won THEN 1 ELSE 0 END) AS clutches_won FROM clutches c INNER JOIN matches m ON c.match_checksum = m.checksum WHERE m.date::date >= (SELECT seasonstart FROM season_start_info) GROUP BY c.clutcher_steam_id, m.date::date ) SELECT psd.steam_id, psd.name, psd.match_date, psd.hltv_2, psd.adr, psd.kd, psd.mvp, psd.kills, psd.deaths, psd.assists, psd.headshot_kills, psd.headshot_killratio, psd.first_kill_count, psd.first_death_count, psd.bomb_planted, psd.bomb_defused, psd.hltv, psd.kast, psd.utl_dmg, psd.two_kills, psd.three_kills, psd.four_kills, psd.five_kills, psd.matches_in_interval, COALESCE(p10a.hltv_2_10, 0) AS hltv_2_10, (psd.hltv_2 - COALESCE(p10a.hltv_2_10, 0)) AS hltv_2_diff, COALESCE(p10a.adr_10, 0) AS adr_10, (psd.adr - COALESCE(p10a.adr_10, 0)) AS adr_diff, COALESCE(cs.clutches, 0) AS clutches, COALESCE(cs.clutches_won, 0) AS clutches_won FROM player_stats_per_date psd LEFT JOIN prev_10_agg p10a ON psd.steam_id = p10a.steam_id AND psd.match_date = p10a.match_date LEFT JOIN clutches_stats cs ON psd.steam_id = cs.steam_id AND psd.match_date = cs.match_date ORDER BY psd.match_date ASC, psd.hltv_2 DESC;`),
  last10: q(`WITH last_x_dates AS ( SELECT DISTINCT matches.date::date AS unique_date FROM matches ORDER BY unique_date DESC LIMIT 10 ), date_range AS ( SELECT MIN(unique_date) AS x_days_before, MAX(unique_date) AS latest_match_date FROM last_x_dates ), match_agg AS ( SELECT p1.steam_id, MAX(p1.name) AS name, ${selectClause} (SELECT latest_match_date::date FROM date_range) AS latest_match_date, COUNT(*) AS matches_in_interval, ROUND( (COUNT(CASE WHEN matches.winner_name = p1.team_name THEN 1 END)::numeric / COUNT(*) * 100) , 2 ) AS win_rate_percentage FROM players AS p1 INNER JOIN matches ON p1.match_checksum = matches.checksum WHERE matches.date::date BETWEEN (SELECT x_days_before FROM date_range) AND (SELECT latest_match_date FROM date_range) GROUP BY p1.steam_id ), clutch_agg AS ( SELECT c.clutcher_steam_id AS steam_id, COUNT(*)::numeric AS total_clutches, COUNT(CASE WHEN c.won = TRUE THEN 1 END)::numeric AS total_clutches_won FROM clutches c JOIN matches m ON c.match_checksum = m.checksum WHERE m.date::date BETWEEN (SELECT x_days_before FROM date_range) AND (SELECT latest_match_date FROM date_range) GROUP BY c.clutcher_steam_id ) SELECT m.*, ROUND(coalesce(c.total_clutches, 0) / m.matches_in_interval, 2) AS avg_clutches, ROUND(coalesce(c.total_clutches_won, 0) / m.matches_in_interval, 2) AS avg_clutches_won, CASE WHEN coalesce(c.total_clutches, 0) = 0 THEN 0 ELSE ROUND(c.total_clutches_won / c.total_clutches * 100, 2) END AS successful_clutch_percentage FROM match_agg m LEFT JOIN clutch_agg c ON m.steam_id = c.steam_id ORDER BY HLTV_2 DESC;`),
  sonmac: q(`WITH match_date_info AS ( SELECT MAX(matches.date::date) AS latest_match_date  FROM matches ), season_start_info AS ( SELECT '${sezonbaslangic}'::date AS seasonstart ) SELECT matches.date::date AS match_date, matches.map_name, teams.name AS team_name, p1.name, p1.steam_id, teams.score AS team_score, ${selectClause} COALESCE(c.num_clutches, 0) AS number_of_clutches, COALESCE(c.num_successful_clutches, 0) AS number_of_successful_clutches, (SELECT latest_match_date::date FROM match_date_info) AS latest_match_date FROM players AS p1 INNER JOIN matches ON p1.match_checksum = matches.checksum INNER JOIN teams  ON matches.checksum = teams.match_checksum  AND p1.team_name = teams.name LEFT JOIN ( SELECT  match_checksum,  clutcher_steam_id,  COUNT(*) AS num_clutches, SUM(CASE WHEN won THEN 1 ELSE 0 END) AS num_successful_clutches FROM clutches GROUP BY match_checksum, clutcher_steam_id ) AS c  ON c.match_checksum = matches.checksum  AND c.clutcher_steam_id = p1.steam_id WHERE  matches.date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) GROUP BY matches.date::date, matches.map_name, teams.name, teams.score, p1.steam_id, p1.name, c.num_clutches, c.num_successful_clutches ORDER BY matches.date::date DESC, matches.map_name, teams.name, HLTV_2 DESC;`),
  duello_son_mac: q(`WITH last_x_dates AS ( SELECT DISTINCT matches.date::date AS unique_date FROM matches ORDER BY unique_date DESC LIMIT 1 ), date_range AS ( SELECT MIN(unique_date) AS x_days_before, MAX(unique_date) AS latest_match_date FROM last_x_dates ), last_date_matches AS ( SELECT checksum FROM matches WHERE date::date = (SELECT latest_match_date FROM date_range) ), player_kills_deaths AS ( SELECT p1.steam_id AS killerSteamId, MIN(COALESCE(p1_overrides.name, p1.name)) AS killerName, p2.steam_id AS victimSteamId, MIN(COALESCE(p2_overrides.name, p2.name)) AS victimName, ( SELECT COUNT(*) FROM kills k WHERE k.killer_steam_id = p1.steam_id AND k.victim_steam_id = p2.steam_id AND k.match_checksum IN (SELECT checksum FROM last_date_matches) ) AS killCount, ( SELECT COUNT(*) FROM kills k2 WHERE k2.killer_steam_id = p2.steam_id AND k2.victim_steam_id = p1.steam_id AND k2.match_checksum IN (SELECT checksum FROM last_date_matches) ) AS deathCount FROM players p1 LEFT JOIN steam_account_overrides p1_overrides ON p1.steam_id = p1_overrides.steam_id INNER JOIN teams t1 ON p1.match_checksum = t1.match_checksum AND p1.team_name = t1.name INNER JOIN players p2 ON p1.match_checksum = p2.match_checksum LEFT JOIN steam_account_overrides p2_overrides ON p2.steam_id = p2_overrides.steam_id INNER JOIN teams t2 ON p2.match_checksum = t2.match_checksum AND p2.team_name = t2.name WHERE p1.match_checksum IN (SELECT checksum FROM last_date_matches) AND p2.match_checksum IN (SELECT checksum FROM last_date_matches) AND p1.team_name <> p2.team_name GROUP BY p1.steam_id, p2.steam_id ), distinct_players AS ( SELECT DISTINCT killerSteamId AS playerSteamId, killerName AS playerName FROM player_kills_deaths UNION SELECT DISTINCT victimSteamId, victimName FROM player_kills_deaths ) SELECT dp1.playerName AS PlayerRow, dp2.playerName AS PlayerColumn, COALESCE(pkd.killCount, 0) || '/' || COALESCE(pkd.deathCount, 0) AS KillDeathRatio FROM distinct_players dp1 CROSS JOIN distinct_players dp2 LEFT JOIN player_kills_deaths pkd ON dp1.playerSteamId = pkd.killerSteamId AND dp2.playerSteamId = pkd.victimSteamId ORDER BY dp1.playerName, dp2.playerName;`),
  duello_sezon: q(`WITH match_date_info AS ( SELECT MAX(matches.date::date) AS latest_match_date FROM matches ), season_start_info AS ( SELECT '${sezonbaslangic}'::date AS seasonstart ), season_matches AS ( SELECT checksum FROM matches WHERE date::date >= (SELECT seasonstart FROM season_start_info) AND date::date <= (SELECT latest_match_date FROM match_date_info) ), consistent_player_names AS ( SELECT p.steam_id, MAX(COALESCE(po.name, p.name)) AS playerName FROM players p LEFT JOIN steam_account_overrides po ON p.steam_id = po.steam_id GROUP BY p.steam_id ), player_kills_deaths AS ( SELECT p1.steam_id AS killerSteamId, cpn1.playerName AS killerName, p2.steam_id AS victimSteamId, cpn2.playerName AS victimName, ( SELECT COUNT(*) FROM kills k WHERE k.killer_steam_id = p1.steam_id AND k.victim_steam_id = p2.steam_id AND k.match_checksum IN (SELECT checksum FROM season_matches) ) AS killCount, ( SELECT COUNT(*) FROM kills k2 WHERE k2.killer_steam_id = p2.steam_id AND k2.victim_steam_id = p1.steam_id AND k2.match_checksum IN (SELECT checksum FROM season_matches) ) AS deathCount FROM players p1 INNER JOIN teams t1 ON p1.match_checksum = t1.match_checksum AND p1.team_name = t1.name INNER JOIN players p2 ON p1.match_checksum = p2.match_checksum INNER JOIN teams t2 ON p2.match_checksum = t2.match_checksum AND p2.team_name = t2.name INNER JOIN consistent_player_names cpn1 ON p1.steam_id = cpn1.steam_id INNER JOIN consistent_player_names cpn2 ON p2.steam_id = cpn2.steam_id WHERE p1.match_checksum IN (SELECT checksum FROM season_matches) AND p2.match_checksum IN (SELECT checksum FROM season_matches) AND p1.team_name <> p2.team_name GROUP BY p1.steam_id, cpn1.playerName, p2.steam_id, cpn2.playerName ), distinct_players AS ( SELECT DISTINCT killerSteamId AS playerSteamId, killerName AS playerName FROM player_kills_deaths UNION SELECT DISTINCT victimSteamId, victimName FROM player_kills_deaths ) SELECT dp1.playerName AS PlayerRow, dp2.playerName AS PlayerColumn, COALESCE(pkd.killCount, 0) || '/' || COALESCE(pkd.deathCount, 0) AS KillDeathRatio FROM distinct_players dp1 CROSS JOIN distinct_players dp2 LEFT JOIN player_kills_deaths pkd ON dp1.playerSteamId = pkd.killerSteamId AND dp2.playerSteamId = pkd.victimSteamId ORDER BY dp1.playerName, dp2.playerName;`),
  performanceGraphs: q(`WITH season_start_info AS ( SELECT '${sezonbaslangic}'::date AS seasonstart ), match_date_info AS ( SELECT MAX(date::date) AS latest_match_date  FROM matches ), match_dates AS ( SELECT DISTINCT date::date AS match_date FROM matches WHERE date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) ), distinct_players AS ( SELECT steam_id, MAX(name) AS name FROM players GROUP BY steam_id ), performance_data AS ( SELECT p.steam_id, m.date::date AS match_date, AVG(p.hltv_rating_2) AS HLTV_2, AVG(p.average_damage_per_round) AS adr, COUNT(*) AS matches_played FROM players p INNER JOIN matches m ON p.match_checksum = m.checksum WHERE m.date::date BETWEEN (SELECT seasonstart FROM season_start_info) AND (SELECT latest_match_date FROM match_date_info) GROUP BY p.steam_id, m.date::date ) SELECT dp.steam_id, dp.name, md.match_date::date, pd.HLTV_2, pd.adr, pd.matches_played FROM distinct_players dp CROSS JOIN match_dates md LEFT JOIN performance_data pd ON pd.steam_id = dp.steam_id AND pd.match_date = md.match_date ORDER BY dp.name, md.match_date;`)
};

async function executeDbQuery(dbQuery){
  const res = await fetch(API_ENDPOINT, {method:'POST', headers:{'Content-Type':'application/json', 'Authorization':`Bearer ${MW_TOKEN}`}, body: JSON.stringify({query: dbQuery})});
  if(!res.ok) throw new Error('DB query failed '+res.status);
  return res.json();
}

function ensureDataDir(){
  const dataDir = path.join(__dirname, '..', 'data');
  if(!fs.existsSync(dataDir)) fs.mkdirSync(dataDir,{recursive:true});
  return dataDir;
}

// SEASON AVG
async function updateSeasonAvg(){
  try {
    const result = await executeDbQuery(queries.seasonAvg);
    if(!result.rows?.length){
      fs.writeFileSync(path.join(ensureDataDir(),'season_avg.json'), JSON.stringify([],null,2));
      return;
    }
    const columnMap={}; result.columns.forEach((c,i)=>columnMap[c.toLowerCase()]=i);
    const get=(row,col,def=0)=>{const idx=columnMap[col.toLowerCase()]; if(idx===undefined) return def; const v=row[idx]; const n=parseFloat(v); return isNaN(n)?def:n};
    const transformed = result.rows.map(r=>({
      steam_id: r[columnMap['steam_id']],
      name: r[columnMap['name']],
      hltv_2: get(r,'hltv_2'), adr: get(r,'adr'), kd: get(r,'kd'), mvp: get(r,'mvp'),
      kills: get(r,'kills'), deaths: get(r,'deaths'), assists: get(r,'assists'), hs: get(r,'headshot_kills'), hs_ratio: get(r,'headshot_killratio'),
      first_kill: get(r,'first_kill_count'), first_death: get(r,'first_death_count'), bomb_planted: get(r,'bomb_planted'), bomb_defused: get(r,'bomb_defused'),
      hltv: get(r,'hltv'), kast: get(r,'kast'), utl_dmg: get(r,'utl_dmg'), two_kills: get(r,'two_kills'), three_kills: get(r,'three_kills'), four_kills: get(r,'four_kills'), five_kills: get(r,'five_kills'),
      matches: get(r,'matches_in_interval'), win_rate: get(r,'win_rate_percentage'), avg_clutches: get(r,'avg_clutches'), avg_clutches_won: get(r,'avg_clutches_won'), clutch_success: get(r,'successful_clutch_percentage')
    }));
    fs.writeFileSync(path.join(ensureDataDir(),'season_avg.json'), JSON.stringify(transformed,null,2));
  } catch(e){ console.error('Season avg generation failed', e);}  
}

// NIGHT AVG
async function updateNightAvg(){
  try {
    const result = await executeDbQuery(queries.nightAvg);
    if(!result.rows?.length){
      fs.writeFileSync(path.join(ensureDataDir(),'night_avg.json'), JSON.stringify({},null,2));
      return;
    }
    const columnMap={}; result.columns.forEach((c,i)=>columnMap[c.toLowerCase()]=i);
    const grouped={};
    for(const row of result.rows){
      const raw=row[columnMap['match_date']]; if(!raw) continue; let dateKey= typeof raw==='string'?raw.split('T')[0]: new Date(raw).toISOString().split('T')[0]; if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateKey)) continue;
      if(!grouped[dateKey]) grouped[dateKey]=[];
      const get=(col,def=0)=>{const idx=columnMap[col.toLowerCase()]; const v= idx===undefined?def:row[idx]; const n=parseFloat(v); return isNaN(n)?def:n};
      grouped[dateKey].push({ steam_id: row[columnMap['steam_id']], name: row[columnMap['name']], 'HLTV 2': get('hltv_2'), 'ADR': get('adr'), 'K/D': get('kd'), 'MVP': get('mvp'), 'Kills': get('kills'), 'Deaths': get('deaths'), 'Assists': get('assists'), 'HS': get('headshot_kills'), 'HS/Kill ratio': get('headshot_killratio'), 'First Kill': get('first_kill_count'), 'First Death': get('first_death_count'), 'Bomb Planted': get('bomb_planted'), 'Bomb Defused': get('bomb_defused'), 'HLTV': get('hltv'), 'KAST': get('kast'), 'Utility Damage': get('utl_dmg'), '2 kills': get('two_kills'), '3 kills': get('three_kills'), '4 kills': get('four_kills'), '5 kills': get('five_kills'), 'Nr of Matches': get('matches_in_interval'), 'HLTV2 DIFF': get('hltv_2_diff'), 'ADR DIFF': get('adr_diff'), 'Clutch Opportunity': get('clutches'), 'Clutches Won': get('clutches_won') });
    }
    fs.writeFileSync(path.join(ensureDataDir(),'night_avg.json'), JSON.stringify(grouped,null,2));
  } catch(e){ console.error('Night avg generation failed', e);}  
}

// LAST10
async function updateLast10(){
  try {
    const result = await executeDbQuery(queries.last10);
    if(!result.rows?.length){ fs.writeFileSync(path.join(ensureDataDir(),'last10.json'), JSON.stringify([],null,2)); return; }
    const columnMap={}; result.columns.forEach((c,i)=>columnMap[c.toLowerCase()]=i);
    const get=(row,col,def=0)=>{const idx=columnMap[col.toLowerCase()]; const v= idx===undefined?def:row[idx]; const n=parseFloat(v); return isNaN(n)?def:n};
    const transformed = result.rows.map(r=>({ steam_id: r[columnMap['steam_id']], name: r[columnMap['name']], hltv_2: get(r,'hltv_2'), adr: get(r,'adr'), kd: get(r,'kd'), mvp: get(r,'mvp'), kills: get(r,'kills'), deaths: get(r,'deaths'), assists: get(r,'assists'), hs: get(r,'headshot_kills'), hs_ratio: get(r,'headshot_killratio'), first_kill: get(r,'first_kill_count'), first_death: get(r,'first_death_count'), bomb_planted: get(r,'bomb_planted'), bomb_defused: get(r,'bomb_defused'), hltv: get(r,'hltv'), kast: get(r,'kast'), utl_dmg: get(r,'utl_dmg'), two_kills: get(r,'two_kills'), three_kills: get(r,'three_kills'), four_kills: get(r,'four_kills'), five_kills: get(r,'five_kills'), matches: get(r,'matches_in_interval'), win_rate: get(r,'win_rate_percentage'), avg_clutches: get(r,'avg_clutches'), avg_clutches_won: get(r,'avg_clutches_won'), clutch_success: get(r,'successful_clutch_percentage') }));
    fs.writeFileSync(path.join(ensureDataDir(),'last10.json'), JSON.stringify(transformed,null,2));
  } catch(e){ console.error('Last10 generation failed', e);}  
}

// SONMAC (by date)
async function updateSonMac(){
  try {
    const result = await executeDbQuery(queries.sonmac);
    if(!result.rows?.length){ fs.writeFileSync(path.join(ensureDataDir(),'sonmac_by_date.json'), JSON.stringify({},null,2)); return; }
    const columnMap={}; result.columns.forEach((c,i)=>columnMap[c.toLowerCase()]=i);
    const allDatesData={};
    for(const row of result.rows){
      const raw=row[columnMap['match_date']]; if(!raw) continue; let dateKey= typeof raw==='string'?raw.split('T')[0]: new Date(raw).toISOString().split('T')[0]; if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateKey)) continue;
      if(!allDatesData[dateKey]) allDatesData[dateKey]={ maps:{} };
      const mapsData=allDatesData[dateKey].maps; const mapName=row[columnMap['map_name']]; const teamName=row[columnMap['team_name']]; const teamScore=row[columnMap['team_score']];
      if(!mapsData[mapName]) mapsData[mapName]={ team1:null, team2:null };
      let teamKey=null; if(mapsData[mapName].team1===null || mapsData[mapName].team1?.name===teamName) teamKey='team1'; else if(mapsData[mapName].team2===null || mapsData[mapName].team2?.name===teamName) teamKey='team2'; else continue;
      if(!mapsData[mapName][teamKey]) mapsData[mapName][teamKey]={ name:teamName, score: teamScore, players:[] }; else mapsData[mapName][teamKey].score=teamScore;
      const get=(col,def=0)=>{const idx=columnMap[col.toLowerCase()]; const v= idx===undefined?def:row[idx]; const n=parseFloat(v); return isNaN(n)?def:n};
      mapsData[mapName][teamKey].players.push({ name: row[columnMap['name']], steam_id: row[columnMap['steam_id']], hltv_2: get('hltv_2'), adr: get('adr'), kd: get('kd'), mvp: get('mvp'), kills: get('kills'), deaths: get('deaths'), assists: get('assists'), hs: get('headshot_kills'), hs_ratio: get('headshot_killratio'), first_kill: get('first_kill_count'), first_death: get('first_death_count'), bomb_planted: get('bomb_planted'), bomb_defused: get('bomb_defused'), hltv: get('hltv'), kast: get('kast'), utl_dmg: get('utl_dmg'), two_kills: get('two_kills'), three_kills: get('three_kills'), four_kills: get('four_kills'), five_kills: get('five_kills'), score: get('score'), clutches: get('number_of_clutches',0), clutches_won: get('number_of_successful_clutches',0) });
    }
    fs.writeFileSync(path.join(ensureDataDir(),'sonmac_by_date.json'), JSON.stringify(allDatesData,null,2));
  } catch(e){ console.error('Sonmac generation failed', e);}  
}

// DUELLO (last match)
async function updateDuelloSonMac(){
  try {
    const result = await executeDbQuery(queries.duello_son_mac);
    if(!result.rows?.length){ fs.writeFileSync(path.join(ensureDataDir(),'duello_son_mac.json'), JSON.stringify({playerRows:[],playerCols:[],duels:{}},null,2)); return; }
    const columnMap={}; result.columns.forEach((c,i)=>columnMap[c.toLowerCase()]=i);
    const duelsData={}; const playerSet=new Set();
    for(const row of result.rows){
      const playerRow=row[columnMap['playerrow']]; const playerCol=row[columnMap['playercolumn']]; const kd=row[columnMap['killdeathratio']];
      playerSet.add(playerRow); playerSet.add(playerCol);
      if(!duelsData[playerRow]) duelsData[playerRow]={};
      const [kStr,dStr]=kd.split('/'); const kills=parseInt(kStr,10)||0; const deaths=parseInt(dStr,10)||0;
      duelsData[playerRow][playerCol]={kills,deaths};
    }
    const allPlayers=[...playerSet].sort(); allPlayers.forEach(r=>{ if(!duelsData[r]) duelsData[r]={}; allPlayers.forEach(c=>{ if(!duelsData[r][c]) duelsData[r][c]={kills:0,deaths:0}; }); });
    fs.writeFileSync(path.join(ensureDataDir(),'duello_son_mac.json'), JSON.stringify({playerRows:allPlayers, playerCols:allPlayers, duels:duelsData},null,2));
  } catch(e){ console.error('Duello son mac generation failed', e);}  
}

// DUELLO (season)
async function updateDuelloSezon(){
  try {
    const result = await executeDbQuery(queries.duello_sezon);
    if(!result.rows?.length){ fs.writeFileSync(path.join(ensureDataDir(),'duello_sezon.json'), JSON.stringify({playerRows:[],playerCols:[],duels:{}},null,2)); return; }
    const columnMap={}; result.columns.forEach((c,i)=>columnMap[c.toLowerCase()]=i);
    const duelsData={}; const playerSet=new Set();
    for(const row of result.rows){
      const playerRow=row[columnMap['playerrow']]; const playerCol=row[columnMap['playercolumn']]; const kd=row[columnMap['killdeathratio']];
      playerSet.add(playerRow); playerSet.add(playerCol);
      if(!duelsData[playerRow]) duelsData[playerRow]={};
      const [kStr,dStr]=kd.split('/'); const kills=parseInt(kStr,10)||0; const deaths=parseInt(dStr,10)||0;
      duelsData[playerRow][playerCol]={kills,deaths};
    }
    const allPlayers=[...playerSet].sort(); allPlayers.forEach(r=>{ if(!duelsData[r]) duelsData[r]={}; allPlayers.forEach(c=>{ if(!duelsData[r][c]) duelsData[r][c]={kills:0,deaths:0}; }); });
    fs.writeFileSync(path.join(ensureDataDir(),'duello_sezon.json'), JSON.stringify({playerRows:allPlayers, playerCols:allPlayers, duels:duelsData},null,2));
  } catch(e){ console.error('Duello sezon generation failed', e);}  
}

// PERFORMANCE GRAPHS
async function updatePerformanceGraphs(){
  try {
    const result = await executeDbQuery(queries.performanceGraphs);
    if(!result.rows?.length){ fs.writeFileSync(path.join(ensureDataDir(),'performance_data.json'), JSON.stringify([],null,2)); return; }
    const columnMap={}; result.columns.forEach((c,i)=>columnMap[c.toLowerCase()]=i);
    const grouped={};
    for(const row of result.rows){
      const name=row[columnMap['name']]; const steamId=row[columnMap['steam_id']]; const matchDate=row[columnMap['match_date']];
      const hRaw=row[columnMap['hltv_2']]; const aRaw=row[columnMap['adr']];
      const dateIso = matchDate? new Date(matchDate).toISOString(): null; if(!dateIso) continue;
      if(!grouped[name]) grouped[name]={ name, steam_id: steamId, performance: [] };
      const h = (hRaw===null||hRaw===undefined)?null: parseFloat(hRaw); const a=(aRaw===null||aRaw===undefined)?null: parseFloat(aRaw);
      grouped[name].performance.push({ match_date: dateIso, hltv_2: isNaN(h)?null:h, adr: isNaN(a)?null:a });
    }
    const finalData = Object.values(grouped).sort((a,b)=>a.name.localeCompare(b.name));
    fs.writeFileSync(path.join(ensureDataDir(),'performance_data.json'), JSON.stringify(finalData,null,2));
  } catch(e){ console.error('Performance graphs generation failed', e);}  
}

async function main(){
  console.log('[stats] Starting stats generation...');
  await updateSeasonAvg();
  await updateNightAvg();
  await updateLast10();
  await updateSonMac();
  await updateDuelloSonMac();
  await updateDuelloSezon();
  await updatePerformanceGraphs();
  console.log('[stats] Completed stats generation.');
}

main().catch(e=>{console.error(e);process.exit(1);});
