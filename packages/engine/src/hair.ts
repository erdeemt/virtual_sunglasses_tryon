import { ImageSegmenter, type FilesetResolver } from '@mediapipe/tasks-vision';

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

export interface HairMask {
  /** 0..1 saç güveni, satır sırası üstten alta. */
  data: Float32Array;
  width: number;
  height: number;
}

/**
 * MediaPipe saç segmenter'ı (hair_segmenter.tflite, 781 KB).
 *
 * Genel çok-sınıflı model 16 MB — embed widget için kabul edilemez. Bu özel
 * model iki sınıf veriyor: background, hair. Sınıf indeksi modelin kendi
 * etiketlerinden okunuyor, sabit kodlanmıyor (tasarım ilkesi: indeks
 * konvansiyonuna değil kaynağa güven).
 */
export class HairSegmenter {
  private constructor(
    private readonly segmenter: ImageSegmenter,
    private readonly hairIndex: number,
    readonly labels: string[],
  ) {}

  static async create(fileset: WasmFileset, modelPath: string, delegate: 'CPU' | 'GPU'): Promise<HairSegmenter> {
    const segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelPath, delegate },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
    const labels = segmenter.getLabels();
    const index = labels.findIndex((l) => /hair/i.test(l));
    return new HairSegmenter(segmenter, index >= 0 ? index : 1, labels);
  }

  /**
   * Maske verisi yalnızca geri çağırma içinde geçerli — kopyalanıyor.
   * VIDEO modunda zaman damgaları monoton artmalı.
   */
  segment(video: HTMLVideoElement, timestampMs: number): HairMask | null {
    let out: HairMask | null = null;
    this.segmenter.segmentForVideo(video, timestampMs, (result) => {
      const mask = result.confidenceMasks?.[this.hairIndex];
      if (!mask) return;
      out = { data: new Float32Array(mask.getAsFloat32Array()), width: mask.width, height: mask.height };
    });
    return out;
  }

  close(): void {
    this.segmenter.close();
  }
}
