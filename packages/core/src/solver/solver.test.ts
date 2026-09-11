import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../types.js';
import {
  CHIN,
  FACE_SIDE_A,
  FACE_SIDE_B,
  FOREHEAD,
  IRIS_A_CENTER,
  IRIS_B_CENTER,
  NOSE_BRIDGE_TOP,
} from '../perception/landmarkIndices.js';
import { buildHeadFrame, fromHead, toHead } from './headFrame.js';
import { HeadSurface } from './surface.js';
import {
  composePose,
  modelToHead,
  padMid,
  solvePlacement,
  type GlassesGeometry,
  type PlacementResult,
} from './placement.js';
import { computeFit } from './fit.js';

/**
 * Çözücü ekranda görülmeden önce sentetik bir kafa üzerinde doğrulanıyor.
 * Kafa, burun köprüsü yüksekliği parametrik olan analitik bir yüzey:
 * farklı burunlarda çerçevenin farklı yükseklikte oturması asıl hedef.
 *
 * Anatomi (baş uzayı, sellion = orijin):
 *   pupil hattı sellion'ın ~8 mm altında · kaş kemeri ~14 mm üstünde
 *   elmacık ~38 mm altında · yüz yan noktaları (234/454) ~14 mm altında
 */

interface FaceParams {
  /** Burun kökünün yüzden çıkıklığı (mm). Yüksek = çıkık köprü. */
  rootHeight: number;
  /** Aşağı indikçe burnun öne çıkma hızı. */
  slope: number;
}

const HIGH_BRIDGE: FaceParams = { rootHeight: 8, slope: 0.55 };
const FLAT_BRIDGE: FaceParams = { rootHeight: 1.5, slope: 0.25 };

const PUPIL_Y = -8;

function nose(x: number, y: number, p: FaceParams): number {
  const t = -y; // sellion altındaki mesafe
  if (t < -10 || t > 55) return 0;
  const fade = t < 0 ? 1 + t / 10 : t > 45 ? 1 - (t - 45) / 10 : 1;
  const R = (p.rootHeight + p.slope * Math.max(t, 0)) * fade;
  const W = 7 + 0.18 * Math.max(t, 0);
  return R * Math.max(0, 1 - (x / W) ** 2);
}

function faceZ(x: number, y: number, p: FaceParams): number {
  const base = -(x * x) / 220;
  const brow = 4 * Math.exp(-((y - 14) ** 2) / (2 * 6 ** 2)) * Math.exp(-(x * x) / (2 * 40 ** 2));
  const orbit =
    -7 * Math.exp(-(((Math.abs(x) - 31) ** 2) / (2 * 11 ** 2) + ((y - PUPIL_Y) ** 2) / (2 * 10 ** 2)));
  const cheek = 3 * Math.exp(-(((Math.abs(x) - 38) ** 2) / (2 * 14 ** 2) + ((y + 38) ** 2) / (2 * 12 ** 2)));
  return base + brow + orbit + cheek + nose(x, y, p);
}

interface Rigid {
  apply(p: Vec3): Vec3;
}

function rigid(yawDeg: number, pitchDeg: number, rollDeg: number, t: Vec3): Rigid {
  const [a, b, c] = [yawDeg, pitchDeg, rollDeg].map((d) => (d * Math.PI) / 180) as [number, number, number];
  return {
    apply(p) {
      // roll (z) → pitch (x) → yaw (y) → öteleme
      let x = p.x * Math.cos(c) - p.y * Math.sin(c);
      let y = p.x * Math.sin(c) + p.y * Math.cos(c);
      let z = p.z;
      const y2 = y * Math.cos(b) - z * Math.sin(b);
      const z2 = y * Math.sin(b) + z * Math.cos(b);
      y = y2;
      z = z2;
      const x3 = x * Math.cos(a) + z * Math.sin(a);
      const z3 = -x * Math.sin(a) + z * Math.cos(a);
      x = x3;
      z = z3;
      return { x: x + t.x, y: y + t.y, z: z + t.z };
    },
  };
}

const FRONTAL = rigid(0, 0, 0, { x: 0, y: 0, z: -560 });

