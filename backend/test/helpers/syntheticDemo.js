// Builds byte-accurate CS2 demos for tests: "PBDEMS2\0", two offsets, then varint-framed messages.
// The layout matches real match demos (see demoFile.js); frame payloads are filler.

function varint(value) {
  const bytes = [];
  let rest = value;
  do {
    let byte = rest % 128;
    rest = Math.floor(rest / 128);
    if (rest > 0) byte |= 0x80;
    bytes.push(byte);
  } while (rest > 0);
  return Buffer.from(bytes);
}

function protoString(field, value) {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([varint(field * 8 + 2), varint(bytes.length), bytes]);
}

function protoInt(field, value) {
  return Buffer.concat([varint(field * 8), varint(value)]);
}

const DEFAULT_HEADER = {
  demoFileStamp: 'PBDEMS2\0',
  patchVersion: 14090,
  serverName: 'XPLAY.GG | 5v5 Competitive #12',
  clientName: 'SourceTV Demo',
  mapName: 'de_mirage',
  gameDirectory: '/home/container/game/csgo',
  demoVersionName: 'valve_demo_2',
  demoVersionGuid: '8e9d71ab-04a1-4c01-bb61-acfede27c046',
  buildNum: 10542,
};

function headerMessage(overrides = {}) {
  const header = { ...DEFAULT_HEADER, ...overrides };
  const parts = [];
  if (header.demoFileStamp !== undefined) parts.push(protoString(1, header.demoFileStamp));
  if (header.patchVersion !== undefined) parts.push(protoInt(2, header.patchVersion));
  if (header.serverName !== undefined) parts.push(protoString(3, header.serverName));
  if (header.clientName !== undefined) parts.push(protoString(4, header.clientName));
  if (header.mapName !== undefined) parts.push(protoString(5, header.mapName));
  if (header.gameDirectory !== undefined) parts.push(protoString(6, header.gameDirectory));
  parts.push(protoInt(7, 2), protoInt(8, 1));
  if (header.demoVersionName !== undefined) parts.push(protoString(11, header.demoVersionName));
  if (header.demoVersionGuid !== undefined) parts.push(protoString(12, header.demoVersionGuid));
  if (header.buildNum !== undefined) parts.push(protoInt(13, header.buildNum));
  return Buffer.concat(parts);
}

function frame(command, tick, payload) {
  return Buffer.concat([varint(command), varint(tick), varint(payload.length), payload]);
}

// `packets` frames of `packetBytes` each, then DEM_Stop, SpawnGroups and FileInfo like a real recording.
function syntheticDemo({ header = {}, headerCommand = 1, packets = 20, packetBytes = 1000 } = {}) {
  const frames = [frame(headerCommand, 0xffffffff, headerMessage(header)), frame(8, 0xffffffff, Buffer.alloc(16, 1))];
  for (let index = 0; index < packets; index++) {
    const payload = Buffer.alloc(packetBytes, index % 251);
    frames.push(frame(index % 3 === 0 ? 71 : 7, index * 4, payload));
  }
  frames.push(frame(0, packets * 4, Buffer.alloc(0)), frame(15, packets * 4, Buffer.alloc(3, 2)), frame(2, packets * 4, Buffer.alloc(16, 3)));
  const body = Buffer.concat(frames);
  const preamble = Buffer.alloc(16);
  Buffer.from('PBDEMS2\0', 'latin1').copy(preamble);
  preamble.writeUInt32LE(16 + body.length - 18, 8);
  preamble.writeUInt32LE(16 + body.length - 23, 12);
  return Buffer.concat([preamble, body]);
}

module.exports = { syntheticDemo, frame, headerMessage, varint };
