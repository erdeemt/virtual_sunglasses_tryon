import type * as THREE from 'three';
import type { GlassesGeometry } from '@vto/core';
import type { BuiltFrame } from './frameModel.js';

/**
 * Render katmanındaki çerçeve (three.js nesneleri + anchor'lar) → çözücünün
 * beklediği saf geometri. Çözücü three.js'e bağımlı değil; çeviri burada.
 */
export function glassesGeometry(frame: BuiltFrame): GlassesGeometry {
  const a = frame.anchors;
  const s = frame.spec;
  const v = (p: THREE.Vector3) => ({ x: p.x, y: p.y, z: p.z });

  return {
    padL: v(a.nosePadL),
    padR: v(a.nosePadR),
    bridge: v(a.bridgeCenter),
    hingeL: v(a.hingeL),
    hingeR: v(a.hingeR),
    templeL: v(a.templeTipL),
    templeR: v(a.templeTipR),
    lensCenterL: v(a.lensCenterL),
    lensCenterR: v(a.lensCenterR),
    lensWidth: s.lensWidth,
    lensHeight: s.lensHeight,
    frontWidth: frame.frontWidth ?? 2 * (s.bridgeWidth / 2 + s.lensWidth + s.rimThickness * 1.5),
    lensBackOffset: frame.lensBackOffset ?? s.rimDepth / 2,
    frameWrapDeg: frame.frameWrapDeg ?? null,
  };
}