function syntheticHead(p: FaceParams, pose: Rigid = FRONTAL) {
  const positions: number[] = [];
  const indices: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let x = -75; x <= 75; x += 2.5) xs.push(x);
  for (let y = -100; y <= 65; y += 2.5) ys.push(y);

  for (const y of ys) {
    for (const x of xs) {
      const q = pose.apply({ x, y, z: faceZ(x, y, p) });
      positions.push(q.x, q.y, q.z);
    }
  }
  const cols = xs.length;
  for (let r = 0; r < ys.length - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i = r * cols + c;
      indices.push(i, i + 1, i + cols, i + 1, i + cols + 1, i + cols);
    }
  }

  const landmarks: Vec3[] = Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0 }));
  const put = (index: number, x: number, y: number, dz = 0) => {
    landmarks[index] = pose.apply({ x, y, z: faceZ(x, y, p) + dz });
  };
  put(NOSE_BRIDGE_TOP, 0, 0);
  put(FOREHEAD, 0, 60);
  put(CHIN, 0, -95);
  put(FACE_SIDE_A, -68, -14);
  put(FACE_SIDE_B, 68, -14);
  // Göz küresi yörünge çukurundan ~5 mm dışarı taşar.
  put(IRIS_A_CENTER, -31.5, PUPIL_Y, 5);
  put(IRIS_B_CENTER, 31.5, PUPIL_Y, 5);

  return { landmarks, mesh: { positions, indices } };
}

/**
 * 49□21 benzeri çerçeve, model uzayında. Pedler lens kutusu merkezinin
 * biraz üstünde ve lens düzleminin 5 mm gerisinde — tipik metal çerçeve.
 */
function glasses(frontWidth = 132): GlassesGeometry {
  const half = frontWidth / 2;
  const lensCX = half - 26.5;
  return {
    padL: { x: 7.8, y: 2, z: -5 },
    padR: { x: -7.8, y: 2, z: -5 },
    bridge: { x: 0, y: 17, z: -1.5 },
    hingeL: { x: half - 1, y: 11, z: 0 },
    hingeR: { x: -(half - 1), y: 11, z: 0 },
    templeL: { x: half - 8, y: 9, z: -112 },
    templeR: { x: -(half - 8), y: 9, z: -112 },
    lensCenterL: { x: lensCX, y: 0, z: 0 },
    lensCenterR: { x: -lensCX, y: 0, z: 0 },
    lensWidth: 49,
    lensHeight: 40,
    frontWidth,
  };
}

function solve(p: FaceParams, pose: Rigid = FRONTAL, frame = glasses()): PlacementResult {
  const head = syntheticHead(p, pose);
  const result = solvePlacement(head.landmarks, head.mesh, frame);
  expect(result).not.toBeNull();
  return result!;
}

