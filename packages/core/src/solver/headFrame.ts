import type { Vec3 } from '../types.js';
import { cross, dot, len, norm, scale, sub } from '../perception/geometry.js';
import { CHIN, FACE_SIDE_A, FACE_SIDE_B, FOREHEAD, NOSE_BRIDGE_TOP } from '../perception/landmarkIndices.js';

/**
 * Baş koordinat sistemi — çözücünün çalıştığı uzay.
 *
 *   orijin = burun kökü (sellion, landmark 168)
 *   +x     = takan kişinin soluna
 *   +y     = yukarı (çeneden alna)
 *   +z     = yüzden dışarı (kameraya doğru)
 *   birim  = mm
 *
 * Neden ayrı bir uzay: gözlüğün başa göre nasıl oturduğu (hangi yükseklikte,
 * ne kadar eğik) yüzün anatomik bir özelliğidir ve kafa hareketiyle DEĞİŞMEZ.
 * Çözücü bu sabit "yerel pozu" bulur; her karede değişen tek şey baş pozudur.
 * Böylece yerel poz agresif filtrelenebilir ve fit skoru titremez.
 */
export interface HeadFrame {
  origin: Vec3;
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

/**
 * Kamera uzayındaki (mm) landmarklardan baş çerçevesini kurar.
 *
 * Yalnızca iki işaret kuralı var: z kameraya bakar, y yukarı bakar. x sağ-el
 * kuralından türetilir (x = y × z). Karşıdan bakan bir yüzde bu otomatik olarak
 * kamera +X'e, yani takan kişinin soluna denk gelir — 234/454'ün hangisinin
 * hangi tarafta olduğunu bilmemize gerek yok.
 */
export function buildHeadFrame(lm: ReadonlyArray<Vec3>): HeadFrame | null {
  const a = lm[FACE_SIDE_A];
  const b = lm[FACE_SIDE_B];
  const chin = lm[CHIN];
  const brow = lm[FOREHEAD];
  const sellion = lm[NOSE_BRIDGE_TOP];
  if (!a || !b || !chin || !brow || !sellion) return null;

  const xRaw = sub(b, a);
  const yRaw = sub(brow, chin);
  let z = norm(cross(xRaw, yRaw));
  if (len(z) < 0.5) return null; // dejenere: noktalar doğrusal
  if (z.z < 0) z = scale(z, -1);

  const y = norm(sub(yRaw, scale(z, dot(yRaw, z))));
  const x = cross(y, z);
  return { origin: sellion, x, y, z };
}

/** Kamera uzayı → baş uzayı. */
export function toHead(f: HeadFrame, p: Vec3): Vec3 {
  const d = sub(p, f.origin);
  return { x: dot(d, f.x), y: dot(d, f.y), z: dot(d, f.z) };
}

/** Baş uzayı → kamera uzayı. */
export function fromHead(f: HeadFrame, q: Vec3): Vec3 {
  return {
    x: f.origin.x + f.x.x * q.x + f.y.x * q.y + f.z.x * q.z,
    y: f.origin.y + f.x.y * q.x + f.y.y * q.y + f.z.y * q.z,
    z: f.origin.z + f.x.z * q.x + f.y.z * q.y + f.z.z * q.z,
  };
}
