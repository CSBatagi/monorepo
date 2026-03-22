import Last10TabsClient from "@/components/Last10TabsClient";
import { fetchStats } from "@/lib/statsServer";

export const revalidate = 60; // seconds – data changes only when stats regenerate

export default async function Last10Page() {
  const stats = await fetchStats('last10');
  const data: any[] = Array.isArray(stats.last10) ? stats.last10 : [];
  return (
    <div id="page-last10" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Son 10 Ortalaması</h2>
      <Last10TabsClient data={data} />
    </div>
  );
}
