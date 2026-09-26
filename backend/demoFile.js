'use strict';
// Structural validation of uploaded CS2 demos, run on every byte before it is forwarded to the bucket.
//
// A CS2 (Source 2) demo is the stamp "PBDEMS2\0", two little-endian offsets, then nothing but frames:
// varint command, varint tick, varint size and `size` bytes of protobuf (snappy-compressed when the
// command carries the 64 flag). The first frame must be an uncompressed DEM_FileHeader with the fields
// CS Demo Manager insists on. Walking every frame means a file that only starts like a demo (an archive
// or executable appended to a copied header) is rejected before its payload reaches storage.

const MAGIC = Buffer.from('PBDEMS2\0', 'latin1');
const PREAMBLE_BYTES = 16;
const DEM_FILE_HEADER = 1;
const MAX_COMMAND = 127; // 6 bits of command type plus the 64 "compressed" flag
const MAX_HEADER_FRAME_BYTES = 64 * 1024;
// The largest frame in a real 60 MB match demo is 2.5 MB; 32 MiB leaves room for big-lobby full packets.
const MAX_FRAME_BYTES = 32 * 1024 * 1024;
const MAX_FRAME_HEADER_BYTES = 15; // three varint32s

class DemoRejected extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const EXTRACT = 'İçindeki .dem dosyasını çıkarıp onu yükleyin.';
const FOREIGN_FORMATS = [
  { bytes: [0x50, 0x4b, 0x03, 0x04], code: 'archive', message: `Bu bir ZIP arşivi. ${EXTRACT}` },
  { bytes: [0x1f, 0x8b], code: 'archive', message: `Bu bir GZIP arşivi (.gz). ${EXTRACT}` },
  { bytes: [0x28, 0xb5, 0x2f, 0xfd], code: 'archive', message: `Bu bir Zstandard arşivi (.zst). ${EXTRACT}` },
  { bytes: [0x52, 0x61, 0x72, 0x21], code: 'archive', message: `Bu bir RAR arşivi. ${EXTRACT}` },
  { bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], code: 'archive', message: `Bu bir 7z arşivi. ${EXTRACT}` },
  { bytes: [0x42, 0x5a, 0x68], code: 'archive', message: `Bu bir BZIP2 arşivi. ${EXTRACT}` },
  { bytes: [...Buffer.from('HL2DEMO\0', 'latin1')], code: 'csgo_demo', message: 'Bu bir CS:GO demosu; yalnızca CS2 demoları yüklenebilir.' },
];

const corrupt = detail => new DemoRejected('corrupt', `Demo dosyası bozuk görünüyor (${detail}).`);

// Returns null when the buffer ends before the varint does.
function readVarint(buffer, position, maxBytes = 5) {
  let value = 0;
  for (let index = 0; index < maxBytes; index++) {
    if (position + index >= buffer.length) return null;
    const byte = buffer[position + index];
    value += (byte & 0x7f) * 2 ** (7 * index);
    if (!(byte & 0x80)) return { value, length: index + 1 };
  }
  throw corrupt('geçersiz sayı kodlaması');
}

const HEADER_FIELDS = {
  1: ['demoFileStamp', 'string'],
  2: ['patchVersion', 'int'],
  3: ['serverName', 'string'],
  4: ['clientName', 'string'],
  5: ['mapName', 'string'],
  6: ['gameDirectory', 'string'],
  11: ['demoVersionName', 'string'],
  12: ['demoVersionGuid', 'string'],
  13: ['buildNum', 'int'],
  14: ['game', 'string'],
};

// Minimal protobuf reader for CDemoFileHeader; unknown fields are skipped by wire type.
function parseFileHeader(bytes) {
  const header = {};
  let position = 0;
  while (position < bytes.length) {
    const key = readVarint(bytes, position, 10);
    if (!key) throw corrupt('başlık yarım');
    position += key.length;
    const field = Math.floor(key.value / 8);
    const wire = key.value % 8;
    const known = HEADER_FIELDS[field];
    if (wire === 0) {
      const value = readVarint(bytes, position, 10);
      if (!value) throw corrupt('başlık yarım');
      position += value.length;
      if (known && known[1] === 'int') header[known[0]] = value.value;
    } else if (wire === 2) {
      const length = readVarint(bytes, position, 10);
      if (!length || position + length.length + length.value > bytes.length) throw corrupt('başlık yarım');
      position += length.length;
      // NUL padding (the stamp is "PBDEMS2\0") is dropped: Postgres text and JSONB cannot store it.
      if (known && known[1] === 'string') header[known[0]] = bytes.toString('utf8', position, position + length.value).replace(/\0/g, '');
      position += length.value;
    } else if (wire === 1 || wire === 5) {
      position += wire === 1 ? 8 : 4;
      if (position > bytes.length) throw corrupt('başlık yarım');
    } else {
      throw corrupt('başlık okunamadı');
    }
  }
  return header;
}

