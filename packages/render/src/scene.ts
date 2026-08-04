import * as THREE from 'three';
import { CHIN, FACE_SIDE_A, FACE_SIDE_B, FOREHEAD, NOSE_BRIDGE_TOP, type FaceUnits } from '@vto/core';
import { DEFAULT_FOV_Y_DEG, faceDistanceMM, unprojectToMM } from './camera.js';
import { FaceOccluder, type Connection } from './faceMesh.js';
import { buildFrame, DEFAULT_SPEC, type BuiltFrame, type FrameSpec } from './frameModel.js';

export type OccluderDebug = 'off' | 'wireframe' | 'solid';

export interface SceneOptions {
  tesselation: readonly Connection[];
  fovYDeg?: number;
  maxPixelRatio?: number;
}

/**
 * Metrik sahne.
 *
 * Dünya birimi = milimetre. Kamera orijinde, -Z yönüne bakıyor. Yüz mesh'i
 * ölçek füzyonundan gelen k ile geri-projekte edilir; gözlük gerçek fiziksel
 * ölçüleriyle (49□21-145) yerleştirilir. Ölçek yanlışsa gözlük ya kocaman ya
 * minicik durur — yani metrik doğruluk artık GÖRÜLEBİLİR bir şey.
 */
export class TryOnScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly occluder: FaceOccluder;
  private frame: BuiltFrame;
  private readonly fovYDeg: number;
  private readonly maxPixelRatio: number;
  private mmBuffer = new Float32Array(478 * 3);

  /** Son hesaplanan yerleştirme — panelde göstermek için. */
  lastPlacement: { distanceMM: number; rollDeg: number; visible: boolean } = {
    distanceMM: NaN,
    rollDeg: NaN,
    visible: false,
  };

  constructor(canvas: HTMLCanvasElement, options: SceneOptions) {
    this.fovYDeg = options.fovYDeg ?? DEFAULT_FOV_Y_DEG;

    this.maxPixelRatio = options.maxPixelRatio ?? 2;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true, // video arkadan görünsün
      antialias: this.maxPixelRatio <= 1.5, // yüksek DPR'de MSAA fazla pahalı
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);

    this.camera = new THREE.PerspectiveCamera(this.fovYDeg, 1, 1, 5000);
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, 0, -1);

    this.occluder = new FaceOccluder(options.tesselation);
    this.scene.add(this.occluder.mesh);

    this.frame = buildFrame(DEFAULT_SPEC);
    this.frame.group.visible = false;
    this.scene.add(this.frame.group);

    // Geçici ışıklandırma. Gün 16'da küresel harmonik ışık tahmini gelecek;
    // şu anki sabit kurulum gözlüğü sahneye "ait" göstermez, sadece görünür kılar.
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-200, 300, 400);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbdd4ff, 0.8);
    fill.position.set(300, -100, 200);
    this.scene.add(fill);
  }

  /**
   * Çizim tamponunu hem DPR hem toplam piksel bütçesiyle sınırla.
   *
   * 1280×720 video + DPR 2 = 2560×1440 = 3.7 MP. MSAA ile birlikte mobilde
   * onlarca MB VRAM demek ve düşük bellekli cihazlarda sekmeyi öldürebiliyor.
   * Video zaten object-fit ile ölçekleniyor, o yüzden tam çözünürlük gereksiz.
   */
  resize(width: number, height: number): void {
    const MAX_PIXELS = 2_100_000; // ~1080p eşdeğeri
    const dprCap = Math.min(window.devicePixelRatio, this.maxPixelRatio);
    const budgetCap = Math.sqrt(MAX_PIXELS / (width * height));
    this.renderer.setPixelRatio(Math.max(0.75, Math.min(dprCap, budgetCap)));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  setFrameSpec(spec: FrameSpec): void {
    this.scene.remove(this.frame.group);
    this.frame.dispose();
    this.frame = buildFrame(spec);
    this.scene.add(this.frame.group);
  }

  get spec(): FrameSpec {
    return this.frame.spec;
  }

  setGlassesVisible(visible: boolean): void {
    this.frame.group.visible = visible;
    this.lastPlacement.visible = visible;
  }

  setFrameColor(hex: number): void {
    this.frame.materials.frame.color.setHex(hex);
  }

  setOccluderDebug(mode: OccluderDebug): void {
    this.occluder.setDebug(mode);
  }

  /** Yüz bulunamadığında sahneyi gizle — eski poz donmuş halde kalmasın. */
  hide(): void {
    this.occluder.mesh.visible = false;
    this.frame.group.visible = false;
  }

  update(lm: FaceUnits, scaleMMPerUnit: number, aspect: number): void {
    this.occluder.mesh.visible = true;
    this.occluder.update(lm, scaleMMPerUnit, aspect, this.fovYDeg);

    if (this.mmBuffer.length !== lm.length * 3) this.mmBuffer = new Float32Array(lm.length * 3);
    unprojectToMM(lm, scaleMMPerUnit, aspect, this.fovYDeg, this.mmBuffer);
    this.placeFrame(scaleMMPerUnit);
  }

  /**
   * Naif yerleştirme — köprü landmark'ına oturt, kafa pozunu uygula.
   *
   * ⚠ Roadmap §7 bunun SAHTE göründüğünü söylüyor ve haklı: burun köprüsü
   * açısı kişiden kişiye değiştiği için aynı çerçeve farklı yüzlerde farklı
   * yükseklikte oturmalı. Sabit offset bunu tamamen kaybeder.
   * Gün 10-11'de temas-kısıtlı çözücü buranın yerini alacak; şu anki amaç
   * occlusion'ı görünür kılmak.
   */
  private placeFrame(scaleMMPerUnit: number): void {
    const p = (i: number) =>
      new THREE.Vector3(this.mmBuffer[i * 3]!, this.mmBuffer[i * 3 + 1]!, this.mmBuffer[i * 3 + 2]!);

    const bridge = p(NOSE_BRIDGE_TOP);
    const sideA = p(FACE_SIDE_A);
    const sideB = p(FACE_SIDE_B);
    const chin = p(CHIN);
    const brow = p(FOREHEAD);

    // Yüz bazı — metrik uzayda yeniden hesaplanır (FaceUnits bazı perspektif
    // geri-projeksiyondan sonra artık geçerli değil).
    let x = sideB.clone().sub(sideA);
    const yRaw = brow.clone().sub(chin);
    let z = new THREE.Vector3().crossVectors(x, yRaw);

    // İşaret güvencesi: modelin +X'i takan kişinin SOLU, +Z'si yüzden dışarı
    // (kameraya doğru) olmalı. MediaPipe'ın taraf konvansiyonuna güvenmiyoruz —
    // aynı ilke landmark taraf atamasında da uygulandı.
    if (z.z < 0) z.negate();
    z.normalize();
    const y = yRaw.clone().sub(z.clone().multiplyScalar(yRaw.dot(z))).normalize();
    x = new THREE.Vector3().crossVectors(y, z).normalize();
    if (x.x < 0) {
      x.negate();
      z = new THREE.Vector3().crossVectors(x, y).normalize();
    }

    const basis = new THREE.Matrix4().makeBasis(x, y, z);
    this.frame.group.quaternion.setFromRotationMatrix(basis);

    // Köprüyü burun kökünün biraz önüne al — vertex mesafesi yaklaşık 13 mm.
    // Gün 11'de bu, ray-cast ile gerçek temastan çıkacak; şimdilik sabit.
    const VERTEX_DISTANCE_MM = 13;
    const pos = bridge.clone().add(z.clone().multiplyScalar(VERTEX_DISTANCE_MM));
    // Model orijini köprü merkezi, ama anchor y'si sıfır değil — telafi et.
    pos.add(y.clone().multiplyScalar(-this.frame.anchors.bridgeCenter.y));
    this.frame.group.position.copy(pos);

    this.lastPlacement = {
      distanceMM: faceDistanceMM(scaleMMPerUnit, this.fovYDeg),
      rollDeg: (Math.atan2(x.y, x.x) * 180) / Math.PI,
      visible: this.frame.group.visible,
    };
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.occluder.dispose();
    this.frame.dispose();
    this.renderer.dispose();
  }
}
