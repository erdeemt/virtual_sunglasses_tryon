import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BuiltFrame, FrameAnchors, FrameSpec } from './frameModel.js';
import { DEFAULT_SPEC } from './frameModel.js';

/**
 * Hazır GLB/glTF gözlük modeli yükleme.
 *
 * İndirilen bir modelde şunların hiçbiri garanti değil:
 *   - ölçek birimi (glTF spesifikasyonu METRE der, ama herkes uymaz)
 *   - yönelim (spesifikasyon +Y yukarı, ön yüz +Z der — yine herkes uymaz)
 *   - orijin konumu
 *   - semantik anchor noktaları (köprü, burun pedi, menteşe, sap ucu)
 *
 * Bu dosya ilk üçünü normalize eder, dördüncüsünü türetir. İki yol var:
 *
 *   1. İSİMLİ PARÇALAR — e-ticaret modelleri çoğunlukla parçaları adlandırır
 *      (Nosepads, TempleLeft, EarhookRight, Lenses...). Bu durumda anchor'lar
 *      gerçek ped/sap/lens geometrisinden hesaplanır. En doğrusu.
 *   2. HEURİSTİK — isim yoksa gözlüğün kısıtlı şeklinden tahmin edilir.
 *
 * Her anchor bağımsız olarak düşer: pedler isimden, sap ucu heuristikten
 * gelebilir. Sonuç UI'da gösterilip elle düzeltilebilir olmalı.
 *
 * Kalıcı çözüm asset pipeline (TASKS.md T-08): anchor'lar bir kez işaretlenip
 * manifest'e yazılır.
 */

export type ScaleMode = 'auto' | 'meters' | 'fit-width';

export interface NormalizeOptions {
  /**
   * Çerçevenin gerçek toplam ön genişliği (mm). Yalnızca ölçek modu
   * 'fit-width'e düştüğünde kullanılır.
   */
  frontWidthMM: number;
  /**
   * 'auto': glTF spesifikasyonuna (metre) güven; sonuç gözlük için makul
   * değilse (100–200 mm dışı) genişliğe oturt.
   */
  scaleMode?: ScaleMode;
  upAxis?: 'x' | 'y' | 'z';
  forwardAxis?: 'x' | 'y' | 'z';
  /** Model ters bakıyorsa (saplar öne uzanıyorsa) 180° çevir. */
  flipForward?: boolean;
  spec?: FrameSpec;
}

export interface LoadedFrameInfo {
  detectedUp: 'x' | 'y' | 'z';
  detectedForward: 'x' | 'y' | 'z';
  rawSize: THREE.Vector3;
  scaleFactor: number;
  scaleMode: 'meters' | 'fit-width';
  /** Ölçek sonrası ön genişlik (mm). */
  frontWidthMM: number;
  meshCount: number;
  triangleCount: number;
  materialNames: string[];
  /** Hangi anchor'lar isimli parçalardan geldi. */
  namedAnchors: string[];
  warnings: string[];
}

export interface LoadedFrame extends BuiltFrame {
  info: LoadedFrameInfo;
}

const AXES = ['x', 'y', 'z'] as const;
type Axis = (typeof AXES)[number];

const PART = {
  pads: /nose.?pad|nosepad|\bpads?\b/i,
  temples: /temple|ear.?hook|\barms?\b|\blegs?\b/i,
  lenses: /lens|glass/i,
  front: /frame|rim|front|bridge/i,
};

export async function loadFrameFromGLB(source: string | File, options: NormalizeOptions): Promise<LoadedFrame> {
  const loader = new GLTFLoader();
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);

  try {
    const gltf = await loader.loadAsync(url);
    return normalizeFrame(gltf.scene, options);
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url);
  }
}

/**
 * Yüklenen sahneyi model uzayımıza taşır.
 *
 * Hedef koordinat sistemi (frameModel.ts ile aynı):
 *   +X takan kişinin soluna · +Y yukarı · +Z yüzden dışarı · birim mm
 *   saplar -Z yönüne uzanır · orijin köprü anchor'ında
 */