// Checks the stamp and the DEM_FileHeader frame. `buffer` must hold at least the first frame.
function inspectDemoStart(buffer) {
  for (const format of FOREIGN_FORMATS) {
    if (buffer.length >= format.bytes.length && format.bytes.every((byte, index) => buffer[index] === byte)) {
      throw new DemoRejected(format.code, format.message);
    }
  }
  if (buffer.length < PREAMBLE_BYTES || !buffer.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new DemoRejected('not_demo', 'Bu dosya bir CS2 demosu değil (.dem başlığı bulunamadı).');
  }
  const command = readVarint(buffer, PREAMBLE_BYTES);
  const tick = command && readVarint(buffer, PREAMBLE_BYTES + command.length);
  const size = tick && readVarint(buffer, PREAMBLE_BYTES + command.length + tick.length);
  // CS Demo Manager rejects anything but an uncompressed file header as the first message.
  if (!size || command.value !== DEM_FILE_HEADER || size.value > MAX_HEADER_FRAME_BYTES) {
    throw new DemoRejected('bad_header', 'Demo başlığı okunamadı; dosya eksik veya bozuk.');
  }
  const start = PREAMBLE_BYTES + command.length + tick.length + size.length;
  if (start + size.value > buffer.length) throw new DemoRejected('bad_header', 'Demo başlığı okunamadı; dosya eksik veya bozuk.');
  const header = parseFileHeader(buffer.subarray(start, start + size.value));
  const stamp = header.demoFileStamp || '';
  const required = ['patchVersion', 'serverName', 'clientName', 'mapName', 'buildNum', 'demoVersionGuid', 'demoVersionName'];
  if (stamp !== 'PBDEMS2' || required.some(field => !header[field])) {
    throw new DemoRejected('bad_header', 'Demo başlığında gerekli bilgiler eksik; CS Demo Manager bu dosyayı okuyamaz.');
  }
  // Dota 2 and Deadlock share the Source 2 format; only the csgo game directory is Counter-Strike 2.
  const directory = (header.gameDirectory || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  if (header.gameDirectory && directory !== 'csgo') {
    throw new DemoRejected('not_cs2', 'Bu demo Counter-Strike 2 dışında bir oyundan.');
  }
  if (header.mapName.length > 128) throw corrupt('harita adı');
  return { header, firstFrameEnd: start + size.value };
}

function initialScanState() {
  return { next: PREAMBLE_BYTES, carry: '', frames: 0, truncated: false };
}

// Walks the frames that start inside [chunkStart, chunkStart + chunk.length). Frame bodies are opaque
// and may span many chunks; a frame header split across two chunks is carried over (at most 14 bytes).
// The returned state is plain JSON so it survives in the database between chunk requests.
function scanChunk(state, chunk, chunkStart, totalSize) {
  const carry = state.carry ? Buffer.from(state.carry, 'base64') : Buffer.alloc(0);
  const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
  const dataStart = chunkStart - carry.length;
  const chunkEnd = chunkStart + chunk.length;
  if (state.next < dataStart) throw corrupt('çerçeve sırası');
  let { next, frames } = state;
  while (next < chunkEnd) {
    const position = next - dataStart;
    const command = readVarint(data, position);
    const tick = command && readVarint(data, position + command.length);
    const size = tick && readVarint(data, position + command.length + tick.length);
    if (!size) {
      if (chunkEnd >= totalSize) return { next, carry: '', frames, truncated: true };
      if (data.length - position >= MAX_FRAME_HEADER_BYTES) throw corrupt('çerçeve başlığı');
      return { next, carry: data.subarray(position).toString('base64'), frames, truncated: false };
    }
    if (command.value > MAX_COMMAND) throw corrupt(`bilinmeyen çerçeve türü ${command.value}`);
    if (size.value > MAX_FRAME_BYTES) throw corrupt('çerçeve çok büyük');
    next += command.length + tick.length + size.length + size.value;
    frames += 1;
  }
  // A recording cut off mid-frame is kept but flagged; everything before the cut was well formed.
  return { next, carry: '', frames, truncated: chunkEnd >= totalSize && next > totalSize };
}

// Map name as CS Demo Manager stores it (workshop prefix and scrimmage suffix removed).
function displayMapName(mapName) {
  return String(mapName || '').replace(/^workshop\/\d+\//, '').replaceAll('_scrimmagemap', '').slice(0, 64) || null;
}

module.exports = { DemoRejected, inspectDemoStart, initialScanState, scanChunk, parseFileHeader, readVarint, displayMapName, MAX_FRAME_BYTES };
