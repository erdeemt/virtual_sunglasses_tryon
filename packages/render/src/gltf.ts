import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BuiltFrame, FrameAnchors, FrameSpec } from './frameModel.js';
import { DEFAULT_SPEC } from './frameModel.js';

/**
 * Hazır GLB/glTF gözlük modeli yükleme.
 *
 * İndirilen bir modelde şunların HİÇBİRİ bilinmez:
 *   - ölçek birimi (mm / cm / inç / keyfi)
 *   - yönelim (Y-up mu Z-up mu, hangi yöne bakıyor)
 *   - orijin konumu
 *   - semantik anchor noktaları (köprü, burun pedi, menteşe, sap ucu)
 *
 * Bu dosya ilk üçünü normalize eder, dördüncüsünü geometriden TÜREtir.
 * Gözlük şekli çok kısıtlı olduğu için türetme pratikte iyi çalışıyor —
 * ama sonuç UI'da gösterilip elle düzeltilebilir olmalı. Rastgele internet
 * modellerinde tam otomasyon bir araştırma problemi; yarı otomatik doğru
 * mühendislik kararı.
 *
 * Kalıcı çözüm asset pipeline (TASKS.md T-08): anchor'lar Blender'da bir kez
 * işaretlenip manifest'e yazılır. Bu dosya o zamana kadarki köprü ve
 * "modeli hemen görelim" yolu.
 */

export interface NormalizeOptions {
  /**
   * Çerçevenin gerçek toplam ön genişliği (mm).
   * Gerçek gözlüklerde tipik olarak 130–145 mm. Ölçek bundan türetilir.
   */
  frontWidthMM: number;
  /** Otomatik eksen tespitini geçersiz kıl. */
  upAxis?: 'x' | 'y' | 'z';
  forwardAxis?: 'x' | 'y' | 'z';
  /** Model ters bakıyorsa (saplar öne uzanıyorsa) 180° çevir. */
  flipForward?: boolean;
  /** Referans ölçüler — anchor türetmede kullanılır. */
  spec?: FrameSpec;
}

export interface LoadedFrameInfo {
  /** Otomatik tespit edilen eksenler — UI'da gösterilip düzeltilebilsin. */
  detectedUp: 'x' | 'y' | 'z';
  detectedForward: 'x' | 'y' | 'z';
  /** Ham modelin ölçüleri (dosya birimlerinde). */
  rawSize: THREE.Vector3;
  /** Uygulanan ölçek çarpanı. */
  scaleFactor: number;
  meshCount: number;
  triangleCount: number;
  materialNames: string[];
  warnings: string[];
}

export interface LoadedFrame extends BuiltFrame {
  info: LoadedFrameInfo;
}

const AXES = ['x', 'y', 'z'] as const;
type Axis = (typeof AXES)[number];

