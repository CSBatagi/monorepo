import SonMacClient from "@/components/SonMacClient";
import { readJson } from "@/lib/dataReader";

// Force dynamic so we always re-evaluate filesystem each request
export const dynamic = 'force-dynamic';

export default async function SonMacPage() {
  const allData: Record<string, any> = (await readJson('sonmac_by_date.json')) || {};
  const dates = Object.keys(allData).sort((a, b) => b.localeCompare(a));

  return (
    <div id="page-sonmac" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Son Maç</h2>
      <SonMacClient allData={allData} dates={dates} />
    </div>
  );
}