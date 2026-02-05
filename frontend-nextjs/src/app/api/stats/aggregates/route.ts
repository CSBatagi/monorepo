import { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs/promises';

// Aggregates are always refreshed on-demand.
const AGG_FILES = ['season_avg.json','season_avg_periods.json','last10.json'];

export async function GET(req: NextRequest) {
  const backendBase = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';
  const url = `${backendBase}/stats/aggregates?_cb=${Date.now()}`;
  let data: any = null;
  try {
    const res = await fetch(url, { cache: 'no-store', headers:{'Cache-Control':'no-store'} });
    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'backend_failed', status: res.status }), { status: 500 });
    }
    data = await res.json();
  } catch (e:any) {
    return new Response(JSON.stringify({ error: 'network', details: e.message }), { status: 502 });
  }
  // Persist both aggregate files unconditionally because they always change logically (fresh recompute) even if identical
  const runtimeDir = process.env.STATS_DATA_DIR || path.join(process.cwd(),'runtime-data');
  await fs.mkdir(runtimeDir,{recursive:true});
  for (const base of AGG_FILES) {
    const key = base.replace(/\.json$/, '');
    if (data[key] !== undefined) {
      try { await fs.writeFile(path.join(runtimeDir, base), JSON.stringify(data[key], null, 2), 'utf-8'); } catch {}
    }
  }
  return new Response(JSON.stringify(data), { status: 200, headers:{'Content-Type':'application/json','Cache-Control':'no-store'} });
}
