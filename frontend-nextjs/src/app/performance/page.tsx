import React from 'react';
import PerformanceGraphs from '@/components/Performance/PerformanceGraphs';

const PerformancePage = () => {
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Performance Graphs</h1>
      <PerformanceGraphs />
    </div>
  );
};

export default PerformancePage; 