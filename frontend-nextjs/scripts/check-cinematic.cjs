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
  night_avg_periods: period({ '2026-09-01': [{ name: 'Old leader', 'HLTV 2': 4 }], '2026-09-03': [{ name: 'Missing value', 'HLTV 2': null }, { name: 'Leader', steam_id: '1', 'HLTV 2': 1.6, ADR: 95, 'K/D': 1.4 }, { name: 'Second', 'HLTV 2': 1.2 }] }),
  sonmac_by_date_periods: period({ '2026-09-03': { maps: { de_test: { team1: { name: 'A', score: 13 }, team2: { name: 'B', score: 8 } } } } }),
};
let summary = summarizeLastNight(payload);
assert.equal(summary.date, '2026-09-03');
assert.equal(summary.leaders[0].name, 'Leader');
assert.equal(summary.leaders[2].rating, null);
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

const { cameraAt, chooseTier, renderPixelRatio } = load('src/components/cinematic/camera-path.ts');
assert.notEqual(cameraAt(0).x, cameraAt(1).x, 'Scroll travels to the opposing side of real geometry');
assert(cameraAt(3).y > cameraAt(0).y * 2, 'Final chapter is an overhead view');
for (const p of [-100, 0, .2, 1, 2.8, 3, 100, NaN]) {
  for (const value of Object.values(cameraAt(p))) assert(Number.isFinite(value));
}
assert.equal(chooseTier('auto', 390, 8, 8), 'low');
assert.equal(chooseTier('auto', 1440, 4, 8), 'low');
assert.equal(chooseTier('auto', 1440, 8, 4), 'low');
assert.equal(chooseTier('lite', 1440, 16, 16), 'low');
assert.equal(chooseTier('auto', 1440, 8, 8), 'high');
for (const tier of ['low', 'high']) for (const [width, height] of [[390, 844], [1440, 900], [3840, 2160]]) {
  const ratio = renderPixelRatio(width, height, 3, tier);
  assert(width * height * ratio * ratio <= (tier === 'low' ? 850000 : 1900000) + 1);
}
console.log('3D checks passed: camera travel, bounded values, modest hardware tiers, hard pixel budgets.');

const { encounterAt, footAt, impactAt } = load('src/components/cinematic/encounter-motion.ts');
assert(encounterAt(.9, true).distance > 1, 'Actual travel to cover');
assert.equal(encounterAt(1.4, true).distance, encounterAt(1.8, true).distance, 'Stationary while firing');
assert(encounterAt(3, true).distance < encounterAt(2, true).distance, 'Withdraw after the exchange');
assert.equal(impactAt(0, 0).active, false);
assert.equal(impactAt(1.4, 0).active, true);
assert.equal(footAt(1.3, true).planted, true);
assert.equal(footAt(1.3, false).planted, true);
console.log('Encounter checks passed: approach, planted firing stance, withdrawal, and shot-timed impacts.');
