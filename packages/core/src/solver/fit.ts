import type { Vec3 } from '../types.js';
import { dist } from '../perception/geometry.js';
import { FACE_SIDE_A, FACE_SIDE_B, IRIS_A_CENTER, IRIS_B_CENTER } from '../perception/landmarkIndices.js';
import { toHead } from './headFrame.js';
import { modelToHead, type GlassesGeometry, type PlacementResult, type RestStatus } from './placement.js';

/**
 * Fit skoru ve optik ölçüm raporu (TASKS T-03).
 *
 * B2B satışının asıl argümanı: try-on eğlence, ölçüm para kazandırır. Aynı
 * çözücü temas noktalarını hesaplarken "bu çerçeve bu yüze oturuyor mu"
 * sorusunu ve reçeteli lens siparişi için gereken ölçüleri de cevaplıyor.
 *
 * ⚠ İdeal aralıklar optik literatüründen başlangıç değerleridir. Ağırlıklar ve
 * aralıklar gerçek deneklerle (T-00) kalibre edilmeden müşteriye "doğru fit"
 * iddiası yapılmamalı. `estimated: true` olan bileşenler MediaPipe'ın
 * kalibre olmayan derinliğine ya da kulak konumu tahminine dayanıyor.
 */

export type FitKey = 'width' | 'squeeze' | 'pupil' | 'pantoscopic' | 'vertex' | 'temple';

export interface FitComponent {
  key: FitKey;
  label: string;
  value: number;
  unit: string;
  ideal: [number, number];
  tolerance: number;
  weight: number;
  /** 0..1 */
  score: number;
  estimated: boolean;
}

export interface OpticalMeasurements {
  /** Lens altından pupil merkezine (mm) — progresif lens için. */
  segmentHeightOD: number;
  segmentHeightOS: number;
  /** Lens arka yüzü – kornea (mm). */
  vertexDistance: number;
  /** Lens düzleminin dikeyle açısı (°). */
  pantoscopicTilt: number;
  /** Yüz formu açısı — çerçevenin özelliği; bilinmiyorsa null. */
  frameWrap: number | null;
}

export type Verdict = 'too-narrow' | 'good' | 'too-wide';

export interface FitReport {
  /** 0..100 */
  score: number;
  verdict: Verdict;
  /** −1 bir beden küçük · 0 uygun · +1 bir beden büyük */
  sizeSuggestion: -1 | 0 | 1;
  components: FitComponent[];
  optical: OpticalMeasurements;
  status: RestStatus;
  notes: string[];
}

/** İdeal aralıkta 1, dışında toleransa göre doğrusal düşüş. */
function trapezoid(value: number, [lo, hi]: [number, number], tolerance: number): number {
  if (value >= lo && value <= hi) return 1;
  const d = value < lo ? lo - value : value - hi;
  return Math.max(0, 1 - d / tolerance);
}

const STATUS_NOTES: Record<RestStatus, string | null> = {
  nose: null,
  'rides-high': 'Köprü bu burun için dar — çerçeve yukarıda duruyor, sıkabilir.',
  'slides-low': 'Köprü geniş ya da burun kökü alçak — çerçeve aşağı kayıyor. Ayarlanabilir ped önerilir.',
  'on-cheeks': 'Alt çerçeve yanaklara değiyor — gülümserken çerçeve kalkar. Alçak köprü uyumlu model önerilir.',
  'on-lashes': 'Lens kirpiklere çok yakın.',
};

