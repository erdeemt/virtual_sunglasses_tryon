import type { Vec3 } from '../types.js';
import { FACE_SIDE_A, FACE_SIDE_B, IRIS_A_CENTER, IRIS_B_CENTER } from '../perception/landmarkIndices.js';
import { buildHeadFrame, fromHead, toHead, type HeadFrame } from './headFrame.js';
import { HeadSurface, type MeshMM } from './surface.js';

/**
 * Temas-kısıtlı yerleştirme çözücüsü (roadmap §7, TASKS T-01).
 *
 * ── Fizik ──────────────────────────────────────────────────────────────────
 * Gerçek gözlük iki burun pedi ve iki kulak üstünde durur. Saf statik burada
 * yetersiz: sürtünmesiz bir modelde pedler her yükseklikte buruna değebilir
 * ve yerçekimi çerçeveyi dibe kadar indirir. Çerçeveyi gerçekte tutan şey
 * silikon pedlerin sürtünmesi ve burnun iki yanına kama gibi oturmalarıdır.
 *
 * Model üç terimden oluşan bir enerji:
 *
 *   E(h) = h + k·z(h) + λ·(h − h₀)²
 *
 *   h        : ped orta noktasının yüksekliği (sellion = 0)
 *   z(h)     : o yükseklikte çerçevenin yüze ne kadar yaklaşabildiği — bir
 *              şeye (ped, köprü, yanak, kirpik) değene kadar itilir
 *   h + k·z  : yerçekimi aşağı, sap gerginliği yüze doğru çeker
 *   λ(h−h₀)² : sürtünme/kama etkisinin yerine geçen anatomik prior —
 *              pedler tipik olarak pupil hizasının biraz altında durur
 *
 * Burun şekli çerçeveyi h₀'dan uzaklaştırır: burun hızla öne çıkıyorsa
 * (yüksek köprü) çerçeve yukarıda kalır; düz köprüde aşağı kayar ve kirpiğe
 * ya da yanağa değer — optisyenlerin bildiği "alçak köprü" problemi. Sabit
 * offset kullanan naif yerleştirme bu farkı tamamen kaybeder.
 *
 * k, λ ve h₀ ampirik. Gerçek gözlük takan kişilerin fotoğraflarıyla kalibre
 * edilmeli (T-00 verisiyle birlikte). Kalibrasyon öncesi değerler makul ama
 * doğrulanmamış.
 *
 * ── Serbestlik dereceleri ──────────────────────────────────────────────────
 * Simetri kısıtı yaw ve roll'u başa kilitler, x ötelemesini sıfırlar.
 * Kalan 3 serbestlik: yükseklik (h), derinlik (z), pantoskopik açı (θ).
 *   h, z ← enerji minimumu + temas
 *   θ    ← sap uçları kulak üstü yüksekliğine gelecek şekilde
 * İkisi birbirine bağlı; birkaç iterasyonda yakınsıyor.
 */

/** Çözücünün çerçeveden ihtiyaç duyduğu her şey (model uzayı, mm). */
export interface GlassesGeometry {
  padL: Vec3;
  padR: Vec3;
  /** Köprü kemerinin burun sırtı üzerindeki en alt noktası. */
  bridge: Vec3;
  hingeL: Vec3;
  hingeR: Vec3;
  /** Kulak üstü temas noktaları (sapın kıvrılmaya başladığı yer). */
  templeL: Vec3;
  templeR: Vec3;
  lensCenterL: Vec3;
  lensCenterR: Vec3;
  lensWidth: number;
  lensHeight: number;
  /** Toplam ön genişlik. */
  frontWidth: number;
  /** Lens arka yüzünün lens merkez düzleminin ne kadar gerisinde olduğu. */
  lensBackOffset?: number;
  /** Çerçeve lenslerinin yüz formu açısı (°), biliniyorsa. */
  frameWrapDeg?: number | null;
}

