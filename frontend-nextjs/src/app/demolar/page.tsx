import DemolarClient from '@/components/DemolarClient';

export const dynamic = 'force-dynamic';

export default function DemolarPage() {
  return (
    <div id="page-demolar" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-1">Demolar</h2>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
        Sunucuda kaydedilen maç demoları. İndirip CS2 içinde veya CS Demo Manager ile izleyebilirsiniz; tamamlanan maçlar otomatik olarak istatistiklere işlenir.
      </p>
      <DemolarClient />
    </div>
  );
}