export function normalizeFrame(root: THREE.Object3D, options: NormalizeOptions): LoadedFrame {
  const warnings: string[] = [];
  const baseSpec = options.spec ?? DEFAULT_SPEC;

  const group = new THREE.Group();
  group.name = 'glasses-glb';
  group.add(root);

  // --- ham ölçüler ---------------------------------------------------------
  root.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(root);
  const rawSize = rawBox.getSize(new THREE.Vector3());
  if (rawSize.length() < 1e-9) throw new Error('Model boş görünüyor — geometri bulunamadı.');

  // --- eksen tespiti -------------------------------------------------------
  // Gözlükte en küçük açıklık daima YUKARI eksenidir (yükseklik ~40-60 mm,
  // genişlik ~140 mm, sap derinliği ~150 mm).
  const detectedUp = options.upAxis ?? smallestAxis(rawSize);
  // Kalan iki eksenden sol-sağ olanı aynalama simetrisi gösterir; ileri ekseni
  // asimetriktir (saplar tek yöne uzanır).
  const remaining = AXES.filter((a) => a !== detectedUp);
  const detectedForward = options.forwardAxis ?? pickForwardAxis(root, remaining as [Axis, Axis], rawBox);
  const sideAxis = remaining.find((a) => a !== detectedForward)!;

  root.applyMatrix4(basisRotation(sideAxis, detectedUp, detectedForward));
  root.updateMatrixWorld(true);

  // --- ölçekleme -----------------------------------------------------------
  let box = new THREE.Box3().setFromObject(root);
  const widthRaw = box.getSize(new THREE.Vector3()).x;
  const requested = options.scaleMode ?? 'auto';
  let scaleMode: 'meters' | 'fit-width';
  let scaleFactor: number;

  const asMeters = widthRaw * 1000;
  if (requested === 'meters' || (requested === 'auto' && asMeters >= 100 && asMeters <= 200)) {
    scaleMode = 'meters';
    scaleFactor = 1000;
  } else {
    scaleMode = 'fit-width';
    scaleFactor = options.frontWidthMM / widthRaw;
    if (requested === 'auto') {
      warnings.push(
        `Birim glTF spesifikasyonuna (metre) uymuyor — genişlik ${options.frontWidthMM} mm'ye oturtuldu.`,
      );
    }
  }
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
    throw new Error('Ölçek hesaplanamadı — modelin genişliği sıfır.');
  }
  root.applyMatrix4(new THREE.Matrix4().makeScale(scaleFactor, scaleFactor, scaleFactor));
  root.updateMatrixWorld(true);

  // --- ileri yönü doğrula --------------------------------------------------
  const shouldFlip = options.flipForward ?? detectTemplesDirection(root) > 0;
  if (shouldFlip) {
    root.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI));
    root.updateMatrixWorld(true);
  }
  box = new THREE.Box3().setFromObject(root);

  // --- anchor türetimi -----------------------------------------------------
  const parts = collectParts(root);
  const derived = deriveAnchors(root, box, parts, baseSpec, warnings);
  const { anchors, namedAnchors } = derived;

  // Orijini köprü anchor'ına taşı.
  const shift = anchors.bridgeCenter.clone().negate();
  root.applyMatrix4(new THREE.Matrix4().makeTranslation(shift.x, shift.y, shift.z));
  root.updateMatrixWorld(true);
  for (const key of Object.keys(anchors) as Array<keyof FrameAnchors>) anchors[key].add(shift);

  // --- envanter ------------------------------------------------------------
  let meshCount = 0;
  let triangleCount = 0;
  const materials = new Set<string>();
  const materialRefs: THREE.Material[] = [];
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    meshCount++;
    const index = node.geometry.getIndex();
    const position = node.geometry.getAttribute('position');
    triangleCount += index ? index.count / 3 : position ? position.count / 3 : 0;
    for (const m of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(m.name || m.type);
      materialRefs.push(m);
    }
  });

  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  if (triangleCount > 60_000) {
    warnings.push(`${Math.round(triangleCount)} üçgen — mobilde ağır. LOD gerekiyor (T-08).`);
  }
  if (size.z < size.x * 0.4) {
    warnings.push('Model çok sığ — saplar eksik olabilir (sadece ön çerçeve?).');
  }

  const frontWidthMM = derived.frontWidth ?? size.x;
  const spec: FrameSpec = {
    ...baseSpec,
    lensWidth: round1(derived.lensWidth ?? baseSpec.lensWidth),
    lensHeight: round1(derived.lensHeight ?? baseSpec.lensHeight),
    bridgeWidth: round1(derived.bridgeWidth ?? baseSpec.bridgeWidth),
    templeLength: round1(derived.templeLength ?? baseSpec.templeLength),
  };

  // Renk değişimi için ön çerçevenin (yoksa ilk opak) malzemesini hedefle.
  const frontMaterial = parts.front[0]?.material;
  const primary = (
    (frontMaterial && !Array.isArray(frontMaterial) ? frontMaterial : null) ??
    materialRefs.find((m) => m instanceof THREE.MeshStandardMaterial && !(m as THREE.MeshPhysicalMaterial).transmission)
  ) as THREE.MeshPhysicalMaterial | undefined;

  return {
    group,
    anchors,
    spec,
    frontWidth: frontWidthMM,
    lensBackOffset: derived.lensBackOffset,
    frameWrapDeg: derived.frameWrapDeg,
    info: {
      detectedUp,
      detectedForward,
      rawSize,
      scaleFactor,
      scaleMode,
      frontWidthMM,
      meshCount,
      triangleCount: Math.round(triangleCount),
      materialNames: [...materials],
      namedAnchors,
      warnings,
    },
    materials: {
      frame: primary ?? new THREE.MeshPhysicalMaterial(),
      lens: new THREE.MeshPhysicalMaterial(),
    },
    dispose() {
      root.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          for (const m of Array.isArray(node.material) ? node.material : [node.material]) m.dispose();
        }
      });
    },
  };
}

