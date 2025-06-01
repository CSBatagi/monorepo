import { loadKabileList } from '@/utils/loadKabileList';
import TeamPickerClient from './TeamPickerClient';

export default async function TeamPickerPage() {
  const kabileList = await loadKabileList();
  return <TeamPickerClient kabileList={kabileList} />;
}