import * as THREE from 'three';
import {
  CHIN,
  FACE_SIDE_A,
  FACE_SIDE_B,
  FOREHEAD,
  IRIS_A_CENTER,
  IRIS_B_CENTER,
  NOSE_BRIDGE_TOP,
  NOSE_TIP,
  type HeadFrame,
  type RawLandmarks,
} from '@vto/core';

/**
 * Görüntüden ışık tahmini (TASKS T-06'nın ucuz ilk sürümü).
 *
 * Sanal nesnenin ışığı sahneyle uyuşmazsa beyin anında yakalar. Yüz, albedosu
 * kabaca bilinen bir yüzey: sağ/sol yanak ve alın/çene parlaklık farkları ana
 * ışığın yönünü, ortalama renk ışığın rengini, ortalama parlaklık şiddetini
 * veriyor. Tam küresel harmonik çözümü (9 katsayı) sonraki adım; bu sürüm
 * yön + renk + şiddet, kare başına ~0.2 ms.
 *
 * Sadece doğrulanmış landmarkları kullanıyor (iris, yüz yanları, burun, alın,
 * çene) — yanak noktaları bunlardan geometrik olarak türetiliyor, internetten
 * bulunmuş "yanak landmark indeksi" listelerine güvenilmiyor.
 */
export interface LightEstimate {
  /** Göreli şiddet — 1 ≈ iyi aydınlatılmış iç mekân. */
  intensity: number;
  /** Işık rengi (cilt tonu bölünmüş, beyaza doğru yumuşatılmış). */
  color: THREE.Color;
  /** Işığın geldiği yön, kamera uzayında birim vektör. */
  direction: THREE.Vector3;
}

/** Tipik cilt albedosu oranları — ışık rengini cilt renginden ayırmak için. */
const SKIN_ALBEDO = { r: 1, g: 0.78, b: 0.66 };
/** İyi aydınlatılmış cildin tipik doğrusal parlaklığı. */
const REFERENCE_LUMINANCE = 0.3;

const W = 64;
const H = 36;

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class LightEstimator {
  private readonly ctx: Ctx2D | null;
  private readonly state: LightEstimate = {
    intensity: 1,
    color: new THREE.Color(1, 1, 1),
    direction: new THREE.Vector3(-0.35, 0.55, 0.76).normalize(),
  };

  /** Yumuşatma katsayısı — ışık ani değişmez, titreşen ışık rahatsız eder. */
  constructor(private readonly smoothing = 0.12) {
    let ctx: Ctx2D | null = null;
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        ctx = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true });
      } else {
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        ctx = canvas.getContext('2d', { willReadFrequently: true });
      }
    } catch {
      ctx = null;
    }
    this.ctx = ctx;
  }

  get current(): LightEstimate {
    return this.state;
  }

  update(video: HTMLVideoElement, raw: RawLandmarks, head: HeadFrame | null): LightEstimate {
    const ctx = this.ctx;
    if (!ctx || video.readyState < 2 || raw.length < 478) return this.state;

    ctx.drawImage(video, 0, 0, W, H);
    const pixels = ctx.getImageData(0, 0, W, H).data;

    const at = (i: number) => raw[i]!;
    const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });

    // Görüntü uzayında sol/sağ: aynalanmamış karede takan kişinin sağı SOLDA.
    const [irisR, irisL] = at(IRIS_A_CENTER).x < at(IRIS_B_CENTER).x
      ? [at(IRIS_A_CENTER), at(IRIS_B_CENTER)]
      : [at(IRIS_B_CENTER), at(IRIS_A_CENTER)];
    const [sideR, sideL] = at(FACE_SIDE_A).x < at(FACE_SIDE_B).x
      ? [at(FACE_SIDE_A), at(FACE_SIDE_B)]
      : [at(FACE_SIDE_B), at(FACE_SIDE_A)];

    const sellion = at(NOSE_BRIDGE_TOP);
    const chin = at(CHIN);
    const down = { x: (chin.x - sellion.x) * 0.22, y: (chin.y - sellion.y) * 0.22 };
    const shift = (p: { x: number; y: number }) => ({ x: p.x + down.x, y: p.y + down.y });

    const cheekR = shift(lerp(irisR, sideR, 0.35));
    const cheekL = shift(lerp(irisL, sideL, 0.35));
    const forehead = lerp(sellion, at(FOREHEAD), 0.55);
    const chinArea = lerp(at(NOSE_TIP), chin, 0.6);

    const sR = sample(pixels, cheekR);
    const sL = sample(pixels, cheekL);
    const sT = sample(pixels, forehead);
    const sB = sample(pixels, chinArea);

    const lum = (c: RGB) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const lR = lum(sR);
    const lL = lum(sL);
    const lT = lum(sT);
    const lB = lum(sB);

    // Parlaklık gradyanı → ışık yönü (baş uzayında). Işık çoğunlukla önden
    // gelir; yanal ve dikey bileşenler farklardan.
    const gx = (lL - lR) / (lL + lR + 1e-3);
    const gy = (lT - lB) / (lT + lB + 1e-3);
    const local = new THREE.Vector3(gx * 3, gy * 2 + 0.3, 1).normalize();
    const direction = head
      ? new THREE.Vector3(
          head.x.x * local.x + head.y.x * local.y + head.z.x * local.z,
          head.x.y * local.x + head.y.y * local.y + head.z.y * local.z,
          head.x.z * local.x + head.y.z * local.y + head.z.z * local.z,
        ).normalize()
      : local;

    const mean: RGB = {
      r: (sR.r + sL.r + sT.r + sB.r) / 4,
      g: (sR.g + sL.g + sT.g + sB.g) / 4,
      b: (sR.b + sL.b + sT.b + sB.b) / 4,
    };
    const illum = { r: mean.r / SKIN_ALBEDO.r, g: mean.g / SKIN_ALBEDO.g, b: mean.b / SKIN_ALBEDO.b };
    const peak = Math.max(illum.r, illum.g, illum.b, 1e-3);
    // Cilt tonu tahmini kaba; renk sapmasını yarıya indirerek beyaza çek.
    const color = new THREE.Color(
      0.5 + 0.5 * (illum.r / peak),
      0.5 + 0.5 * (illum.g / peak),
      0.5 + 0.5 * (illum.b / peak),
    );

    const intensity = Math.max(0.35, Math.min(1.8, lum(mean) / REFERENCE_LUMINANCE));

    const k = this.smoothing;
    this.state.intensity += (intensity - this.state.intensity) * k;
    this.state.color.lerp(color, k);
    this.state.direction.lerp(direction, k).normalize();
    return this.state;
  }
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

/** 3×3 ortalama, sRGB → doğrusal. */
function sample(pixels: Uint8ClampedArray, p: { x: number; y: number }): RGB {
  const cx = Math.round(p.x * (W - 1));
  const cy = Math.round(p.y * (H - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = Math.min(W - 1, Math.max(0, cx + dx));
      const y = Math.min(H - 1, Math.max(0, cy + dy));
      const i = (y * W + x) * 4;
      r += toLinear(pixels[i]! / 255);
      g += toLinear(pixels[i + 1]! / 255);
      b += toLinear(pixels[i + 2]! / 255);
      n++;
    }
  }
  return { r: r / n, g: g / n, b: b / n };
}

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