// ---------------------------------------------------------------- parçalar

interface Parts {
  pads: THREE.Mesh[];
  temples: THREE.Mesh[];
  lenses: THREE.Mesh[];
  front: THREE.Mesh[];
}

/** Mesh'leri kendi adları ya da ata düğüm adlarıyla sınıflandır. */
function collectParts(root: THREE.Object3D): Parts {
  const parts: Parts = { pads: [], temples: [], lenses: [], front: [] };
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const names: string[] = [];
    for (let n: THREE.Object3D | null = node; n && n !== root; n = n.parent) names.push(n.name);
    const label = names.join(' ');
    if (PART.pads.test(label)) parts.pads.push(node);
    else if (PART.temples.test(label)) parts.temples.push(node);
    else if (PART.lenses.test(label)) parts.lenses.push(node);
    else if (PART.front.test(label)) parts.front.push(node);
  });
  return parts;
}

/** Mesh'lerin dünya uzayı tepe noktaları (büyük mesh'lerde örneklenmiş). */
function worldVertices(meshes: THREE.Object3D[], budget = 20000): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const root of meshes) {
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const position = node.geometry.getAttribute('position');
      if (!position) return;
      const step = Math.max(1, Math.floor(position.count / budget));
      for (let i = 0; i < position.count; i += step) {
        out.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld));
      }
    });
  }
  return out;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]!;
}

