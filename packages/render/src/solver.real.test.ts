import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  CHIN,
  FACE_SIDE_A,
  FACE_SIDE_B,
  FOREHEAD,
  HeadSurface,
  IRIS_A_CENTER,
  IRIS_B_CENTER,
  NOSE_BRIDGE_TOP,
  computeFit,
  modelToHead,
  solvePlacement,
  type GlassesGeometry,
  type Vec3,
} from '@vto/core';
import { normalizeFrame } from './gltf.js';
import { buildFrame, DEFAULT_SPEC } from './frameModel.js';
import { glassesGeometry } from './glassesGeometry.js';

/**
 * Uçtan uca: gerçek çerçeve geometrisi (parametrik + Khronos GLB) ×
 * çözücü × sentetik kafa.
 *
 * Çözücünün birim testleri elle kurulmuş bir çerçeveyle çalışıyor. Bu test,
 * render katmanının ürettiği GERÇEK anchor'larla çözücünün makul sonuç
 * verdiğini kanıtlıyor — anchor türetiminde bir hata (ör. pedin yanlış
 * tarafta olması) burada yakalanır, ekranda değil.
 */

function faceZ(x: number, y: number): number {
  const t = -y;
  const fade = t < 0 ? Math.max(0, 1 + t / 10) : t > 45 ? Math.max(0, 1 - (t - 45) / 10) : 1;
  const R = (7 + 0.5 * Math.max(t, 0)) * fade;
  const W = 7 + 0.18 * Math.max(t, 0);
  const nose = t < -10 || t > 55 ? 0 : R * Math.max(0, 1 - (x / W) ** 2);
  const base = -(x * x) / 220;
  const brow = 4 * Math.exp(-((y - 14) ** 2) / 72) * Math.exp(-(x * x) / 3200);
  const orbit = -7 * Math.exp(-(((Math.abs(x) - 31) ** 2) / 242 + ((y + 8) ** 2) / 200));
  const cheek = 3 * Math.exp(-(((Math.abs(x) - 38) ** 2) / 392 + ((y + 38) ** 2) / 288));
  return base + brow + orbit + cheek + nose;
}

function syntheticHead() {
  const positions: number[] = [];
  const indices: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let x = -75; x <= 75; x += 2.5) xs.push(x);
  for (let y = -100; y <= 65; y += 2.5) ys.push(y);
  const Z0 = -560;
  for (const y of ys) for (const x of xs) positions.push(x, y, faceZ(x, y) + Z0);
  const cols = xs.length;
  for (let r = 0; r < ys.length - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i = r * cols + c;
      indices.push(i, i + 1, i + cols, i + 1, i + cols + 1, i + cols);
    }
  }
  const landmarks: Vec3[] = Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0 }));
  const put = (i: number, x: number, y: number, dz = 0) => (landmarks[i] = { x, y, z: faceZ(x, y) + dz + Z0 });
  put(NOSE_BRIDGE_TOP, 0, 0);
  put(FOREHEAD, 0, 60);
  put(CHIN, 0, -95);
  put(FACE_SIDE_A, -68, -14);
  put(FACE_SIDE_B, 68, -14);
  put(IRIS_A_CENTER, -31.5, -8, 5);
  put(IRIS_B_CENTER, 31.5, -8, 5);
  return { landmarks, mesh: { positions, indices } };
}

function checkPlacement(g: GlassesGeometry) {
  const head = syntheticHead();
  const result = solvePlacement(head.landmarks, head.mesh, g);
  expect(result).not.toBeNull();
  const r = result!;
  const surface = new HeadSurface(head.mesh, r.head);

  // Pedler yüzün önünde (içine girmiyor).
  for (const pad of [g.padL, g.padR]) {
    const q = modelToHead(pad, g, r.local);
    const s = surface.zAt(q.x, q.y);
    if (s !== null) expect(q.z).toBeGreaterThanOrEqual(s - 0.3);
  }

  const fit = computeFit(head.landmarks, r, g)!;
  expect(fit).not.toBeNull();
  return { r, fit };
}

describe('parametrik çerçeve × çözücü', () => {
  it('pupil lens içinde makul yükseklikte', () => {
    const { fit, r } = checkPlacement(glassesGeometry(buildFrame(DEFAULT_SPEC)));
    const pupil = fit.components.find((c) => c.key === 'pupil')!;
    // Pupil lensin alt %30'u ile üst %10'u arasında olmalı — dışında çerçeve
    // gözle alakasız bir yerde duruyor demektir.
    expect(pupil.value).toBeGreaterThan(30);
    expect(pupil.value).toBeLessThan(90);
    expect(Number.isFinite(r.local.pitchDeg)).toBe(true);
  });
});

const MODEL = resolve(import.meta.dirname, '../../../apps/demo/public/models/glasses/khronos-sunglasses.glb');
const available = existsSync(MODEL);
let khronos: GlassesGeometry;

beforeAll(async () => {
  if (!available) return;
  (globalThis as { self?: unknown }).self ??= globalThis;
  const buf = readFileSync(MODEL);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const originalError = console.error;
  console.error = () => {};
  try {
    const gltf = await new Promise<{ scene: THREE.Group }>((ok, fail) => new GLTFLoader().parse(ab, '', ok, fail));
    khronos = glassesGeometry(normalizeFrame(gltf.scene, { frontWidthMM: 138 }));
  } finally {
    console.error = originalError;
  }
});

describe.skipIf(!available)('Khronos güneş gözlüğü × çözücü', () => {
  it('yerleşiyor, yüze girmiyor, fit hesaplanıyor', () => {
    const { r, fit } = checkPlacement(khronos);
    expect(fit.score).toBeGreaterThanOrEqual(0);
    expect(fit.score).toBeLessThanOrEqual(100);
    expect(Math.abs(r.local.pitchDeg)).toBeLessThan(25);
  });

  it('150 mm genişliğinde güneş gözlüğü 136 mm yüze "geniş" ya da "uygun" der, "dar" demez', () => {
    const { fit } = checkPlacement(khronos);
    expect(fit.verdict).not.toBe('too-narrow');
  });
});