export async function loadFrameFromGLB(
  source: string | File,
  options: NormalizeOptions,
): Promise<LoadedFrame> {
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
 *   orijin = köprü merkezi · +X takan kişinin soluna · +Y yukarı
 *   +Z yüzden dışarı (saplar -Z yönüne uzanır) · birim mm
 */
export function normalizeFrame(root: THREE.Object3D, options: NormalizeOptions): LoadedFrame {
  const warnings: string[] = [];
  const spec = options.spec ?? DEFAULT_SPEC;

  const group = new THREE.Group();
  group.name = 'glasses-glb';
  group.add(root);

  // --- ham ölçüler ---------------------------------------------------------
  root.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(root);
  const rawSize = rawBox.getSize(new THREE.Vector3());

  if (rawSize.length() < 1e-6) {
    throw new Error('Model boş görünüyor — geometri bulunamadı.');
  }

  // --- eksen tespiti -------------------------------------------------------
  // Gözlükte en küçük açıklık daima YUKARI eksenidir (yükseklik ~40-50 mm,
  // genişlik ~140 mm, sap derinliği ~145 mm).
  const detectedUp = options.upAxis ?? smallestAxis(rawSize);

  // Kalan iki eksenden sol-sağ olanı, mesh'in aynalama simetrisi gösterdiği
  // eksendir. Gözlük sagital düzleme göre simetriktir; saplar ise tek yöne
  // uzanır, yani ileri ekseni asimetriktir.
  const remaining = AXES.filter((a) => a !== detectedUp);
  const detectedForward =
    options.forwardAxis ?? pickForwardAxis(root, remaining as [Axis, Axis], rawBox);

  const sideAxis = remaining.find((a) => a !== detectedForward)!;

  // --- döndürme ------------------------------------------------------------
  const rotation = basisRotation(sideAxis, detectedUp, detectedForward);
  root.applyMatrix4(rotation);
  root.updateMatrixWorld(true);

  // --- ölçekleme -----------------------------------------------------------
  let box = new THREE.Box3().setFromObject(root);
  let size = box.getSize(new THREE.Vector3());
  const scaleFactor = options.frontWidthMM / size.x;

  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
    throw new Error('Ölçek hesaplanamadı — modelin genişliği sıfır.');
  }
  root.applyMatrix4(new THREE.Matrix4().makeScale(scaleFactor, scaleFactor, scaleFactor));
  root.updateMatrixWorld(true);

  box = new THREE.Box3().setFromObject(root);
  size = box.getSize(new THREE.Vector3());

  // --- ileri yönü doğrula --------------------------------------------------
  // Saplar -Z'ye uzanmalı. Kütle merkezi +Z tarafındaysa model ters.
  const shouldFlip = options.flipForward ?? detectTemplesDirection(root) > 0;
  if (shouldFlip) {
    root.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI));
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
  }

  // --- anchor türetimi -----------------------------------------------------
  const anchors = deriveAnchors(root, box, spec, warnings);

  // Orijini köprü merkezine taşı — modelimizin sözleşmesi bu.
  const shift = anchors.bridgeCenter.clone().negate();
  root.applyMatrix4(new THREE.Matrix4().makeTranslation(shift.x, shift.y, shift.z));
  root.updateMatrixWorld(true);
  for (const key of Object.keys(anchors) as Array<keyof FrameAnchors>) {
    anchors[key].add(shift);
  }

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

  if (triangleCount > 60_000) {
    warnings.push(`${Math.round(triangleCount)} üçgen — mobilde ağır. LOD gerekiyor (T-08).`);
  }
  if (size.z < size.x * 0.4) {
    warnings.push('Model çok sığ — saplar eksik olabilir (sadece ön çerçeve?).');
  }

  const info: LoadedFrameInfo = {
    detectedUp,
    detectedForward,
    rawSize,
    scaleFactor,
    meshCount,
    triangleCount: Math.round(triangleCount),
    materialNames: [...materials],
    warnings,
  };

  // Renk değişimi için en çok kullanılan malzemeyi hedefle.
  const primary = materialRefs.find(
    (m) => m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshPhysicalMaterial,
  ) as THREE.MeshPhysicalMaterial | undefined;

  return {
    group,
    anchors,
    spec,
    info,
    materials: {
      frame: primary ?? new THREE.MeshPhysicalMaterial(),
      lens: new THREE.MeshPhysicalMaterial(),
    },
    dispose() {
      root.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          for (const m of Array.isArray(node.material) ? node.material : [node.material]) {
            m.dispose();
          }
        }
      });
    },
  };
}

// ---------------------------------------------------------------- yardımcılar

function smallestAxis(size: THREE.Vector3): Axis {
  if (size.x <= size.y && size.x <= size.z) return 'x';
  if (size.y <= size.x && size.y <= size.z) return 'y';
  return 'z';
}

/**
 * İki aday eksenden hangisinin "ileri" olduğunu bulur.
 *
 * Gözlük sol-sağ eksenine göre simetriktir (aynalama), ileri eksenine göre
 * değildir — saplar tek yöne uzanır. Her eksen için tepe noktalarının
 * merkeze göre dağılım çarpıklığını ölçüp daha asimetrik olanı seçiyoruz.
 */
