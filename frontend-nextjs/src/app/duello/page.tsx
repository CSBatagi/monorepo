import path from 'path';
import fs from 'fs';
import DuelloTabsClient from './DuelloTabsClient';

// Server-side loader for JSON
async function loadDuelloJson(filename: string) {
  const filePath = path.join(process.cwd(), 'public', 'data', filename);
  const data = await fs.promises.readFile(filePath, 'utf-8');
  return JSON.parse(data);
}

export default async function DuelloPage() {
  const sonmacData = await loadDuelloJson('duello_son_mac.json');
  const sezonData = await loadDuelloJson('duello_sezon.json');
  return <DuelloTabsClient sonmacData={sonmacData} sezonData={sezonData} />;
} 