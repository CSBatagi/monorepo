/*
 Integration test using real docker-compose-test.yml services.
 Assumptions:
  - docker-compose-test.yml is launched externally (CI step) before tests run.
  - Backend reachable at http://localhost:3001 (direct port mapping); frontend-nextjs still on http://localhost:3000.
  - Postgres seeded with some data (at least tables exist) so /stats/check-and-update returns 200.
 This test will:
   1. Hit /stats/check-and-update without lastKnownTs => expect updated flag present.
   2. Hit again with lastKnownTs => expect either updated=false or still valid response.
   3. Assert all core JSON dataset keys appear when updated=true.
*/

const fetch = require('node-fetch');

const BASE = process.env.INTEGRATION_BACKEND_URL || 'http://localhost:3001';

async function getStats(params){
  const url = new URL('/stats/check-and-update', BASE);
  if (params?.lastKnownTs) url.searchParams.set('lastKnownTs', params.lastKnownTs);
  const res = await fetch(url.toString(), { headers: { 'Accept':'application/json' }, cache: 'no-store' });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch(e){ throw new Error('Non-JSON response: '+text); }
  return { status: res.status, body: json };
}

describe('docker-compose integration: /stats/check-and-update', () => {
  jest.setTimeout(60000);

  test('initial call returns timestamp and maybe datasets', async () => {
    const r1 = await getStats();
    expect(r1.status).toBe(200);
    expect(r1.body).toHaveProperty('serverTimestamp');
    expect(r1.body).toHaveProperty('updated');
  });

  test('second call with lastKnownTs returns consistent timestamp semantics', async () => {
    const first = await getStats();
    const ts = first.body.serverTimestamp;
    const second = await getStats({ lastKnownTs: ts });
    expect(second.status).toBe(200);
    expect(second.body).toHaveProperty('serverTimestamp');
  });

  test('when updated true includes known dataset keys (if generation succeeded)', async () => {
    const r = await getStats();
    if (r.body.updated) {
      // Only assert keys exist if updated; absence would indicate generation mismatch
      const expectedKeys = [
        'season_avg','night_avg','last10','sonmac_by_date','duello_son_mac','duello_sezon','performance_data'
      ];
      const missing = expectedKeys.filter(k=>!(k in r.body));
      // Allow partially empty if DB lacks data, but keys should at least be defined
      expect(missing).toEqual([]);
    }
  });
});