function pickForwardAxis(root: THREE.Object3D, candidates: [Axis, Axis], box: THREE.Box3): Axis {
  const center = box.getCenter(new THREE.Vector3());
  const skew: Record<string, number> = { [candidates[0]]: 0, [candidates[1]]: 0 };
  const count = { n: 0 };

  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const position = node.geometry.getAttribute('position');
    if (!position) return;
    const v = new THREE.Vector3();
    // Büyük mesh'lerde her tepe noktasına bakmaya gerek yok.
    const step = Math.max(1, Math.floor(position.count / 4000));
    for (let i = 0; i < position.count; i += step) {
      v.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld).sub(center);
      for (const axis of candidates) skew[axis]! += v[axis];
      count.n++;
    }
  });

  if (count.n === 0) return candidates[1];
  const a = Math.abs(skew[candidates[0]]! / count.n);
  const b = Math.abs(skew[candidates[1]]! / count.n);
  return a > b ? candidates[0] : candidates[1];
}

/**
 * side/up/forward eksenlerini X/Y/Z'ye eşleyen dönüşüm.
 *
 * ⚠ Determinant kontrolü şart: eksen kombinasyonlarının yarısı determinantı
 * −1 yapar, yani AYNALAMA üretir. Aynalanmış bir gözlükte sol ve sağ yer
 * değiştirir — monoküler PD raporu yanlış göze yazılır ve asimetrik
 * çerçevelerde gözle de fark edilir. Bu durumda ileri eksenini ters çevirip
 * saf döndürmeye zorluyoruz (yön hatası varsa detectTemplesDirection düzeltir).
 */
function basisRotation(side: Axis, up: Axis, forward: Axis): THREE.Matrix4 {
  const unit = (axis: Axis): THREE.Vector3 =>
    new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);

  const s = unit(side);
  const u = unit(up);
  const f = unit(forward);

  // det = s · (u × f). Negatifse baz sol-el sistemidir.
  if (s.dot(new THREE.Vector3().crossVectors(u, f)) < 0) f.negate();

  // Satırları kaynak eksenler olan matris = kaynak → hedef dönüşümü.
  return new THREE.Matrix4().set(
    s.x, s.y, s.z, 0,
    u.x, u.y, u.z, 0,
    f.x, f.y, f.z, 0,
    0, 0, 0, 1,
  );
}

/** Sapların hangi yöne uzandığını bulur. Dönen değer > 0 ise +Z'ye (ters). */
function detectTemplesDirection(root: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  // Ön çerçeve geniş ve yoğun; saplar ince ve uzun. Uçlardaki KESİT
  // GENİŞLİĞİNE bak: sapların olduğu uçta genişlik küçüktür.
  let frontHalfWidth = 0;
  let backHalfWidth = 0;

  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const position = node.geometry.getAttribute('position');
    if (!position) return;
    const v = new THREE.Vector3();
    const step = Math.max(1, Math.floor(position.count / 4000));
    for (let i = 0; i < position.count; i += step) {
      v.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld).sub(center);
      // Sadece uçlardaki %25'lik dilimlere bak.
      if (v.z > size.z * 0.25) frontHalfWidth = Math.max(frontHalfWidth, Math.abs(v.x));
      else if (v.z < -size.z * 0.25) backHalfWidth = Math.max(backHalfWidth, Math.abs(v.x));
    }
  });

  // +Z tarafı daha darsa saplar oraya uzanıyor demektir → ters.
  return backHalfWidth - frontHalfWidth;
}

/**
 * Anchor'ları geometriden türet.
 *
 * Gözlük şekli çok kısıtlı olduğu için bu heuristikler pratikte iş görüyor.
 * Yine de tahmin oldukları unutulmamalı — çözücüde belirgin sapma görülürse
 * ilk şüpheli burasıdır.
 */
