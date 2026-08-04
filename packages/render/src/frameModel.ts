import * as THREE from 'three';

/**
 * Parametrik gözlük çerçevesi.
 *
 * Neden hazır GLB değil: Gün 10-11'deki temas-kısıtlı yerleştirme çözücüsü
 * semantik anchor noktalarına ihtiyaç duyuyor (burun pedi temas düzlemi,
 * menteşe ekseni, sap ucu eğrisi). İnternetten indirilen bir modelde bunlar
 * yok ve elle işaretlemek gerekir. Parametrik model bunları TANIM GEREĞİ
 * verir, üstelik ölçüleri tam olarak bilinir — çözücüyü bilinen bir gerçekle
 * test edebiliriz.
 *
 * Gerçek SKU'lar Gün 19-20'de asset pipeline üzerinden gelecek; o zaman bu
 * arayüz (geometry + anchors) aynı kalacak, kaynağı değişecek.
 *
 * Koordinat sistemi (mm):
 *   orijin = köprü merkezi (burun sırtına oturan nokta)
 *   +X     = takan kişinin soluna
 *   +Y     = yukarı
 *   +Z     = yüzden dışarı (kameraya doğru); saplar -Z yönüne uzanır
 */
export interface FrameSpec {
  /** Çerçeve içine yazan ilk sayı — tek lens genişliği (mm). */
  lensWidth: number;
  /** İkinci sayı — köprü genişliği, iki lens arası (mm). */
  bridgeWidth: number;
  /** Üçüncü sayı — sap uzunluğu (mm). */
  templeLength: number;
  lensHeight: number;
  /** Çerçeve profil kalınlığı (mm). */
  rimThickness: number;
  /** Çerçeve derinliği — ön yüzeyden arkaya (mm). */
  rimDepth: number;
  /** Köşe yuvarlaklığı (mm). */
  cornerRadius: number;
  /** Sapın kulak arkasında aşağı kıvrıldığı uzunluk (mm). */
  earBendLength: number;
}

export const DEFAULT_SPEC: FrameSpec = {
  lensWidth: 49,
  bridgeWidth: 21,
  templeLength: 145,
  lensHeight: 40,
  rimThickness: 4,
  rimDepth: 3,
  cornerRadius: 8,
  earBendLength: 28,
};

/** Etiketi çerçeve içine yazıldığı gibi üretir: 49□21-145 */
export function specLabel(spec: FrameSpec): string {
  return `${spec.lensWidth}□${spec.bridgeWidth}-${spec.templeLength}`;
}

/**
 * Yerleştirme çözücüsünün ihtiyaç duyduğu semantik noktalar (mm, model uzayı).
 * Roadmap §10: "Çözücü bunlar olmadan generic çalışamaz."
 */
export interface FrameAnchors {
  /** Köprü merkezi — burun sırtı temas noktası. */
  bridgeCenter: THREE.Vector3;
  /** Burun pedi temas noktaları (sol/sağ). */
  nosePadL: THREE.Vector3;
  nosePadR: THREE.Vector3;
  /** Menteşe ekseni konumları — sap esnetme buradan döner. */
  hingeL: THREE.Vector3;
  hingeR: THREE.Vector3;
  /** Sap uçları — kulak üstü temas noktaları. */
  templeTipL: THREE.Vector3;
  templeTipR: THREE.Vector3;
  /** Lens düzlemi merkezleri — segment height ve refraction için. */
  lensCenterL: THREE.Vector3;
  lensCenterR: THREE.Vector3;
}

export interface BuiltFrame {
  group: THREE.Group;
  anchors: FrameAnchors;
  spec: FrameSpec;
  /** Malzeme referansları — renk/varyant değişimi için. */
  materials: { frame: THREE.MeshPhysicalMaterial; lens: THREE.MeshPhysicalMaterial };
  dispose(): void;
}

