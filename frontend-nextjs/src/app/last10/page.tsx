import path from "path";
import fs from "fs/promises";
import Last10TabsClient from "@/components/Last10TabsClient";

export default async function Last10Page() {
  // Read the JSON file from the public directory at build/runtime
  const filePath = path.join(process.cwd(), "frontend-nextjs/public/data/last10.json");
  let data: any[] | null = [];
  try {
    const file = await fs.readFile(filePath, "utf-8");
    data = JSON.parse(file);
  } catch (e) {
    // fallback: try relative to root (for Vercel/production)
    try {
      const file = await fs.readFile(path.join(process.cwd(), "public/data/last10.json"), "utf-8");
      data = JSON.parse(file);
    } catch (e2) {
      data = null;
    }
  }

  return (
    <div id="page-last10" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-4">Son 10 Ortalaması</h2>
      <Last10TabsClient data={data || []} />
    </div>
  );
} 