function deriveAnchors(
  root: THREE.Object3D,
  box: THREE.Box3,
  spec: FrameSpec,
  warnings: string[],
): FrameAnchors {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  // Köprü: x≈0 çevresindeki tepe noktalarının en yükseği, ön düzlemde.
  //
  // Bant genişliği uyarlamalı: dar bant daha doğru köprü verir ama seyrek
  // geometride (basit kutu mesh'leri, düşük poligonlu modeller) hiç nokta
  // yakalamayabilir. Boş kalırsa bir üst banda geçiyoruz — aksi halde
  // bridgeY = -Infinity kalıp tüm modeli NaN'a çeviriyordu.
  const BANDS = [0.05, 0.1, 0.2, 0.5];
  const bandBest = BANDS.map(() => ({ y: -Infinity, z: 0 }));
  // Sap uçları: her tarafta en geriye (en küçük z) giden nokta.
  const tip = { l: new THREE.Vector3(0, 0, Infinity), r: new THREE.Vector3(0, 0, Infinity) };
  // Menteşe: ön dilimdeki en uç ±x.
  let hingeXL = 0;
  let hingeXR = 0;
  let hingeY = 0;
  let found = false;

  const v = new THREE.Vector3();
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const position = node.geometry.getAttribute('position');
    if (!position) return;
    const step = Math.max(1, Math.floor(position.count / 20000));

    for (let i = 0; i < position.count; i += step) {
      v.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld);
      found = true;

      // köprü bölgesi — her bant için ayrı en yüksek nokta
      const dx = Math.abs(v.x - center.x);
      for (let b = 0; b < BANDS.length; b++) {
        if (dx < size.x * BANDS[b]! && v.y > bandBest[b]!.y) {
          bandBest[b]!.y = v.y;
          bandBest[b]!.z = v.z;
        }
      }
      // ön dilim (z büyük) → menteşe adayları
      if (v.z > box.max.z - size.z * 0.2) {
        if (v.x > hingeXL) {
          hingeXL = v.x;
          hingeY = v.y;
        }
        if (v.x < hingeXR) hingeXR = v.x;
      }
      // sap uçları
      if (v.x > size.x * 0.15 && v.z < tip.l.z) tip.l.copy(v);
      if (v.x < -size.x * 0.15 && v.z < tip.r.z) tip.r.copy(v);
    }
  });

  if (!found) throw new Error('Modelde tepe noktası bulunamadı.');

  // Son çare: hiçbir bant nokta yakalamadıysa (tepe noktaları yalnızca dış
  // köşelerde olan çok basit mesh'ler) sınırlayıcı kutunun üst-orta noktası.
  const band = bandBest.find((b) => Number.isFinite(b.y)) ?? { y: box.max.y, z: box.max.z };
  if (band !== bandBest[0]) {
    warnings.push('Köprü geniş bantla tahmin edildi — model seyrek geometrili, anchor kaba olabilir.');
  }
  const bridgeY = band.y;
  const bridgeZ = band.z;

  if (!Number.isFinite(tip.l.z) || !Number.isFinite(tip.r.z)) {
    warnings.push('Sap uçları bulunamadı — kulak teması tahmini kullanılacak.');
    tip.l.set(size.x * 0.4, bridgeY - spec.lensHeight * 0.5, box.min.z);
    tip.r.set(-size.x * 0.4, bridgeY - spec.lensHeight * 0.5, box.min.z);
  }

  const halfBridge = spec.bridgeWidth / 2;
  const lensCenterX = halfBridge + spec.lensWidth / 2;
  const bridgeCenter = new THREE.Vector3(center.x, bridgeY, bridgeZ);

  return {
    bridgeCenter,
    nosePadL: new THREE.Vector3(center.x + halfBridge * 0.55, bridgeY - 6, bridgeZ - 3),
    nosePadR: new THREE.Vector3(center.x - halfBridge * 0.55, bridgeY - 6, bridgeZ - 3),
    hingeL: new THREE.Vector3(hingeXL, hingeY, box.max.z),
    hingeR: new THREE.Vector3(hingeXR, hingeY, box.max.z),
    templeTipL: tip.l.clone(),
    templeTipR: tip.r.clone(),
    lensCenterL: new THREE.Vector3(center.x + lensCenterX, center.y, bridgeZ),
    lensCenterR: new THREE.Vector3(center.x - lensCenterX, center.y, bridgeZ),
  };
}
