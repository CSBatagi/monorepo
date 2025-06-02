import NightAvgTableClient from "@/components/NightAvgTableClient";
import path from "path";
import fs from "fs/promises";

export default async function GeceOrtalamasiPage() {
  // Read the JSON file from the public directory at build/runtime
  const filePath = path.join(process.cwd(), "frontend-nextjs/public/data/night_avg.json");
  let allData: Record<string, any[]> = {};
  try {
    const file = await fs.readFile(filePath, "utf-8");
    allData = JSON.parse(file);
  } catch (e) {
    // fallback: try relative to root (for Vercel/production)
    try {
      const file = await fs.readFile(path.join(process.cwd(), "public/data/night_avg.json"), "utf-8");
      allData = JSON.parse(file);
    } catch (e2) {
      allData = {};
    }
  }
  const dates = Object.keys(allData).sort((a, b) => b.localeCompare(a));

  return (
    <div id="page-gece_ortalama" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Gece Ortalaması</h2>
      <NightAvgTableClient allData={allData} dates={dates} />
      {/* All tab content is handled inside NightAvgTableClient */}
    </div>
  );
} 