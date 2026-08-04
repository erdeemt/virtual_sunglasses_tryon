import type { FaceBasis, FaceUnits, HeadPose, RawLandmarks, SymmetryPlane, Vec3 } from '../types.js';
import { CHIN, FACE_SIDE_A, FACE_SIDE_B, FOREHEAD, MIDLINE } from './landmarkIndices.js';

export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a: Vec3): number => Math.sqrt(dot(a, a));
export const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });

export function norm(a: Vec3): Vec3 {
  const l = len(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
}

export function dist(a: Vec3, b: Vec3): number {
  return len(sub(a, b));
}

/**
 * MediaPipe normalize uzayından en-boy düzeltilmiş uzaya.
 *
 * x görüntü GENİŞLİĞİNE, y YÜKSEKLİĞE bölünmüş halde gelir; z ise MediaPipe
 * dokümantasyonuna göre kabaca x ile aynı ölçektedir. 16:9 bir videoda bu
 * düzeltme yapılmazsa yatay mesafeler ~%78 küçük ölçülür — sessiz ve
 * ölümcül bir hata.
 */
export function toFaceUnits(raw: RawLandmarks, aspect: number): FaceUnits {
  const out: Vec3[] = new Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i]!;
    out[i] = { x: p.x * aspect, y: p.y, z: p.z * aspect };
  }
  return out;
}

function at(lm: FaceUnits, i: number): Vec3 {
  const p = lm[i];
  if (!p) throw new Error(`Landmark ${i} yok (uzunluk ${lm.length})`);
  return p;
}

/**
 * Yüzün yerel ortonormal bazı.
 *
 * MediaPipe'ın z'si yaklaşıktır, dolayısıyla bu baz da yaklaşıktır — ancak
 * frontallik kapısı için fazlasıyla yeterli ve facialTransformationMatrix'in
 * satır/sütun düzeni gibi belirsizliklere bağımlı değil.
 */
export function faceBasis(lm: FaceUnits): FaceBasis {
  const sideA = at(lm, FACE_SIDE_A);
  const sideB = at(lm, FACE_SIDE_B);
  const chin = at(lm, CHIN);
  const brow = at(lm, FOREHEAD);

  const xRaw = sub(sideB, sideA);
  const yRaw = sub(brow, chin);
  const z = norm(cross(xRaw, yRaw));
  // Gram-Schmidt: y'yi z'ye dikleştir, x'i son olarak türet.
  const y = norm(sub(yRaw, scale(z, dot(yRaw, z))));
  const x = norm(cross(y, z));

  const origin: Vec3 = {
    x: (sideA.x + sideB.x) / 2,
    y: (sideA.y + sideB.y) / 2,
    z: (sideA.z + sideB.z) / 2,
  };
  return { x, y, z, origin };
}

/**
 * Baş pozu ve frontallik skoru.
 *
 * frontality = yüz normalinin kamera eksenine hizası, |roll| ile hafif cezalı.
 * Ölçüm kapısı bunu kullanır: yüz döndüğünde antropometrik mesafeler
 * perspektif nedeniyle kısalır ve ölçek tahmini bozulur.
 */
export function headPose(basis: FaceBasis): HeadPose {
  const { x, y, z } = basis;
  // Kamera -z yönüne bakıyor kabul; yüz normali z kameraya doğru.
  const yaw = Math.atan2(z.x, Math.abs(z.z)) * (180 / Math.PI);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -z.y))) * (180 / Math.PI);
  const roll = Math.atan2(x.y, y.y === 0 ? 1e-9 : Math.abs(y.y)) * (180 / Math.PI);

  const yawPenalty = Math.cos((yaw * Math.PI) / 180);
  const pitchPenalty = Math.cos((pitch * Math.PI) / 180);
  const rollPenalty = Math.cos((Math.min(Math.abs(roll), 45) * Math.PI) / 180);
  const frontality = Math.max(0, yawPenalty * pitchPenalty * rollPenalty);

  return { yaw, pitch, roll, frontality };
}

/**
 * Simetri (sagital) düzlemi — orta hat zincirinin centroidinden geçer,
 * normali yüzün yanal eksenidir. Monoküler PD bu düzleme uzaklıktan çıkar.
 */
export function symmetryPlane(lm: FaceUnits, basis: FaceBasis): SymmetryPlane {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let n = 0;
  for (const i of MIDLINE) {
    const p = lm[i];
    if (!p) continue;
    sx += p.x;
    sy += p.y;
    sz += p.z;
    n++;
  }
  if (n === 0) return { origin: basis.origin, normal: basis.x };
  return { origin: { x: sx / n, y: sy / n, z: sz / n }, normal: basis.x };
}

/** İşaretli uzaklık — işareti hangi tarafta olduğunu söyler. */
export function signedDistanceToPlane(p: Vec3, plane: SymmetryPlane): number {
  return dot(sub(p, plane.origin), plane.normal);
}

/**
 * Bir landmark halkasının en büyük çapı.
 *
 * İris için: halka 4 noktadır ve perspektif/bakış yönüyle elipsleşir.
 * Antropometrik prior YATAY çap için tanımlı, bu yüzden en büyük eksen
 * (major axis) alınır — frontal bakışta yatay çapa denk gelir.
 */
export function maxPairwiseDistance(lm: FaceUnits, indices: readonly number[]): number {
  let best = 0;
  for (let i = 0; i < indices.length; i++) {
    for (let j = i + 1; j < indices.length; j++) {
      const a = lm[indices[i]!];
      const b = lm[indices[j]!];
      if (!a || !b) continue;
      best = Math.max(best, dist(a, b));
    }
  }
  return best;
}
