import type { CueContribution, CueSample, ScaleEstimate } from '../types.js';
import { correlation, priorFor } from './anthropometry.js';
import { invert } from './linalg.js';

/**
 * Çok-ipuçlu Bayesian ölçek füzyonu (roadmap §6).
 *
 * Problem: monoküler kamerada mutlak ölçek gözlemlenemez (u = f·X/Z —
 * boyut ve mesafe çarpımsal olarak eşleşir). Çözüm: her antropometrik
 * ipucunun gerçek dünya prior'ı bir ölçek tahmini verir; bunları
 * korelasyonu hesaba katarak birleştiririz.
 *
 * Her ipucu i için:
 *     s_i = μ_i / observed_i          σ_{s_i} = σ_i / observed_i
 *
 * GLS füzyonu (Σ = ölçek tahminlerinin kovaryansı):
 *     ŝ = (1ᵀΣ⁻¹1)⁻¹ · 1ᵀΣ⁻¹s        Var(ŝ) = (1ᵀΣ⁻¹1)⁻¹
 *
 * Korelasyon neden şart: iki iris ölçümü aynı büyüklüğün iki gözlemidir.
 * Naif ters-varyans ağırlıklandırma bunları bağımsız sayıp güveni √2 kat
 * şişirir — yani ürünün "±2 mm" iddiası yalan olur.
 */
export function fuseScale(samples: CueSample[], sex?: 'male' | 'female'): ScaleEstimate | null {
  const usable = samples.filter((s) => Number.isFinite(s.observed) && s.observed > 1e-6);
  if (usable.length === 0) return null;

  const n = usable.length;
  const s: number[] = [];
  const sd: number[] = [];

  for (const sample of usable) {
    const prior = priorFor(sample.key, sex);
    s.push(prior.muMM / sample.observed);
    sd.push(prior.sigmaMM / sample.observed);
  }

  const sigma: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) =>
      i === j ? sd[i]! * sd[i]! : correlation(usable[i]!.key, usable[j]!.key) * sd[i]! * sd[j]!,
    ),
  );

  const gls = tryGLS(s, sd, sigma);
  if (gls) return buildEstimate(usable, s, sd, gls.weights, gls.scale, gls.sigma, 'gls');

  // Fallback: ters-varyans ağırlıklandırma + korelasyon için tasarım etkisi cezası.
  const ivw = inverseVarianceWithDesignEffect(usable, s, sd);
  return buildEstimate(usable, s, sd, ivw.weights, ivw.scale, ivw.sigma, 'fallback-ivw');
}

function tryGLS(
  s: number[],
  sd: number[],
  sigma: number[][],
): { weights: number[]; scale: number; sigma: number } | null {
  const inv = invert(sigma);
  if (!inv) return null;

  const rowSums = inv.map((row) => row.reduce((a, b) => a + b, 0));
  const total = rowSums.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(total) || total <= 0) return null;

  const weights = rowSums.map((w) => w / total);
  const scale = s.reduce((acc, si, i) => acc + si * weights[i]!, 0);
  const variance = 1 / total;
  if (!Number.isFinite(variance) || variance <= 0) return null;

  const sigmaOut = Math.sqrt(variance);

  // Güvenlik kapıları: kötü belirlenmiş bir Σ, matematiksel olarak geçerli
  // ama fiziksel olarak saçma sonuçlar üretebilir.
  //  1) Füzyon en iyi tek ipucundan daha kötü olamaz.
  //  2) Aşırı ağırlık = bir ipucundan diğerine ekstrapolasyon; güvenilmez.
  const bestSingle = Math.min(...sd);
  if (sigmaOut > bestSingle * 1.001) return null;
  if (weights.some((w) => Math.abs(w) > 3)) return null;
  if (!Number.isFinite(scale) || scale <= 0) return null;

  return { weights, scale, sigma: sigmaOut };
}

function inverseVarianceWithDesignEffect(
  samples: CueSample[],
  s: number[],
  sd: number[],
): { weights: number[]; scale: number; sigma: number } {
  const n = s.length;
  const raw = sd.map((d) => 1 / (d * d));
  const total = raw.reduce((a, b) => a + b, 0);
  const weights = raw.map((w) => w / total);
  const scale = s.reduce((acc, si, i) => acc + si * weights[i]!, 0);

  // Ortalama köşegen-dışı korelasyon → Kish tasarım etkisi analogu.
  // Bağımsızlık varsayımının şişirdiği güveni geri alır.
  let corrSum = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      corrSum += correlation(samples[i]!.key, samples[j]!.key);
      pairs++;
    }
  }
  const rbar = pairs > 0 ? corrSum / pairs : 0;
  const variance = (1 / total) * (1 + rbar * (n - 1));

  return { weights, scale, sigma: Math.sqrt(Math.max(variance, 0)) };
}

function buildEstimate(
  samples: CueSample[],
  s: number[],
  sd: number[],
  weights: number[],
  scale: number,
  sigma: number,
  method: ScaleEstimate['method'],
): ScaleEstimate {
  const contributions: CueContribution[] = samples.map((sample, i) => ({
    key: sample.key,
    observed: sample.observed,
    scale: s[i]!,
    sigma: sd[i]!,
    weight: weights[i]!,
  }));

  return { scale, sigma, cv: sigma / scale, contributions, method };
}