export interface PlacementOptions {
  /** Sap gerginliği / yerçekimi oranı. */
  templePull: number;
  /** h₀: pedlerin pupil hizasının kaç mm altında durmaya meyilli olduğu. */
  padRestBelowPupil: number;
  /** λ: anatomik prior'ın gücü. Küçük = burun şekli daha etkili. */
  restPrior: number;
  searchTop: number;
  searchBottom: number;
  searchStep: number;
  bridgeClearance: number;
  cheekClearance: number;
  browClearance: number;
  /** Lens arka yüzü ile kornea arası minimum mesafe (kirpik teması). */
  minVertexDistance: number;
  /** Kornea tepesinin iris düzleminin ne kadar önünde olduğu. */
  corneaAheadOfIris: number;
  /** Kulak üstü temas noktasının yüz ovali yan noktalarına göre yüksekliği. */
  earAboveOval: number;
  /** Kulak üstü temas noktasının yüz ovali yan noktalarına göre geride oluşu. */
  earBehindOval: number;
  pitchMinDeg: number;
  pitchMaxDeg: number;
  iterations: number;
}

export const DEFAULT_PLACEMENT: PlacementOptions = {
  templePull: 1.0,
  padRestBelowPupil: 2,
  restPrior: 0.06,
  searchTop: 6,
  searchBottom: -32,
  searchStep: 0.5,
  bridgeClearance: 1.5,
  cheekClearance: 2,
  browClearance: 2,
  minVertexDistance: 10,
  corneaAheadOfIris: 2.5,
  // Antropometrik tahmin: MediaPipe mesh'i kulakları içermiyor (ARKit'inki de
  // içermiyor). 234/454 kabaca tragion hizasındaki yüz kenarı; sap bundan
  // biraz yukarıda ve geride, kulak kökünde durur.
  earAboveOval: 10,
  earBehindOval: 30,
  pitchMinDeg: -4,
  pitchMaxDeg: 20,
  iterations: 4,
};

export type ConstraintKey = 'pads' | 'bridge' | 'cheeks' | 'brow' | 'lashes';
export type RestStatus = 'nose' | 'rides-high' | 'slides-low' | 'on-cheeks' | 'on-lashes';

/** Çerçevenin başa göre pozu — anatomik sabit, kafa hareketiyle değişmez. */
export interface LocalPose {
  /** Ped orta noktasının baş uzayındaki yüksekliği (sellion = 0). */
  pivotY: number;
  /** Ped orta noktasının baş uzayındaki derinliği. */
  pivotZ: number;
  /** Pantoskopik açı — alt çerçeve yüze doğru eğikse pozitif. */
  pitchDeg: number;
}

export interface WorldPose {
  /** Model orijininin kamera uzayındaki konumu (mm). */
  position: Vec3;
  /** Model → kamera döndürmesi, [x, y, z, w]. */
  quaternion: [number, number, number, number];
}

export interface PlacementResult {
  head: HeadFrame;
  local: LocalPose;
  status: RestStatus;
  /** Dinlenme yüksekliğinde derinliği belirleyen kısıt. */
  governing: ConstraintKey;
  pitchClamped: boolean;
  /** Kulak üstü temas hedefi, baş uzayında. */
  earTarget: Vec3;
  pose: WorldPose;
  /** Temas noktaları, kamera uzayında — gölge için. */
  contacts: { padL: Vec3; padR: Vec3; bridge: Vec3; templeL: Vec3; templeR: Vec3 };
  /** Lens arka yüzü – kornea (mm). MediaPipe derinliğine dayandığı için tahmini. */
  vertexDistance: number;
  /** Teşhis: yükseklik taraması. */
  profile: Array<{ h: number; z: number; energy: number; governing: ConstraintKey }>;
}

const DEG = Math.PI / 180;

function rotX(p: Vec3, deg: number): Vec3 {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
}

export function padMid(frame: GlassesGeometry): Vec3 {
  return {
    x: (frame.padL.x + frame.padR.x) / 2,
    y: (frame.padL.y + frame.padR.y) / 2,
    z: (frame.padL.z + frame.padR.z) / 2,
  };
}

