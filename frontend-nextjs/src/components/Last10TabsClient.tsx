"use client";
import React, { useState } from "react";
import SeasonStatsTable, { columns } from "@/components/SeasonStatsTable";
import H2HClient from "@/components/H2HClient";
import { RadarGraphs } from "./SeasonAvgRadarGraphs";

export default function Last10TabsClient({ data }: { data: any[] }) {
  const [activeTab, setActiveTab] = useState<"table" | "graph" | "head2head">("table");
  return (
    <>
      {/* Sub Tab Navigation */}
      <div className="mb-4 border-b border-gray-200">
        <ul id="last10-sub-tabs" className="flex flex-wrap -mb-px text-sm font-medium text-center" role="tablist">
          <li className="mr-2" role="presentation">
            <button className={`map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg ${activeTab === "table" ? "active border-blue-600 text-blue-600" : "border-transparent hover:text-gray-600 hover:border-gray-300"}`} id="last10-table-tab" type="button" role="tab" aria-controls="last10-tab-table" aria-selected={activeTab === "table"} onClick={() => setActiveTab("table")}>Tablo</button>
          </li>
          <li className="mr-2" role="presentation">
            <button className={`map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg ${activeTab === "graph" ? "active border-blue-600 text-blue-600" : "border-transparent hover:text-gray-600 hover:border-gray-300"}`} id="last10-graph-tab" type="button" role="tab" aria-controls="last10-tab-graph" aria-selected={activeTab === "graph"} onClick={() => setActiveTab("graph")}>Grafik</button>
          </li>
          <li className="mr-2" role="presentation">
            <button className={`map-tab-button tab-nav-item inline-block border-b-2 rounded-t-lg ${activeTab === "head2head" ? "active border-blue-600 text-blue-600" : "border-transparent hover:text-gray-600 hover:border-gray-300"}`} id="last10-head2head-tab" type="button" role="tab" aria-controls="last10-tab-head2head" aria-selected={activeTab === "head2head"} onClick={() => setActiveTab("head2head")}>Karşılaştırma</button>
          </li>
        </ul>
      </div>
      <div id="last10-tab-content">
        {/* Table Content */}
        {activeTab === "table" && (
          <div id="last10-tab-table" className="last10-tab-pane active" role="tabpanel" aria-labelledby="last10-table-tab">
            <div className="overflow-x-auto">
              <SeasonStatsTable data={data} />
            </div>
          </div>
        )}
        {/* Graph Content */}
        {activeTab === "graph" && (
          <div id="last10-tab-graph" className="last10-tab-pane active" role="tabpanel" aria-labelledby="last10-graph-tab">
            <RadarGraphs
              data={data}
              statConfig={columns.reduce((acc: Record<string, any>, col, i) => {
                acc[col.key] = { label: col.label, default: i < 5, format: col.isPercentage ? "percent" : undefined };
                return acc;
              }, {})}
              playerFilterKey="matches"
              title="Pentagon İstatistiklerini Özelleştir (Son 10)"
            />
          </div>
        )}
        {/* Head-to-Head Content */}
        {activeTab === "head2head" && (
          <div id="last10-tab-head2head" className="last10-tab-pane active" role="tabpanel" aria-labelledby="last10-head2head-tab">
            <H2HClient data={data} columns={columns} />
          </div>
        )}
      </div>
    </>
  );
} 