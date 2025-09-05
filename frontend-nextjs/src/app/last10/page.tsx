import Last10TabsClient from "@/components/Last10TabsClient";
import { readJson } from "@/lib/dataReader";

export const dynamic = 'force-dynamic';

export default async function Last10Page() {
  let data: any[] = [];
  const aggregatesUrl = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/stats/aggregates?_cb=${Date.now()}`;
  try {
    const ac = new AbortController();
    const to = setTimeout(()=>ac.abort(), 2000);
    const res = await fetch(aggregatesUrl, { cache:'no-store', signal: ac.signal });
    clearTimeout(to);
    if (res.ok) {
      const j = await res.json();
      if (Array.isArray(j.last10)) data = j.last10;
    }
  } catch {}
  if (!data.length) {
    try { const r = await readJson('last10.json'); if (Array.isArray(r)) data = r; } catch {}
  }
  return (
    <div id="page-last10" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Son 10 Ortalaması</h2>
      <Last10TabsClient data={data} />
    </div>
  );
}