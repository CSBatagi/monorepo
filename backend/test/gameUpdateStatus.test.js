const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');
const { createGameUpdateStatus } = require('../gameUpdateStatus');
const { registerGameServer } = require('../gameServer');

let directory;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'csbatagi-update-test-')); });
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

test('expires, persists and sanitizes preparation reports; rejects replay and invalid clocks', () => {
  let now = 100000;
  const store = createGameUpdateStatus(directory, () => now);
  const input = { stage: 'updating_game', bootId: 'boot-a', updatedAt: 100, password: 'private',
    error: 'token=private', package: { css: 'v1.0.376', token: 'private' } };
  store.receive(input);
  expect(JSON.stringify(store.current())).not.toContain('private');
  expect(createGameUpdateStatus(directory, () => now).current().stage).toBe('updating_game');
  expect(() => store.receive({ ...input, updatedAt: 99 })).toThrow('Stale');
  expect(() => store.receive({ ...input, updatedAt: 200 })).toThrow('Invalid');
  expect(() => store.receive({ ...input, stage: 'arbitrary' })).toThrow('Invalid');
  now += 45001;
  expect(store.current()).toBeNull();
});

test('callback needs bearer auth and rejects malformed reports', async () => {
  process.env.CS2_MATCH_DIR = directory; process.env.AUTH_TOKEN = 'test-update-secret';
  const app = express(); app.use(express.json());
  registerGameServer(app, { pool: {}, rcon: {}, gcp: {} });
  await request(app).post('/game-update-status').send({}).expect(403);
  await request(app).post('/game-update-status').set('Authorization', 'Bearer test-update-secret').send({}).expect(400);
  await request(app).post('/game-update-status').set('Authorization', 'Bearer test-update-secret')
    .send({ stage: 'verifying', bootId: 'boot-a', updatedAt: Date.now() / 1000 }).expect(204);
});

test('accepts only sanitized relay identities in fresh Ready reports', () => {
  let now = 100000;
  const store = createGameUpdateStatus(directory, () => now);
  const report = address => ({ stage: 'ready', bootId: 'boot-a', updatedAt: now / 1000, sdr: { address, password: 'private' } });
  store.receive(report('[A:1:2392563733:51945]'));
  expect(store.current().sdr).toEqual({ address: '[A:1:2392563733:51945]' });
  expect(JSON.stringify(store.current())).not.toContain('private');
  // Token logins ([G:...]) are dialed as the wrong instance by CS2 clients, so they never reach the website.
  for (const bad of ['[G:1:12345]', '[G:1:12345:0]', '[A:1:12345]', '[A:1:12345:7];quit', '[a:1:12345:7]',
    '[U:1:12345:1]', '[A:1:0:7]', '203.0.113.8:27015', null]) {
    store.receive(report(bad)); expect(store.current().sdr).toBeNull();
  }
  store.receive({ ...report('[A:1:12345:7]'), stage: 'verifying' });
  expect(store.current().sdr).toBeNull();
  store.receive(report('[A:1:12345:7]'));
  now += 45001;
  expect(store.current()).toBeNull();
});
