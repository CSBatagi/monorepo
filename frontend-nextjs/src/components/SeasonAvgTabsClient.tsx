"use client";

import React, { useEffect, useMemo, useState } from "react";
import SeasonStatsTable, { columns } from "@/components/SeasonStatsTable";
import { RadarGraphs } from "@/components/SeasonAvgRadarGraphs";
import H2HClient from "@/components/H2HClient";
import { useTheme } from "@/contexts/ThemeContext";

type PeriodMeta = {
  id: string;
  label?: string;
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean;
};

type SeasonAvgPeriodPayload = {
  current_period?: string;
  periods?: PeriodMeta[];
  data?: Record<string, any[]>;
};

function buildFallbackPayload(initialData: any[]): SeasonAvgPeriodPayload {
  return {
    current_period: "season_current",
    periods: [{ id: "season_current", label: "Guncel Sezon", is_current: true }],
    data: { season_current: Array.isArray(initialData) ? initialData : [] },
  };
}

export default function SeasonAvgTabsClient({
  data: initialData,
  periodData: initialPeriodData,
}: {
  data: any[];
  periodData?: SeasonAvgPeriodPayload | null;
}) {
  const [activeTab, setActiveTab] = useState<"table" | "graph" | "head2head">("table");
  const [periodPayload, setPeriodPayload] = useState<SeasonAvgPeriodPayload>(
    initialPeriodData && initialPeriodData.data ? initialPeriodData : buildFallbackPayload(initialData || [])
  );
  const [loading, setLoading] = useState<boolean>(false);

  const periodOptions = useMemo(
    () => (Array.isArray(periodPayload?.periods) && periodPayload.periods.length ? periodPayload.periods : []),
    [periodPayload]
  );

  const [selectedPeriod, setSelectedPeriod] = useState<string>(
    periodPayload?.current_period || periodOptions[0]?.id || "season_current"
  );

  useEffect(() => {
    const hasSelected = Array.isArray(periodPayload?.data?.[selectedPeriod]);
    if (!hasSelected) {
      const next = periodPayload?.current_period || periodOptions[0]?.id || "season_current";
      setSelectedPeriod(next);
    }
  }, [periodPayload, periodOptions, selectedPeriod]);

  const selectedData = useMemo(() => {
    const fromPeriods = periodPayload?.data?.[selectedPeriod];
    if (Array.isArray(fromPeriods)) return fromPeriods;
    return [];
  }, [periodPayload, selectedPeriod]);

  useEffect(() => {
    if (selectedData.length > 0) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/stats/aggregates?_cb=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const payload = await res.json();
        if (cancelled) return;
        if (payload?.season_avg_periods?.data) {
          setPeriodPayload(payload.season_avg_periods);
          if (payload.season_avg_periods.current_period) {
            setSelectedPeriod(payload.season_avg_periods.current_period);
          }
        } else if (Array.isArray(payload?.season_avg)) {
          const fallback = buildFallbackPayload(payload.season_avg);
          setPeriodPayload(fallback);
          setSelectedPeriod(fallback.current_period || "season_current");
        }
      } catch (_) {
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedData.length]);

  const { isDark } = useTheme();

  const overlay = loading ? (
    <div className={`absolute inset-0 flex flex-col items-center justify-center text-sm ${isDark ? 'bg-[#0d1321]/80 text-gray-400' : 'bg-white/70 text-gray-600'}`}>
      <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full mb-2" />
      Istatistikler yukleniyor...
    </div>
  ) : null;

  return (
    <>
      <div className={`mb-4 p-4 border rounded-lg shadow-sm ${isDark ? 'bg-dark-surface border-dark-border' : 'bg-gray-50'}`}>
        <label htmlFor="season-avg-period-selector" className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          Donem Secin:
        </label>
        <select
          id="season-avg-period-selector"
          className={`form-select block w-full mt-1 rounded-md shadow-sm focus:ring focus:ring-opacity-50 ${isDark ? 'bg-dark-card border-dark-border text-gray-100 focus:border-blue-500 focus:ring-blue-500/20' : 'border-gray-300 focus:border-indigo-300 focus:ring-indigo-200'}`}
          value={selectedPeriod}
          onChange={(e) => setSelectedPeriod(e.target.value)}
        >
          {periodOptions.map((period) => (
            <option key={period.id} value={period.id}>
              {period.label || period.id}
            </option>
          ))}
        </select>
      </div>

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
              Karsilastirma
            </button>
          </li>
        </ul>
      </div>

      <div id="season-avg-tab-content">
        {activeTab === "table" && (
          <div id="season-avg-tab-table" className="season-avg-tab-pane active" role="tabpanel" aria-labelledby="season-avg-table-tab">
            <div className="overflow-x-auto">
              <div className="relative">
                {overlay}
                <SeasonStatsTable data={selectedData} loading={loading} />
              </div>
            </div>
          </div>
        )}

        {activeTab === "graph" && (
          <div id="season-avg-tab-graph" className="season-avg-tab-pane active" role="tabpanel" aria-labelledby="season-avg-graph-tab">
            <div className="relative">
              {overlay}
              <RadarGraphs
                data={selectedData}
                statConfig={columns.reduce((acc: Record<string, any>, col, i) => {
                  acc[col.key] = { label: col.label, default: i < 5, format: col.isPercentage ? "percent" : undefined };
                  return acc;
                }, {})}
                playerFilterKey="matches"
                title="Pentagon Istatistiklerini Ozellestir (Sezon Ortalamasi)"
              />
            </div>
          </div>
        )}

        {activeTab === "head2head" && (
          <div id="season-avg-tab-head2head" className="season-avg-tab-pane active" role="tabpanel" aria-labelledby="season-avg-head2head-tab">
            <div className="relative">
              {overlay}
              <H2HClient data={selectedData} columns={columns} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
