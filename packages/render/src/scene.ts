import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  CHIN,
  FACE_SIDE_A,
  FACE_SIDE_B,
  FOREHEAD,
  NOSE_BRIDGE_TOP,
  OneEuroFilter,
  buildHeadFrame,
  composePose,
  solvePlacement,
  type FaceUnits,
  type GlassesGeometry,
  type HeadFrame,
  type LocalPose,
  type PlacementResult,
  type Vec3,
} from '@vto/core';
import { DEFAULT_FOV_Y_DEG, faceDistanceMM, unprojectToMM } from './camera.js';
import { FaceOccluder, type Connection } from './faceMesh.js';
import { buildFrame, DEFAULT_SPEC, type BuiltFrame, type FrameSpec } from './frameModel.js';
import { glassesGeometry } from './glassesGeometry.js';
import { ContactShadow } from './contactShadow.js';
import { HairOccluder } from './hairOccluder.js';
import type { LightEstimate } from './lighting.js';

export type OccluderDebug = 'off' | 'wireframe' | 'solid';
export type RenderQuality = 'high' | 'mid' | 'low';

export interface SceneOptions {
  tesselation: readonly Connection[];
  fovYDeg?: number;
  maxPixelRatio?: number;
  quality?: RenderQuality;
}

export interface SceneUpdate {
  /**
   * Bu karede çözücü çalışsın mı. Frontal karelerde true: MediaPipe mesh'i
   * yüz döndükçe bozuluyor, çözücü sonucu da onunla. Yerel poz anatomik bir
   * sabit olduğu için arada eski (filtrelenmiş) sonuç kullanılıyor.
   */
  solve: boolean;
  timestampMs: number;
}

/**
 * Metrik sahne.
 *
 * Dünya birimi = milimetre. Kamera orijinde, -Z yönüne bakıyor. Video, sahnenin
 * ARKA PLANI olarak WebGL içinde çiziliyor — lens transmission'ı ancak böyle
 * arkasındaki gerçek görüntüyü kırabilir (three.js transmission'ı sahnenin opak
 * render'ını örnekliyor; HTML video katmanını göremez).
 */