/** Model noktası → baş uzayı. Ped orta noktası pivottur ve x=0'da durur (simetri). */
export function modelToHead(p: Vec3, frame: GlassesGeometry, local: LocalPose): Vec3 {
  const pm = padMid(frame);
  const r = rotX({ x: p.x - pm.x, y: p.y - pm.y, z: p.z - pm.z }, local.pitchDeg);
  return { x: r.x, y: local.pivotY + r.y, z: local.pivotZ + r.z };
}

/**
 * Yerel poz + baş pozu → dünya pozu.
 *
 * Ayrı dışa aktarılıyor çünkü render katmanı yerel pozu ağır filtreleyip her
 * karede değişen baş pozuyla yeniden birleştiriyor.
 */
export function composePose(head: HeadFrame, frame: GlassesGeometry, local: LocalPose): WorldPose {
  const c = Math.cos(local.pitchDeg * DEG);
  const s = Math.sin(local.pitchDeg * DEG);
  // M = H · Rx(θ). Sütunlar: x, c·y + s·z, −s·y + c·z
  const c0 = head.x;
  const c1 = {
    x: c * head.y.x + s * head.z.x,
    y: c * head.y.y + s * head.z.y,
    z: c * head.y.z + s * head.z.z,
  };
  const c2 = {
    x: -s * head.y.x + c * head.z.x,
    y: -s * head.y.y + c * head.z.y,
    z: -s * head.y.z + c * head.z.z,
  };
  return {
    position: fromHead(head, modelToHead({ x: 0, y: 0, z: 0 }, frame, local)),
    quaternion: quatFromColumns(c0, c1, c2),
  };
}

