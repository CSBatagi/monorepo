'use strict';
const fs = require('fs');
const path = require('path');
const STAGES = new Set(['checking', 'updating_game', 'updating_plugins', 'verifying', 'ready', 'failed']);
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value) ? value : null;
const relayAddress = value => typeof value === 'string' && /^\[G:1:[1-9]\d{0,9}(?::\d{1,7})?\]$/.test(value) ? value : null;

function createGameUpdateStatus(directory, now = () => Date.now()) {
  const file = path.join(directory, 'game-update-status.json');
  let latest = null;
  try { latest = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { }
  return {
    receive(input) {
      if (!STAGES.has(input?.stage) || !identifier(input?.bootId)
        || !Number.isFinite(input.updatedAt) || Math.abs(now() / 1000 - input.updatedAt) > 60) {
        throw new Error('Invalid game preparation report');
      }
      if (latest && input.updatedAt < latest.updatedAt) throw new Error('Stale game preparation report');
      const value = { stage: input.stage, bootId: identifier(input.bootId), operationId: identifier(input.operationId),
        updatedAt: input.updatedAt, receivedAt: now(), error: identifier(input.error), warning: identifier(input.warning),
        sdr: input.stage === 'ready' && relayAddress(input.sdr?.address) ? { address: relayAddress(input.sdr.address) } : null,
        game: input.game ? { PatchVersion: identifier(input.game.PatchVersion), ServerVersion: identifier(input.game.ServerVersion), buildId: identifier(input.game.buildId) } : null,
        package: input.package ? Object.fromEntries(['css', 'metamod', 'matchzy', 'inventory'].map(key => [key, identifier(input.package[key])])) : null };
      fs.writeFileSync(file + '.tmp', JSON.stringify(value), { mode: 0o640 });
      fs.renameSync(file + '.tmp', file);
      latest = value;
      return value;
    },
    current() { return latest && now() - latest.receivedAt < 45000 ? latest : null; },
  };
}
module.exports = { createGameUpdateStatus };