export class TryOnScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly occluder: FaceOccluder;
  private readonly shadow: ContactShadow;
  private readonly hair: HairOccluder;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private frame: BuiltFrame;
  private geometry: GlassesGeometry;
  private readonly fovYDeg: number;
  private readonly maxPixelRatio: number;
  private readonly quality: RenderQuality;
  private mmBuffer = new Float32Array(478 * 3);
  private mmPoints: Vec3[] = [];
  private anchorHelpers: THREE.Group | null = null;
  private anchorsVisible = false;
  private videoTexture: THREE.VideoTexture | null = null;
  private shadowsVisible = true;
  private hairEnabled = true;

  /**
   * Yerel poz filtreleri. Yerel poz anatomik bir sabit (kişinin burnu kare
   * kare değişmiyor), o yüzden çok agresif yumuşatılabilir — fit skorunun
   * titrememesinin sebebi bu.
   */
  private readonly localFilters = {
    y: new OneEuroFilter({ minCutoff: 0.35, beta: 0.004 }),
    z: new OneEuroFilter({ minCutoff: 0.35, beta: 0.004 }),
    pitch: new OneEuroFilter({ minCutoff: 0.35, beta: 0.004 }),
  };
  private smoothedLocal: LocalPose | null = null;

  /** Son ham çözücü sonucu (filtrelenmemiş). */
  lastSolve: PlacementResult | null = null;
  lastHead: HeadFrame | null = null;
  lastPlacement: {
    distanceMM: number;
    visible: boolean;
    mode: 'solver' | 'naive' | 'none';
  } = {
    distanceMM: NaN,
    // Varsayılan GÖRÜNÜR. Eskiden false'tu ve yalnızca geliştirme panelinin
    // "Gözlük" kutucuğu setGlassesVisible(true) çağırıyordu — embed widget
    // çağırmadığı için mağazada kamera açılıyor ama gözlük hiç görünmüyordu.
    // Gizlemek bir teşhis seçeneği; ürünün varsayılanı olamaz.
    visible: true,
    mode: 'none',
  };
  timings = { solveMs: 0 };

  constructor(canvas: HTMLCanvasElement, options: SceneOptions) {
    this.fovYDeg = options.fovYDeg ?? DEFAULT_FOV_Y_DEG;
    this.maxPixelRatio = options.maxPixelRatio ?? 2;
    this.quality = options.quality ?? 'high';

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: this.maxPixelRatio <= 1.5, // yüksek DPR'de MSAA fazla pahalı
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.NoToneMapping; // video renkleri bozulmasın
    this.renderer.shadowMap.enabled = this.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(this.fovYDeg, 1, 1, 5000);
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, 0, -1);

    // Ortam haritası: metal ve cam yansımaları için şart — yoksa metalik
    // yüzeyler siyah görünür. Oda ortamı nötr; şiddeti ışık tahmini ayarlıyor.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.occluder = new FaceOccluder(options.tesselation);
    this.occluder.mesh.renderOrder = -3;
    this.occluder.mesh.castShadow = false;
    this.scene.add(this.occluder.mesh);

    this.hair = new HairOccluder();
    this.scene.add(this.hair.mesh);

    this.shadow = new ContactShadow(this.occluder.geometry);
    this.scene.add(this.shadow.receiver, this.shadow.ao);
    this.shadow.setVisible(this.quality !== 'low');

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x4a4238, 0.9);
    this.scene.add(this.hemi);

    this.keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    this.keyLight.position.set(-250, 350, 300);
    this.keyLight.castShadow = this.quality !== 'low';
    this.keyLight.shadow.mapSize.set(this.quality === 'high' ? 1024 : 512, this.quality === 'high' ? 1024 : 512);
    const sc = this.keyLight.shadow.camera;
    sc.left = -120;
    sc.right = 120;
    sc.top = 120;
    sc.bottom = -120;
    sc.near = 50;
    sc.far = 1600;
    this.keyLight.shadow.bias = -0.0004;
    this.keyLight.shadow.normalBias = 0.6;
    this.keyLight.shadow.radius = 4;
    this.scene.add(this.keyLight, this.keyLight.target);

    this.frame = buildFrame(DEFAULT_SPEC);
    this.geometry = glassesGeometry(this.frame);
    this.prepareFrame(this.frame);
    this.frame.group.visible = false;
    this.scene.add(this.frame.group);
  }

  // ---------------------------------------------------------------- kurulum

  /** Videoyu sahnenin arka planı yap (lens kırılması için şart). */
  setVideo(video: HTMLVideoElement): void {
    this.videoTexture?.dispose();
    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    this.videoTexture = texture;
    this.scene.background = texture;
  }

  /**
   * Çizim tamponunu hem DPR hem toplam piksel bütçesiyle sınırla.
   *
   * 1280×720 video + DPR 2 = 2560×1440 = 3.7 MP. MSAA ile birlikte mobilde
   * onlarca MB VRAM demek ve düşük bellekli cihazlarda sekmeyi öldürebiliyor.
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
    this.swapFrame(buildFrame(spec));
  }

  /** Parametrik çerçeve, çerçeve içine yazan üç sayıyla (49□21-145). */
  setFrameSize(lensWidth: number, bridgeWidth: number, templeLength: number): void {
    this.setFrameSpec({ ...DEFAULT_SPEC, lensWidth, bridgeWidth, templeLength });
  }

  /** Yüklenen bir GLB modelini devreye al (bkz. gltf.ts). */
  setFrame(frame: BuiltFrame): void {
    this.swapFrame(frame);
  }

  get spec(): FrameSpec {
    return this.frame.spec;
  }

  get glasses(): GlassesGeometry {
    return this.geometry;
  }

  /** Filtrelenmiş yerel poz — fit skoru bunun üzerinden hesaplanmalı. */
  get local(): LocalPose | null {
    return this.smoothedLocal;
  }

  /** Bu karenin landmarkları, kamera uzayında mm. */
  get landmarksMM(): ReadonlyArray<Vec3> {
    return this.mmPoints;
  }

  private swapFrame(next: BuiltFrame): void {
    const wasVisible = this.frame.group.visible;
    this.scene.remove(this.frame.group);
    this.frame.dispose();
    this.frame = next;
    this.geometry = glassesGeometry(next);
    this.prepareFrame(next);
    this.frame.group.visible = wasVisible;
    this.scene.add(this.frame.group);
    this.resetLocal();
    this.refreshAnchorHelpers();
  }

  /** Yeni çerçeve: gölge ayarları ve kalite kademesine göre malzeme. */
  private prepareFrame(frame: BuiltFrame): void {
    frame.group.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      let clearLens = false;
      for (const m of materials) {
        if (m instanceof THREE.MeshPhysicalMaterial && m.transmission > 0) {
          const l = 0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b;
          clearLens ||= l > 0.3;
          if (this.quality === 'low') {
            // Düşük kademede transmission pass'i yok — lensi basit şeffaf yap.
            m.transmission = 0;
            m.transparent = true;
            m.opacity = clearLens ? 0.18 : 0.72;
            m.needsUpdate = true;
          }
        }
      }
      // Şeffaf lensin opak gölge düşürmesi yanlış görünür; güneş gözlüğü lensi
      // ise gerçekten koyu gölge düşürür.
      node.castShadow = !clearLens;
      node.receiveShadow = false;
    });
  }

  private resetLocal(): void {
    this.smoothedLocal = null;
    this.lastSolve = null;
    for (const f of Object.values(this.localFilters)) f.reset();
  }

  // ---------------------------------------------------------------- kontroller

  setAnchorsVisible(visible: boolean): void {
    this.anchorsVisible = visible;
    this.refreshAnchorHelpers();
  }

  setGlassesVisible(visible: boolean): void {
    this.frame.group.visible = visible;
    this.lastPlacement.visible = visible;
  }

  setShadowsVisible(visible: boolean): void {
    this.shadowsVisible = visible && this.quality !== 'low';
    this.shadow.setVisible(this.shadowsVisible);
  }

  setHairEnabled(enabled: boolean): void {
    this.hairEnabled = enabled;
    this.hair.setEnabled(enabled && this.frame.group.visible);
    if (!enabled) this.hair.clearMask();
  }

  updateHairMask(mask: Float32Array | Uint8Array, width: number, height: number): void {
    if (this.hairEnabled) this.hair.updateMask(mask, width, height);
  }

  setFrameColor(hex: number): void {
    this.frame.materials.frame.color.setHex(hex);
  }

  setOccluderDebug(mode: OccluderDebug): void {
    this.occluder.setDebug(mode);
  }

  applyLight(estimate: LightEstimate): void {
    this.keyLight.color.copy(estimate.color);
    this.keyLight.intensity = 2.0 * estimate.intensity;
    this.hemi.intensity = 0.9 * estimate.intensity;
    this.hemi.color.copy(estimate.color);
    this.scene.environmentIntensity = 0.9 * estimate.intensity;

    const center = this.lastHead?.origin ?? { x: 0, y: 0, z: -550 };
    this.keyLight.target.position.set(center.x, center.y, center.z);
    this.keyLight.position.set(
      center.x + estimate.direction.x * 700,
      center.y + estimate.direction.y * 700,
      center.z + estimate.direction.z * 700,
    );
    this.keyLight.target.updateMatrixWorld();
  }

  /** Yüz bulunamadığında sahneyi gizle — eski poz donmuş halde kalmasın. */
  hide(): void {
    this.occluder.mesh.visible = false;
    this.shadow.setVisible(false);
    this.hair.setEnabled(false);
    this.frame.group.visible = false;
  }

  // ---------------------------------------------------------------- kare güncellemesi

  update(lm: FaceUnits, scaleMMPerUnit: number, aspect: number, options: SceneUpdate): void {
    this.occluder.mesh.visible = true;
    this.occluder.update(lm, scaleMMPerUnit, aspect, this.fovYDeg);

    if (this.mmBuffer.length !== lm.length * 3) this.mmBuffer = new Float32Array(lm.length * 3);
    unprojectToMM(lm, scaleMMPerUnit, aspect, this.fovYDeg, this.mmBuffer);
    this.syncPoints(lm.length);

    const head = buildHeadFrame(this.mmPoints);
    this.lastHead = head;
    this.lastPlacement.distanceMM = faceDistanceMM(scaleMMPerUnit, this.fovYDeg);
    if (!head) return;

    if (options.solve || !this.smoothedLocal) {
      const t0 = performance.now();
      const result = solvePlacement(
        this.mmPoints,
        { positions: this.occluder.positions, indices: this.occluder.indices },
        this.geometry,
      );
      this.timings.solveMs = performance.now() - t0;
      if (result) {
        this.lastSolve = result;
        this.pushLocal(result.local, options.timestampMs);
      }
    }

    const visible = this.lastPlacement.visible;
    if (this.smoothedLocal) {
      const pose = composePose(head, this.geometry, this.smoothedLocal);
      this.frame.group.position.set(pose.position.x, pose.position.y, pose.position.z);
      this.frame.group.quaternion.set(...pose.quaternion);
      this.lastPlacement.mode = 'solver';
    } else {
      this.placeNaive();
      this.lastPlacement.mode = 'naive';
    }
    this.frame.group.visible = visible;
    this.frame.group.updateMatrixWorld(true);

    this.shadow.setVisible(this.shadowsVisible && visible);
    this.updateContacts();
    this.updateHairPlane(head);
  }

  private syncPoints(count: number): void {
    if (this.mmPoints.length !== count) {
      this.mmPoints = Array.from({ length: count }, () => ({ x: 0, y: 0, z: 0 }));
    }
    for (let i = 0; i < count; i++) {
      const p = this.mmPoints[i]!;
      p.x = this.mmBuffer[i * 3]!;
      p.y = this.mmBuffer[i * 3 + 1]!;
      p.z = this.mmBuffer[i * 3 + 2]!;
    }
  }

  private pushLocal(local: LocalPose, t: number): void {
    this.smoothedLocal = {
      pivotY: this.localFilters.y.filter(local.pivotY, t),
      pivotZ: this.localFilters.z.filter(local.pivotZ, t),
      pitchDeg: this.localFilters.pitch.filter(local.pitchDeg, t),
    };
  }

  private anchorWorld(p: THREE.Vector3): THREE.Vector3 {
    return p.clone().applyMatrix4(this.frame.group.matrixWorld);
  }

  /** Burun pedleri ve (değiyorsa) köprü için kontak AO. */
  private updateContacts(): void {
    const a = this.frame.anchors;
    const bridgeTouches = this.lastSolve?.governing === 'bridge';
    this.shadow.setContacts([
      { point: this.anchorWorld(a.nosePadL), weight: 1 },
      { point: this.anchorWorld(a.nosePadR), weight: 1 },
      { point: this.anchorWorld(a.bridgeCenter), weight: bridgeTouches ? 0.9 : 0.35 },
    ]);
  }

  private updateHairPlane(head: HeadFrame): void {
    const enabled = this.hairEnabled && this.frame.group.visible && this.quality !== 'low';
    this.hair.setEnabled(enabled);
    if (!enabled) return;
    const l = this.anchorWorld(this.frame.anchors.hingeL);
    const r = this.anchorWorld(this.frame.anchors.hingeR);
    const center = l.add(r).multiplyScalar(0.5);
    const v = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);
    this.hair.place(center, v(head.x), v(head.y), v(head.z));
  }

  /**
   * Yedek yerleştirme — çözücü sonuç veremediğinde (ilk kareler, bozuk mesh).
   * Köprü landmark'ına oturtur, sabit vertex mesafesi kullanır. Sahte görünür;
   * sadece gözlüğün kaybolmaması için.
   */
  private placeNaive(): void {
    const p = (i: number) =>
      new THREE.Vector3(this.mmBuffer[i * 3]!, this.mmBuffer[i * 3 + 1]!, this.mmBuffer[i * 3 + 2]!);

    const bridge = p(NOSE_BRIDGE_TOP);
    let x = p(FACE_SIDE_B).sub(p(FACE_SIDE_A));
    const yRaw = p(FOREHEAD).sub(p(CHIN));
    let z = new THREE.Vector3().crossVectors(x, yRaw);
    if (z.z < 0) z.negate();
    z.normalize();
    const y = yRaw.clone().sub(z.clone().multiplyScalar(yRaw.dot(z))).normalize();
    x = new THREE.Vector3().crossVectors(y, z).normalize();

    this.frame.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    const pos = bridge.clone().add(z.clone().multiplyScalar(13));
    pos.add(y.clone().multiplyScalar(-this.frame.anchors.bridgeCenter.y));
    this.frame.group.position.copy(pos);
  }

  // ---------------------------------------------------------------- anchor görselleştirme

  /**
   * GLB'lerde anchor'lar geometriden türetiliyor. Çözücü yanlış çalışıyorsa
   * ilk şüpheli burasıdır — gözle bakılabilmesi şart.
   */
  private refreshAnchorHelpers(): void {
    if (this.anchorHelpers) {
      this.anchorHelpers.parent?.remove(this.anchorHelpers);
      this.anchorHelpers.traverse((n) => {
        if (n instanceof THREE.Mesh) {
          n.geometry.dispose();
          (n.material as THREE.Material).dispose();
        }
      });
      this.anchorHelpers = null;
    }
    if (!this.anchorsVisible) return;

    const helpers = new THREE.Group();
    helpers.name = 'anchor-helpers';
    const palette: Record<string, number> = {
      bridgeCenter: 0xff3b3b,
      nosePadL: 0xffa63b,
      nosePadR: 0xffa63b,
      hingeL: 0x3bff7a,
      hingeR: 0x3bff7a,
      templeTipL: 0x3ba8ff,
      templeTipR: 0x3ba8ff,
      lensCenterL: 0xc86ae0,
      lensCenterR: 0xc86ae0,
    };

    for (const [name, point] of Object.entries(this.frame.anchors)) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(2.2, 10, 8),
        new THREE.MeshBasicMaterial({ color: palette[name] ?? 0xffffff, depthTest: false }),
      );
      dot.position.copy(point as THREE.Vector3);
      dot.renderOrder = 999;
      dot.castShadow = false;
      helpers.add(dot);
    }

    this.anchorHelpers = helpers;
    this.frame.group.add(helpers);
  }

  // ---------------------------------------------------------------- çizim

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.occluder.dispose();
    this.shadow.dispose();
    this.hair.dispose();
    this.frame.dispose();
    this.videoTexture?.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }
}
