import MacSonuclariClient from "@/components/MacSonuclariClient";
import { readJson } from "@/lib/dataReader";

export const dynamic = 'force-dynamic';

async function tryBackend(timeoutMs=1500){
  const backendBase = process.env.BACKEND_INTERNAL_URL || 'http://backend:3000';
  const url = `${backendBase}/stats/incremental?_cb=${Date.now()}`;
  try {
    const ac = new AbortController();
    const t = setTimeout(()=>ac.abort(), timeoutMs);
    const res = await fetch(url,{cache:'no-store', headers:{'Cache-Control':'no-store','Pragma':'no-cache'}, signal: ac.signal});
    clearTimeout(t);
    if(!res.ok) return null;
    const j = await res.json();
    if (j && j.sonmac_by_date && typeof j.sonmac_by_date === 'object') return j.sonmac_by_date;
  } catch(e){
    console.log('[mac-sonuclari] backend fetch failed', (e as any)?.message);
  }
  return null;
}

export default async function MacSonuclariPage() {
  let allData: Record<string, any> = (await readJson('sonmac_by_date.json')) || {};
  if (!allData || Object.keys(allData).length === 0) {
    const regen = await tryBackend();
    if (regen) {
      allData = regen;
      console.log('[mac-sonuclari] Filled empty dataset from backend');
    }
  }
  const dates = Object.keys(allData || {}).sort((a, b) => b.localeCompare(a));

  return (
    <div id="page-mac-sonuclari" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Maç Sonuçları</h2>
      <MacSonuclariClient allData={allData} dates={dates} />
    </div>
  );
}