function quatFromColumns(c0: Vec3, c1: Vec3, c2: Vec3): [number, number, number, number] {
  const m00 = c0.x;
  const m10 = c0.y;
  const m20 = c0.z;
  const m01 = c1.x;
  const m11 = c1.y;
  const m21 = c1.z;
  const m02 = c2.x;
  const m12 = c2.y;
  const m22 = c2.z;
  const trace = m00 + m11 + m22;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

// ---------------------------------------------------------------- sondalar

type ProbeKind = 'surface' | 'ridge' | 'cornea';

interface Probe {
  key: ConstraintKey;
  point: Vec3;
  clearance: number;
  kind: ProbeKind;
  corneaZ?: number;
}

/**
 * Çerçeve üzerinde yüze değebilecek noktalar. Her biri "bu noktanın önündeki
 * yüzey + boşluk" kadar bir alt derinlik sınırı üretir; çerçeve bunların en
 * büyüğüne kadar yüze itilir.
 *
 * Kirpik ve kaş sondaları DESTEK sağlamaz, sadece girişi engeller. Kirpik
 * kısıtı z'yi sabit tutarken enerjinin h terimi çerçeveyi aşağı iter —
 * yani çerçeve pedler buruna değene kadar kayar. Fiziksel olarak doğru.
 */
function buildProbes(frame: GlassesGeometry, o: PlacementOptions, cornea: { od: number; os: number }): Probe[] {
  const back = frame.lensBackOffset ?? 1.5;
  const probes: Probe[] = [
    { key: 'pads', point: frame.padL, clearance: 0, kind: 'surface' },
    { key: 'pads', point: frame.padR, clearance: 0, kind: 'surface' },
    { key: 'bridge', point: frame.bridge, clearance: o.bridgeClearance, kind: 'ridge' },
  ];

  for (const lc of [frame.lensCenterL, frame.lensCenterR]) {
    const dx = frame.lensWidth * 0.28;
    const bottom = lc.y - frame.lensHeight / 2;
    const top = lc.y + frame.lensHeight / 2;
    const z = lc.z - back;
    for (const x of [lc.x - dx, lc.x, lc.x + dx]) {
      probes.push({ key: 'cheeks', point: { x, y: bottom, z }, clearance: o.cheekClearance, kind: 'surface' });
    }
    for (const x of [lc.x - dx, lc.x + dx]) {
      probes.push({ key: 'brow', point: { x, y: top, z }, clearance: o.browClearance, kind: 'surface' });
    }
    probes.push({
      key: 'lashes',
      point: { x: lc.x, y: lc.y, z },
      clearance: o.minVertexDistance,
      kind: 'cornea',
      // model x < 0 → takan kişinin sağı → OD
      corneaZ: lc.x < 0 ? cornea.od : cornea.os,
    });
  }
  return probes;
}

interface RestSample {
  h: number;
  z: number;
  governing: ConstraintKey;
}

function scanHeights(
  surface: HeadSurface,
  frame: GlassesGeometry,
  probes: Probe[],
  pitchDeg: number,
  o: PlacementOptions,
): RestSample[] {
  const pm = padMid(frame);
  const rotated = probes.map((p) => ({
    ...p,
    r: rotX({ x: p.point.x - pm.x, y: p.point.y - pm.y, z: p.point.z - pm.z }, pitchDeg),
  }));

  const samples: RestSample[] = [];
  for (let h = o.searchTop; h >= o.searchBottom - 1e-9; h -= o.searchStep) {
    let zReq = -Infinity;
    let governing: ConstraintKey = 'pads';

    for (const probe of rotated) {
      let s: number | null;
      if (probe.kind === 'cornea') {
        s = probe.corneaZ ?? null;
      } else if (probe.kind === 'ridge') {
        s = null;
        for (const dx of [-1.5, 0, 1.5]) {
          const v = surface.zAt(probe.r.x + dx, h + probe.r.y);
          if (v !== null && (s === null || v > s)) s = v;
        }
      } else {
        s = surface.zAt(probe.r.x, h + probe.r.y);
      }
      if (s === null) continue;

      const bound = s + probe.clearance - probe.r.z;
      if (bound > zReq) {
        zReq = bound;
        governing = probe.key;
      }
    }

    if (Number.isFinite(zReq)) samples.push({ h, z: zReq, governing });
  }
  return samples;
}

/** Sap uçlarını kulak üstü yüksekliğine getiren pantoskopik açı. */
function pitchForEar(
  frame: GlassesGeometry,
  pivotY: number,
  earY: number,
  o: PlacementOptions,
): { pitch: number; clamped: boolean } {
  const pm = padMid(frame);
  const ry = (frame.templeL.y + frame.templeR.y) / 2 - pm.y;
  const rz = (frame.templeL.z + frame.templeR.z) / 2 - pm.z;

  // Döndürülmüş y: ry·cosθ − rz·sinθ = earY − pivotY
  const A = ry;
  const B = -rz;
  const C = earY - pivotY;
  const R = Math.hypot(A, B);
  if (R < 1e-6) return { pitch: 0, clamped: true };

  const ratio = Math.max(-1, Math.min(1, C / R));
  const phi = Math.atan2(B, A);
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const t1 = wrap(phi + Math.acos(ratio));
  const t2 = wrap(phi - Math.acos(ratio));
  const raw = (Math.abs(t1) < Math.abs(t2) ? t1 : t2) / DEG;

  const pitch = Math.max(o.pitchMinDeg, Math.min(o.pitchMaxDeg, raw));
  return { pitch, clamped: pitch !== raw || Math.abs(C / R) > 1 };
}

interface Rest {
  sample: RestSample;
  index: number;
  samples: RestSample[];
}

/**
 * Enerji minimumu. z(h) mesh gürültüsüyle pürüzlü olabilir; yerel minimumlara
 * takılmamak için 3'lü hareketli ortalamayla yumuşatılıyor.
 */
function pickRest(samples: RestSample[], o: PlacementOptions, h0: number): Rest {
  let bestIndex = 0;
  let bestEnergy = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const energy = energyAt(samples, i, o, h0);
    if (energy < bestEnergy) {
      bestEnergy = energy;
      bestIndex = i;
    }
  }
  return { sample: samples[bestIndex]!, index: bestIndex, samples };
}

function energyAt(samples: RestSample[], i: number, o: PlacementOptions, h0: number): number {
  const lo = Math.max(0, i - 1);
  const hi = Math.min(samples.length - 1, i + 1);
  let zSum = 0;
  for (let j = lo; j <= hi; j++) zSum += samples[j]!.z;
  const zSmooth = zSum / (hi - lo + 1);
  const h = samples[i]!.h;
  return h + o.templePull * zSmooth + o.restPrior * (h - h0) ** 2;
}

