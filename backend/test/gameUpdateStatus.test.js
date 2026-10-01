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
