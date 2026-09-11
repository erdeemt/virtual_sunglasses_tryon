import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import {
  EXPECTED_LANDMARK_COUNT,
  MetricEstimator,
  OneEuroFilter,
  computeFit,
  detectCapability,
  median,
  toFaceUnits,
  type Capability,
  type EstimatorFrame,
  type FaceUnits,
  type FitReport,
  type PlacementResult,
  type RawLandmarks,
  type Tier,
} from '@vto/core';
import {
  LightEstimator,
  TryOnScene,
  loadFrameFromGLB,
  type FrameSpec,
  type LoadedFrame,
  type NormalizeOptions,
  type RenderQuality,
} from '@vto/render';
import { cameraErrorMessage, openCamera, stopStream } from './camera.js';
import { HairSegmenter } from './hair.js';

/**
 * Try-on motoru — tüm pipeline tek yerde.
 *
 *   kamera → FaceLandmarker → ölçek füzyonu → metrik yüz mesh'i
 *          → yerleştirme çözücüsü → saç maskesi → ışık tahmini → render
 *          → fit skoru
 *
 * Demo (geliştirme paneli) ve embed widget (ürün) aynı motoru kullanıyor.
 * Motor UI bilmez; olay yayınlar ('frame', 'fit', 'error', 'noface').
 *
 * Gizlilik: kamera karesi bu sınıftan hiçbir yere gönderilmez. Tüm çıkarım
 * cihazda. Olaylar yalnızca türetilmiş sayılar taşır.
 */

export interface EngineOptions {
  video: HTMLVideoElement;
  /** WebGL çizim yüzeyi. */
  canvas: HTMLCanvasElement;
  /** mediapipe/wasm ve models/ dizinlerinin kökü. */
  assetBase?: string;
  capability?: Capability;
  forceCPU?: boolean;
  /** false: sadece ölçüm (3D sahne yok). */
  enable3D?: boolean;
  /** Saç occlusion'ı. Varsayılan: düşük kademe dışında açık. */
  enableHair?: boolean;
}

export interface EngineTimings {
  inferenceMs: number;
  hairMs: number;
  solveMs: number;
  renderMs: number;
  fps: number;
}

export interface EngineFrame {
  timestampMs: number;
  raw: RawLandmarks | null;
  units: FaceUnits | null;
  aspect: number;
  metric: EstimatorFrame | null;
  placement: PlacementResult | null;
  fit: FitReport | null;
  timings: EngineTimings;
}

export interface EngineEvents {
  frame: EngineFrame;
  fit: FitReport;
  error: Error;
  noface: undefined;
}

const QUALITY: Record<Tier, RenderQuality> = { high: 'high', mid: 'mid', low: 'low', photo: 'low' };

type Listener = (payload: never) => void;

export class TryOnEngine {
  readonly capability: Capability;
  readonly scene: TryOnScene | null;
  estimator = new MetricEstimator();

  private readonly video: HTMLVideoElement;
  private readonly landmarker: FaceLandmarker;
  private readonly hair: HairSegmenter | null;
  private readonly light = new LightEstimator();
  private readonly listeners = new Map<keyof EngineEvents, Set<Listener>>();
  /** Ölçek fiziksel olarak sabit — kare kare oynarsa gözlük "nefes alır". */
  private readonly scaleFilter = new OneEuroFilter({ minCutoff: 0.25, beta: 0.002 });

  private stream: MediaStream | null = null;
  private running = false;
  private rafId = 0;
  private lastVideoTime = -1;
  private frameIndex = 0;
  private hairEnabled: boolean;
  private fps = { windowStart: 0, frames: 0, value: 0 };
  private fitScores: number[] = [];
  private lastFitAt = 0;
  private latestFit: FitReport | null = null;

  private constructor(
    options: EngineOptions,
    capability: Capability,
    landmarker: FaceLandmarker,
    hair: HairSegmenter | null,
    scene: TryOnScene | null,
  ) {
    this.video = options.video;
    this.capability = capability;
    this.landmarker = landmarker;
    this.hair = hair;
    this.scene = scene;
    this.hairEnabled = hair !== null;
    scene?.setHairEnabled(this.hairEnabled);
  }

