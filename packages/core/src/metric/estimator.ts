import type { FaceMeasurements, FaceUnits, MetricState, ScaleEstimate } from '../types.js';
import { cueValue, extractFrameGeometry, monocularPD, type FrameGeometry } from './cues.js';
import { median, robustSigma } from './linalg.js';
import { fuseScale } from './scale.js';

export interface EstimatorOptions {
  /** Bu eşiğin altındaki karelerin ölçümü sayılmaz (perspektif kısalması). */
  minFrontality: number;
  /** Kabul edilen örneklerin tutulduğu halka tampon boyutu. */
  windowSize: number;
  /** "Oturmuş" sayılmak için gereken minimum örnek. */
  settleCount: number;
  sex?: 'male' | 'female';
}

const DEFAULTS: EstimatorOptions = {
  // cos(18°)·cos(18°) ≈ 0.90 — yaw ve pitch'te kabaca ±18° tolerans.
  minFrontality: 0.9,
  windowSize: 90,
  settleCount: 20,
};

export interface EstimatorFrame {
  geometry: FrameGeometry;
  scale: ScaleEstimate;
  /** Bu kare frontallik kapısını geçti mi. */
  accepted: boolean;
  /** Bu tek karenin ham ölçümleri (birikmemiş). */
  instant: FaceMeasurements;
  /** Zaman içinde birikmiş, sağlam ölçüm. Yeterli örnek yoksa null. */
  state: MetricState | null;
}

/**
 * Zamansal ölçüm birikimi.
 *
 * İki ayrı belirsizlik raporlanır, çünkü farklı şeylerdir ve farklı
 * çözümleri vardır:
 *   - systematicCV: priorlardan gelir. Daha çok kare toplamak BUNU DÜŞÜRMEZ.
 *     Ancak kart kalibrasyonu düşürür (roadmap §6).
 *   - stabilityCV: kare-kare oynaklık. Örnek biriktirmek bunu düşürür.
 * İkisini tek sayıya karıştırmak, kalibrasyonun neden gerektiğini gizler.
 */
export class MetricEstimator {
  private readonly opts: EstimatorOptions;
  private readonly pd: number[] = [];
  private readonly icd: number[] = [];
  private readonly biz: number[] = [];
  private readonly iris: number[] = [];
  private readonly pdOD: number[] = [];
  private readonly pdOS: number[] = [];
  private lastSystematicCV = NaN;

  constructor(options: Partial<EstimatorOptions> = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  reset(): void {
    for (const buf of [this.pd, this.icd, this.biz, this.iris, this.pdOD, this.pdOS]) buf.length = 0;
    this.lastSystematicCV = NaN;
  }

  update(lm: FaceUnits): EstimatorFrame | null {
    const geometry = extractFrameGeometry(lm);
    if (!geometry) return null;

    const scale = fuseScale(geometry.cues, this.opts.sex);
    if (!scale) return null;

    const k = scale.scale;
    const mono = monocularPD(geometry, k);
    const instant: FaceMeasurements = {
      pd: cueValue(geometry.cues, 'interpupillary') * k,
      pdOD: mono.od,
      pdOS: mono.os,
      innerCanthal: cueValue(geometry.cues, 'innerCanthal') * k,
      bizygomatic: cueValue(geometry.cues, 'bizygomatic') * k,
      irisDiameter: ((geometry.irisDiameterOD + geometry.irisDiameterOS) / 2) * k,
    };

    const accepted = geometry.pose.frontality >= this.opts.minFrontality;
    if (accepted) {
      this.push(this.pd, instant.pd);
      this.push(this.pdOD, instant.pdOD);
      this.push(this.pdOS, instant.pdOS);
      this.push(this.icd, instant.innerCanthal);
      this.push(this.biz, instant.bizygomatic);
      this.push(this.iris, instant.irisDiameter);
      this.lastSystematicCV = scale.cv;
    }

    return { geometry, scale, accepted, instant, state: this.state() };
  }

  state(): MetricState | null {
    const n = this.pd.length;
    if (n < 3) return null;

    const pdMedian = median(this.pd);
    const stabilityCV = pdMedian > 0 ? robustSigma(this.pd) / pdMedian : NaN;

    return {
      measurements: {
        pd: pdMedian,
        pdOD: median(this.pdOD),
        pdOS: median(this.pdOS),
        innerCanthal: median(this.icd),
        bizygomatic: median(this.biz),
        irisDiameter: median(this.iris),
      },
      systematicCV: this.lastSystematicCV,
      stabilityCV,
      sampleCount: n,
      settled: n >= this.opts.settleCount,
    };
  }

  private push(buf: number[], v: number): void {
    if (!Number.isFinite(v)) return;
    buf.push(v);
    if (buf.length > this.opts.windowSize) buf.shift();
  }
}
