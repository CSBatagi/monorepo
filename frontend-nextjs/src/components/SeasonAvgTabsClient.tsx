"use client";
import React, { useState, useEffect } from "react";
import SeasonStatsTable, { columns } from "@/components/SeasonStatsTable";
import { RadarGraphs } from "@/components/SeasonAvgRadarGraphs";
import H2HClient from "@/components/H2HClient";

export default function SeasonAvgTabsClient({ data: initialData }: { data: any[] }) {
  const [activeTab, setActiveTab] = useState<"table" | "graph" | "head2head">("table");
  const [data, setData] = useState<any[]>(initialData || []);
  const [perfData, setPerfData] = useState<any[] | null>(null); // keep placeholder if later needed
  const loadError = null;
  const [loading, setLoading] = useState<boolean>(!initialData || initialData.length === 0);

  useEffect(() => {
    if (data.length > 0) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/stats/aggregates?_cb=${Date.now()}`, { cache:'no-store' });
        if (res.ok) {
          const j = await res.json();
          if (!cancelled && Array.isArray(j.season_avg) && j.season_avg.length) { setData(j.season_avg); }
        }
      } catch(_) {} finally { if(!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [data.length]);

  const overlay = loading ? (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/70 text-sm text-gray-600">
      <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full mb-2" />
      İstatistikler yükleniyor...
    </div>
  ) : null;

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[SeasonAvgTabsClient] data length', data?.length);
      if (data && data.length) console.log('[SeasonAvg sample]', data[0]);
    }
  }, [data]);

  return (
    <>
      {/* Sub Tab Navigation */}
      <div className="mb-4 border-b border-gray-200">
        <ul id="season-avg-sub-tabs" className="flex flex-wrap -mb-px text-sm font-medium text-center" role="tablist">
          <li className="mr-2" role="presentation">
            <button
              className={`map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg ${activeTab === "table" ? "active border-blue-600 text-blue-600" : "border-transparent hover:text-gray-600 hover:border-gray-300"}`}
              id="season-avg-table-tab"
              type="button"
              role="tab"
              aria-controls="season-avg-tab-table"
              aria-selected={activeTab === "table"}
              onClick={() => setActiveTab("table")}
            >
              Tablo
            </button>
          </li>
          <li className="mr-2" role="presentation">
            <button
              className={`map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg ${activeTab === "graph" ? "active border-blue-600 text-blue-600" : "border-transparent hover:text-gray-600 hover:border-gray-300"}`}
              id="season-avg-graph-tab"
              type="button"
              role="tab"
              aria-controls="season-avg-tab-graph"
              aria-selected={activeTab === "graph"}
              onClick={() => setActiveTab("graph")}
            >
              Grafik
            </button>
          </li>
          <li className="mr-2" role="presentation">
            <button
              className={`map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg ${activeTab === "head2head" ? "active border-blue-600 text-blue-600" : "border-transparent hover:text-gray-600 hover:border-gray-300"}`}
              id="season-avg-head2head-tab"
              type="button"
              role="tab"
              aria-controls="season-avg-tab-head2head"
              aria-selected={activeTab === "head2head"}
              onClick={() => setActiveTab("head2head")}
            >
              Karşılaştırma
            </button>
          </li>
        </ul>
      </div>
      <div id="season-avg-tab-content">
        {/* Table Content */}
        {activeTab === "table" && (
          <div id="season-avg-tab-table" className="season-avg-tab-pane active" role="tabpanel" aria-labelledby="season-avg-table-tab">
            <div className="overflow-x-auto">
              {loadError && data.length === 0 ? (
                <div className="p-4 text-sm text-red-600">{loadError} – Önbellekte veri yok.</div>
              ) : (
                <div className="relative">
                  {overlay}
                  <SeasonStatsTable data={data} loading={loading} />
                </div>
              )}
            </div>
          </div>
        )}
        {/* Graph Content */}
        {activeTab === "graph" && (
          <div id="season-avg-tab-graph" className="season-avg-tab-pane active" role="tabpanel" aria-labelledby="season-avg-graph-tab">
              <div className="relative">
                {overlay}
                <RadarGraphs
              data={data}
              statConfig={columns.reduce((acc: Record<string, any>, col, i) => {
                acc[col.key] = { label: col.label, default: i < 5, format: col.isPercentage ? "percent" : undefined };
                return acc;
              }, {})}
              playerFilterKey="matches"
              title="Pentagon İstatistiklerini Özelleştir (Sezon Ortalaması)"
                />
              </div>
          </div>
        )}
        {/* Head-to-Head Content */}
        {activeTab === "head2head" && (
          <div id="season-avg-tab-head2head" className="season-avg-tab-pane active" role="tabpanel" aria-labelledby="season-avg-head2head-tab">
            <div className="relative">
              {overlay}
              <H2HClient data={data} columns={columns} />
            </div>
          </div>
        )}
      </div>
    </>
  );
} 