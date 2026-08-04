import { describe, expect, it } from 'vitest';
import { DEFAULT_FOV_Y_DEG, faceDistanceMM, unprojectToMM } from './camera.js';
import { trianglesFromTesselation, type Connection } from './faceMesh.js';
import type { Vec3 } from '@vto/core';

/**
 * Geri-projeksiyonun tek kritik özelliği: metrik 3B noktalar kameradan
 * tekrar projekte edildiğinde ORİJİNAL piksel konumlarını vermeli.
 *
 * Bu sağlanmazsa yüz mesh'i görüntüye oturmaz ve occlusion kayar — gözlük
 * yanağın içinden geçer. Ekranda görmeden önce burada kanıtlıyoruz.
 */

const ASPECT = 16 / 9;

function project(p: Vec3, aspect: number, fovYDeg: number): { ndcX: number; ndcY: number } {
  const depth = -p.z;
  const t = Math.tan((fovYDeg * Math.PI) / 360);
  return { ndcX: p.x / (depth * t * aspect), ndcY: p.y / (depth * t) };
}

/** Landmark benzeri sentetik nokta bulutu — farklı derinliklerde. */
function syntheticFace(): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i < 40; i++) {
    pts.push({
      x: (0.35 + (i % 8) * 0.03) * ASPECT,
      y: 0.3 + Math.floor(i / 8) * 0.06,
      // MediaPipe z: baş merkezinde 0, kameraya yakın olan daha küçük
      z: (((i * 7) % 11) - 5) * 0.004 * ASPECT,
    });
  }
  return pts;
}

describe('faceDistanceMM', () => {
  it('tipik ölçekte fiziksel olarak makul mesafe verir', () => {
    // PD ~63 mm ve görüntüde ~0.1 birim ise k ≈ 630 mm/birim.
    const distance = faceDistanceMM(630, DEFAULT_FOV_Y_DEG);
    // Bir webcam mesafesi: 40-70 cm arası beklenir.
    expect(distance).toBeGreaterThan(400);
    expect(distance).toBeLessThan(700);
  });

  it('ölçekle doğru orantılı', () => {
    expect(faceDistanceMM(1200)).toBeCloseTo(2 * faceDistanceMM(600), 6);
  });

  it('geniş FOV daha yakın mesafe demek', () => {
    expect(faceDistanceMM(630, 90)).toBeLessThan(faceDistanceMM(630, 45));
  });
});

describe('unprojectToMM', () => {
  const lm = syntheticFace();
  const k = 630;

  it('KRİTİK: geri-projeksiyon → projeksiyon turu orijinal konumu verir', () => {
    const mm = unprojectToMM(lm, k, ASPECT, DEFAULT_FOV_Y_DEG);

    for (let i = 0; i < lm.length; i++) {
      const p = lm[i]!;
      const world: Vec3 = { x: mm[i * 3]!, y: mm[i * 3 + 1]!, z: mm[i * 3 + 2]! };
      const { ndcX, ndcY } = project(world, ASPECT, DEFAULT_FOV_Y_DEG);

      // FaceUnits x ∈ [0, aspect] → ndc [-1, 1]; y ∈ [0,1] → ndc [1, -1]
      //
      // Tolerans 1e-6: sonuç Float32Array'de saklanıyor ve float32'nin
      // bağıl hassasiyeti ~1.2e-7. Gözlenen sapma ~1e-8, yani 1280 px'lik
      // bir görüntüde 10⁻⁵ pikselden küçük — matematik tam, tampon sonlu.
      expect(ndcX).toBeCloseTo((p.x / ASPECT) * 2 - 1, 6);
      expect(ndcY).toBeCloseTo(1 - p.y * 2, 6);
    }
  });

  it('farklı derinlikteki noktalar farklı z alır', () => {
    const mm = unprojectToMM(lm, k, ASPECT);
    const depths = new Set<number>();
    for (let i = 0; i < lm.length; i++) depths.add(Math.round(mm[i * 3 + 2]! * 100));
    // Tek düzlem varsayılsaydı hepsi aynı olurdu — burun ucunda %5 hata demekti.
    expect(depths.size).toBeGreaterThan(3);
  });

  it('aynı derinlikteki iki nokta arası mesafe ölçekle tutarlı', () => {
    // z'si eşit iki nokta seç; aralarındaki mm mesafesi
    // (FaceUnits mesafesi × k) olmalı.
    const a: Vec3 = { x: 0.4 * ASPECT, y: 0.5, z: 0 };
    const b: Vec3 = { x: 0.5 * ASPECT, y: 0.5, z: 0 };
    const mm = unprojectToMM([a, b], k, ASPECT);
    const dx = mm[3]! - mm[0]!;
    const expected = (b.x - a.x) * k;
    expect(Math.abs(dx)).toBeCloseTo(expected, 6);
  });

  it('yüz kameraya bakar — tüm z değerleri negatif', () => {
    const mm = unprojectToMM(lm, k, ASPECT);
    for (let i = 0; i < lm.length; i++) expect(mm[i * 3 + 2]!).toBeLessThan(0);
  });

  it('verilen tamponu yeniden kullanır (kare başına tahsis yok)', () => {
    const buffer = new Float32Array(lm.length * 3);
    const result = unprojectToMM(lm, k, ASPECT, DEFAULT_FOV_Y_DEG, buffer);
    expect(result).toBe(buffer);
  });

  it('ölçek iki katına çıkarsa mesafeler de iki katına çıkar', () => {
    const near = unprojectToMM(lm, k, ASPECT);
    const far = unprojectToMM(lm, k * 2, ASPECT);
    const d1 = Math.hypot(near[3]! - near[0]!, near[4]! - near[1]!);
    const d2 = Math.hypot(far[3]! - far[0]!, far[4]! - far[1]!);
    expect(d2 / d1).toBeCloseTo(2, 4);
  });
});

describe('trianglesFromTesselation', () => {
  it('her 3 bağlantıyı bir üçgene çevirir', () => {
    const connections: Connection[] = [
      { start: 1, end: 2 },
      { start: 2, end: 3 },
      { start: 3, end: 1 },
      { start: 10, end: 20 },
      { start: 20, end: 30 },
      { start: 30, end: 10 },
    ];
    const tri = trianglesFromTesselation(connections);
    expect(Array.from(tri)).toEqual([1, 2, 3, 10, 20, 30]);
  });

  it('eksik kalan bağlantıları yok sayar', () => {
    const connections: Connection[] = [
      { start: 1, end: 2 },
      { start: 2, end: 3 },
      { start: 3, end: 1 },
      { start: 9, end: 8 },
    ];
    expect(trianglesFromTesselation(connections).length).toBe(3);
  });
});