  static async create(options: EngineOptions): Promise<TryOnEngine> {
    const capability = options.capability ?? (await detectCapability());
    const base = options.assetBase ?? '/';
    const delegate = options.forceCPU || capability.tier === 'low' ? 'CPU' : 'GPU';

    // WASM ve modeller yerel servis ediliyor — çalışma anında CDN yok.
    const fileset = await FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`);
    const landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}models/face_landmarker.task`, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    // Saç segmenter'ı opsiyonel: yüklenemezse ürün çalışmaya devam eder.
    let hair: HairSegmenter | null = null;
    const wantHair = (options.enableHair ?? capability.budget.hairSegmentEvery > 0) && options.enable3D !== false;
    if (wantHair) {
      try {
        hair = await HairSegmenter.create(fileset, `${base}models/hair_segmenter.tflite`, delegate);
      } catch (error) {
        console.warn('[vto] saç segmenter yüklenemedi, saç occlusion kapalı:', error);
      }
    }

    let scene: TryOnScene | null = null;
    if (options.enable3D !== false) {
      scene = new TryOnScene(options.canvas, {
        // Tesselation modelin kendi sabitinden — 852 üçgenlik diziyi gömmeye gerek yok.
        tesselation: FaceLandmarker.FACE_LANDMARKS_TESSELATION,
        maxPixelRatio: capability.budget.maxPixelRatio,
        quality: QUALITY[capability.tier],
      });
    }

    const engine = new TryOnEngine(options, capability, landmarker, hair, scene);
    options.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      engine.fail(new Error('WebGL bağlamı kaybedildi (GPU belleği yetersiz olabilir).'));
    });
    return engine;
  }

  // ---------------------------------------------------------------- olaylar

  on<K extends keyof EngineEvents>(event: K, callback: (payload: EngineEvents[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(callback as Listener);
    return () => set!.delete(callback as Listener);
  }

  private emit<K extends keyof EngineEvents>(event: K, payload: EngineEvents[K]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as (p: EngineEvents[K]) => void)(payload);
    }
  }

  private fail(error: unknown): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.emit('error', error instanceof Error ? error : new Error(String(error)));
  }

  // ---------------------------------------------------------------- yaşam döngüsü

  /** Kamerayı aç ve döngüyü başlat. Hata mesajları kullanıcıya gösterilebilir. */
  async start(): Promise<void> {
    if (this.running) return;
    stopStream(this.stream);

    try {
      this.stream = await openCamera();
    } catch (error) {
      throw new Error(cameraErrorMessage(error));
    }

    const video = this.video;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;
    await video.play();
    if (video.videoWidth === 0) {
      await new Promise<void>((resolve) => video.addEventListener('loadedmetadata', () => resolve(), { once: true }));
    }

    if (this.scene) {
      this.scene.resize(video.videoWidth, video.videoHeight);
      this.scene.setVideo(video);
    }

    window.addEventListener('pagehide', this.onPageHide);
    this.running = true;
    this.fps = { windowStart: performance.now(), frames: 0, value: 0 };
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    stopStream(this.stream);
    this.stream = null;
    this.video.srcObject = null;
    window.removeEventListener('pagehide', this.onPageHide);
  }

  dispose(): void {
    this.stop();
    this.landmarker.close();
    this.hair?.close();
    this.scene?.dispose();
    this.listeners.clear();
  }

  private readonly onPageHide = (): void => this.stop();

  // ---------------------------------------------------------------- kontroller

  /** Yeni denek: ölçüm, ölçek ve fit geçmişini sıfırla. */
  resetMeasurements(): void {
    this.estimator = new MetricEstimator();
    this.scaleFilter.reset();
    this.resetFit();
  }

  setFrameSpec(spec: FrameSpec): void {
    this.scene?.setFrameSpec(spec);
    this.resetFit();
  }

  /** Parametrik çerçeve, çerçeve içine yazan üç sayıyla (49□21-145). */
  setFrameSize(lensWidth: number, bridgeWidth: number, templeLength: number): void {
    this.scene?.setFrameSize(lensWidth, bridgeWidth, templeLength);
    this.resetFit();
  }

  async loadGlasses(source: string | File, options: Partial<NormalizeOptions> = {}): Promise<LoadedFrame> {
    const frame = await loadFrameFromGLB(source, {
      frontWidthMM: 138,
      ...options,
      spec: options.spec ?? this.scene?.spec,
    });
    this.scene?.setFrame(frame);
    this.resetFit();
    return frame;
  }

  setHairEnabled(enabled: boolean): void {
    this.hairEnabled = enabled && this.hair !== null;
    this.scene?.setHairEnabled(this.hairEnabled);
  }

  get hairAvailable(): boolean {
    return this.hair !== null;
  }

  get fit(): FitReport | null {
    return this.latestFit;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private resetFit(): void {
    this.fitScores = [];
    this.latestFit = null;
    this.lastFitAt = 0;
  }

  // ---------------------------------------------------------------- döngü

  private readonly loop = (): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);
    try {
      this.tick();
    } catch (error) {
      // Tek bir hatayı 60 Hz tekrarlamak yerine dur ve bildir — aksi halde
      // konsol dolup sekme kilitleniyor ve kullanıcıya "çökme" gibi görünüyor.
      this.fail(error);
    }
  };

  private tick(): void {
    const video = this.video;
    if (video.readyState < 2 || video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;
    const now = performance.now();
    this.frameIndex++;

    const t0 = performance.now();
    const result = this.landmarker.detectForVideo(video, now);
    const timings: EngineTimings = {
      inferenceMs: performance.now() - t0,
      hairMs: 0,
      solveMs: 0,
      renderMs: 0,
      fps: this.trackFps(now),
    };

    const raw = result.faceLandmarks[0] as RawLandmarks | undefined;
    const aspect = video.videoWidth / video.videoHeight;
    const scene = this.scene;

    if (!raw || raw.length < EXPECTED_LANDMARK_COUNT) {
      if (scene) {
        scene.hide();
        const r0 = performance.now();
        scene.render();
        timings.renderMs = performance.now() - r0;
      }
      this.emit('noface', undefined);
      this.emit('frame', {
        timestampMs: now,
        raw: null,
        units: null,
        aspect,
        metric: null,
        placement: null,
        fit: this.latestFit,
        timings,
      });
      return;
    }

    const units = toFaceUnits(raw, aspect);
    const metric = this.estimator.update(units);

    if (scene) {
      const k = metric ? this.scaleFilter.filter(metric.scale.scale, now) : NaN;
      if (metric && Number.isFinite(k) && k > 0) {
        const every = this.capability.budget.hairSegmentEvery;
        if (this.hairEnabled && this.hair && every > 0 && this.frameIndex % every === 0) {
          const h0 = performance.now();
          const mask = this.hair.segment(video, now);
          if (mask) scene.updateHairMask(mask.data, mask.width, mask.height);
          timings.hairMs = performance.now() - h0;
        }

        // Çözücü yalnızca frontal karelerde: yüz döndükçe MediaPipe mesh'i
        // bozuluyor. Yerel poz anatomik sabit, arada filtrelenmişi kullanılır.
        const frontal = metric.geometry.pose.frontality >= 0.85;
        scene.update(units, k, aspect, { solve: frontal && this.frameIndex % 2 === 0, timestampMs: now });
        timings.solveMs = scene.timings.solveMs;

        if (this.frameIndex % 4 === 0) scene.applyLight(this.light.update(video, raw, scene.lastHead));
      } else {
        scene.hide();
      }

      const r0 = performance.now();
      scene.render();
      timings.renderMs = performance.now() - r0;
      this.updateFit(now);
    }

    this.emit('frame', {
      timestampMs: now,
      raw,
      units,
      aspect,
      metric,
      placement: scene?.lastSolve ?? null,
      fit: this.latestFit,
      timings,
    });
  }

  private trackFps(now: number): number {
    this.fps.frames++;
    const elapsed = now - this.fps.windowStart;
    if (elapsed >= 500) {
      this.fps.value = (this.fps.frames * 1000) / elapsed;
      this.fps.frames = 0;
      this.fps.windowStart = now;
    }
    return this.fps.value;
  }

  /**
   * Fit skoru 4 Hz'de, filtrelenmiş yerel poz üzerinden hesaplanıyor ve son
   * 12 ölçümün medyanıyla raporlanıyor. 78↔81 arası oynayan bir skor
   * kullanıcının güvenini yok eder.
   */
  private updateFit(now: number): void {
    if (now - this.lastFitAt < 250) return;
    const scene = this.scene;
    const solve = scene?.lastSolve;
    const local = scene?.local;
    const head = scene?.lastHead;
    if (!scene || !solve || !local || !head) return;
    this.lastFitAt = now;

    const fit = computeFit(scene.landmarksMM, { ...solve, head, local }, scene.glasses);
    if (!fit) return;

    this.fitScores.push(fit.score);
    if (this.fitScores.length > 12) this.fitScores.shift();
    const stable: FitReport = { ...fit, score: Math.round(median(this.fitScores)) };

    const previous = this.latestFit;
    this.latestFit = stable;
    const changed =
      !previous ||
      previous.score !== stable.score ||
      previous.verdict !== stable.verdict ||
      previous.status !== stable.status;
    if (changed) this.emit('fit', stable);
  }
}
