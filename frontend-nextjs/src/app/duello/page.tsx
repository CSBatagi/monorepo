import DuelloTabsClient from './DuelloTabsClient';
import { readJson } from "@/lib/dataReader";

export const revalidate = 60; // seconds – data changes only when stats regenerate

export default async function DuelloPage() {
  const sonmacData = (await readJson('duello_son_mac.json')) || { playerRows: [], playerCols: [], duels: {} };
  const sezonData = (await readJson('duello_sezon.json')) || { playerRows: [], playerCols: [], duels: {} };
  return <DuelloTabsClient sonmacData={sonmacData} sezonData={sezonData} />;
}