import fs from 'fs/promises';
import path from 'path';
import { Player } from '@/types';
import AttendanceClient from './AttendanceClient';

export const revalidate = 60;

export default async function AttendancePage() {
  let players: Player[] = [];
  try {
    const filePath = path.join(process.cwd(), 'public', 'data', 'players.json');
    const raw = await fs.readFile(filePath, 'utf-8');
    players = JSON.parse(raw);
  } catch (error) {
    console.error('Failed to read players.json:', error);
  }

  return <AttendanceClient players={players} />;
}
