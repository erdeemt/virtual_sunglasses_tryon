import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { normalizeFrame } from './gltf.js';

/**
 * GLB normalizasyonu, indirilen modelin bilinmeyen ölçek/yönelimini bizim
 * model uzayımıza taşır. Testler sentetik bir "gözlük" üretip bilinen bir
 * bozulma uygular, sonra normalizasyonun onu geri kazandığını doğrular.
 *
 * Ekranda görmeden önce burada kanıtlanması gereken şeyler:
 *   - ölçek doğru (gerçek mm'ye oturuyor)
 *   - yukarı ekseni doğru
 *   - saplar -Z'ye bakıyor
 *   - AYNALAMA YOK (sol/sağ korunuyor)
 */

/**
 * Kanonik uzayda sentetik gözlük:
 *   ön çerçeve 138 (x) × 45 (y) × 6 (z), z ≈ 0
 *   saplar x = ±62, z = 0 → -145, ince
 * Saplar asimetriyi ve ileri yönü belirler.
 */
function syntheticGlasses(): THREE.Object3D {
  const root = new THREE.Group();

  const front = new THREE.Mesh(new THREE.BoxGeometry(138, 45, 6));
  front.position.set(0, 0, 0);
  root.add(front);

  for (const side of [-1, 1] as const) {
    const temple = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 145));
    // Saplar geriye (-Z) uzanır.
    temple.position.set(side * 62, 12, -145 / 2);
    root.add(temple);
  }

  // Elliliği (chirality) izlemek için dört işaretçi — bir tetrahedron.
  // Aynalama işaretli hacmin işaretini ters çevirir; saf döndürme çevirmez.
  const corners: Array<[string, number, number, number]> = [
    ['m0', 0, 0, 0],
    ['m1', 40, 0, 0],
    ['m2', 0, 15, 0],
    ['m3', 0, 0, -40],
  ];
  for (const [name, x, y, z] of corners) {
    const marker = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    marker.name = name;
    marker.position.set(x, y, z);
    root.add(marker);
  }

  root.updateMatrixWorld(true);
  return root;
}

/**
 * İşaretçi tetrahedronunun işaretli hacmi.
 *
 * Aynalama (determinant −1) bu işareti ters çevirir, saf döndürme çevirmez.
 * "Sol tarafta kalsın" diye test etmek YANLIŞ olurdu: gözlük sol-sağ
 * simetrik olduğu için rastgele bir modelde hangi tarafın takan kişinin
 * solu olduğu geometriden bilinemez. Garanti edebileceğimiz şey aynalama
 * yapmadığımızdır. (Asimetrik markalı gerçek ürünlerde taraf, asset
 * pipeline'da açıkça işaretlenecek — T-08.)
 */
function signedVolume(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  const at = (name: string) =>
    new THREE.Vector3().setFromMatrixPosition(root.getObjectByName(name)!.matrixWorld);
  const o = at('m0');
  const a = at('m1').sub(o);
  const b = at('m2').sub(o);
  const c = at('m3').sub(o);
  return a.dot(new THREE.Vector3().crossVectors(b, c));
}

/** Modeli bozar: farklı birim + farklı yukarı ekseni. */
function distort(root: THREE.Object3D, scale: number, rotation: THREE.Matrix4): THREE.Object3D {
  const wrapper = new THREE.Group();
  wrapper.add(root);
  wrapper.applyMatrix4(rotation);
  wrapper.applyMatrix4(new THREE.Matrix4().makeScale(scale, scale, scale));
  wrapper.updateMatrixWorld(true);
  return wrapper;
}

const FRONT_WIDTH = 138;

