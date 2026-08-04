/**
 * MediaPipe FaceLandmarker (478 nokta) indeks haritası.
 *
 * ✅ GÜN 3 KAPISI GEÇİLDİ — tüm gruplar demo'nun denetim modunda gözle
 * doğrulandı (iris halkaları, kantuslar, yüz yanal noktaları, burun,
 * orta hat). İndeksler artık güvenilir kabul edilir.
 *
 * ⚠ Yeni indeks eklerken `verified: false` ile başla ve denetim modunda
 * teyit etmeden true yapma. İnternetteki landmark listelerinin çoğu hatalı.
 *
 * Tasarım ilkesi: mümkün olan her yerde indeks semantiğine değil GEOMETRİYE
 * güven. Örnek — hangi irisin sağ göz olduğu indeksten değil, görüntüdeki
 * x konumundan türetilir (bkz. sides.ts). Böylece MediaPipe'ın sol/sağ
 * adlandırma konvansiyonunu bilmek zorunda kalmayız.
 */

/** İris landmarkları yalnızca 478 noktalı modelde gelir. */
export const IRIS_A_CENTER = 468;
export const IRIS_A_RING = [469, 470, 471, 472] as const;
export const IRIS_B_CENTER = 473;
export const IRIS_B_RING = [474, 475, 476, 477] as const;

/** Göz iç köşeleri (endocanthion / medial canthus). */
export const CANTHUS_INNER_A = 133;
export const CANTHUS_INNER_B = 362;

/** Göz dış köşeleri (exocanthion). */
export const CANTHUS_OUTER_A = 33;
export const CANTHUS_OUTER_B = 263;

/**
 * Yüz ovalinin en yanal noktaları — bizygomatik genişlik için tragion PROXY'si.
 * Gerçek zygion değil; ölçek ipucu olarak prior'ı buna göre kalibre edildi.
 */
export const FACE_SIDE_A = 234;
export const FACE_SIDE_B = 454;

/** Orta hat (sagital) zinciri — simetri düzlemi bu noktalara uydurulur. */
export const MIDLINE = [10, 151, 9, 8, 168, 6, 197, 195, 5, 4, 1, 19, 152] as const;

/** Burun kökü (sellion civarı) ve burun ucu — yerleştirme çözücüsü için (Gün 10). */
export const NOSE_BRIDGE_TOP = 168;
export const NOSE_TIP = 1;
export const CHIN = 152;
export const FOREHEAD = 10;

/**
 * Doğrulama modunda etiketlenerek çizilecek noktalar.
 * `verified` alanı ancak gerçek cihazda gözle teyit sonrası true yapılır.
 */
export interface NamedLandmark {
  index: number;
  label: string;
  group: 'iris' | 'eye' | 'oval' | 'midline' | 'nose';
  verified: boolean;
}

export const NAMED_LANDMARKS: NamedLandmark[] = [
  { index: IRIS_A_CENTER, label: 'iris A merkez', group: 'iris', verified: true },
  { index: IRIS_B_CENTER, label: 'iris B merkez', group: 'iris', verified: true },
  ...IRIS_A_RING.map((i, n) => ({ index: i, label: `iris A halka ${n}`, group: 'iris' as const, verified: true })),
  ...IRIS_B_RING.map((i, n) => ({ index: i, label: `iris B halka ${n}`, group: 'iris' as const, verified: true })),
  { index: CANTHUS_INNER_A, label: 'iç kantus A', group: 'eye', verified: true },
  { index: CANTHUS_INNER_B, label: 'iç kantus B', group: 'eye', verified: true },
  { index: CANTHUS_OUTER_A, label: 'dış kantus A', group: 'eye', verified: true },
  { index: CANTHUS_OUTER_B, label: 'dış kantus B', group: 'eye', verified: true },
  { index: FACE_SIDE_A, label: 'yüz yanı A', group: 'oval', verified: true },
  { index: FACE_SIDE_B, label: 'yüz yanı B', group: 'oval', verified: true },
  { index: NOSE_BRIDGE_TOP, label: 'burun kökü', group: 'nose', verified: true },
  { index: NOSE_TIP, label: 'burun ucu', group: 'nose', verified: true },
  { index: CHIN, label: 'çene', group: 'midline', verified: true },
  { index: FOREHEAD, label: 'alın', group: 'midline', verified: true },
];

export const EXPECTED_LANDMARK_COUNT = 478;

/** Model 468 nokta döndürürse iris yok demektir — ölçek füzyonu çalışamaz. */
export function assertIrisAvailable(count: number): void {
  if (count < EXPECTED_LANDMARK_COUNT) {
    throw new Error(
      `İris landmarkları yok: ${count} nokta geldi, ${EXPECTED_LANDMARK_COUNT} bekleniyordu. ` +
        `face_landmarker.task model paketinin kullanıldığından emin ol.`,
    );
  }
}
