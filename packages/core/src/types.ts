/**
 * Çekirdek tipler. Bu paket DOM'a bağımlı DEĞİLDİR (capability.ts hariç) —
 * amaç ileride tamamının bir Web Worker'a taşınabilmesi.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** MediaPipe FaceLandmarker çıktısı: 478 normalize landmark (x,y ∈ [0,1], z ~ x ölçeğinde). */
export type RawLandmarks = ReadonlyArray<Vec3>;

/**
 * En-boy oranı düzeltilmiş landmark uzayı.
 *
 * MediaPipe x'i görüntü GENİŞLİĞİNE, y'yi YÜKSEKLİĞE böler. Kare olmayan
 * videoda x ve y farklı ölçektedir; bu düzeltilmeden ölçülen her mesafe yanlıştır.
 * Burada x ve z, aspect (w/h) ile çarpılarak y ile aynı birime getirilir.
 * Sonuçtaki birim: "kare yükseklik payı" — mutlak değil, göreli.
 */
export type FaceUnits = ReadonlyArray<Vec3>;

/** Yüzün kamera karşısındaki yönelimi (derece). */
export interface HeadPose {
  yaw: number;
  pitch: number;
  roll: number;
  /** 0..1 — 1 = tam karşıdan. Ölçüm kapısı bunu kullanır. */
  frontality: number;
}

/** Yüz simetri (sagital) düzlemi: nokta + normal, FaceUnits uzayında. */
export interface SymmetryPlane {
  origin: Vec3;
  /** Birim normal. Yüzün sol-sağ eksenine paraleldir. */
  normal: Vec3;
}

export interface FaceBasis {
  /** Sağdan sola (veya tersi) — işareti garanti değil, taraf ataması görüntüden yapılır. */
  x: Vec3;
  /** Aşağıdan yukarı. */
  y: Vec3;
  /** Yüz normali (kameraya doğru). */
  z: Vec3;
  origin: Vec3;
}

export type CueKey =
  | 'irisDiameterA'
  | 'irisDiameterB'
  | 'interpupillary'
  | 'innerCanthal'
  | 'bizygomatic';

/** Bir antropometrik ipucunun tek karelik gözlemi. */
export interface CueSample {
  key: CueKey;
  /** FaceUnits cinsinden ölçülen mesafe. */
  observed: number;
}

export interface CuePrior {
  key: CueKey;
  label: string;
  /** Popülasyon ortalaması (mm). */
  muMM: number;
  /** Popülasyon standart sapması (mm). */
  sigmaMM: number;
  /** Kaynak notu — sayıların nereden geldiği unutulmasın. */
  source: string;
}

export interface CueContribution {
  key: CueKey;
  observed: number;
  /** Bu ipucunun tek başına verdiği ölçek tahmini (mm / FaceUnit). */
  scale: number;
  /** Bu tahminin standart sapması. */
  sigma: number;
  /** Füzyondaki ağırlığı (toplamı 1). Negatif olabilir — bu GLS'de normaldir. */
  weight: number;
}

export interface ScaleEstimate {
  /** mm / FaceUnit. Her karede değişir (derinliğe bağlı) — mm sonuçlar değişmez. */
  scale: number;
  /** Priorlardan gelen sistematik belirsizlik (mm/FaceUnit). İndirgenemez. */
  sigma: number;
  /** sigma / scale — yüzde cinsinden beklenen hata. */
  cv: number;
  contributions: CueContribution[];
  /** GLS mi yoksa güvenlik fallback'i mi kullanıldı. */
  method: 'gls' | 'fallback-ivw';
}

/** Kullanıcıya gösterilen nihai metrik ölçümler. */
export interface FaceMeasurements {
  /** Pupiller mesafe (mm). */
  pd: number;
  /** Monoküler PD — OD = sağ göz (görüntüde solda), OS = sol göz. */
  pdOD: number;
  pdOS: number;
  innerCanthal: number;
  bizygomatic: number;
  irisDiameter: number;
}

export interface MetricState {
  measurements: FaceMeasurements;
  /** Prior kaynaklı sistematik hata (%). */
  systematicCV: number;
  /** Kare-kare oynaklık (%) — filtreleme/pozdan gelir, sistematikten ayrıdır. */
  stabilityCV: number;
  /** Kabul edilmiş (frontal) örnek sayısı. */
  sampleCount: number;
  /** Ölçüm güvenilir sayılacak kadar örnek toplandı mı. */
  settled: boolean;
}
