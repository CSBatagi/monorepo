import { NextRequest, NextResponse } from 'next/server';
import { gameControl } from '@/lib/gameControl';

export const runtime = 'nodejs';

const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Middleware buffers request bodies (and truncates them past 10 MB), so demos travel in 4 MiB chunks.
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

/** Relays one chunk of an upload; the backend checks its offset, length and content. */
export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const offset = req.nextUrl.searchParams.get('offset') || '';
  if (!UPLOAD_ID.test(id) || !/^\d{1,13}$/.test(offset)) return NextResponse.json({ error: 'Geçersiz yükleme isteği.' }, { status: 400 });
  if (Number(req.headers.get('content-length') || 0) > MAX_CHUNK_BYTES) return NextResponse.json({ error: 'Parça çok büyük.' }, { status: 413 });
  const body = await req.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_CHUNK_BYTES) return NextResponse.json({ error: 'Parça boyutu geçersiz.' }, { status: 413 });
  return gameControl(req, `demo-uploads/${id}?offset=${offset}`, 'PUT', { body, contentType: 'application/octet-stream' });
}

/** Cancels the member's own unfinished upload. */
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UPLOAD_ID.test(id)) return NextResponse.json({ error: 'Geçersiz yükleme.' }, { status: 400 });
  return gameControl(req, `demo-uploads/${id}`, 'DELETE');
}
