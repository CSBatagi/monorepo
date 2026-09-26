const fs = require('fs');
const { DemoRejected, inspectDemoStart, initialScanState, scanChunk, displayMapName } = require('../demoFile');
const { syntheticDemo, varint } = require('./helpers/syntheticDemo');

function scanInChunks(buffer, chunkBytes, totalSize = buffer.length) {
  let state = initialScanState();
  for (let offset = 0; offset < buffer.length; offset += chunkBytes) {
    // Round-trip through JSON like the database does between chunk requests.
    state = JSON.parse(JSON.stringify(scanChunk(state, buffer.subarray(offset, offset + chunkBytes), offset, totalSize)));
  }
  return state;
}

function rejection(fn) {
  try { fn(); } catch (error) { if (error instanceof DemoRejected) return error; throw error; }
  throw new Error('expected a rejection');
}

test('reads the CS2 file header the way CS Demo Manager does', () => {
  const { header } = inspectDemoStart(syntheticDemo());
  expect(header).toMatchObject({ demoFileStamp: 'PBDEMS2', mapName: 'de_mirage', serverName: 'XPLAY.GG | 5v5 Competitive #12', buildNum: 10542, demoVersionName: 'valve_demo_2' });
  // The stamp's NUL padding is stripped; Postgres cannot store NUL in text or JSONB.
  expect(JSON.stringify(header)).not.toContain('\\u0000');
  expect(displayMapName('workshop/123456/de_cache_scrimmagemap')).toBe('de_cache');
});

test('a well-formed demo passes the frame walk at any chunk size, including split frame headers', () => {
  const demo = syntheticDemo({ packets: 40, packetBytes: 777 });
  for (const size of [1, 2, 7, 13, 64, 1000, 4096, demo.length]) {
    expect(scanInChunks(demo, size)).toMatchObject({ next: demo.length, carry: '', truncated: false });
  }
});

test('archives, CS:GO demos and other files are refused with a reason', () => {
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]);
  expect(rejection(() => inspectDemoStart(zip))).toMatchObject({ code: 'archive' });
  expect(rejection(() => inspectDemoStart(Buffer.from([0x1f, 0x8b, 8, 0, ...Buffer.alloc(40)])))).toMatchObject({ code: 'archive' });
  expect(rejection(() => inspectDemoStart(Buffer.from([0x28, 0xb5, 0x2f, 0xfd, ...Buffer.alloc(40)])))).toMatchObject({ code: 'archive' });
  expect(rejection(() => inspectDemoStart(Buffer.concat([Buffer.from('Rar!\x1a\x07', 'latin1'), Buffer.alloc(40)])))).toMatchObject({ code: 'archive' });
  expect(rejection(() => inspectDemoStart(Buffer.concat([Buffer.from('HL2DEMO\0', 'latin1'), Buffer.alloc(1100)])))).toMatchObject({ code: 'csgo_demo' });
  expect(rejection(() => inspectDemoStart(Buffer.from('MZ\x90\x00 this program cannot be run in DOS mode'.padEnd(64), 'latin1')))).toMatchObject({ code: 'not_demo' });
  expect(rejection(() => inspectDemoStart(Buffer.from('<html><script>alert(1)</script></html>')))).toMatchObject({ code: 'not_demo' });
});

test('the header must be an uncompressed CS2 file header with the fields the analyzer needs', () => {
  expect(rejection(() => inspectDemoStart(syntheticDemo({ headerCommand: 65 })))).toMatchObject({ code: 'bad_header' });
  expect(rejection(() => inspectDemoStart(syntheticDemo({ headerCommand: 7 })))).toMatchObject({ code: 'bad_header' });
  expect(rejection(() => inspectDemoStart(syntheticDemo({ header: { mapName: undefined } })))).toMatchObject({ code: 'bad_header' });
  expect(rejection(() => inspectDemoStart(syntheticDemo({ header: { demoVersionGuid: undefined } })))).toMatchObject({ code: 'bad_header' });
  expect(rejection(() => inspectDemoStart(syntheticDemo({ header: { demoFileStamp: 'HL2DEMO' } })))).toMatchObject({ code: 'bad_header' });
  // Dota 2 and Deadlock write the same container format.
  expect(rejection(() => inspectDemoStart(syntheticDemo({ header: { gameDirectory: '/srv/dota2/game/dota' } })))).toMatchObject({ code: 'not_cs2' });
  expect(inspectDemoStart(syntheticDemo({ header: { gameDirectory: 'C:\\cs2\\game\\csgo\\' } })).header.mapName).toBe('de_mirage');
  // A copied header in front of a short file is not enough.
  expect(rejection(() => inspectDemoStart(syntheticDemo().subarray(0, 60)))).toMatchObject({ code: 'bad_header' });
});

test('anything that is not a frame sequence after the header is rejected', () => {
  const demo = syntheticDemo();
  // A valid demo with an archive appended (a polyglot) fails where the archive starts.
  const polyglot = Buffer.concat([demo, Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(2000, 0xff)]);
  expect(rejection(() => scanInChunks(polyglot, 4096))).toMatchObject({ code: 'corrupt' });
  // Random bytes after a genuine header.
  const noise = Buffer.alloc(5000);
  for (let index = 0; index < noise.length; index++) noise[index] = (index * 7919 + 13) % 256 | 0x80;
  expect(rejection(() => scanInChunks(Buffer.concat([demo.subarray(0, 300), noise]), 1024))).toMatchObject({ code: 'corrupt' });
  // A frame claiming more than 32 MiB, right after the file header.
  const { firstFrameEnd } = inspectDemoStart(demo);
  const huge = Buffer.concat([demo.subarray(0, firstFrameEnd), varint(7), varint(1), varint(33 * 1024 * 1024), Buffer.alloc(100)]);
  expect(rejection(() => scanInChunks(huge, 4096))).toMatchObject({ code: 'corrupt' });
  // A command byte outside the protocol's range.
  const unknown = Buffer.concat([demo.subarray(0, firstFrameEnd), varint(300), varint(1), varint(1), Buffer.alloc(1)]);
  expect(rejection(() => scanInChunks(unknown, 4096))).toMatchObject({ code: 'corrupt' });
});

test('a recording cut off mid-frame is accepted but flagged', () => {
  const demo = syntheticDemo({ packets: 10, packetBytes: 5000 });
  const cut = demo.subarray(0, 20000);
  expect(scanInChunks(cut, 4096).truncated).toBe(true);
  expect(scanInChunks(demo.subarray(0, demo.length - 5), 4096).truncated).toBe(true);
});

// Point DEMO_SAMPLE at a real CS2 demo to check the parser against it (not committed: demos are large).
(process.env.DEMO_SAMPLE ? test : test.skip)('a real CS2 match demo passes in 4 MiB chunks', () => {
  const demo = fs.readFileSync(process.env.DEMO_SAMPLE);
  expect(inspectDemoStart(demo.subarray(0, 4 * 1024 * 1024)).header.mapName).toMatch(/^de_/);
  expect(scanInChunks(demo, 4 * 1024 * 1024)).toMatchObject({ next: demo.length, truncated: false });
});
