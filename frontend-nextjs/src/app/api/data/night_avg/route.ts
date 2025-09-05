import { NextResponse } from 'next/server';
import { readJson } from '@/lib/dataReader';

export async function GET() {
  try {
    const data = await readJson('night_avg.json');
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error reading night_avg data:', error);
    return NextResponse.json({}, { status: 500 });
  }
}