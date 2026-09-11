import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { normalizeFrame, type LoadedFrame } from './gltf.js';
import { glassesGeometry } from './glassesGeometry.js';

/**
 * Gerçek model üzerinde normalizasyon — Khronos SunglassesKhronos.
 *
 * Sentetik testler matematiği kanıtlıyor; bu test gerçek bir e-ticaret
 * modelinin (isimli parçalar, metre birimi, node matrisleri, KHR materyal
 * uzantıları) uçtan uca doğru işlendiğini kanıtlıyor.
 *
 * Model `npm run setup` ile indiriliyor ve repoda yok; yoksa test atlanır.
 *
 * Bilinen gerçekler (Node'da ham GLB parse edilerek ölçüldü):
 *   dünya genişliği 150.5 mm · ön çerçeve 149.8 mm · yükseklik 57.6 mm
 *   burun pedleri x ∈ [−8.8, 9.1], y ∈ [18.8, 31.4]
 *   kulak kancaları z → −157 mm
 */
const MODEL = resolve(import.meta.dirname, '../../../apps/demo/public/models/glasses/khronos-sunglasses.glb');
const available = existsSync(MODEL);

let frame: LoadedFrame;

beforeAll(async () => {
  if (!available) return;
  // GLTFLoader doku yükleyicisi tarayıcı global'i bekliyor. Doku yüklenemez
  // (Node'da resim çözücü yok) ama geometri ve malzemeler gelir.
  (globalThis as { self?: unknown }).self ??= globalThis;
  const buf = readFileSync(MODEL);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const originalError = console.error;
  console.error = () => {}; // "Couldn't load texture" gürültüsü
  try {
    const gltf = await new Promise<{ scene: THREE.Group }>((ok, fail) =>
      new GLTFLoader().parse(ab, '', ok, fail),
    );
    frame = normalizeFrame(gltf.scene, { frontWidthMM: 138 });
  } finally {
    console.error = originalError;
  }
});

describe.skipIf(!available)('Khronos güneş gözlüğü', () => {
  it('glTF metre birimine güvenir, genişliğe oturtmaz', () => {
    expect(frame.info.scaleMode).toBe('meters');
    expect(frame.info.scaleFactor).toBe(1000);
    expect(frame.info.frontWidthMM).toBeGreaterThan(145);
    expect(frame.info.frontWidthMM).toBeLessThan(155);
  });

  it('spesifikasyona uygun yönelim: Y yukarı, saplar −Z', () => {
    expect(frame.info.detectedUp).toBe('y');
    expect(frame.anchors.templeTipL.z).toBeLessThan(frame.anchors.hingeL.z - 40);
  });

  it('anchor ların çoğu isimli parçalardan geliyor', () => {
    for (const key of ['nosePadL', 'nosePadR', 'hingeL', 'templeTipL', 'lensCenterL', 'bridgeCenter']) {
      expect(frame.info.namedAnchors).toContain(key);
    }
  });

  it('burun pedleri simetrik ve gerçek ped aralığında', () => {
    const { nosePadL, nosePadR } = frame.anchors;
    expect(nosePadL.x).toBeGreaterThan(3);
    expect(nosePadL.x).toBeLessThan(10);
    expect(nosePadR.x).toBeLessThan(-3);
    expect(Math.abs(nosePadL.x + nosePadR.x)).toBeLessThan(1.5);
    expect(Math.abs(nosePadL.y - nosePadR.y)).toBeLessThan(1.5);
  });

  it('köprü pedlerin üstünde', () => {
    expect(frame.anchors.bridgeCenter.y).toBeGreaterThan(frame.anchors.nosePadL.y);
  });

  it('sap teması kancanın ucu değil kıvrımın başı', () => {
    // Kanca ucu ~−157 mm'de ve aşağıda; temas noktası daha önde ve yukarıda
    // olmalı. En geri noktayı almak çerçeveyi yanlış eğerdi.
    const tip = frame.anchors.templeTipL;
    const hinge = frame.anchors.hingeL;
    expect(tip.z).toBeGreaterThan(hinge.z - 150);
    expect(tip.y).toBeGreaterThan(hinge.y - 12);
  });

  it('lens ölçüleri modelden okunuyor', () => {
    expect(frame.spec.lensHeight).toBeGreaterThan(45);
    expect(frame.spec.lensHeight).toBeLessThan(62);
    expect(frame.spec.lensWidth).toBeGreaterThan(50);
  });

  it('transmission ve iridescence malzemeleri korunuyor', () => {
    let transmissive = 0;
    let iridescent = 0;
    frame.group.traverse((n) => {
      if (n instanceof THREE.Mesh && n.material instanceof THREE.MeshPhysicalMaterial) {
        if (n.material.transmission > 0) transmissive++;
        if (n.material.iridescence > 0) iridescent++;
      }
    });
    expect(transmissive).toBeGreaterThanOrEqual(2);
    expect(iridescent).toBeGreaterThanOrEqual(1);
  });

  it('çözücü geometrisine sorunsuz çevriliyor', () => {
    const g = glassesGeometry(frame);
    for (const v of [g.padL, g.padR, g.bridge, g.hingeL, g.templeL, g.lensCenterL]) {
      expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
    }
    expect(g.frontWidth).toBeGreaterThan(140);
  });
});
