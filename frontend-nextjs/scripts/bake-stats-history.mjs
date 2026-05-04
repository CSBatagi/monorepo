import fs from "fs/promises";
import path from "path";

const root = process.cwd();
const runtimeDir = process.env.STATS_DATA_DIR || path.join(root, "runtime-data");
const defaultHistorySourceDir = path.join(runtimeDir, "history-source");
const historySourceDir = process.env.STATS_HISTORY_SOURCE_DIR || defaultHistorySourceDir;
const publicDataDir = path.join(root, "public", "data");
const outputRoot = path.join(publicDataDir, "stats-history");

function normalizeDate(value) {
  if (typeof value !== "string") return null;
  const dateOnly = value.split("T")[0]?.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : null;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

function buildCompletedPeriods(seasonStarts, activeSeasonStart) {
  return seasonStarts
    .map((startDate, index) => {
      const nextStart = seasonStarts[index + 1] || null;
      return {
        id: `season_${startDate}`,
        startDate,
        endDate: nextStart ? addDays(nextStart, -1) : null,
        isActive: startDate === activeSeasonStart,
      };
    })
    .filter((period) => period.endDate && !period.isActive);
}

function filterByPeriod(data, period) {
  const filtered = {};
  for (const [date, value] of Object.entries(data || {})) {
    if (date >= period.startDate && date <= period.endDate) {
      filtered[date] = value;
    }
  }
  return filtered;
}

async function bakeDataset(dataset, sourceFilename, periods) {
  let sourcePath = path.join(historySourceDir, sourceFilename);
  try {
    await fs.stat(sourcePath);
  } catch {
    sourcePath = path.join(runtimeDir, sourceFilename);
  }
  const source = await readJson(sourcePath);
  const datasetDir = path.join(outputRoot, dataset);
  await fs.rm(datasetDir, { recursive: true, force: true });
  await fs.mkdir(datasetDir, { recursive: true });

  const written = [];
  for (const period of periods) {
    const data = filterByPeriod(source, period);
    if (!Object.keys(data).length) continue;
    const filename = `${period.id}.json`;
    await fs.writeFile(path.join(datasetDir, filename), JSON.stringify(data), "utf-8");
    written.push({ period: period.id, dates: Object.keys(data).length, filename });
  }
  return written;
}

async function main() {
  const seasonConfig = await readJson(path.join(publicDataDir, "season_start.json"));
  const activeSeasonStart = normalizeDate(seasonConfig.season_start);
  const starts = Array.isArray(seasonConfig.season_starts) ? seasonConfig.season_starts : [];
  const seasonStarts = Array.from(new Set([...starts, activeSeasonStart].map(normalizeDate).filter(Boolean))).sort();
  const periods = buildCompletedPeriods(seasonStarts, activeSeasonStart);

  if (!periods.length) {
    throw new Error("No completed season periods found in season_start.json");
  }

  const nightAvg = await bakeDataset("night_avg", "night_avg_all.json", periods);
  const sonmacByDate = await bakeDataset("sonmac_by_date", "sonmac_by_date_all.json", periods);

  console.log("Baked static stats history:");
  console.log(`  night_avg: ${nightAvg.length} period files`);
  for (const item of nightAvg) console.log(`    ${item.period}: ${item.dates} dates`);
  console.log(`  sonmac_by_date: ${sonmacByDate.length} period files`);
  for (const item of sonmacByDate) console.log(`    ${item.period}: ${item.dates} dates`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