function mean(vs: THREE.Vector3[]): THREE.Vector3 {
  const m = new THREE.Vector3();
  for (const v of vs) m.add(v);
  return vs.length ? m.multiplyScalar(1 / vs.length) : m;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

// ---------------------------------------------------------------- eksenler

function smallestAxis(size: THREE.Vector3): Axis {
  if (size.x <= size.y && size.x <= size.z) return 'x';
  if (size.y <= size.x && size.y <= size.z) return 'y';
  return 'z';
}

/**
 * İki aday eksenden hangisinin "ileri" olduğunu bulur: gözlük sol-sağ eksenine
 * göre simetriktir, ileri eksenine göre değildir.
 */
function pickForwardAxis(root: THREE.Object3D, candidates: [Axis, Axis], box: THREE.Box3): Axis {
  const center = box.getCenter(new THREE.Vector3());
  const skew: Record<string, number> = { [candidates[0]]: 0, [candidates[1]]: 0 };
  let n = 0;
  for (const v of worldVertices([root], 4000)) {
    v.sub(center);
    for (const axis of candidates) skew[axis]! += v[axis];
    n++;
  }
  if (n === 0) return candidates[1];
  const a = Math.abs(skew[candidates[0]]! / n);
  const b = Math.abs(skew[candidates[1]]! / n);
  return a > b ? candidates[0] : candidates[1];
}

/**
 * side/up/forward eksenlerini X/Y/Z'ye eşleyen dönüşüm.
 *
 * ⚠ Determinant kontrolü şart: eksen kombinasyonlarının yarısı determinantı
 * −1 yapar, yani AYNALAMA üretir. Aynalanmış bir gözlükte asimetrik detaylar
 * yanlış tarafa geçer. Bu durumda ileri eksenini ters çevirip saf döndürmeye
 * zorluyoruz (yön hatası varsa detectTemplesDirection düzeltir).
 */
function basisRotation(side: Axis, up: Axis, forward: Axis): THREE.Matrix4 {
  const unit = (axis: Axis): THREE.Vector3 =>
    new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  const s = unit(side);
  const u = unit(up);
  const f = unit(forward);
  if (s.dot(new THREE.Vector3().crossVectors(u, f)) < 0) f.negate();
  // Satırları kaynak eksenler olan matris = kaynak → hedef dönüşümü.
  return new THREE.Matrix4().set(s.x, s.y, s.z, 0, u.x, u.y, u.z, 0, f.x, f.y, f.z, 0, 0, 0, 0, 1);
}

/**
 * Sapların hangi yöne uzandığı. Dönen değer > 0 ise +Z'ye (model ters).
 * Ön çerçeve geniş, saplar ince: sapların olduğu uçta kesit daha dar.
 */
function detectTemplesDirection(root: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  let frontHalfWidth = 0;
  let backHalfWidth = 0;
  for (const v of worldVertices([root], 4000)) {
    v.sub(center);
    if (v.z > size.z * 0.25) frontHalfWidth = Math.max(frontHalfWidth, Math.abs(v.x));
    else if (v.z < -size.z * 0.25) backHalfWidth = Math.max(backHalfWidth, Math.abs(v.x));
  }
  return backHalfWidth - frontHalfWidth;
}

// ---------------------------------------------------------------- anchor'lar

interface Derived {
  anchors: FrameAnchors;
  namedAnchors: string[];
  lensWidth?: number;
  lensHeight?: number;
  bridgeWidth?: number;
  templeLength?: number;
  frontWidth?: number;
  lensBackOffset: number;
  frameWrapDeg: number | null;
}

function deriveAnchors(
  root: THREE.Object3D,
  box: THREE.Box3,
  parts: Parts,
  spec: FrameSpec,
  warnings: string[],
): Derived {
  const heuristic = heuristicAnchors(root, box, spec, warnings);
  const anchors = heuristic;
  const named: string[] = [];
  const out: Omit<Derived, 'anchors' | 'namedAnchors'> = { lensBackOffset: 1.5, frameWrapDeg: null };

  // --- lensler → lens merkezleri, ölçüler, yüz formu ------------------------
  if (parts.lenses.length) {
    const verts = worldVertices(parts.lenses);
    const sides = [verts.filter((v) => v.x > 0), verts.filter((v) => v.x < 0)] as const;
    if (sides[0].length > 10 && sides[1].length > 10) {
      const boxes = sides.map((vs) => new THREE.Box3().setFromPoints(vs));
      const centers = boxes.map((b) => b.getCenter(new THREE.Vector3()));
      // Kavisli (sarmal) lenslerde optik merkez ön yüzeyin en önüne yakın.
      anchors.lensCenterL.set(centers[0]!.x, centers[0]!.y, boxes[0]!.max.z - 1);
      anchors.lensCenterR.set(centers[1]!.x, centers[1]!.y, boxes[1]!.max.z - 1);
      const sizes = boxes.map((b) => b.getSize(new THREE.Vector3()));
      out.lensWidth = (sizes[0]!.x + sizes[1]!.x) / 2;
      out.lensHeight = (sizes[0]!.y + sizes[1]!.y) / 2;
      out.bridgeWidth = boxes[0]!.min.x - boxes[1]!.max.x;
      out.lensBackOffset = 2;
      out.frameWrapDeg = wrapAngle(sides[0]) ?? null;
      named.push('lensCenterL', 'lensCenterR');
    }
  }

  // --- burun pedleri → gerçek temas noktaları -----------------------------
  if (parts.pads.length) {
    const verts = worldVertices(parts.pads);
    for (const [key, sign] of [
      ['nosePadL', 1],
      ['nosePadR', -1],
    ] as const) {
      const side = verts.filter((v) => Math.sign(v.x) === sign);
      if (side.length < 6) continue;
      // Temas yüzeyi pedin burna bakan (iç) tarafı.
      const innerX = percentile(
        side.map((v) => Math.abs(v.x)),
        0.2,
      );
      const c = mean(side);
      anchors[key].set(sign * innerX, c.y, c.z);
      named.push(key);
    }
  }

  // --- saplar → menteşe ve kulak temas noktası ----------------------------
  if (parts.temples.length) {
    const verts = worldVertices(parts.temples);
    for (const [hingeKey, tipKey, sign] of [
      ['hingeL', 'templeTipL', 1],
      ['hingeR', 'templeTipR', -1],
    ] as const) {
      const side = verts.filter((v) => Math.sign(v.x) === sign);
      if (side.length < 6) continue;
      const front = side.reduce((a, b) => (b.z > a.z ? b : a));
      anchors[hingeKey].copy(front);
      anchors[tipKey].copy(bendStart(side));
      named.push(hingeKey, tipKey);
    }
    const reach =
      (Math.abs(anchors.templeTipL.z - anchors.hingeL.z) + Math.abs(anchors.templeTipR.z - anchors.hingeR.z)) / 2;
    out.templeLength = reach + spec.earBendLength;
  }

  // --- köprü: pedlerin üstündeki kemerin alt yüzü --------------------------
  const frontVerts = parts.front.length ? worldVertices(parts.front) : worldVertices([root]);
  const padY = (anchors.nosePadL.y + anchors.nosePadR.y) / 2;
  const arch = frontVerts.filter((v) => Math.abs(v.x) < 3 && v.y > padY);
  if (arch.length > 0) {
    const under = arch.reduce((a, b) => (b.y < a.y ? b : a));
    anchors.bridgeCenter.set(0, under.y, under.z);
    if (parts.front.length) named.push('bridgeCenter');
  }

  if (parts.front.length) {
    const fb = new THREE.Box3().setFromPoints(frontVerts);
    out.frontWidth = fb.getSize(new THREE.Vector3()).x;
  }

  return { anchors, namedAnchors: named, ...out };
}

/**
 * Sapın kulak üstüne değdiği yer: sap en yüksek hattından aşağı kıvrılmaya
 * başladığı nokta. (En geri nokta DEĞİL — o, kulağın arkasında aşağı sarkan
 * kancanın ucu.)
 */
function bendStart(side: THREE.Vector3[]): THREE.Vector3 {
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const v of side) {
    if (v.z < zMin) zMin = v.z;
    if (v.z > zMax) zMax = v.z;
  }
  // Önün %20'si hariç: ön çerçeve ve menteşe bölgesi sapın üst hattı değil.
  // (Olmadan, sadece geometrik heuristikte ön çerçevenin tepesi "sap tepesi"
  // sanılıyordu — testler yakaladı.)
  const cutoff = zMax - 0.2 * (zMax - zMin);
  const rear = side.filter((v) => v.z <= cutoff);
  if (rear.length < 2) return side.reduce((a, b) => (b.z < a.z ? b : a)).clone();

  // Üst profil: 4 mm'lik z dilimlerinde en yüksek nokta, önden arkaya.
  const BIN = 4;
  const bins = new Map<number, THREE.Vector3>();
  for (const v of rear) {
    const k = Math.floor((cutoff - v.z) / BIN);
    const current = bins.get(k);
    if (!current || v.y > current.y) bins.set(k, v);
  }
  const profile = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);

  // Kıvrım: üst hattın iki ardışık dilimde ~20°'den dik düştüğü ilk yer.
  for (let i = 1; i < profile.length - 1; i++) {
    const d1 = (profile[i - 1]!.y - profile[i]!.y) / BIN;
    const d2 = (profile[i]!.y - profile[i + 1]!.y) / BIN;
    if (d1 > 0.35 && d2 > 0.35) return profile[i - 1]!.clone();
  }
  return profile[profile.length - 1]!.clone();
}

