const fs = require('fs');
const os = require('os');
const path = require('path');
const { normalizeSeasonStarts, resolveSeasonConfig } = require('../seasonConfig');

describe('seasonConfig', () => {
  test('normalizes unique sorted season starts and includes active fallback', () => {
    expect(normalizeSeasonStarts(['2025-06-09', 'bad', '2025-02-10', '2025-06-09'], '2026-04-06')).toEqual([
      '2025-02-10',
      '2025-06-09',
      '2026-04-06',
    ]);
  });

  test('reads optional season_starts from config file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'season-config-'));
    const file = path.join(dir, 'season_start.json');
    fs.writeFileSync(file, JSON.stringify({
      season_start: '2026-04-06',
      season_starts: ['2025-02-10', '2025-06-09', '2026-01-05'],
    }));

    const config = resolveSeasonConfig({ explicitFile: file, explicitEnvDate: '2025-01-01' });
    expect(config.seasonStart).toBe('2026-04-06');
    expect(config.seasonStarts).toEqual([
      '2025-02-10',
      '2025-06-09',
      '2026-01-05',
      '2026-04-06',
    ]);
  });
});
