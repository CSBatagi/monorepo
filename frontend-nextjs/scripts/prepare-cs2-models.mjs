import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Offline asset preparation only. No conversion work runs on the web server.
const downloads = process.argv[2];
if (!downloads) throw new Error('Usage: node scripts/prepare-cs2-models.mjs <download-directory>');
const output = path.resolve('public/models/cinematic');
await fs.mkdir(output, { recursive: true });
for (const [name, filename] of [['sas', 'sas__cs2_agent_model_blue.glb'], ['phoenix', 'phoenix__cs2_agent_model.glb']]) {
  const source = await fs.readFile(path.join(downloads, filename));
  const jsonLength = source.readUInt32LE(12);
  const original = JSON.parse(source.subarray(20, 20 + jsonLength));
  const binary = source.subarray(28 + jsonLength);
  for (const low of [true, false]) {
    const doc = structuredClone(original), oldViews = doc.bufferViews, oldAccessors = doc.accessors;
    const chunks = [], views = [], accessors = [], remap = new Map(), viewRemap = new Map();
    let size = 0;
    const add = bytes => {
      const index = views.length;
      views.push({ buffer: 0, byteOffset: size, byteLength: bytes.length });
      chunks.push(bytes, Buffer.alloc((4 - bytes.length % 4) % 4));
      size += Math.ceil(bytes.length / 4) * 4;
      return index;
    };
    const accessor = id => {
      if (remap.has(id)) return remap.get(id);
      const a = structuredClone(oldAccessors[id]), v = oldViews[a.bufferView];
      const view = viewRemap.get(a.bufferView) ?? add(binary.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength));
      viewRemap.set(a.bufferView, view);
      if (v.byteStride) views[view].byteStride = v.byteStride;
      a.bufferView = view;
      const next = accessors.length; accessors.push(a); remap.set(id, next); return next;
    };
    for (const mesh of doc.meshes) for (const primitive of mesh.primitives) {
      delete primitive.attributes.TEXCOORD_1;
      if (low) delete primitive.attributes.TANGENT;
      for (const key of Object.keys(primitive.attributes)) primitive.attributes[key] = accessor(primitive.attributes[key]);
      if (primitive.indices !== undefined) primitive.indices = accessor(primitive.indices);
    }
    for (const skin of doc.skins) skin.inverseBindMatrices = accessor(skin.inverseBindMatrices);
    delete doc.animations;
    const images = [], textures = [];
    let decodedBytes = 0;
    async function texture(reference, normal = false) {
      if (!reference) return undefined;
      const oldTexture = original.textures[reference.index], oldImage = original.images[oldTexture.source];
      const v = oldViews[oldImage.bufferView];
      const bytes = binary.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
      const max = low ? 512 : normal ? 512 : 1024;
      const { data, info } = await sharp(bytes).resize(max, max, { fit: 'inside', withoutEnlargement: true }).png({ palette: false }).toBuffer({ resolveWithObject: true });
      // JPEG for opaque albedo; PNG for normal maps and transparent lenses.
      const encoded = !normal ? await sharp(data).jpeg({ quality: low ? 78 : 86 }).toBuffer() : data;
      const jpeg = encoded[0] === 255;
      decodedBytes += info.width * info.height * 4 * 4 / 3;
      const index = textures.length;
      textures.push({ source: images.length, sampler: oldTexture.sampler });
      images.push({ bufferView: add(encoded), mimeType: jpeg ? 'image/jpeg' : 'image/png' });
      return { index };
    }
    for (const material of doc.materials) {
      const pbr = material.pbrMetallicRoughness ||= {};
      pbr.baseColorTexture = await texture(pbr.baseColorTexture);
      pbr.metallicFactor = 0; pbr.roughnessFactor = .85;
      delete pbr.metallicRoughnessTexture; delete material.occlusionTexture; delete material.emissiveTexture;
      if (low) delete material.normalTexture;
      else material.normalTexture = await texture(material.normalTexture, true);
      delete material.extensions;
    }
    delete doc.extensionsUsed; delete doc.extensionsRequired;
    doc.accessors = accessors; doc.bufferViews = views; doc.images = images; doc.textures = textures;
    doc.buffers = [{ byteLength: size }];
    const json = Buffer.from(JSON.stringify(doc));
    const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded);
    const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4);
    header.writeUInt32LE(28 + padded.length + size, 8); header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(size); binHeader.writeUInt32LE(0x004e4942, 4);
    const result = Buffer.concat([header, padded, binHeader, ...chunks]);
    const file = `${name}-${low ? 'mobile' : 'desktop'}.glb`;
    await fs.writeFile(path.join(output, file), result);
    console.log(JSON.stringify({ file, bytes: result.length, textureMemoryMiB: +(decodedBytes / 1048576).toFixed(2), triangles: doc.meshes.reduce((n,m)=>n+m.primitives.reduce((n,p)=>n+doc.accessors[p.indices].count/3,0),0), animationsRemoved: original.animations?.length || 0 }));
  }
}
