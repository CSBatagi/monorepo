// Script to generate stats JSONs from production database
// This queries the production DB and creates local JSON files in runtime-data

require('dotenv').config();

const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
const { generateAll, generateAggregates } = require('./statsGenerator');
const { resolveSeasonConfig } = require('./seasonConfig');

// Production database configuration
if (!process.env.PROD_DB_USER || !process.env.PROD_DB_HOST || !process.env.PROD_DB_PASSWORD) {
  console.error('Error: Missing production database credentials');
  console.error('Please set environment variables: PROD_DB_USER, PROD_DB_HOST, PROD_DB_PASSWORD, PROD_DB_DATABASE');
  process.exit(1);
}

const productionPool = new Pool({
  user: process.env.PROD_DB_USER,
  host: process.env.PROD_DB_HOST,
  database: process.env.PROD_DB_DATABASE || 'csdm',
  password: process.env.PROD_DB_PASSWORD,
  port: 5432,
});

async function generateStatsFromProduction() {
  console.log('=== Generating Stats from Production Database ===\n');
  
  const seasonConfig = resolveSeasonConfig();
  const seasonStart = seasonConfig.seasonStart;
  const seasonStarts = seasonConfig.seasonStarts;
  console.log(`Using season start: ${seasonStart}`);
  console.log(`Configured season starts: ${seasonStarts.join(', ')}\n`);
  
  const runtimeDir = path.join(__dirname, '..', 'frontend-nextjs', 'runtime-data');
  await fs.mkdir(runtimeDir, { recursive: true });
  
  try {
    // Test connection
    console.log('Connecting to production database...');
    await productionPool.query('SELECT 1');
    console.log('✓ Connected successfully\n');
    
    // Generate all incremental datasets
    console.log('Generating incremental datasets...');
    const incremental = await generateAll(productionPool, { seasonStart, seasonStarts });
    console.log('✓ Incremental datasets generated\n');
    
    // Generate aggregate datasets
    console.log('Generating aggregate datasets...');
    const aggregates = await generateAggregates(productionPool, { seasonStart, seasonStarts });
    console.log('✓ Aggregate datasets generated\n');
    
    // Write incremental files
    console.log('Writing files to runtime-data/...');
    const incrementalFiles = {
      'night_avg.json': incremental.night_avg,
      'night_avg_all.json': incremental.night_avg_all,
      'sonmac_by_date.json': incremental.sonmac_by_date,
      'sonmac_by_date_all.json': incremental.sonmac_by_date_all,
      'duello_son_mac.json': incremental.duello_son_mac,
      'duello_sezon.json': incremental.duello_sezon,
      'performance_data.json': incremental.performance_data,
      'players_stats.json': incremental.players_stats,
      'players_stats_periods.json': incremental.players_stats_periods,
      'map_stats.json': incremental.map_stats,
    };
    
    for (const [filename, data] of Object.entries(incrementalFiles)) {
      const filepath = path.join(runtimeDir, filename);
      await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`  ✓ ${filename}`);
    }
    
    // Write aggregate files
    const aggregateFiles = {
      'season_avg.json': aggregates.season_avg,
      'season_avg_periods.json': aggregates.season_avg_periods,
      'last10.json': aggregates.last10,
    };
    
    for (const [filename, data] of Object.entries(aggregateFiles)) {
      const filepath = path.join(runtimeDir, filename);
      await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`  ✓ ${filename}`);
    }
    
    // Write timestamp
    const timestamp = new Date().toISOString();
    await fs.writeFile(path.join(runtimeDir, 'last_timestamp.txt'), timestamp, 'utf-8');
    console.log(`  ✓ last_timestamp.txt\n`);
    
    // Show stats summary
    console.log('=== Generation Complete! ===\n');
    console.log('Stats Summary:');
    console.log(`  Season avg players: ${aggregates.season_avg?.length || 0}`);
    console.log(`  Last 10 players: ${aggregates.last10?.length || 0}`);
    console.log(`  Night avg dates: ${Object.keys(incremental.night_avg || {}).length}`);
    console.log(`  Match dates: ${Object.keys(incremental.sonmac_by_date || {}).length}`);
    console.log(`  Performance players: ${incremental.performance_data?.length || 0}`);
    console.log(`  Players stats: ${incremental.players_stats?.length || 0}`);
    console.log(`  Map stats: ${incremental.map_stats?.length || 0}`);
    console.log(`\nFiles written to: ${runtimeDir}`);
    console.log('\nYou can now use these files with your local backend/frontend!');
    
  } catch (error) {
    console.error('\n✗ Error generating stats:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await productionPool.end();
  }
}

// Run the generator
generateStatsFromProduction().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
