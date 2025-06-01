"use client";
import React, { useState } from "react";
import SeasonStatsTable, { columns } from "@/components/SeasonStatsTable";
import { RadarGraphs } from "@/components/SeasonAvgRadarGraphs";
import H2HClient from "@/components/H2HClient";

export default function SeasonAvgTabsClient({ data }: { data: any[] }) {
  const [activeTab, setActiveTab] = useState<"table" | "graph" | "head2head">("table");

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
              <SeasonStatsTable data={data} />
            </div>
          </div>
        )}
        {/* Graph Content */}
        {activeTab === "graph" && (
          <div id="season-avg-tab-graph" className="season-avg-tab-pane active" role="tabpanel" aria-labelledby="season-avg-graph-tab">
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
        )}
        {/* Head-to-Head Content */}
        {activeTab === "head2head" && (
          <div id="season-avg-tab-head2head" className="season-avg-tab-pane active" role="tabpanel" aria-labelledby="season-avg-head2head-tab">
            <H2HClient data={data} columns={columns} />
          </div>
        )}
      </div>
    </>
  );
} 