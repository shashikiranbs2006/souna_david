import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ViewerOptions, ViewerSpecs } from '../types.ts';
import { disposeParts, loadKitAssets, type PartPiece } from '../kit/assets.ts';
import { buildSauna } from '../kit/build.ts';
import { disposeMaterials, makeMaterials, type KitMaterials } from '../kit/materials.ts';
import type { KitSpec } from '../kit/spec.ts';

/**
 * Ported from the owner's earlier AR studio (app/client/studio/features/sauna/ar/exportArModel.ts),
 * which works on real phones. Verbatim: bake, potTexture, repairTangents, texturesLoaded,
 * lightAtlas, the FRONT_CLEARANCE placement in faceTheViewer and the exporter options.
 * Adapted: the scene comes from our construction kit (three/kit) instead of the studio's
 * ModuleAssembler, so the kit's material slots, door pivot and light geometry are mapped here.
 *
 * The exact configured sauna as files for the phone's own AR viewers, the way
 * web shops ship "View in your room": a GLB for Android Scene Viewer and a
 * USDZ for iPhone Quick Look, both at true scale (1 unit = 1 m).
 *
 * Normalised for AR: door closed (or open, on request), real lights replaced by
 * baked light layers and a warm glow in the wood, the inner floor removed (the
 * real floor shows), inside surfaces visible from both sides (people can walk
 * into the true-size model), footprint behind the origin with the door towards
 * the viewer, floor at y = 0, and everything merged into one mesh per material -
 * the native viewers handle a few plain meshes far better than hundreds of parts.
 */
export interface ArModel {
  glb: ArrayBuffer;
  usdz: Uint8Array;
}

/** The kit spec the 3D view builds for these specs and options (same as KitSauna). */
export function kitSpecOf(specs: ViewerSpecs, options: ViewerOptions): KitSpec {
  return { ...options, form: specs.form, width: specs.widthMm / 1000, depth: specs.depthMm / 1000, height: specs.heightMm / 1000 };
}

/** Loads the kit's parts and textures (no canvas needed) and exports the configured sauna. */
export async function exportArModel(specs: ViewerSpecs, options: ViewerOptions, opts: { doorOpen?: boolean } = {}): Promise<ArModel> {
  const spec = kitSpecOf(specs, options);
  const assets = await loadKitAssets();
  const materials = makeMaterials(spec, assets.wood);
  try {
    return await exportKitArModel(spec, materials, assets.parts, opts);
  } finally {
    disposeMaterials(materials);
    disposeParts(assets.parts);
    for (const w of Object.values(assets.wood)) {
      w.map.dispose();
      w.normal?.dispose();
    }
  }
}

/** Builds the kit sauna for `spec` with materials `M` and exports it (the testable core). */
export async function exportKitArModel(spec: KitSpec, M: KitMaterials, library?: Map<string, PartPiece[]>, opts: { doorOpen?: boolean } = {}): Promise<ArModel> {
  // Slot names: the material name is what the AR steps below key on.
  for (const [slot, m] of Object.entries(M)) (m as THREE.Material).name = slot;
  const { group } = buildSauna(spec, M, library);
  const root = new THREE.Group();
  root.add(group);
  try {
    await texturesLoaded(root);
    const pivot = group.getObjectByName('door-pivot') ?? null;
    const front = doorOutward(root, pivot);
    if (opts.doorOpen && pivot) pivot.rotation.y = pivot.userData.openAngle as number;
    root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // The door glass looks like the fixed glass: one transparent material (Scene Viewer allows two).
      if (mesh.material === M.doorGlass) mesh.material = M.glass;
      if (mesh.material === M.floor) mesh.name = 'floor';
    });
    root.add(lightLayers(root, M));
    const scene = bake(root);
    faceTheViewer(scene, front);
    const [{ GLTFExporter }, { USDZExporter }] = await Promise.all([
      import('three/addons/exporters/GLTFExporter.js'),
      import('three/addons/exporters/USDZExporter.js'),
    ]);
    const glb = await new GLTFExporter().parseAsync(scene, { binary: true, maxTextureSize: 1024, onlyVisible: true }) as ArrayBuffer;
    const usdz = await new USDZExporter().parseAsync(scene, { maxTextureSize: 1024, quickLookCompatible: true });
    scene.traverse(o => (o as THREE.Mesh).geometry?.dispose());
    return { glb, usdz };
  } finally {
    root.traverse(o => (o as THREE.Mesh).geometry?.dispose());
  }
}

