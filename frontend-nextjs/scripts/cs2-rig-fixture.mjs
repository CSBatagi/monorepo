import fs from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
export async function loadRig(file) {
  const bytes = await fs.readFile(file), size = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + size));
  for (const m of doc.materials) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.normalTexture; }
  const json = Buffer.from(JSON.stringify(doc));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded);
  const binary = bytes.subarray(20 + size), head = Buffer.from(bytes.subarray(0,20));
  head.writeUInt32LE(20+padded.length+binary.length,8); head.writeUInt32LE(padded.length,12);
  const glb = Buffer.concat([head,padded,binary]);
  return new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset+glb.byteLength),'');
}
