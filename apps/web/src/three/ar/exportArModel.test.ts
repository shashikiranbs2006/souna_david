import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { KitMaterials } from '../kit/materials.ts';
import { DEFAULT_KIT_OPTIONS, type KitSpec, type SaunaForm } from '../kit/spec.ts';

// The headless asset loader (fetches the kit's GLB and textures) is not needed: the
// test builds the kit with plain materials, like the kit's own tests. No WebGL, no canvas.
vi.mock('../kit/assets.ts', () => ({ loadKitAssets: vi.fn(), disposeParts: vi.fn() }));
const { exportKitArModel } = await import('./exportArModel.ts');

const KEYS = ['wallIn', 'wallOut', 'ceiling', 'bench', 'benchPanel', 'floor', 'plinth', 'roof', 'glass', 'doorGlass', 'steel', 'black', 'stones', 'gap', 'led', 'wash', 'glow', 'fire', 'grille', 'salt', 'white'] as const;
const mats = () =>
  Object.fromEntries(KEYS.map(k => [k, k === 'glass' || k === 'doorGlass' ? new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.2 }) : k === 'led' || k === 'fire' ? new THREE.MeshBasicMaterial({ color: '#ffd29a' }) : new THREE.MeshStandardMaterial()])) as unknown as KitMaterials;

const spec = (form: SaunaForm, width: number, depth: number, height = 2.1): KitSpec => ({ ...structuredClone(DEFAULT_KIT_OPTIONS), form, width, depth, height });

// GLTFExporter's binary path reads Blobs with FileReader, which Node does not have.
beforeAll(() => {
  if (typeof globalThis.FileReader !== 'undefined') return;
  class NodeFileReader {
    result: ArrayBuffer | string | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then(b => {
        this.result = b;
        this.onloadend?.();
      });
    }
  }
  (globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReader;
});

interface Gltf {
  materials: { name: string; doubleSided?: boolean; alphaMode?: string; emissiveFactor?: number[] }[];
  meshes: { name: string; primitives: { attributes: { POSITION: number }; material: number }[] }[];
  accessors: { min?: number[]; max?: number[] }[];
  extensionsUsed?: string[];
}

function readGlb(glb: ArrayBuffer): Gltf {
  const v = new DataView(glb);
  expect(new TextDecoder().decode(glb.slice(0, 4))).toBe('glTF');
  expect(v.getUint32(4, true)).toBe(2);
  expect(v.getUint32(8, true)).toBe(glb.byteLength);
  const len = v.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + len))) as Gltf;
}

/** World bounds of the parts with one material (geometry is baked, nodes carry no transforms) or of all of them. */
function bounds(g: Gltf, material?: string) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const m of g.meshes) {
    for (const p of m.primitives) {
      if (material && g.materials[p.material]!.name !== material) continue;
      const a = g.accessors[p.attributes.POSITION]!;
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, a.min![k]!);
        hi[k] = Math.max(hi[k]!, a.max![k]!);
      }
    }
  }
  return { lo, hi };
}

describe('exportArModel', () => {
  const cases: [SaunaForm, number, number][] = [
    ['box', 1.8, 1.6],
    ['corner', 2.0, 2.0],
    // Wider than deep: the kit turns the barrel; the door must still end up facing the viewer.
    ['barrel', 3.0, 2.0],
  ];
  for (const [form, w, d] of cases) {
    it(`${form}: true scale, floor at y = 0, door towards +Z with the footprint behind the origin`, async () => {
      const { glb, usdz } = await exportKitArModel(spec(form, w, d), mats());
      expect([...usdz.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
      const g = readGlb(glb);

      const all = bounds(g);
      expect(all.lo[1]).toBeCloseTo(0, 3);
      // True scale: the footprint is the sauna's size (in either orientation), not scaled.
      // (A corner sauna's door is on the diagonal, so its turned footprint is wider.)
      const plan = [all.hi[0]! - all.lo[0]!, all.hi[2]! - all.lo[2]!].sort((a, b) => a - b);
      expect(plan[0]).toBeGreaterThan(Math.min(w, d) - 0.1);
      expect(plan[1]).toBeLessThan(Math.hypot(w, d) + 0.1);
      expect(all.hi[1]).toBeGreaterThan(1.8);
      expect(all.hi[1]).toBeLessThan(2.1 + 0.4);
      // Centred across, everything behind the placement point with 0.5 m clearance.
      expect((all.lo[0]! + all.hi[0]!) / 2).toBeCloseTo(0, 3);
      expect(all.hi[2]).toBeCloseTo(-0.5, 3);

      // The door glass (merged into `glass`) is at the front, the side facing the viewer.
      const glass = bounds(g, 'glass');
      expect(glass.hi[2]).toBeGreaterThan(-0.5 - 0.2);

      // Inner floor removed; inside surfaces double-sided; no extensions Scene Viewer rejects.
      expect(g.materials.map(m => m.name)).not.toContain('floor');
      expect(g.materials.map(m => m.name)).not.toContain('doorGlass');
      const wall = g.materials.find(m => m.name === 'wallIn');
      expect(wall?.doubleSided).toBe(true);
      expect(g.materials.filter(m => m.alphaMode === 'BLEND').length).toBeLessThanOrEqual(2);
      for (const e of g.extensionsUsed ?? []) expect(['KHR_texture_transform', 'KHR_materials_unlit', 'KHR_mesh_quantization']).toContain(e);
    });
  }

  it('turns unlit LED parts into emissive standard materials (USDZ keeps only standard materials)', async () => {
    const s = spec('box', 2.0, 1.8);
    s.lights.underBench = true;
    const g = readGlb((await exportKitArModel(s, mats())).glb);
    const led = g.materials.find(m => m.name === 'led');
    expect(led).toBeDefined();
    expect(Math.max(...(led!.emissiveFactor ?? [0]))).toBeGreaterThan(0.5);
  });
});