/**
 * Adapted: the plan direction the closed door faces, outwards, in the scene's frame.
 * Swinging the leaf a little about its vertical hinge moves its centre at right
 * angles to the leaf, and the kit swings doors outwards, so that move is the
 * door's outward normal - for every form, also turned barrels and diagonal doors.
 */
function doorOutward(root: THREE.Object3D, pivot: THREE.Object3D | null): THREE.Vector3 {
  const fallback = new THREE.Vector3(0, 0, 1);
  if (!pivot) return fallback;
  const leaf = pivot.getObjectByName('door-leaf') ?? pivot;
  root.updateMatrixWorld(true);
  const shut = new THREE.Box3().setFromObject(leaf).getCenter(new THREE.Vector3());
  const local = pivot.worldToLocal(shut.clone());
  const angle = pivot.rotation.y;
  pivot.rotation.y = angle + Math.sign((pivot.userData.openAngle as number) || 1) * 0.05;
  root.updateMatrixWorld(true);
  const moved = pivot.localToWorld(local);
  pivot.rotation.y = angle;
  root.updateMatrixWorld(true);
  const d = moved.sub(shut).setY(0);
  return d.lengthSq() > 1e-12 ? d.normalize() : fallback;
}

/**
 * Android's Scene Viewer puts the model's origin where the phone points, about
 * a metre ahead - a 2.5 m sauna centred there surrounds the viewer, who then
 * only sees the inside. So: turn the glass door towards the viewer (+Z, the
 * viewers' "front") and move the whole footprint behind the origin with a
 * little space, so both viewers start outside, looking at the front.
 */
const FRONT_CLEARANCE = 0.5; // metres between the placement point and the front of the sauna
function faceTheViewer(scene: THREE.Group, outward: THREE.Vector3) {
  const door = outward.clone().setY(0).normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(door, new THREE.Vector3(0, 0, 1));
  const meshes = scene.children as THREE.Mesh[];
  for (const m of meshes) m.geometry.applyQuaternion(turn);
  const box = new THREE.Box3().setFromObject(scene);
  const cx = (box.min.x + box.max.x) / 2;
  for (const m of meshes) m.geometry.translate(-cx, 0, -box.max.z - FRONT_CLEARANCE);
}

/**
 * Scene Viewer is stricter than the glTF spec: textures are redrawn at
 * power-of-two sizes (max 1024) and stored as JPEG when the material is opaque.
 */
const safeMaps = new WeakMap<THREE.Texture, THREE.Texture>();
function potTexture(src: THREE.Texture | null, jpeg: boolean): THREE.Texture | null {
  const img = src?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!src || !img || !img.width || !img.height) return src;
  let t = safeMaps.get(src);
  if (!t) {
    const pot = (n: number) => Math.min(1024, Math.max(64, 2 ** Math.round(Math.log2(n))));
    const canvas = document.createElement('canvas');
    canvas.width = pot(img.width); canvas.height = pot(img.height);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    t = new THREE.CanvasTexture(canvas);
    t.wrapS = src.wrapS; t.wrapT = src.wrapT; t.colorSpace = src.colorSpace;
    t.repeat.copy(src.repeat); t.offset.copy(src.offset); t.rotation = src.rotation; t.center.copy(src.center);
    t.flipY = src.flipY;
    if (jpeg) t.userData.mimeType = 'image/jpeg';
    safeMaps.set(src, t);
  }
  return t;
}

// Warm self-glow of the interior wood: the "baked" look of HolzSauna's photos,
// where LEDs and downlights light the cabin. Real rooms are much darker than a
// render, so without it the interior behind the glass reads as flat and grey.
// Neutral-warm on purpose: a saturated orange turns pale Espe salmon-pink.
// Adapted: keyed by the kit's material slots (inner walls and ceiling, benches).
const WALL_GLOW = new THREE.Color(0.24, 0.18, 0.12);
const BENCH_GLOW = new THREE.Color(0.17, 0.16, 0.14);
const WOOD_GLOW: Record<string, THREE.Color> = {
  wallIn: WALL_GLOW,
  ceiling: WALL_GLOW,
  bench: BENCH_GLOW,
  benchPanel: BENCH_GLOW,
};
// Surfaces people see from inside when they walk into the true-size model.
const WALK_IN = new Set(['wallIn', 'ceiling', 'bench', 'benchPanel']);

