import { NextResponse } from 'next/server';
import { readJson } from '@/lib/dataReader';

export async function GET() {
  try {
    const data = await readJson('season_start.json');
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error reading season_start data:', error);
    return NextResponse.json({}, { status: 500 });
  }
}