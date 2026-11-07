import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import type { ViewerOptions, ViewerSpecs } from '../types.ts';
import { useKitAssets } from './assets.ts';
import { buildSauna } from './build.ts';
import { disposeMaterials, makeMaterials, materialKey } from './materials.ts';
import type { KitSpec } from './spec.ts';

/**
 * A sauna built by the construction kit from the model's form and size and the
 * selected options. Materials are rebuilt only when a finish changes; geometry
 * is rebuilt (a few milliseconds) when anything else changes. `onReady` fires
 * once the parts and textures have loaded and the sauna is on screen.
 * `doorOpen` swings the door leaf open (outwards) or shut, eased over about a second.
 */
export function KitSauna({ specs, options, onReady, doorOpen = false }: { specs: ViewerSpecs; options: ViewerOptions; onReady?: (() => void) | undefined; doorOpen?: boolean }) {
  const spec: KitSpec = useMemo(
    () => ({ ...options, form: specs.form, width: specs.widthMm / 1000, depth: specs.depthMm / 1000, height: specs.heightMm / 1000 }),
    [options, specs.form, specs.widthMm, specs.depthMm, specs.heightMm],
  );
  const assets = useKitAssets();
  const key = JSON.stringify(spec);
  const matKey = materialKey(spec);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the finishes only
  const materials = useMemo(() => makeMaterials(spec, assets.wood), [matKey, assets]);
  useEffect(() => () => disposeMaterials(materials), [materials]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the full spec
  const built = useMemo(() => buildSauna(spec, materials, assets.parts), [key, materials, assets]);
  useEffect(
    () => () => {
      built.group.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    },
    [built],
  );
  useEffect(() => onReady?.(), [onReady]);
  const invalidate = useThree(st => st.invalidate);
  const pivot = useMemo(() => built.group.getObjectByName('door-pivot') ?? null, [built]);
  useEffect(() => invalidate(), [doorOpen, invalidate]);
  // The canvas renders on demand: keep asking for frames until the door has arrived.
  useFrame((_, dt) => {
    if (!pivot) return;
    const target = doorOpen ? (pivot.userData.openAngle as number) : 0;
    const d = target - pivot.rotation.y;
    if (Math.abs(d) < 1e-3) {
      pivot.rotation.y = target;
      return;
    }
    pivot.rotation.y += d * Math.min(1, dt * 4.5);
    invalidate();
  });
  return (
    <group>
      <primitive object={built.group} />
      {built.lights.map((l, i) => (
        <pointLight key={i} position={l.position} color={l.color} intensity={l.intensity} distance={l.distance} decay={1.6} />
      ))}
    </group>
  );
}
