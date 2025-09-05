import React from 'react';
import PerformanceGraphs from '@/components/Performance/PerformanceGraphs';
import { readJson } from '@/lib/dataReader';

export const dynamic = 'force-dynamic';

export default async function PerformancePage() {
  // Server-side read so page can stream HTML with data immediately (no client 'Loading...')
  let perfData: any[] = [];
  try {
    const data = await readJson('performance_data.json');
    if (Array.isArray(data)) perfData = data;
  } catch {}
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Performance Grafikleri</h1>
      <PerformanceGraphs initialData={perfData} />
    </div>
  );
}