function viewerSafeMaterial(material: THREE.Material): THREE.Material {
  // Adapted: the kit's unlit LED strips and heater fire are MeshBasicMaterial, which the
  // USDZ exporter drops; as emissive standard materials they glow the same in both viewers.
  const basic = material as THREE.MeshBasicMaterial;
  if (basic.isMeshBasicMaterial) {
    const lit = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: basic.color, roughness: 1, metalness: 0 });
    lit.name = material.name;
    return lit;
  }
  const std = material as THREE.MeshStandardMaterial;
  if (!std.isMeshStandardMaterial || std.userData.arLight) return material;
  const out = std.clone();
  out.name = material.name;
  out.map = potTexture(std.map, !std.transparent);
  out.normalMap = potTexture(std.normalMap, true);
  const glow = WOOD_GLOW[material.name];
  if (glow && out.map) { out.emissive.copy(glow); out.emissiveMap = out.map; out.emissiveIntensity = 1; }
  if (WALK_IN.has(material.name)) out.side = THREE.DoubleSide;
  return out;
}

/**
 * Light "baked" into the AR model: soft warm washes where the sauna's lights
 * fall. Plain textured quads (alpha-blended emissive), so every AR viewer shows
 * them the same way.
 * Adapted: the kit already draws its LED washes (and floor glows) as additive
 * geometry in the `wash` / `glow` slots; those quads move onto the one light
 * material here, their UVs mapped into the atlas halves (wash on top, pool below).
 */
function lightLayers(root: THREE.Object3D, M: KitMaterials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'light_layers';
  const sources: { mesh: THREE.Mesh; half: 'wash' | 'pool' }[] = [];
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    if (mesh.material === M.wash) sources.push({ mesh, half: 'wash' });
    else if (mesh.material === M.glow) sources.push({ mesh, half: 'pool' });
  });
  if (!sources.length) return g;
  // One material and one texture for all light layers (Scene Viewer: <= 10
  // materials, <= 2 of them transparent - glass is the other one).
  const tex = lightAtlas();
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x000000, map: tex, emissive: 0xffffff, emissiveMap: tex, transparent: true, depthWrite: false, roughness: 1, metalness: 0 });
  lightMat.name = 'light'; lightMat.userData.arLight = true;
  root.updateMatrixWorld(true);
  for (const { mesh, half } of sources) {
    const geo = mesh.geometry.clone();
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    // The kit's wash is brightest at v = 0 (at the strip); the atlas wash at the top of its half.
    for (let i = 0; i < uv.count; i++) uv.setY(i, half === 'wash' ? 0.5 + (1 - uv.getY(i)) * 0.5 : uv.getY(i) * 0.5);
    geo.applyMatrix4(mesh.matrixWorld);
    g.add(new THREE.Mesh(geo, lightMat));
    mesh.visible = false;
  }
  return g;
}

/**
 * Warm light falloff with alpha, 256 x 512: the top half is the LED wash
 * (bright at the strip, fading down, soft ends), the bottom half a radial pool.
 */
