import { NextResponse } from 'next/server';
import { readJson } from '@/lib/dataReader';

export async function GET() {
  try {
    const data = await readJson('duello_sezon.json');
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error reading duello_sezon data:', error);
    return NextResponse.json({ playerRows: [], playerCols: [], duels: {} }, { status: 500 });
  }
}