/** Yuvarlatılmış dikdörtgen — lens çerçevesi konturu. */
function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  const radius = Math.min(r, w / 2, h / 2);
  shape.moveTo(x + radius, y);
  shape.lineTo(x + w - radius, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + radius);
  shape.lineTo(x + w, y + h - radius);
  shape.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  shape.lineTo(x + radius, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

export function buildFrame(spec: FrameSpec = DEFAULT_SPEC): BuiltFrame {
  const group = new THREE.Group();
  group.name = 'glasses';

  const frameMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x1a1a1e,
    metalness: 0.15,
    roughness: 0.35,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
  });

  // Lens: şimdilik hafif tint + düşük transmission. Gün 17'de screen-space
  // refraction ve reçete simülasyonu buraya gelecek.
  const lensMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xdfe8f0,
    metalness: 0,
    roughness: 0.05,
    transmission: 0.92,
    thickness: 2,
    ior: 1.5,
    transparent: true,
    opacity: 1,
    iridescence: 0.25,
    iridescenceIOR: 1.3,
  });

  const halfBridge = spec.bridgeWidth / 2;
  const lensCenterX = halfBridge + spec.lensWidth / 2;

  // --- lens çerçeveleri (rim) --------------------------------------------
  const outer = roundedRect(
    spec.lensWidth + spec.rimThickness * 2,
    spec.lensHeight + spec.rimThickness * 2,
    spec.cornerRadius + spec.rimThickness,
  );
  outer.holes.push(roundedRect(spec.lensWidth, spec.lensHeight, spec.cornerRadius));

  const rimGeometry = new THREE.ExtrudeGeometry(outer, {
    depth: spec.rimDepth,
    bevelEnabled: true,
    bevelThickness: 0.4,
    bevelSize: 0.4,
    bevelSegments: 2,
    curveSegments: 12,
  });
  rimGeometry.translate(0, 0, -spec.rimDepth / 2);

  const lensGeometry = new THREE.ShapeGeometry(
    roundedRect(spec.lensWidth, spec.lensHeight, spec.cornerRadius),
    12,
  );

  for (const side of [-1, 1] as const) {
    const rim = new THREE.Mesh(rimGeometry, frameMaterial);
    rim.position.set(side * lensCenterX, 0, 0);
    rim.name = side < 0 ? 'rim-R' : 'rim-L';
    group.add(rim);

    const lens = new THREE.Mesh(lensGeometry, lensMaterial);
    lens.position.set(side * lensCenterX, 0, 0);
    lens.name = side < 0 ? 'lens-R' : 'lens-L';
    group.add(lens);
  }

  // --- köprü -------------------------------------------------------------
  // Hafif yukarı kavisli bir çubuk; burun sırtına oturan kısım.
  const bridgeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-halfBridge - 1, 0, 0),
    new THREE.Vector3(-halfBridge * 0.4, spec.lensHeight * 0.12, 0),
    new THREE.Vector3(halfBridge * 0.4, spec.lensHeight * 0.12, 0),
    new THREE.Vector3(halfBridge + 1, 0, 0),
  ]);
  const bridgeGeometry = new THREE.TubeGeometry(bridgeCurve, 20, spec.rimThickness * 0.45, 8, false);
  const bridge = new THREE.Mesh(bridgeGeometry, frameMaterial);
  bridge.position.y = spec.lensHeight / 2 - spec.rimThickness;
  bridge.name = 'bridge';
  group.add(bridge);

  // --- saplar ------------------------------------------------------------
  const hingeX = lensCenterX + spec.lensWidth / 2 + spec.rimThickness * 0.5;
  const hingeY = spec.lensHeight * 0.28;
  const straight = spec.templeLength - spec.earBendLength;

  const templeGeometries: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1] as const) {
    // Menteşeden başlar, hafifçe içe daralarak geriye gider, sonra kulak
    // arkasında aşağı kıvrılır. Kıvrımın başladığı yer kulak temas noktası.
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * hingeX, hingeY, 0),
      new THREE.Vector3(side * hingeX * 1.02, hingeY, -straight * 0.28),
      new THREE.Vector3(side * hingeX * 0.94, hingeY * 0.9, -straight * 0.72),
      new THREE.Vector3(side * hingeX * 0.86, hingeY * 0.8, -straight),
      new THREE.Vector3(side * hingeX * 0.8, hingeY * 0.3, -straight - spec.earBendLength * 0.6),
      new THREE.Vector3(side * hingeX * 0.76, -hingeY * 0.35, -straight - spec.earBendLength * 0.85),
    ]);
    const geometry = new THREE.TubeGeometry(curve, 40, spec.rimThickness * 0.4, 8, false);
    templeGeometries.push(geometry);
    const temple = new THREE.Mesh(geometry, frameMaterial);
    temple.name = side < 0 ? 'temple-R' : 'temple-L';
    group.add(temple);
  }

  // --- anchor noktaları ---------------------------------------------------
  const bridgeTopY = spec.lensHeight / 2 - spec.rimThickness + spec.lensHeight * 0.12;
  const anchors: FrameAnchors = {
    bridgeCenter: new THREE.Vector3(0, bridgeTopY, -spec.rimDepth / 2),
    // Burun pedleri köprünün biraz altında ve içeride, yüze doğru.
    nosePadL: new THREE.Vector3(halfBridge * 0.55, bridgeTopY - 6, -spec.rimDepth / 2 - 3),
    nosePadR: new THREE.Vector3(-halfBridge * 0.55, bridgeTopY - 6, -spec.rimDepth / 2 - 3),
    hingeL: new THREE.Vector3(hingeX, hingeY, 0),
    hingeR: new THREE.Vector3(-hingeX, hingeY, 0),
    // Sap ucu değil, kulak üstüne DEĞDİĞİ nokta — kıvrımın başladığı yer.
    templeTipL: new THREE.Vector3(hingeX * 0.86, hingeY * 0.8, -straight),
    templeTipR: new THREE.Vector3(-hingeX * 0.86, hingeY * 0.8, -straight),
    lensCenterL: new THREE.Vector3(lensCenterX, 0, 0),
    lensCenterR: new THREE.Vector3(-lensCenterX, 0, 0),
  };

  return {
    group,
    anchors,
    spec,
    materials: { frame: frameMaterial, lens: lensMaterial },
    dispose() {
      rimGeometry.dispose();
      lensGeometry.dispose();
      bridgeGeometry.dispose();
      for (const g of templeGeometries) g.dispose();
      frameMaterial.dispose();
      lensMaterial.dispose();
    },
  };
}
