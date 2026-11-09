/**
 * Ported verbatim from the owner's earlier AR studio (app/server/studio-api/sceneViewerGlb.ts).
 *
 * Makes a GLB safe for Android's Scene Viewer, which rejects models that list
 * glTF extensions it does not implement ("something wrong with this object").
 * Only the JSON chunk is rewritten; geometry and textures (BIN chunk) are kept
 * byte for byte.
 *   - KHR_materials_emissive_strength is folded into emissiveFactor (clamped)
 *   - every other extension Scene Viewer does not support is removed
 */
const SUPPORTED = new Set(['KHR_texture_transform', 'KHR_materials_unlit', 'KHR_mesh_quantization', 'KHR_draco_mesh_compression']);
const JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;

type Json = Record<string, unknown>;

export function sceneViewerSafeGlb(glb: Buffer): Buffer {
  if (glb.length < 20 || glb.toString('latin1', 0, 4) !== 'glTF' || glb.readUInt32LE(16) !== JSON_CHUNK) return glb;
  const jsonLen = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.toString('utf8', 20, 20 + jsonLen)) as Json;
  const used = (gltf.extensionsUsed as string[] | undefined) ?? [];
  if (used.every(e => SUPPORTED.has(e))) return glb;

  for (const m of (gltf.materials as Json[] | undefined) ?? []) {
    const ext = m.extensions as Json | undefined;
    if (!ext) continue;
    const strength = (ext.KHR_materials_emissive_strength as { emissiveStrength?: number } | undefined)?.emissiveStrength;
    if (strength && Array.isArray(m.emissiveFactor)) m.emissiveFactor = (m.emissiveFactor as number[]).map(v => Math.min(1, v * strength));
    for (const k of Object.keys(ext)) if (!SUPPORTED.has(k)) delete ext[k];
    if (!Object.keys(ext).length) delete m.extensions;
  }
  const keep = used.filter(e => SUPPORTED.has(e));
  if (keep.length) gltf.extensionsUsed = keep; else delete gltf.extensionsUsed;
  const required = ((gltf.extensionsRequired as string[] | undefined) ?? []).filter(e => SUPPORTED.has(e));
  if (required.length) gltf.extensionsRequired = required; else delete gltf.extensionsRequired;

  // Rebuild: header + JSON chunk (space-padded to 4 bytes) + the original BIN chunk.
  let json = Buffer.from(JSON.stringify(gltf), 'utf8');
  if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
  const rest = glb.subarray(20 + jsonLen); // BIN chunk (header + data), already aligned
  const out = Buffer.alloc(12 + 8 + json.length + rest.length);
  out.write('glTF', 0, 'latin1');
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(json.length, 12);
  out.writeUInt32LE(JSON_CHUNK, 16);
  json.copy(out, 20);
  rest.copy(out, 20 + json.length);
  if (rest.length >= 8 && rest.readUInt32LE(4) !== BIN_CHUNK) return glb; // unexpected layout: leave it alone
  return out;
}