/**
 * Yerleştirmeyi çöz.
 *
 * @param landmarksMM kamera uzayında 478 landmark (unprojectToMM çıktısı)
 * @param mesh        kamera uzayında yüz mesh'i (468 tepe noktası + tesselation)
 */
export function solvePlacement(
  landmarksMM: ReadonlyArray<Vec3>,
  mesh: MeshMM,
  frame: GlassesGeometry,
  options: Partial<PlacementOptions> = {},
): PlacementResult | null {
  const o: PlacementOptions = { ...DEFAULT_PLACEMENT, ...options };
  const head = buildHeadFrame(landmarksMM);
  if (!head) return null;

  const sideA = landmarksMM[FACE_SIDE_A];
  const sideB = landmarksMM[FACE_SIDE_B];
  const irisA = landmarksMM[IRIS_A_CENTER];
  const irisB = landmarksMM[IRIS_B_CENTER];
  if (!sideA || !sideB || !irisA || !irisB) return null;

  const surface = new HeadSurface(mesh, head);

  const sA = toHead(head, sideA);
  const sB = toHead(head, sideB);
  const earTarget: Vec3 = {
    x: 0,
    y: (sA.y + sB.y) / 2 + o.earAboveOval,
    z: Math.max(-140, Math.min(-60, (sA.z + sB.z) / 2 - o.earBehindOval)),
  };

  // OD = takan kişinin sağ gözü = baş uzayında x < 0.
  const iA = toHead(head, irisA);
  const iB = toHead(head, irisB);
  const [od, os] = iA.x < iB.x ? [iA, iB] : [iB, iA];
  const cornea = { od: od.z + o.corneaAheadOfIris, os: os.z + o.corneaAheadOfIris };
  const h0 = (od.y + os.y) / 2 - o.padRestBelowPupil;

  const probes = buildProbes(frame, o, cornea);

  let pitch = 8;
  let pitchClamped = false;
  for (let iter = 0; iter < o.iterations; iter++) {
    const samples = scanHeights(surface, frame, probes, pitch, o);
    if (samples.length === 0) return null;
    const rest = pickRest(samples, o, h0);
    const next = pitchForEar(frame, rest.sample.h, earTarget.y, o);
    pitchClamped = next.clamped;
    const converged = Math.abs(next.pitch - pitch) < 0.05;
    pitch = next.pitch;
    if (converged) break;
  }

  // Son açıyla bir kez daha tara — dönen konum son açıyla tutarlı olsun.
  const samples = scanHeights(surface, frame, probes, pitch, o);
  if (samples.length === 0) return null;
  const rest = pickRest(samples, o, h0);

  const local: LocalPose = { pivotY: rest.sample.h, pivotZ: rest.sample.z, pitchDeg: pitch };

  let status: RestStatus = 'nose';
  if (rest.sample.governing === 'cheeks') status = 'on-cheeks';
  else if (rest.sample.governing === 'lashes') status = 'on-lashes';
  else if (rest.index === 0 || rest.sample.governing === 'brow') status = 'rides-high';
  else if (rest.index === rest.samples.length - 1) status = 'slides-low';

  const back = frame.lensBackOffset ?? 1.5;
  const vdOD = modelToHead({ ...frame.lensCenterR, z: frame.lensCenterR.z - back }, frame, local).z - cornea.od;
  const vdOS = modelToHead({ ...frame.lensCenterL, z: frame.lensCenterL.z - back }, frame, local).z - cornea.os;

  const toCam = (p: Vec3) => fromHead(head, modelToHead(p, frame, local));

  return {
    head,
    local,
    status,
    governing: rest.sample.governing,
    pitchClamped,
    earTarget,
    pose: composePose(head, frame, local),
    contacts: {
      padL: toCam(frame.padL),
      padR: toCam(frame.padR),
      bridge: toCam(frame.bridge),
      templeL: toCam(frame.templeL),
      templeR: toCam(frame.templeR),
    },
    vertexDistance: (vdOD + vdOS) / 2,
    profile: rest.samples.map((s, i) => ({ ...s, energy: energyAt(rest.samples, i, o, h0) })),
  };
}