describe('buildHeadFrame', () => {
  it('karşıdan bakan yüzde kamera eksenleriyle hizalı', () => {
    const { landmarks } = syntheticHead(HIGH_BRIDGE);
    const f = buildHeadFrame(landmarks)!;
    expect(f.x.x).toBeGreaterThan(0.99);
    expect(f.z.z).toBeGreaterThan(0.95);
    expect(f.y.y).toBeGreaterThan(0.95);
  });

  it('sağ-el sistemi: x × y = z', () => {
    const { landmarks } = syntheticHead(HIGH_BRIDGE, rigid(25, -10, 8, { x: 30, y: -15, z: -600 }));
    const f = buildHeadFrame(landmarks)!;
    const cx = f.x.y * f.y.z - f.x.z * f.y.y;
    const cy = f.x.z * f.y.x - f.x.x * f.y.z;
    const cz = f.x.x * f.y.y - f.x.y * f.y.x;
    expect(cx).toBeCloseTo(f.z.x, 9);
    expect(cy).toBeCloseTo(f.z.y, 9);
    expect(cz).toBeCloseTo(f.z.z, 9);
  });

  it('toHead ∘ fromHead = kimlik', () => {
    const { landmarks } = syntheticHead(HIGH_BRIDGE, rigid(15, 5, -4, { x: 10, y: 0, z: -500 }));
    const f = buildHeadFrame(landmarks)!;
    const p = { x: 12.3, y: -4.5, z: 7.7 };
    const back = toHead(f, fromHead(f, p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
    expect(back.z).toBeCloseTo(p.z, 9);
  });
});

describe('HeadSurface', () => {
  it('analitik yüzeyi mesh çözünürlüğünde geri verir', () => {
    const { landmarks, mesh } = syntheticHead(HIGH_BRIDGE);
    const f = buildHeadFrame(landmarks)!;
    const s = new HeadSurface(mesh, f);
    // Baş çerçevesi sellion'da; yüzey sellion'da ≈ 0 olmalı.
    expect(Math.abs(s.zAt(0, 0)!)).toBeLessThan(0.8);
    // Burun ucu yanaklardan önde.
    expect(s.zAt(0, -35)!).toBeGreaterThan(s.zAt(30, -35)!);
  });

  it('mesh dışında null döner', () => {
    const { landmarks, mesh } = syntheticHead(HIGH_BRIDGE);
    const s = new HeadSurface(mesh, buildHeadFrame(landmarks)!);
    expect(s.zAt(500, 500)).toBeNull();
  });
});

describe('solvePlacement', () => {
  it('çerçeve yüze GİRMEZ: pedler ve alt çerçeve yüzeyin önünde', () => {
    for (const face of [HIGH_BRIDGE, FLAT_BRIDGE]) {
      const head = syntheticHead(face);
      const frame = glasses();
      const result = solvePlacement(head.landmarks, head.mesh, frame)!;
      const surface = new HeadSurface(head.mesh, result.head);

      for (const pad of [frame.padL, frame.padR]) {
        const q = modelToHead(pad, frame, result.local);
        const s = surface.zAt(q.x, q.y)!;
        expect(q.z).toBeGreaterThanOrEqual(s - 0.3);
      }
      for (const lc of [frame.lensCenterL, frame.lensCenterR]) {
        const q = modelToHead({ x: lc.x, y: lc.y - frame.lensHeight / 2, z: lc.z - 1.5 }, frame, result.local);
        const s = surface.zAt(q.x, q.y);
        if (s !== null) expect(q.z).toBeGreaterThanOrEqual(s + 2 - 0.3);
      }
    }
  });

  it('çerçeve bir şeye DEĞİYOR: yüzde asılı durmuyor', () => {
    const head = syntheticHead(HIGH_BRIDGE);
    const frame = glasses();
    const result = solvePlacement(head.landmarks, head.mesh, frame)!;
    const surface = new HeadSurface(head.mesh, result.head);

    // Belirleyici kısıt pedler ya da köprüyse, o nokta yüzeye temas etmeli.
    if (result.governing === 'pads') {
      const gaps = [frame.padL, frame.padR].map((pad) => {
        const q = modelToHead(pad, frame, result.local);
        return q.z - surface.zAt(q.x, q.y)!;
      });
      expect(Math.min(...gaps)).toBeLessThan(0.5);
    }
    expect(['pads', 'bridge']).toContain(result.governing);
  });

  it('KRİTİK: yüksek burun köprüsünde çerçeve düz köprüden daha YUKARIDA oturur', () => {
    const high = solve(HIGH_BRIDGE);
    const flat = solve(FLAT_BRIDGE);
    // Sabit offset kullanan naif yerleştirmede ikisi aynı olurdu — sahteliğin
    // 1 numaralı sebebi. Fark en az birkaç mm olmalı.
    expect(high.local.pivotY).toBeGreaterThan(flat.local.pivotY + 2);
  });

  it('düz köprü "alçak köprü" problemi üretir, yüksek köprü burunda durur', () => {
    const flat = solve(FLAT_BRIDGE);
    expect(['on-cheeks', 'on-lashes', 'slides-low']).toContain(flat.status);
    const high = solve(HIGH_BRIDGE);
    expect(high.status).toBe('nose');
  });

  it('arama aralığının sınırına yapışmaz (yüksek köprü)', () => {
    const high = solve(HIGH_BRIDGE);
    expect(high.local.pivotY).toBeLessThan(6);
    expect(high.local.pivotY).toBeGreaterThan(-32);
  });

  it('KRİTİK: yerel poz kafa hareketinden bağımsız', () => {
    const frontal = solve(HIGH_BRIDGE);
    const turned = solve(HIGH_BRIDGE, rigid(20, -8, 6, { x: 40, y: -25, z: -620 }));
    expect(Math.abs(turned.local.pivotY - frontal.local.pivotY)).toBeLessThan(0.6);
    expect(Math.abs(turned.local.pivotZ - frontal.local.pivotZ)).toBeLessThan(0.8);
    expect(Math.abs(turned.local.pitchDeg - frontal.local.pitchDeg)).toBeLessThan(0.8);
  });

  it('kulak yükseldikçe pantoskopik açı artar', () => {
    const head = syntheticHead(HIGH_BRIDGE);
    const frame = glasses();
    const low = solvePlacement(head.landmarks, head.mesh, frame, { earAboveOval: 0 })!;
    const high = solvePlacement(head.landmarks, head.mesh, frame, { earAboveOval: 18 })!;
    expect(high.local.pitchDeg).toBeGreaterThan(low.local.pitchDeg);
  });

  it('pantoskopik açı fizyolojik aralıkta', () => {
    const result = solve(HIGH_BRIDGE);
    expect(result.local.pitchDeg).toBeGreaterThanOrEqual(-4);
    expect(result.local.pitchDeg).toBeLessThanOrEqual(20);
  });

  it('composePose ped orta noktasını pivota taşır', () => {
    const result = solve(HIGH_BRIDGE, rigid(12, 4, -3, { x: 5, y: 8, z: -540 }));
    const frame = glasses();
    const pose = composePose(result.head, frame, result.local);
    const pm = padMid(frame);

    // Kuaternionla döndür: v' = q v q*
    const [qx, qy, qz, qw] = pose.quaternion;
    const rotate = (v: Vec3): Vec3 => {
      const ix = qw * v.x + qy * v.z - qz * v.y;
      const iy = qw * v.y + qz * v.x - qx * v.z;
      const iz = qw * v.z + qx * v.y - qy * v.x;
      const iw = -qx * v.x - qy * v.y - qz * v.z;
      return {
        x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
        y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
        z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
      };
    };
    const r = rotate(pm);
    const world = { x: r.x + pose.position.x, y: r.y + pose.position.y, z: r.z + pose.position.z };
    const expected = fromHead(result.head, { x: 0, y: result.local.pivotY, z: result.local.pivotZ });
    expect(world.x).toBeCloseTo(expected.x, 6);
    expect(world.y).toBeCloseTo(expected.y, 6);
    expect(world.z).toBeCloseTo(expected.z, 6);
  });

  it('kuaternion birim uzunlukta', () => {
    const result = solve(HIGH_BRIDGE, rigid(30, -12, 9, { x: 0, y: 0, z: -600 }));
    const [x, y, z, w] = result.pose.quaternion;
    expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 9);
  });

  it('eksik landmarkta null döner, çökmez', () => {
    const { mesh } = syntheticHead(HIGH_BRIDGE);
    expect(solvePlacement([], mesh, glasses())).toBeNull();
  });
});

describe('computeFit', () => {
  function fitFor(frontWidth: number) {
    const head = syntheticHead(HIGH_BRIDGE);
    const frame = glasses(frontWidth);
    const placement = solvePlacement(head.landmarks, head.mesh, frame)!;
    return computeFit(head.landmarks, placement, frame)!;
  }

  // Sentetik yüz genişliği: 234↔454 arası 136 mm
  it('dar çerçevede bir beden büyük önerir', () => {
    const fit = fitFor(118);
    expect(fit.verdict).toBe('too-narrow');
    expect(fit.sizeSuggestion).toBe(1);
  });

  it('geniş çerçevede bir beden küçük önerir', () => {
    const fit = fitFor(156);
    expect(fit.verdict).toBe('too-wide');
    expect(fit.sizeSuggestion).toBe(-1);
  });

  it('uyumlu çerçevede iyi der', () => {
    const fit = fitFor(139);
    expect(fit.verdict).toBe('good');
    expect(fit.sizeSuggestion).toBe(0);
  });

  it('uyumlu çerçeve uyumsuzlardan yüksek skor alır', () => {
    const good = fitFor(139).score;
    expect(good).toBeGreaterThan(fitFor(118).score);
    expect(good).toBeGreaterThan(fitFor(156).score);
  });

  it('segment yüksekliği makul aralıkta ve iki göz simetrik', () => {
    const fit = fitFor(136);
    expect(fit.optical.segmentHeightOD).toBeGreaterThan(8);
    expect(fit.optical.segmentHeightOD).toBeLessThan(38);
    expect(Math.abs(fit.optical.segmentHeightOD - fit.optical.segmentHeightOS)).toBeLessThan(0.5);
  });

  it('skor 0-100 aralığında', () => {
    const fit = fitFor(136);
    expect(fit.score).toBeGreaterThanOrEqual(0);
    expect(fit.score).toBeLessThanOrEqual(100);
  });
});
