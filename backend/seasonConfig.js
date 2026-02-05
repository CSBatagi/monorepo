const fs = require('fs');
const path = require('path');

const DEFAULT_SEASON_START = '2025-06-09';

function normalizeDate(value) {
  if (typeof value !== 'string') return null;
  const dateOnly = value.split('T')[0]?.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  return dateOnly;
}

function uniqueSortedDates(values) {
  const set = new Set();
  for (const v of values) {
    const normalized = normalizeDate(v);
    if (normalized) set.add(normalized);
  }
  return Array.from(set).sort();
}

function buildCandidateFiles(explicitFile) {
  const files = [];
  if (explicitFile) files.push(explicitFile);
  files.push(path.join(process.cwd(), 'season_start.json'));
  files.push(path.join(__dirname, '..', 'frontend-nextjs', 'public', 'data', 'season_start.json'));
  files.push(path.join(__dirname, '..', 'config', 'season_start.json'));
  return files;
}

function resolveSeasonConfig(opts = {}) {
  const explicitEnvDate = opts.explicitEnvDate || process.env.SEZON_BASLANGIC || DEFAULT_SEASON_START;
  const explicitFile = opts.explicitFile || process.env.SEASON_START_FILE;
  const fallbackDate = normalizeDate(explicitEnvDate) || DEFAULT_SEASON_START;

  let parsed = null;
  for (const fp of buildCandidateFiles(explicitFile)) {
    try {
      const raw = fs.readFileSync(fp, 'utf-8');
      parsed = JSON.parse(raw);
      break;
    } catch (_) {
      // try next
    }
  }

  const startsFromFile = Array.isArray(parsed?.season_starts) ? parsed.season_starts : [];
  const seasonStartFromFile = normalizeDate(parsed?.season_start);
  const seasonStarts = uniqueSortedDates([...startsFromFile, seasonStartFromFile, fallbackDate]);
  const seasonStart = seasonStartFromFile || seasonStarts[seasonStarts.length - 1] || fallbackDate;

  if (!seasonStarts.includes(seasonStart)) {
    seasonStarts.push(seasonStart);
    seasonStarts.sort();
  }

  return {
    seasonStart,
    seasonStarts,
  };
}

module.exports = {
  DEFAULT_SEASON_START,
  normalizeDate,
  resolveSeasonConfig,
};
