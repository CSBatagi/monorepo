const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/matchDuels.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText;
const context = { exports: {} };
vm.runInNewContext(compiled, context);
const sum = data => JSON.parse(JSON.stringify(context.exports.sumMatchDuels(data)));

const maps = [
  { players: [{ steam_id: '1', name: 'Old name' }, { steam_id: '2', name: 'Same name' }], kills: { 1: { 2: 7 }, 2: { 1: 3 } } },
  { players: [{ steam_id: '1', name: 'New name' }, { steam_id: '3', name: 'Same name' }], kills: { 1: { 3: 2 }, 3: { 1: 9 } } },
  { players: [{ steam_id: '1', name: 'New name' }, { steam_id: '2', name: 'Same name' }], kills: { 1: { 2: 4 } } },
];
const original = JSON.stringify(maps);
const night = sum(maps);
assert.equal(night.players.length, 3, 'Distinct Steam identities must survive identical names');
assert.equal(night.players.find(player => player.steam_id === '1').name, 'New name');
assert.deepEqual(night.kills, { 1: { 2: 11, 3: 2 }, 2: { 1: 3 }, 3: { 1: 9 } });
assert.equal(night.kills['2']['3'], undefined, 'Players on separate maps must not acquire invented encounters');
assert.equal(JSON.stringify(maps), original, 'Night summing must not alter individual maps');
assert.deepEqual(sum([]), { players: [], kills: {} });
console.log('Night duel totals passed: map sums, identity/name changes, separate rosters, empty data and source preservation.');
