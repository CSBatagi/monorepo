import { NextResponse } from 'next/server';
import { readJson } from '@/lib/dataReader';

export async function GET() {
  try {
    const data = await readJson('map_stats.json');
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error reading map_stats data:', error);
    return NextResponse.json([], { status: 500 });
  }
}