/** Yüz formu (wrap) açısı: lensin iç ve dış kenarı arasındaki derinlik farkı. */
function wrapAngle(lens: THREE.Vector3[]): number | undefined {
  const xs = lens.map((v) => Math.abs(v.x));
  const inner = percentile(xs, 0.1);
  const outer = percentile(xs, 0.9);
  const innerZ = mean(lens.filter((v) => Math.abs(v.x) <= inner)).z;
  const outerZ = mean(lens.filter((v) => Math.abs(v.x) >= outer)).z;
  const dx = outer - inner;
  if (dx < 5) return undefined;
  return (Math.atan2(innerZ - outerZ, dx) * 180) / Math.PI;
}

/**
 * İsim yoksa geometriden tahmin. Gözlük şekli çok kısıtlı olduğu için pratikte
 * iş görüyor; çözücüde belirgin sapma görülürse ilk şüpheli burası.
 */
function heuristicAnchors(root: THREE.Object3D, box: THREE.Box3, spec: FrameSpec, warnings: string[]): FrameAnchors {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const verts = worldVertices([root]);
  if (verts.length === 0) throw new Error('Modelde tepe noktası bulunamadı.');

  // Köprü: x≈0 çevresindeki en yüksek nokta. Bant uyarlamalı — seyrek
  // geometride dar bant boş kalıp -Infinity (→ NaN) üretiyordu.
  const BANDS = [0.05, 0.1, 0.2, 0.5];
  const bandBest = BANDS.map(() => ({ y: -Infinity, z: 0 }));
  let hingeXL = 0;
  let hingeXR = 0;
  let hingeY = 0;

  for (const v of verts) {
    const dx = Math.abs(v.x - center.x);
    for (let b = 0; b < BANDS.length; b++) {
      if (dx < size.x * BANDS[b]! && v.y > bandBest[b]!.y) {
        bandBest[b]!.y = v.y;
        bandBest[b]!.z = v.z;
      }
    }
    if (v.z > box.max.z - size.z * 0.2) {
      if (v.x > hingeXL) {
        hingeXL = v.x;
        hingeY = v.y;
      }
      if (v.x < hingeXR) hingeXR = v.x;
    }
  }

  const band = bandBest.find((b) => Number.isFinite(b.y)) ?? { y: box.max.y, z: box.max.z };
  if (band !== bandBest[0]) {
    warnings.push('Köprü geniş bantla tahmin edildi — model seyrek geometrili, anchor kaba olabilir.');
  }

  const left = verts.filter((v) => v.x > size.x * 0.15);
  const right = verts.filter((v) => v.x < -size.x * 0.15);
  const tipL = left.length ? bendStart(left) : null;
  const tipR = right.length ? bendStart(right) : null;
  if (!tipL || !tipR || tipL.z > box.max.z - size.z * 0.3) {
    warnings.push('Sap uçları bulunamadı — kulak teması tahmini kullanılacak.');
  }

  const halfBridge = spec.bridgeWidth / 2;
  const lensCenterX = halfBridge + spec.lensWidth / 2;
  const bridgeY = band.y;
  const bridgeZ = band.z;
  // Pedler: lens kutusu merkezinin biraz üstünde, lens düzleminin gerisinde.
  const padY = center.y + 2;

  return {
    bridgeCenter: new THREE.Vector3(center.x, bridgeY, bridgeZ),
    nosePadL: new THREE.Vector3(center.x + halfBridge * 0.75, padY, bridgeZ - 4),
    nosePadR: new THREE.Vector3(center.x - halfBridge * 0.75, padY, bridgeZ - 4),
    hingeL: new THREE.Vector3(hingeXL, hingeY, box.max.z),
    hingeR: new THREE.Vector3(hingeXR, hingeY, box.max.z),
    templeTipL: tipL ?? new THREE.Vector3(size.x * 0.4, bridgeY - spec.lensHeight * 0.5, box.min.z),
    templeTipR: tipR ?? new THREE.Vector3(-size.x * 0.4, bridgeY - spec.lensHeight * 0.5, box.min.z),
    lensCenterL: new THREE.Vector3(center.x + lensCenterX, center.y, bridgeZ),
    lensCenterR: new THREE.Vector3(center.x - lensCenterX, center.y, bridgeZ),
  };
}
