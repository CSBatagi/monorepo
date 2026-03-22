import React from 'react';
import PerformanceGraphs from '@/components/Performance/PerformanceGraphs';
import { fetchStats } from '@/lib/statsServer';

export const revalidate = 60; // seconds – data changes only when stats regenerate

export default async function PerformancePage() {
  const stats = await fetchStats('performance_data');
  const perfData = Array.isArray(stats.performance_data) ? stats.performance_data : [];
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Performance Grafikleri</h1>
      <PerformanceGraphs initialData={perfData} />
    </div>
  );
}