export function computeFit(
  landmarksMM: ReadonlyArray<Vec3>,
  placement: PlacementResult,
  frame: GlassesGeometry,
): FitReport | null {
  const sideA = landmarksMM[FACE_SIDE_A];
  const sideB = landmarksMM[FACE_SIDE_B];
  const irisA = landmarksMM[IRIS_A_CENTER];
  const irisB = landmarksMM[IRIS_B_CENTER];
  if (!sideA || !sideB || !irisA || !irisB) return null;

  const { head, local } = placement;
  const faceWidth = dist(sideA, sideB);

  // --- genişlik ve sap baskısı ------------------------------------------
  const widthDiff = frame.frontWidth - faceWidth;
  const templeInnerHalf = Math.min(Math.abs(frame.hingeL.x), Math.abs(frame.hingeR.x)) - 2;
  const squeeze = faceWidth / 2 + 4 - templeInnerHalf;

  // --- pupil konumu / segment yüksekliği ---------------------------------
  const pA = toHead(head, irisA);
  const pB = toHead(head, irisB);
  const [pupilOD, pupilOS] = pA.x < pB.x ? [pA, pB] : [pB, pA];
  const up = rotUp(local.pitchDeg);

  const segment = (lensCenter: Vec3, pupil: Vec3): number => {
    const c = modelToHead(lensCenter, frame, local);
    const bottom = {
      x: c.x - up.x * (frame.lensHeight / 2),
      y: c.y - up.y * (frame.lensHeight / 2),
      z: c.z - up.z * (frame.lensHeight / 2),
    };
    return (pupil.x - bottom.x) * up.x + (pupil.y - bottom.y) * up.y + (pupil.z - bottom.z) * up.z;
  };
  const segOD = segment(frame.lensCenterR, pupilOD);
  const segOS = segment(frame.lensCenterL, pupilOS);
  const pupilFraction = ((segOD + segOS) / 2 / frame.lensHeight) * 100;

  // --- sap uzunluğu --------------------------------------------------------
  const hingeHead = modelToHead(
    {
      x: 0,
      y: (frame.hingeL.y + frame.hingeR.y) / 2,
      z: (frame.hingeL.z + frame.hingeR.z) / 2,
    },
    frame,
    local,
  );
  const reachNeeded = Math.abs(hingeHead.z - placement.earTarget.z);
  const frameReach =
    (Math.abs(frame.templeL.z - frame.hingeL.z) + Math.abs(frame.templeR.z - frame.hingeR.z)) / 2;
  const templeDiff = frameReach - reachNeeded;

  const components: FitComponent[] = [
    make('width', 'Çerçeve – yüz genişliği', widthDiff, 'mm', [-4, 8], 10, 0.3, false),
    make('squeeze', 'Sap baskısı', squeeze, 'mm', [-12, 3], 8, 0.15, false),
    make('pupil', 'Pupilin lens içindeki yeri', pupilFraction, '%', [50, 68], 25, 0.25, false),
    make('pantoscopic', 'Pantoskopik açı', local.pitchDeg, '°', [6, 12], 10, 0.1, true),
    make('vertex', 'Vertex mesafesi', placement.vertexDistance, 'mm', [11, 15], 6, 0.08, true),
    make('temple', 'Sap uzunluğu farkı', templeDiff, 'mm', [-3, 8], 15, 0.12, true),
  ];

  // Dinlenme durumu köprü uyumsuzluğu gösteriyorsa pupil bileşeni ne olursa
  // olsun iyi sayılmamalı — çerçeve yanlış yerde duruyor demektir.
  if (placement.status === 'rides-high' || placement.status === 'slides-low' || placement.status === 'on-cheeks') {
    const pupil = components.find((c) => c.key === 'pupil')!;
    pupil.score = Math.min(pupil.score, 0.4);
  }

  const totalWeight = components.reduce((a, c) => a + c.weight, 0);
  const score = Math.round((components.reduce((a, c) => a + c.weight * c.score, 0) / totalWeight) * 100);

  let verdict: Verdict = 'good';
  if (widthDiff < -7 || squeeze > 6) verdict = 'too-narrow';
  else if (widthDiff > 11) verdict = 'too-wide';
  const sizeSuggestion: -1 | 0 | 1 = verdict === 'too-narrow' ? 1 : verdict === 'too-wide' ? -1 : 0;

  const notes: string[] = [];
  const statusNote = STATUS_NOTES[placement.status];
  if (statusNote) notes.push(statusNote);
  if (placement.pitchClamped) notes.push('Sap açısı sınırda — sap uzunluğu bu baş için uyumsuz olabilir.');
  if (verdict === 'too-narrow') notes.push('Çerçeve yüz için dar — bir beden büyük önerilir.');
  if (verdict === 'too-wide') notes.push('Çerçeve yüz için geniş — bir beden küçük önerilir.');

  return {
    score,
    verdict,
    sizeSuggestion,
    components,
    optical: {
      segmentHeightOD: segOD,
      segmentHeightOS: segOS,
      vertexDistance: placement.vertexDistance,
      pantoscopicTilt: local.pitchDeg,
      frameWrap: frame.frameWrapDeg ?? null,
    },
    status: placement.status,
    notes,
  };
}

function rotUp(pitchDeg: number): Vec3 {
  const r = (pitchDeg * Math.PI) / 180;
  return { x: 0, y: Math.cos(r), z: Math.sin(r) };
}

function make(
  key: FitKey,
  label: string,
  value: number,
  unit: string,
  ideal: [number, number],
  tolerance: number,
  weight: number,
  estimated: boolean,
): FitComponent {
  return {
    key,
    label,
    value,
    unit,
    ideal,
    tolerance,
    weight,
    score: Number.isFinite(value) ? trapezoid(value, ideal, tolerance) : 0,
    estimated,
  };
}
