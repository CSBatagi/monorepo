import DuelloTabsClient from './DuelloTabsClient';
import { fetchStats } from "@/lib/statsServer";

export const revalidate = 60; // seconds – data changes only when stats regenerate

export default async function DuelloPage() {
  const stats = await fetchStats('duello_sezon');
  const sezonData = stats.duello_sezon || { playerRows: [], playerCols: [], duels: {} };
  return <DuelloTabsClient sezonData={sezonData} />;
}