function lightAtlas(): THREE.Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s; c.height = s * 2;
  const ctx = c.getContext('2d')!;
  const warm = (a: number) => `rgba(255, 176, 96, ${a})`;
  // wash (canvas rows 0..255 = texture v 0.5..1, top of the quad)
  const v = ctx.createLinearGradient(0, 0, 0, s);
  v.addColorStop(0, warm(0.62)); v.addColorStop(0.35, warm(0.28)); v.addColorStop(1, warm(0));
  ctx.fillStyle = v; ctx.fillRect(0, 0, s, s);
  ctx.globalCompositeOperation = 'destination-out'; // soften both ends of the strip
  for (const [x0, x1] of [[0, s * 0.08], [s, s * 0.92]] as const) {
    const h = ctx.createLinearGradient(x0, 0, x1, 0);
    h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = h; ctx.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), s);
  }
  ctx.globalCompositeOperation = 'source-over';
  // pool (canvas rows 256..511 = texture v 0..0.5)
  const r = ctx.createRadialGradient(s / 2, s * 1.5, 0, s / 2, s * 1.5, s / 2 - 2);
  r.addColorStop(0, warm(0.5)); r.addColorStop(0.4, warm(0.22)); r.addColorStop(1, warm(0));
  ctx.fillStyle = r; ctx.fillRect(0, s, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Faces whose texture coordinates are flat in one direction (thin edge faces)
 * get a zero or NaN tangent; glTF requires unit tangents, so give those any
 * direction perpendicular to the normal and normalise the rest.
 */
function repairTangents(geo: THREE.BufferGeometry) {
  const tan = geo.attributes.tangent as THREE.BufferAttribute, nor = geo.attributes.normal as THREE.BufferAttribute;
  const t = new THREE.Vector3(), n = new THREE.Vector3(), axis = new THREE.Vector3();
  for (let i = 0; i < tan.count; i++) {
    t.set(tan.getX(i), tan.getY(i), tan.getZ(i));
    n.set(nor.getX(i), nor.getY(i), nor.getZ(i)).normalize();
    t.addScaledVector(n, -t.dot(n)); // keep it in the surface plane
    if (!(t.lengthSq() > 1e-10)) { // zero or NaN
      axis.set(Math.abs(n.x) < 0.9 ? 1 : 0, Math.abs(n.x) < 0.9 ? 0 : 1, 0);
      t.crossVectors(axis, n);
    }
    t.normalize();
    const w = tan.getW(i);
    tan.setXYZW(i, t.x, t.y, t.z, w < 0 ? -1 : 1);
  }
  tan.needsUpdate = true;
}

/** Wait until every texture used in the model has its image. */
async function texturesLoaded(root: THREE.Object3D) {
  const maps = new Set<THREE.Texture>();
  root.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m?.map) maps.add(m.map);
    if (m?.normalMap) maps.add(m.normalMap);
  });
  await Promise.all([...maps].map(t => new Promise<void>(resolve => {
    const img = t.image as HTMLImageElement | undefined;
    if (img && (img.complete ?? true) && (img.width ?? 0) > 0) return resolve();
    const start = performance.now();
    const poll = () => (t.image && (t.image as HTMLImageElement).width > 0) || performance.now() - start > 15000 ? resolve() : setTimeout(poll, 50);
    poll();
  })));
}

/**
 * Flatten the assembled scene: world transforms baked into geometry, instances
 * expanded, everything merged per material, centred with the floor at y = 0.
 */
function bake(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const add = (geo: THREE.BufferGeometry, matrix: THREE.Matrix4, material: THREE.Material) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position!.count * 2), 2));
    g.applyMatrix4(matrix);
    (byMaterial.get(material) ?? byMaterial.set(material, []).get(material)!).push(g);
  };
  root.traverse(o => {
    if (o.name === 'floor') return; // the real floor shows through in AR
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
    const inst = o as THREE.InstancedMesh;
    if (inst.isInstancedMesh) {
      const m = new THREE.Matrix4();
      for (let i = 0; i < inst.count; i++) { inst.getMatrixAt(i, m); add(inst.geometry, mesh.matrixWorld.clone().multiply(m), material); }
    } else {
      add(mesh.geometry, mesh.matrixWorld, material);
    }
  });

  const out = new THREE.Group();
  out.name = 'sauna';
  for (const [material, geos] of byMaterial) {
    const flat = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    if (!flat) continue;
    // Indexed triangles: ARCore's loader rejects some un-indexed GLBs from
    // three.js ("Invalid index range"); indexing also shrinks the file.
    const merged = mergeVertices(flat, 1e-5);
    flat.dispose();
    // Scene Viewer supports only a few glTF extensions: keep emissive at the
    // core range (an intensity > 1 would export KHR_materials_emissive_strength).
    let mat = viewerSafeMaterial(material);
    const std = mat as THREE.MeshStandardMaterial;
    if (std.isMeshStandardMaterial && std.emissiveIntensity > 1) {
      const c = std === material ? std.clone() : std;
      c.emissive.multiplyScalar(std.emissiveIntensity);
      c.emissive.r = Math.min(1, c.emissive.r); c.emissive.g = Math.min(1, c.emissive.g); c.emissive.b = Math.min(1, c.emissive.b);
      c.emissiveIntensity = 1;
      mat = c;
    }
    // Relief maps need a tangent frame; ship it so every AR viewer shades the
    // grain and slate the same way instead of guessing its own.
    if ((mat as THREE.MeshStandardMaterial).normalMap && merged.index && merged.attributes.uv) {
      merged.computeTangents();
      repairTangents(merged);
    }
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = material.name || 'part';
    out.add(mesh);
  }
  // Centre the footprint on the origin, floor at y = 0.
  const box = new THREE.Box3().setFromObject(out);
  const centre = box.getCenter(new THREE.Vector3());
  for (const child of out.children) (child as THREE.Mesh).geometry.translate(-centre.x, -box.min.y, -centre.z);
  return out;
}
