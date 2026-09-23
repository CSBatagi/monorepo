// Replays match history through src/lib/teamBalance.ts to check the team balancer.
// For every map, player ratings are rebuilt from maps played on earlier nights only,
// the same way the backend's player_ratings dataset would have looked that day.
//
//   cd frontend-nextjs && npm run backtest-team-balance
//
// Reads the committed season shards in public/data/stats-history/sonmac_by_date/ and
// the active season from runtime-data/sonmac_by_date_periods.json. Needs Node 22.18+
// (TypeScript type stripping) to import the model directly.
import fs from "fs/promises";
import path from "path";
import {
  analyzeBalance,
  indexPlayerRatings,
  normalizeMapKey,
  playerBalanceRating,
  winProbability,
} from "../src/lib/teamBalance.ts";

const root = process.cwd();
const runtimeDir = process.env.STATS_DATA_DIR || path.join(root, "runtime-data");
const historyDir = path.join(root, "public", "data", "stats-history", "sonmac_by_date");
const RATING_WINDOW = 150; // keep in sync with PLAYER_RATING_WINDOW in backend/statsGenerator.js
const WARMUP_NIGHTS = 10; // skip the first nights, when nobody has history yet

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf-8"));
}

async function loadNights() {
  const nights = {};
  for (const file of (await fs.readdir(historyDir)).sort()) {
    if (file.endsWith(".json")) Object.assign(nights, await readJson(path.join(historyDir, file)));
  }
  try {
    const current = await readJson(path.join(runtimeDir, "sonmac_by_date_periods.json"));
    for (const season of Object.values(current.data || {})) Object.assign(nights, season);
  } catch {
    console.warn("runtime-data/sonmac_by_date_periods.json not found; using completed seasons only");
  }
  return nights;
}

function ratingsAsOf(history, date) {
  const entries = [];
  for (const [steamId, maps] of history) {
    const prior = maps.filter((m) => m.date < date).slice(-RATING_WINDOW);
    if (!prior.length) continue;
    const entry = { steam_id: steamId, name: steamId, maps: 0, hltv_2_sum: 0, by_map: {} };
    for (const m of prior) {
      entry.maps += 1;
      entry.hltv_2_sum += m.hltv2;
      const onMap = (entry.by_map[m.map] ||= { maps: 0, hltv_2_sum: 0 });
      onMap.maps += 1;
      onMap.hltv_2_sum += m.hltv2;
    }
    entries.push(entry);
  }
  return indexPlayerRatings(entries);
}

function correlation(xs, ys) {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let cov = 0, vx = 0, vy = 0;
  xs.forEach((x, i) => { cov += (x - mx) * (ys[i] - my); vx += (x - mx) ** 2; vy += (ys[i] - my) ** 2; });
  return cov / Math.sqrt(vx * vy);
}

const nights = await loadNights();
const dates = Object.keys(nights).sort();
const history = new Map();
const results = [];
dates.forEach((date, nightNo) => {
  const index = ratingsAsOf(history, date);
  for (const [map, match] of Object.entries(nights[date].maps || {})) {
    const { team1, team2 } = match;
    if (!team1?.players?.length || !team2?.players?.length) continue;
    if (nightNo >= WARMUP_NIGHTS) {
      const keys = [normalizeMapKey(map)];
      const rows = (team) => team.players.map((p) => ({ steamId: p.steam_id, name: p.name, rating: playerBalanceRating(index, p.steam_id, keys).rating }));
      const report = analyzeBalance(rows(team1), rows(team2));
      const rounds = team1.score + team2.score;
      if (report && rounds > 0) results.push({ report, won: team1.score > team2.score, roundShare: team1.score / rounds });
    }
  }
  for (const [map, match] of Object.entries(nights[date].maps || {})) {
    for (const team of [match.team1, match.team2]) {
      for (const p of team?.players || []) {
        if (typeof p.hltv_2 !== "number") continue;
        if (!history.has(p.steam_id)) history.set(p.steam_id, []);
        history.get(p.steam_id).push({ date, map, hltv2: p.hltv_2 });
      }
    }
  }
});

const logLoss = results.reduce((sum, r) => {
  const p = winProbability(r.report.gap);
  return sum - Math.log(r.won ? p : 1 - p);
}, 0) / results.length;

console.log(`Maps scored: ${results.length} (${dates[WARMUP_NIGHTS]} → ${dates[dates.length - 1]})`);
console.log(`Correlation of power gap with round share: ${correlation(results.map((r) => r.report.gap), results.map((r) => r.roundShare)).toFixed(3)}`);
console.log(`Log loss: ${logLoss.toFixed(4)} (coin flip = 0.6931)`);
for (const verdict of ["balanced", "slight", "unbalanced"]) {
  const group = results.filter((r) => r.report.verdict === verdict);
  if (!group.length) continue;
  const favouriteWon = group.filter((r) => (r.report.gap > 0) === r.won).length / group.length;
  const predicted = group.reduce((sum, r) => sum + Math.max(r.report.probA, 1 - r.report.probA), 0) / group.length;
  console.log(`${verdict.padEnd(10)} maps=${String(group.length).padStart(3)}  favourite won ${(favouriteWon * 100).toFixed(0)}%  (model said ${(predicted * 100).toFixed(0)}%)`);
}
const flagged = results.filter((r) => r.report.suggestions.length);
const singleFix = flagged.filter((r) => r.report.suggestions.some((s) => s.toA.length <= 1 && s.toB.length <= 1 && Math.abs(s.gap) < 0.05));
console.log(`Picks that would have received a suggestion: ${flagged.length}/${results.length}; brought under 0.05 by one swap: ${singleFix.length}`);
