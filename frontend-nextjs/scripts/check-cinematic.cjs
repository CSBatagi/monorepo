// Data correctness and time-driven motion regressions; no backend or browser writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  const absolute = path.resolve(__dirname, '../', file);
  if (cache.has(absolute)) return cache.get(absolute);
  const output = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; cache.set(absolute, exports);
  vm.runInNewContext(output, { exports, require: name => load(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(absolute), name + '.ts'))), console });
  return exports;
}
const { summarizeLastNight, attendanceFields } = load('src/lib/cinematicBriefing.ts');
const period = data => ({ current_period: 'season_test', data: { season_test: data, all_time: { '2099-01-01': [] } } });
const payload = {
  night_avg_periods: period({ '2026-09-01': [{ name: 'Old leader', 'HLTV 2': 4 }], '2026-09-03': [{ name: 'Missing value', 'HLTV 2': null }, { name: 'Leader', steam_id: '1', 'HLTV 2': 1.6, ADR: 95, 'K/D': 1.4, 'HLTV2 DIFF': .3, 'ADR DIFF': 20 }, { name: 'Second', 'HLTV 2': 1.2, 'HLTV2 DIFF': -.1, 'ADR DIFF': -10 }] }),
  sonmac_by_date_periods: period({ '2026-09-03': { maps: { de_test: { team1: { name: 'A', score: 13 }, team2: { name: 'B', score: 8 } } } } }),
};
let summary = summarizeLastNight(payload);
assert.equal(summary.date, '2026-09-03');
assert.equal(summary.leaders[0].name, 'Leader');
assert.equal(summary.leaders.length, 1);
assert.equal(summary.bottom[0].name, 'Second');
assert.equal(summary.bottom[0].score, -17);
assert.equal(summary.maps[0].score1, 13);
assert.equal(summary.playerCount, 3);
summary = summarizeLastNight({ ...payload, sonmac_by_date_periods: period({ '2026-09-04': { maps: { de_new: { team1: { score: 0 }, team2: {} } } } }) });
assert.equal(summary.date, '2026-09-04');
assert.equal(summary.leaders.length, 0, 'Never show an older night’s leader alongside newer scores');
assert.equal(summary.maps[0].score1, 0);
assert.equal(summary.maps[0].score2, null, 'Missing scores must not turn into zero');
assert.equal(summarizeLastNight({}), null);
assert.equal(summarizeLastNight({ night_avg_periods: period({ '2026-09-05': [] }) }), null);
for (const status of ['uncertain', 'not_coming']) {
  assert.equal(attendanceFields(status).is_kaptan, false);
  assert.equal(attendanceFields(status).kaptan_timestamp, null);
}
assert.equal(attendanceFields('coming').is_kaptan, undefined, 'Joining must not overwrite captain state');
const actual = Object.fromEntries(['night_avg_periods', 'sonmac_by_date_periods'].map(key => [key, JSON.parse(fs.readFileSync(path.resolve(__dirname, '../runtime-data', key + '.json'), 'utf8'))]));
const result = summarizeLastNight(actual);
assert(result && result.date && result.maps.length && result.leaders.length, 'Committed runtime snapshot produces a real summary');
console.log('Briefing checks passed: latest date, rankings, same-night consistency, missing values, real snapshot, captain reset.');

const relative = summarizeLastNight({ night_avg_periods: period({ '2026-09-03': [
  { name: 'High raw, underperformed', 'HLTV 2': 1.8, ADR: 110, 'HLTV2 DIFF': -.5, 'ADR DIFF': -25 },
  { name: 'Low raw, overperformed', 'HLTV 2': .8, ADR: 60, 'HLTV2 DIFF': .2, 'ADR DIFF': 15 },
  { name: 'No history', 'HLTV 2': 2, ADR: 130, 'HLTV2 DIFF': 2, 'ADR DIFF': 130 },
  { name: 'Missing differences', 'HLTV 2': 3, ADR: 150 },
  { name: 'Zero', 'HLTV 2': 1, ADR: 80, 'HLTV2 DIFF': 0, 'ADR DIFF': 0 },
  ...[1,2,3,4].map(i => ({ name: `Negative ${i}`, 'HLTV 2': 1, ADR: 80, 'HLTV2 DIFF': -.1, 'ADR DIFF': -i })),
] }) });
assert.equal(relative.leaders[0].name, 'Low raw, overperformed');
assert.equal(relative.leaders[0].score, 29);
assert.equal(relative.bottom[0].name, 'High raw, underperformed');
assert.equal(relative.bottom[0].score, -60);
assert.equal(relative.bottom.length, 3);
assert(!relative.leaders.some(p => relative.bottom.includes(p)), 'No player is in both groups');
assert.equal(relative.rankedCount, 7, 'Missing baseline/differences excluded, zero retained but not awarded');
console.log('Relative performance checks passed: weighted differences, raw stats ignored, no-history exclusion, signs and three-player limit.');

const { debrisAt, projectileAt } = load('src/components/cinematic/battlefield.ts');
const before = debrisAt(3, 2), after = debrisAt(3, 3);
assert.notEqual(before.x, after.x, 'Debris moves without any camera/scroll input');
assert.notEqual(before.spin, after.spin, 'Debris rotates independently');
assert.notEqual(projectileAt(0, .1).age, projectileAt(0, .3).age);
assert.equal(projectileAt(0, .3).active, true);
assert.equal(projectileAt(0, 2).active, false, 'Projectiles leave the scene between shots');
for (let time = 0; time < 40; time += .17) for (let i = 0; i < 64; i++) {
  const p = debrisAt(i, time);
  for (const value of Object.values(p)) assert(Number.isFinite(value));
  assert(p.age >= 0 && p.age < 9);
}
console.log('Motion checks passed: autonomous travel, rotation, projectile lifetime, stable recycling.');
