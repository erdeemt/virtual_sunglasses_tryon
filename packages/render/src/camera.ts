import type { FaceUnits, Vec3 } from '@vto/core';

/**
 * Kamera modeli ve metrik geri-projeksiyon.
 *
 * Web'de kamera intrinsics'i güvenilir değil (MediaTrackSettings çoğu cihazda
 * boş döner), bu yüzden dikey FOV varsayılır. Varsayım yanlışsa yüz mesh'i
 * hâlâ görüntüye TAM oturur — çünkü geri-projeksiyon gözlenen piksel
 * konumunu korur. Yanlış olan şey sahnenin derinlik ölçeği, yani gözlüğün
 * perspektif kısalması. Bu da görsel bir hata, hizalama hatası değil.
 */
export const DEFAULT_FOV_Y_DEG = 60;

export interface CameraModel {
  fovYDeg: number;
  aspect: number;
  /** Yüz merkezinin kameradan uzaklığı (mm). Metrik ölçekten türetilir. */
  distanceMM: number;
}

/**
 * Yüz merkezinin metrik uzaklığı.
 *
 * Görüntünün dikey açıklığı, Z uzaklığında 2·Z·tan(fov/2) mm'dir.
 * FaceUnits tanımı gereği bu açıklık tam olarak 1 birimdir ve ölçek
 * füzyonu 1 birim = k mm demiştir. Dolayısıyla:
 *
 *     k = 2·Z·tan(fov/2)   →   Z = k / (2·tan(fov/2))
 *
 * Tipik değer: k ≈ 630 mm/birim, fov 60° → Z ≈ 545 mm. Bir webcam
 * mesafesi olarak makul — bu, ölçek füzyonunun fiziksel olarak tutarlı
 * olduğunun bedava bir kontrolü.
 */
export function faceDistanceMM(scaleMMPerUnit: number, fovYDeg = DEFAULT_FOV_Y_DEG): number {
  return scaleMMPerUnit / (2 * Math.tan((fovYDeg * Math.PI) / 360));
}

/**
 * FaceUnits landmarklarını metrik kamera uzayına geri-projekte eder.
 *
 * Sonuç: milimetre cinsinden, kamera orijinde ve -Z yönüne bakan bir
 * dünyada duran gerçek 3B yüz. ARKit'in TrueDepth ile bedava verdiği şeyin
 * tek RGB kameradan üretilmiş hali.
 *
 * Her landmark kendi derinliğinde geri-projekte edilir (Z_i / Z çarpanı) —
 * tek bir düzlem varsayılsaydı burun ucunda ~%5 hata kalırdı.
 *
 * ⚠ MediaPipe'ın z'si mutlak anlamda kalibre değil ("kabaca x ölçeğinde").
 * Yani derinlik profili yaklaşıktır; x-y hizalaması ise tamdır.
 */
export function unprojectToMM(
  lm: FaceUnits,
  scaleMMPerUnit: number,
  aspect: number,
  fovYDeg = DEFAULT_FOV_Y_DEG,
  out?: Float32Array,
): Float32Array {
  const k = scaleMMPerUnit;
  const Z = faceDistanceMM(k, fovYDeg);
  const cx = aspect / 2;
  const cy = 0.5;

  // MediaPipe z'sinin orijini baş merkezidir; yine de merkezleyerek
  // modelden gelen kaymalara karşı sağlamlaştırıyoruz.
  let zSum = 0;
  for (const p of lm) zSum += p.z;
  const zMean = zSum / lm.length;

  const target = out && out.length === lm.length * 3 ? out : new Float32Array(lm.length * 3);

  for (let i = 0; i < lm.length; i++) {
    const p = lm[i]!;
    // MediaPipe: z küçüldükçe kameraya yaklaşır → derinlik de küçülür.
    const depth = Z + (p.z - zMean) * k;
    const ratio = depth / Z;
    target[i * 3] = (p.x - cx) * k * ratio;
    target[i * 3 + 1] = -(p.y - cy) * k * ratio;
    target[i * 3 + 2] = -depth;
  }

  return target;
}

/** Tek bir noktayı geri-projekte eder (anchor hesapları için). */
export function unprojectPoint(
  p: Vec3,
  scaleMMPerUnit: number,
  aspect: number,
  zMean: number,
  fovYDeg = DEFAULT_FOV_Y_DEG,
): Vec3 {
  const k = scaleMMPerUnit;
  const Z = faceDistanceMM(k, fovYDeg);
  const depth = Z + (p.z - zMean) * k;
  const ratio = depth / Z;
  return {
    x: (p.x - aspect / 2) * k * ratio,
    y: -(p.y - 0.5) * k * ratio,
    z: -depth,
  };
}
