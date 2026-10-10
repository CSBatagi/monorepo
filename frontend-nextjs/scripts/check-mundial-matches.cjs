// Run the real scoring and audit implementations with no extra test dependencies.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(relative, imports = {}) {
  const filename = path.resolve(__dirname, '../src', relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => imports[name] || require(name), mod, mod.exports);
  return mod.exports;
}
const shared = load('lib/batakAllStars.ts');
const scoring = load('lib/superliga.ts', { './batakAllStars': shared });
const mundial = load('lib/mundial.ts', { './superliga': scoring });
const Matches = load('app/mundial/MundialMatches.tsx', {
  '@/lib/superliga': scoring,
  './mundial.module.css': new Proxy({}, { get: (_, key) => key === '__esModule' ? false : key }),
}).default;
const captain = id => ({ steamId: id });
const captains = { team1: captain('1'), team2: captain('2') };
const map = (s1 = 13, s2 = 7, t1 = 'Alpha', t2 = 'Bravo', p1 = '1') => ({
  team1: { name: t1, score: s1, players: [{ steam_id: p1 }] },
  team2: { name: t2, score: s2, players: [{ steam_id: '2' }] },
});
function fixture() {
  return {
    sonmacByDate: {
      '2026-09-30': { maps: { de_dust2: map() } },
      '2026-10-01': { maps: { de_dust2: map(), de_mirage: map(8, 13, 'Alpha', 'Bravo', '3'), de_nuke: map(13, 4, 'Charlie', 'Delta') } },
      '2026-10-02': { maps: { de_dust2: map() } },
      '2026-10-04': { maps: { de_dust2: map() } },
    },
    captainsByDate: {
      '2026-09-30': captains, '2026-10-01': captains,
      '2026-10-02': { team1: captain('1') }, '2026-10-03': captains,
      '2026-10-04': captains, '2026-10-05': captains,
    },
    mapOverrides: {
      '2026-10-01': [
        { mapName: 'de_dust2', team1Score: 13, team2Score: 0 },
        { mapName: 'de_inferno', team1Name: 'Bravo', team2Name: 'Alpha', team1Score: 10, team2Score: 13 },
      ],
      '2026-10-06': [{ mapName: 'de_nuke', team1Score: 13, team2Score: 2 }],
    },
    manualNights: {
      '2026-10-01': { team1Players: [{ steamId: '1' }], team2Players: [{ steamId: '2' }], maps: [{ mapName: 'de_ancient', team1Score: 13, team2Score: 0 }] },
      '2026-10-03': { team1Name: 'Alpha', team2Name: 'Bravo', team1Players: [{ steamId: '1' }], team2Players: [{ steamId: '2' }], maps: [{ mapName: 'de_anubis', team1Score: 16, team2Score: 14 }] },
    },
    config: { scoring: scoring.DEFAULT_SUPERLIGA_SCORING, leagues: [{ id: 'mundial', name: 'Mundial', players: ['1', '2', '3'] }] },
    playersIndex: shared.buildPlayersIndex([{ steam_id: '1', name: 'Alice' }, { steam_id: '2', name: 'Bob' }, { steam_id: '3', name: 'Cem' }]),
    seasonStart: '2026-10-01',
    upToNight: 2,
  };
}
const audit = params => mundial.buildMundialMatchNights({ ...params, datesIncluded: scoring.computeSuperligaStandings(params).datesIncluded });

test('audit agrees with standings on season, captains and group limit, including captain-only dates', () => {
  const params = fixture();
  const nights = audit(params);
  assert.deepEqual(nights.map(n => [n.date, n.status]), [
    ['2026-10-06', 'missing-results'], ['2026-10-05', 'missing-results'],
    ['2026-10-04', 'after-groups'], ['2026-10-03', 'included'],
    ['2026-10-02', 'missing-captains'], ['2026-10-01', 'included'],
  ]);
  assert.deepEqual(nights.filter(n => n.nightNumber).map(n => n.nightNumber), [2, 1]);
  params.captainsByDate['2026-10-02'] = captains;
  assert.deepEqual(audit(params).filter(n => n.status === 'included').map(n => n.date), ['2026-10-02', '2026-10-01']);
  // A late captain assignment shifts the exact same group-night boundary as standings.
  assert.equal(audit(params).find(n => n.date === '2026-10-03').status, 'after-groups');
});

