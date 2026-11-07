import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildSauna } from './build.ts';
import type { KitMaterials } from './materials.ts';
import { DEFAULT_KIT_OPTIONS, type Door, type KitSpec, type SaunaForm } from './spec.ts';

const KEYS = ['wallIn', 'wallOut', 'ceiling', 'bench', 'benchPanel', 'floor', 'plinth', 'roof', 'glass', 'doorGlass', 'steel', 'black', 'stones', 'gap', 'led', 'wash', 'glow', 'fire', 'grille', 'salt', 'white'] as const;
const mats = () => Object.fromEntries(KEYS.map(k => [k, Object.assign(new THREE.MeshStandardMaterial(), { name: k })])) as unknown as KitMaterials;

const SIZES: Record<SaunaForm, [number, number, number]> = {
  box: [1.8, 1.6, 2.1], panorama: [2.2, 1.8, 2.1], corner: [2.0, 2.0, 2.1], 'glass-corner': [2.4, 2.0, 2.1],
  barrel: [2.0, 3.0, 2.1], hex: [2.4, 2.2, 2.3], cabin: [3.0, 2.6, 2.6],
};

/** Centre of the door leaf in the sauna's frame, at a given swing. */
function leafCentre(form: SaunaForm, door: Door, width?: number, depth?: number) {
  const [w, d, h] = SIZES[form];
  const spec: KitSpec = { ...structuredClone(DEFAULT_KIT_OPTIONS), door, form, width: width ?? w, depth: depth ?? d, height: h };
  const { group } = buildSauna(spec, mats());
  const pivot = group.getObjectByName('door-pivot');
  if (!pivot) return null;
  const at = (angle: number) => {
    pivot.rotation.y = angle;
    group.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(pivot.getObjectByName('door-leaf')!).getCenter(new THREE.Vector3());
  };
  return { shut: at(0), open: at(pivot.userData.openAngle as number), angle: pivot.userData.openAngle as number };
}

describe('door', () => {
  for (const form of Object.keys(SIZES) as SaunaForm[]) {
    for (const door of ['clear', 'timber'] as const) {
      it(`${form} (${door}) has a leaf on a hinge that swings outwards`, () => {
        const r = leafCentre(form, door)!;
        expect(r).not.toBeNull();
        expect(Math.abs(r.angle)).toBeGreaterThan(1);
        // Opening moves the leaf away from the middle of the cabin, never into it.
        const flat = (v: THREE.Vector3) => Math.hypot(v.x, v.z);
        expect(flat(r.open)).toBeGreaterThan(flat(r.shut) + 0.1);
      });
    }
  }

  it('a turned barrel still opens outwards', () => {
    const r = leafCentre('barrel', 'clear', 3.0, 2.0)!;
    expect(Math.hypot(r.open.x, r.open.z)).toBeGreaterThan(Math.hypot(r.shut.x, r.shut.z) + 0.1);
  });
});
