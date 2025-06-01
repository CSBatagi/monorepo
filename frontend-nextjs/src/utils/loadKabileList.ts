import { promises as fs } from 'fs';
import path from 'path';

export async function loadKabileList(): Promise<string[]> {
  const kabilePath = path.join(process.cwd(), 'public', 'data', 'kabile.json');
  const data = await fs.readFile(kabilePath, 'utf-8');
  return JSON.parse(data);
} 