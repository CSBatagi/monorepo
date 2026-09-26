// Run with: node --test ops/video/build-video-config.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWholeMatchSequence, buildVideoConfig, roundRangeArg, ENCODER_PROFILES } = require('./build-video-config');

const A = '76561198000000001';
const B = '76561198000000002';

function kill(tick, killerSteamId, extra = {}) {
  return { tick, killerSteamId, killerName: killerSteamId === A ? 'alpha' : 'bravo', weaponType: 'rifle', ...extra };
}

function match(overrides = {}) {
  return {
    mapName: 'de_mirage',
    tickrate: 64,
    tickCount: 100000,
    rounds: [
      { number: 2, freezetimeEndTick: 9000, endTick: 20000 },
      { number: 1, freezetimeEndTick: 1566, endTick: 8000 },
    ],
    kills: [kill(5000, A), kill(19000, B), kill(2234, A)],
    players: [
      { steamId: A, name: 'alpha' },
      { steamId: B, name: 'bravo' },
    ],
    ...overrides,
  };
}

test('starts at round 1 freeze-time end and ends one second after the last kill', () => {
  const sequence = buildWholeMatchSequence(match({ rounds: [{ number: 1, freezetimeEndTick: 1566, endTick: 2234 }] }));
  assert.equal(sequence.startTick, 1566);
  assert.equal(sequence.endTick, 19000 + 64);
});

test('extends to the last round end when the round ended after the last kill', () => {
  const sequence = buildWholeMatchSequence(match());
  assert.equal(sequence.endTick, 20000 + 64);
});

test('keeps the quit command inside the demo', () => {
  const sequence = buildWholeMatchSequence(match({ tickCount: 20100 }));
  assert.equal(sequence.endTick, 20100 - 66);
});

test('switches to the killer two seconds before each kill, in tick order', () => {
  const { playerCameras } = buildWholeMatchSequence(match());
  assert.deepEqual(
    playerCameras.map((camera) => [camera.tick, camera.playerSteamId]),
    [
      [2234 - 128, A],
      [5000 - 128, A],
      [19000 - 128, B],
    ],
  );
});

test('skips world kills and never places a camera before the sequence start', () => {
  const { playerCameras } = buildWholeMatchSequence(
    match({
      kills: [kill(1600, A), kill(6000, B, { weaponType: 'world' }), kill(7000, '0'), kill(7500, B)],
    }),
  );
  assert.deepEqual(
    playerCameras.map((camera) => camera.tick),
    [1566, 7500 - 128],
  );
});

test('records only the requested rounds', () => {
  const first = buildWholeMatchSequence(match(), { roundRange: { from: 1, to: 1 } });
  assert.equal(first.startTick, 1566);
  assert.equal(first.endTick, 8000 + 64);
  assert.deepEqual(
    first.playerCameras.map((camera) => camera.tick),
    [2234 - 128, 5000 - 128],
  );

  // From round 2 to the end: starts at round 2's freeze end, same end as the whole match.
  const last = buildWholeMatchSequence(match(), { roundRange: { from: 2 } });
  assert.equal(last.startTick, 9000);
  assert.equal(last.endTick, 20000 + 64);
  assert.deepEqual(
    last.playerCameras.map((camera) => camera.tick),
    [19000 - 128],
  );

  assert.throws(() => buildWholeMatchSequence(match(), { roundRange: { from: 1, to: 3 } }), /2 rounds/);
  assert.throws(() => buildWholeMatchSequence(match(), { roundRange: { from: 2, to: 1 } }), /2 rounds/);
});

test('writes the encoder settings into the config', () => {
  const options = { demoPath: 'C:\\demos\\a.dem', outputFolderPath: 'C:\\videos' };
  assert.deepEqual(buildVideoConfig(match(), options).ffmpegSettings, ENCODER_PROFILES.x264);
  const nvenc = buildVideoConfig(match(), { ...options, encoder: 'nvenc' }).ffmpegSettings;
  assert.equal(nvenc.videoCodec, 'h264_nvenc');
  assert.equal(nvenc.audioBitrate, ENCODER_PROFILES.x264.audioBitrate);
  assert.throws(() => buildVideoConfig(match(), { ...options, encoder: 'av1' }), /Unknown encoder/);
});

test('replaces double quotes in player names', () => {
  const { playersOptions } = buildWholeMatchSequence(match({ players: [{ steamId: A, name: 'here comes the "D"' }] }));
  assert.equal(playersOptions[0].playerName, "here comes the 'D'");
});

test('refuses a demo without kills', () => {
  assert.throws(() => buildWholeMatchSequence(match({ kills: [] })), /no kills/);
});

test('config has voices on, X-ray off and every player shown in the kill feed', () => {
  const config = buildVideoConfig(match(), { demoPath: 'C:\\demos\\a.dem', outputFolderPath: 'C:\\videos' });
  const [sequence] = config.sequences;
  assert.equal(config.recordingSystem, 'HLAE');
  assert.equal(config.closeGameAfterRecording, true);
  assert.equal(sequence.playerVoicesEnabled, true);
  assert.equal(sequence.showXRay, false);
  assert.deepEqual(
    sequence.playersOptions.map((player) => [player.steamId, player.showKill, player.isVoiceEnabled]),
    [
      [A, true, true],
      [B, true, true],
    ],
  );
});

test('parses --rounds values', () => {
  assert.equal(roundRangeArg(undefined), undefined);
  assert.deepEqual(roundRangeArg('2'), { from: 1, to: 2 });
  assert.deepEqual(roundRangeArg('20-24'), { from: 20, to: 24 });
  assert.deepEqual(roundRangeArg('20-'), { from: 20, to: undefined });
  assert.throws(() => roundRangeArg('a-b'), /--rounds/);
});

test('caps the length for smoke tests', () => {
  const sequence = buildWholeMatchSequence(match(), { roundRange: { from: 1, to: 1 }, maxSeconds: 12 });
  assert.equal(sequence.endTick, 1566 + 768);
  assert.deepEqual(
    sequence.playerCameras.map((camera) => camera.tick),
    [2234 - 128],
  );
});