test('effective results preserve map rosters, align reversed overrides and prevent double counting', () => {
  const params = fixture();
  const night = audit(params).find(n => n.date === '2026-10-01');
  assert.deepEqual(night.maps.filter(m => !m.excludedReason).map(m => m.mapName), ['de_dust2', 'de_mirage', 'de_inferno']);
  assert.equal(night.maps.find(m => m.mapName === 'de_nuke').excludedReason, 'Ana lig dışı harita');
  assert.equal(night.maps.find(m => m.source === 'override' && m.mapName === 'de_dust2').excludedReason, 'Demo sonucu zaten var');
  assert.equal(night.maps.find(m => m.source === 'manual').excludedReason, 'Demo verisi kullanılıyor');
  const added = night.maps.find(m => m.mapName === 'de_inferno');
  assert.deepEqual([added.team1Score, added.team2Score, added.team1Name], [13, 10, 'Alpha']);
  const standings = scoring.computeSuperligaStandings(params).league.standings;
  const alice = standings.find(p => p.steamId === '1');
  const bob = standings.find(p => p.steamId === '2');
  const cem = standings.find(p => p.steamId === '3');
  assert.deepEqual(alice.nightBreakdown[0].maps.map(m => m.mapName), ['de_dust2', 'de_inferno']);
  assert.equal(alice.totalPoints, 66); // (21 + 18 + captain 5) + (17 + captain 5)
  assert.equal(bob.totalPoints, 35); // (20 + captain 5) + (overtime 5 + captain 5)
  assert.equal(cem.totalPoints, 18); // inferno override uses the night's combined roster
});

test('invalid scores are visible but cannot contribute map points', () => {
  const params = fixture();
  params.sonmacByDate['2026-10-01'].maps.de_dust2.team1.score = undefined;
  params.sonmacByDate['2026-10-01'].maps.de_mirage.team1.score = 13;
  const night = audit(params).find(n => n.date === '2026-10-01');
  assert.equal(night.status, 'included'); // preserve existing night-count semantics
  assert.equal(night.maps.filter(m => m.excludedReason === 'Geçerli sonuç yok').length, 2);
  assert.equal(scoring.computeSuperligaStandings(params).league.standings.find(p => p.steamId === '1').totalPoints, 45);
});

test('public panel renders scores, sources, captains and reasons, and guards loading/errors', () => {
  const params = fixture();
  const props = { nights: audit(params), scoring: params.config.scoring, groupStageLength: 2, nameOf: id => shared.displayNameForSteamId(id, params.playersIndex), loading: false, error: false, onRetry() {} };
  const html = renderToStaticMarkup(React.createElement(Matches, props));
  for (const text of ['Maçlar ve Sonuçlar', '2/2 gece · 4 harita sayıldı', 'Alice', 'Bob', 'Atanmadı', '13 – 7', '16 – 14', 'Elle eklenen harita', 'Manuel gece', 'Ana lig dışı harita', 'Demo sonucu zaten var', 'Grup aşaması dışında']) {
    assert.ok(html.includes(text), text);
  }
  assert.ok(renderToStaticMarkup(React.createElement(Matches, { ...props, loading: true })).includes('yükleniyor'));
  const failed = renderToStaticMarkup(React.createElement(Matches, { ...props, error: true }));
  assert.ok(failed.includes('doğrulanamıyor'));
  assert.ok(!failed.includes('harita sayıldı'));
  assert.ok(renderToStaticMarkup(React.createElement(Matches, { ...props, nights: [] })).includes('henüz maç kaydı yok'));
});
