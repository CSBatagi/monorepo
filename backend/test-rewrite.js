// Quick test to verify rewriteMatchDateToDemos produces valid SQL
const { _rewriteMatchDateToDemos: rewriteMatchDateToDemos, _buildQueries: buildQueries } = require('./statsGenerator');

const testCases = [
  'SELECT MAX(matches.date::date) AS latest_match_date FROM matches',
  'SELECT MAX(matches.date::date) FROM matches)',
  'SELECT DISTINCT matches.date::date AS unique_date FROM matches ORDER BY unique_date DESC LIMIT 10',
  'FROM matches WHERE date::date = (SELECT MAX(unique_date) FROM last_x_dates)',
  'INNER JOIN matches ON p1.match_checksum = matches.checksum WHERE matches.date::date',
  'INNER JOIN matches m ON c.match_checksum = m.checksum WHERE m.date::date',
  'FROM matches m WHERE m.date::date',
  'SELECT matches.date::date AS match_date, matches.map_name FROM players p1 INNER JOIN matches ON p1.match_checksum = matches.checksum',
  'SELECT DISTINCT date::date AS match_date, ROW_NUMBER() OVER (ORDER BY date::date) AS rn FROM matches',
];

let allOk = true;
for (const t of testCases) {
  const out = rewriteMatchDateToDemos(t);
  const usesDemosDot = /\bdemos\.(date|map_name)\b/.test(out);
  const joinsUnaliased = /JOIN demos ON demos\.checksum\s*=\s*matches\.checksum/.test(out) || /FROM demos\b/.test(out);
  const usesDm = /\bdm\.(date|map_name)\b/.test(out);
  const joinsAliased = /JOIN demos dm ON dm\.checksum\s*=\s*m\.checksum/.test(out);
  const broken = (usesDemosDot && !joinsUnaliased) || (usesDm && !joinsAliased);
  const stillHasOld = /\bmatches\.(date|map_name)\b/.test(out);

  console.log('IN:  ' + t.substring(0, 90));
  console.log('OUT: ' + out.substring(0, 140));
  if (broken) { console.log('*** BROKEN - demos referenced but not joined ***'); allOk = false; }
  if (stillHasOld) { console.log('*** BROKEN - still has matches.date/map_name ***'); allOk = false; }
  if (!broken && !stillHasOld) console.log('OK');
  console.log();
}

// Test full buildQueries output
console.log('=== Testing full buildQueries output ===\n');
const queries = buildQueries('2026-01-05');
for (const [key, sql] of Object.entries(queries)) {
  const hasMatchesDate = /\bmatches\.(date|map_name)\b/.test(sql);
  const hasMDot = /\bm\.(date|map_name)\b/.test(sql);
  const usesDemos = /\bdemos\.(date|map_name)\b/.test(sql);
  const joinsDemos = /JOIN demos ON demos\.checksum/.test(sql) || /FROM demos\b/.test(sql);
  const usesDm = /\bdm\.(date|map_name)\b/.test(sql);
  const joinsDm = /JOIN demos dm ON dm\.checksum/.test(sql);
  
  const problems = [];
  if (hasMatchesDate) problems.push('still has matches.date/map_name');
  if (hasMDot) problems.push('still has m.date/map_name');
  if (usesDemos && !joinsDemos) problems.push('demos.date without JOIN demos');
  if (usesDm && !joinsDm) problems.push('dm.date without JOIN demos dm');
  
  if (problems.length > 0) {
    console.log('FAIL: ' + key + ' -- ' + problems.join(', '));
    allOk = false;
  } else {
    console.log('OK: ' + key);
  }
}

if (allOk) {
  console.log('\n=== ALL TESTS PASSED ===');
} else {
  console.log('\n=== SOME TESTS FAILED ===');
  process.exit(1);
}
