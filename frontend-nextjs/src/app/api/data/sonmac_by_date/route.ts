import { NextResponse } from 'next/server';
import { readJson } from '@/lib/dataReader';

export async function GET() {
  try {
    const data = await readJson('sonmac_by_date.json');
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error reading sonmac_by_date data:', error);
    return NextResponse.json({}, { status: 500 });
  }
}