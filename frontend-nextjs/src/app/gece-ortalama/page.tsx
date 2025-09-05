import NightAvgTableClient from "@/components/NightAvgTableClient";
import { readJson } from "@/lib/dataReader";

export const dynamic = 'force-dynamic';

export default async function GeceOrtalamasiPage() {
  let allData: Record<string, any[]> = {};
  try { const r = await readJson('night_avg.json'); if (r && typeof r === 'object' && !Array.isArray(r)) allData = r; } catch {}
  const dates = Object.keys(allData).sort((a,b)=>b.localeCompare(a));
  return (
    <div id="page-gece_ortalama" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Gece Ortalaması</h2>
      <NightAvgTableClient allData={allData} dates={dates} />
    </div>
  );
}