import { NextResponse } from 'next/server';
import { readJson } from '@/lib/dataReader';

export async function GET() {
  try {
    const data = await readJson('last10.json');
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error reading last10 data:', error);
    return NextResponse.json([], { status: 500 });
  }
}