describe('normalizeFrame', () => {
  it('metre biriminde gelen modeli mm ye ölçekler', () => {
    // 0.001 çarpanı = model metre cinsinden yazılmış.
    const model = distort(syntheticGlasses(), 0.001, new THREE.Matrix4());
    const frame = normalizeFrame(model, { frontWidthMM: FRONT_WIDTH });

    const box = new THREE.Box3().setFromObject(frame.group);
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(FRONT_WIDTH, 3);
  });

  it('Z-yukarı modeli Y-yukarıya çevirir', () => {
    // Z-up → Y-up: X ekseni etrafında -90°
    const zUp = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    const model = distort(syntheticGlasses(), 1, zUp);
    const frame = normalizeFrame(model, { frontWidthMM: FRONT_WIDTH });

    const box = new THREE.Box3().setFromObject(frame.group);
    const size = box.getSize(new THREE.Vector3());

    // Yükseklik en küçük açıklık olmalı (45 mm), genişlik en büyüğü.
    expect(size.y).toBeLessThan(size.x);
    expect(size.y).toBeLessThan(size.z);
    expect(size.x).toBeCloseTo(FRONT_WIDTH, 3);
  });

  it('KRİTİK: hiçbir yönelimde aynalama yapmaz', () => {
    // Aynalanmış bir modelde asimetrik detaylar (marka, menteşe) yanlış
    // tarafa geçer. Eksen eşleme matrisinin determinantı +1 kalmalı.
    const reference = Math.sign(signedVolume(syntheticGlasses()));
    expect(reference).not.toBe(0);

    const rotations: Array<[string, THREE.Matrix4]> = [
      ['kimlik', new THREE.Matrix4()],
      ['Z-yukarı', new THREE.Matrix4().makeRotationX(-Math.PI / 2)],
      ['X-yukarı', new THREE.Matrix4().makeRotationZ(Math.PI / 2)],
      ['ters Z-yukarı', new THREE.Matrix4().makeRotationX(Math.PI / 2)],
      ['bileşik', new THREE.Matrix4().makeRotationY(Math.PI / 2).multiply(
        new THREE.Matrix4().makeRotationX(-Math.PI / 2),
      )],
    ];

    for (const [label, rotation] of rotations) {
      const model = distort(syntheticGlasses(), 1, rotation);
      const frame = normalizeFrame(model, { frontWidthMM: FRONT_WIDTH });
      expect(Math.sign(signedVolume(frame.group)), `${label} aynalandı`).toBe(reference);
    }
  });

  it('saplar -Z yönüne bakar', () => {
    const model = distort(syntheticGlasses(), 1, new THREE.Matrix4());
    const frame = normalizeFrame(model, { frontWidthMM: FRONT_WIDTH });

    // Sap uçları anchor'ı köprüden belirgin şekilde geride olmalı.
    expect(frame.anchors.templeTipL.z).toBeLessThan(-50);
    expect(frame.anchors.templeTipR.z).toBeLessThan(-50);
  });

  it('180° ters çevrilmiş modeli düzeltir', () => {
    // Saplar +Z'ye bakan model — detectTemplesDirection yakalamalı.
    const flipped = new THREE.Matrix4().makeRotationY(Math.PI);
    const model = distort(syntheticGlasses(), 1, flipped);
    const frame = normalizeFrame(model, { frontWidthMM: FRONT_WIDTH });

    expect(frame.anchors.templeTipL.z).toBeLessThan(-50);
  });

  it('orijini köprü merkezine taşır', () => {
    const model = distort(syntheticGlasses(), 1, new THREE.Matrix4());
    const frame = normalizeFrame(model, { frontWidthMM: FRONT_WIDTH });

    // Sözleşme: model orijini = köprü merkezi.
    expect(frame.anchors.bridgeCenter.length()).toBeLessThan(1e-6);
  });

  it('menteşeler karşıt taraflarda ve dış uçta', () => {
    const model = distort(syntheticGlasses(), 1, new THREE.Matrix4());
    const frame = normalizeFrame(model, { frontWidthMM: FRONT_WIDTH });

    expect(frame.anchors.hingeL.x).toBeGreaterThan(0);
    expect(frame.anchors.hingeR.x).toBeLessThan(0);
    expect(Math.abs(frame.anchors.hingeL.x)).toBeGreaterThan(FRONT_WIDTH * 0.3);
  });

  it('sap uçları karşıt taraflarda', () => {
    const model = distort(syntheticGlasses(), 1, new THREE.Matrix4());
    const frame = normalizeFrame(model, { frontWidthMM: FRONT_WIDTH });

    expect(frame.anchors.templeTipL.x).toBeGreaterThan(0);
    expect(frame.anchors.templeTipR.x).toBeLessThan(0);
  });

  it('boş modelde anlamlı hata verir', () => {
    expect(() => normalizeFrame(new THREE.Group(), { frontWidthMM: FRONT_WIDTH })).toThrow(
      /boş görünüyor/,
    );
  });

  it('sapsız (sadece ön çerçeve) modelde uyarı üretir', () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(138, 45, 6)));
    root.updateMatrixWorld(true);

    const frame = normalizeFrame(root, { frontWidthMM: FRONT_WIDTH });
    expect(frame.info.warnings.some((w) => /sığ|Sap/.test(w))).toBe(true);
  });
});
