import {
  dist,
  faceBasis,
  headPose,
  maxPairwiseDistance,
  signedDistanceToPlane,
  symmetryPlane,
} from '../perception/geometry.js';
import {
  CANTHUS_INNER_A,
  CANTHUS_INNER_B,
  FACE_SIDE_A,
  FACE_SIDE_B,
  IRIS_A_CENTER,
  IRIS_A_RING,
  IRIS_B_CENTER,
  IRIS_B_RING,
} from '../perception/landmarkIndices.js';
import type { CueSample, FaceBasis, FaceUnits, HeadPose, SymmetryPlane, Vec3 } from '../types.js';

export interface FrameGeometry {
  basis: FaceBasis;
  plane: SymmetryPlane;
  pose: HeadPose;
  /** OD = sağ göz. Görüntüde SOLDA görünür (aynalanmamış kaynakta). */
  irisOD: Vec3;
  irisOS: Vec3;
  irisDiameterOD: number;
  irisDiameterOS: number;
  cues: CueSample[];
}

/**
 * Bir kareden tüm geometriyi ve ölçek ipuçlarını çıkarır.
 *
 * Taraf ataması indeks semantiğine DEĞİL görüntü geometrisine dayanır:
 * kameraya bakan bir kişinin sağ tarafı, aynalanmamış görüntüde SOLDA
 * (küçük x) görünür. Böylece MediaPipe'ın sol/sağ konvansiyonunu bilmek
 * zorunda kalmıyoruz — bu konvansiyon kaynaklarda tutarsız belgeleniyor.
 *
 * ⚠ getUserMedia aynalanmamış kare verir. Aynalama YALNIZCA CSS ile
 * görüntüleme katmanında yapılmalı; landmarklar ham karede hesaplanır.
 */
export function extractFrameGeometry(lm: FaceUnits): FrameGeometry | null {
  const irisA = lm[IRIS_A_CENTER];
  const irisB = lm[IRIS_B_CENTER];
  const canthusA = lm[CANTHUS_INNER_A];
  const canthusB = lm[CANTHUS_INNER_B];
  const sideA = lm[FACE_SIDE_A];
  const sideB = lm[FACE_SIDE_B];
  if (!irisA || !irisB || !canthusA || !canthusB || !sideA || !sideB) return null;

  const basis = faceBasis(lm);
  const pose = headPose(basis);
  const plane = symmetryPlane(lm, basis);

  const aIsOD = irisA.x < irisB.x;
  const irisOD = aIsOD ? irisA : irisB;
  const irisOS = aIsOD ? irisB : irisA;

  const diaA = maxPairwiseDistance(lm, IRIS_A_RING);
  const diaB = maxPairwiseDistance(lm, IRIS_B_RING);
  const irisDiameterOD = aIsOD ? diaA : diaB;
  const irisDiameterOS = aIsOD ? diaB : diaA;

  const cues: CueSample[] = [
    { key: 'irisDiameterA', observed: diaA },
    { key: 'irisDiameterB', observed: diaB },
    { key: 'interpupillary', observed: dist(irisA, irisB) },
    { key: 'innerCanthal', observed: dist(canthusA, canthusB) },
    { key: 'bizygomatic', observed: dist(sideA, sideB) },
  ];

  return { basis, plane, pose, irisOD, irisOS, irisDiameterOD, irisDiameterOS, cues };
}

/** Monoküler PD: her irisin simetri düzlemine dik uzaklığı. */
export function monocularPD(geo: FrameGeometry, scaleMMPerUnit: number): { od: number; os: number } {
  return {
    od: Math.abs(signedDistanceToPlane(geo.irisOD, geo.plane)) * scaleMMPerUnit,
    os: Math.abs(signedDistanceToPlane(geo.irisOS, geo.plane)) * scaleMMPerUnit,
  };
}

export function cueValue(cues: CueSample[], key: CueSample['key']): number {
  return cues.find((c) => c.key === key)?.observed ?? NaN;
}
