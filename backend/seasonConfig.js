const fs = require('fs');
const path = require('path');

const DEFAULT_SEASON_START = '2025-06-09';

function normalizeDate(value) {
  if (typeof value !== 'string') return null;
  const dateOnly = value.split('T')[0]?.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  return dateOnly;
}

function buildCandidateFiles(explicitFile) {
  const files = [];
  if (explicitFile) files.push(explicitFile);
  files.push(path.join(process.cwd(), 'season_start.json'));
  files.push(path.join(__dirname, '..', 'frontend-nextjs', 'public', 'data', 'season_start.json'));
  files.push(path.join(__dirname, '..', 'config', 'season_start.json'));
  return files;
}

function normalizeSeasonStarts(rawStarts, fallbackStart) {
  const starts = [];
  if (Array.isArray(rawStarts)) {
    for (const start of rawStarts) {
      const normalized = normalizeDate(start);
      if (normalized) starts.push(normalized);
    }
  }
  const fallback = normalizeDate(fallbackStart);
  if (fallback) starts.push(fallback);
  return Array.from(new Set(starts)).sort();
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

  const seasonStartFromFile = normalizeDate(parsed?.season_start);
  const seasonStart = seasonStartFromFile || fallbackDate;
  const seasonStarts = normalizeSeasonStarts(parsed?.season_starts, seasonStart);

  return {
    seasonStart,
    seasonStarts,
  };
}

module.exports = {
  DEFAULT_SEASON_START,
  normalizeDate,
  normalizeSeasonStarts,
  resolveSeasonConfig,
};
