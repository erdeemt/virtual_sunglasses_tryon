import { describe, expect, it } from 'vitest';
import { fuseScale } from './scale.js';
import { invert, median, robustSigma } from './linalg.js';
import { PRIORS } from './anthropometry.js';
import type { CueSample } from '../types.js';

/**
 * Ölçek füzyonunun doğruluğu ürünün var olup olmayacağını belirliyor
 * (roadmap Gün 5 kapısı). Bu testler matematiğin kendisini doğrular —
 * priorların gerçekliğe uygunluğu ayrı bir iş, o gerçek denekle ölçülür.
 */

/** Verilen gerçek mm ölçülerini, bilinen bir ölçekle gözleme çevirir. */
function observe(trueMM: Partial<Record<CueSample['key'], number>>, scale: number): CueSample[] {
  return Object.entries(trueMM).map(([key, mm]) => ({
    key: key as CueSample['key'],
    observed: mm! / scale,
  }));
}

describe('invert', () => {
  it('birim matrisi kendine çevirir', () => {
    const I = [
      [1, 0],
      [0, 1],
    ];
    expect(invert(I)).toEqual(I);
  });

  it('bilinen tersi doğru hesaplar', () => {
    const m = [
      [4, 7],
      [2, 6],
    ];
    const inv = invert(m)!;
    expect(inv[0]![0]!).toBeCloseTo(0.6, 10);
    expect(inv[0]![1]!).toBeCloseTo(-0.7, 10);
    expect(inv[1]![0]!).toBeCloseTo(-0.2, 10);
    expect(inv[1]![1]!).toBeCloseTo(0.4, 10);
  });

  it('tekil matriste null döner', () => {
    expect(
      invert([
        [1, 2],
        [2, 4],
      ]),
    ).toBeNull();
  });
});

describe('fuseScale', () => {
  it('ortalama bir yüzde ölçeği neredeyse tam bulur', () => {
    // Tam olarak prior ortalamalarına sahip bir denek: füzyon ölçeği
    // hatasız bulmalı, çünkü her ipucu aynı cevabı veriyor.
    const scale = 250; // mm / FaceUnit
    const cues = observe(
      {
        irisDiameterA: PRIORS.irisDiameterA.muMM,
        irisDiameterB: PRIORS.irisDiameterB.muMM,
        interpupillary: PRIORS.interpupillary.muMM,
        innerCanthal: PRIORS.innerCanthal.muMM,
        bizygomatic: PRIORS.bizygomatic.muMM,
      },
      scale,
    );

    const result = fuseScale(cues)!;
    expect(result).not.toBeNull();
    expect(result.scale).toBeCloseTo(scale, 6);
  });

  it('ağırlıklar 1 e toplanır', () => {
    const cues = observe(
      { irisDiameterA: 11.9, irisDiameterB: 11.8, interpupillary: 66, innerCanthal: 33, bizygomatic: 141 },
      250,
    );
    const result = fuseScale(cues)!;
    const sum = result.contributions.reduce((a, c) => a + c.weight, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('irisi PD den daha çok ağırlıklandırır (CV daha düşük)', () => {
    const cues = observe({ irisDiameterA: 11.7, interpupillary: 63 }, 250);
    const result = fuseScale(cues)!;
    const iris = result.contributions.find((c) => c.key === 'irisDiameterA')!;
    const pd = result.contributions.find((c) => c.key === 'interpupillary')!;
    expect(iris.weight).toBeGreaterThan(pd.weight);
  });

  it('KRİTİK: korele iris çiftini iki bağımsız ölçüm saymaz', () => {
    // Naif ters-varyans ağırlıklandırma iki iris ölçümünü bağımsız sayar ve
    // belirsizliği √2 kat düşük gösterir. GLS, r=0.95 korelasyonu bildiği
    // için neredeyse hiç kazanç vermemeli.
    const single = fuseScale(observe({ irisDiameterA: 11.7 }, 250))!;
    const pair = fuseScale(observe({ irisDiameterA: 11.7, irisDiameterB: 11.7 }, 250))!;

    const naiveGain = 1 / Math.SQRT2; // bağımsız olsalardı beklenen düşüş
    const actualGain = pair.sigma / single.sigma;

    expect(actualGain).toBeGreaterThan(0.95); // yani kazanç ~yok
    expect(actualGain).toBeGreaterThan(naiveGain * 1.3); // naif tahminden belirgin uzak
  });

  it('bağımsız ipucu eklemek belirsizliği gerçekten düşürür', () => {
    const irisOnly = fuseScale(observe({ irisDiameterA: 11.7 }, 250))!;
    const withPD = fuseScale(observe({ irisDiameterA: 11.7, interpupillary: 63 }, 250))!;
    expect(withPD.sigma).toBeLessThan(irisOnly.sigma);
  });

  it('füzyon en iyi tek ipucundan daha kötü olamaz', () => {
    const cues = observe(
      { irisDiameterA: 11.7, irisDiameterB: 11.7, interpupillary: 63, innerCanthal: 32, bizygomatic: 134 },
      250,
    );
    const fused = fuseScale(cues)!;
    const bestSingle = Math.min(
      ...cues.map((c) => {
        const p = PRIORS[c.key];
        return p.sigmaMM / c.observed;
      }),
    );
    expect(fused.sigma).toBeLessThanOrEqual(bestSingle * 1.001);
  });

  it('beklenen doğruluk %4 ün altında (ürün eşiği)', () => {
    const cues = observe(
      { irisDiameterA: 11.7, irisDiameterB: 11.7, interpupillary: 63, innerCanthal: 32, bizygomatic: 134 },
      250,
    );
    const result = fuseScale(cues)!;
    // Gün 5 kapısı: %4 üstündeyse kart kalibrasyonu zorunlu hale gelir.
    expect(result.cv).toBeLessThan(0.04);
  });

  it('gerçek bir deneğin PD sini prior ortalamasından sapsa da makul bulur', () => {
    // Geniş yüzlü bir denek: gerçek PD 70 mm, iris 12.0 mm.
    // Ölçek yalnızca priorlardan tahmin edildiği için hata olacak —
    // amacımız hatanın makul sınırda kalması.
    const trueScale = 250;
    const cues = observe(
      { irisDiameterA: 12.0, irisDiameterB: 12.0, interpupillary: 70, innerCanthal: 34, bizygomatic: 145 },
      trueScale,
    );
    const result = fuseScale(cues)!;
    const estimatedPD = (70 / trueScale) * result.scale;
    const errorPct = Math.abs(estimatedPD - 70) / 70;
    expect(errorPct).toBeLessThan(0.08);
  });

  it('cinsiyet beyanı erkek denekte hatayı azaltır', () => {
    const trueScale = 250;
    const trueMM = { irisDiameterA: 11.9, interpupillary: 67, bizygomatic: 142 };
    const cues = observe(trueMM, trueScale);

    const agnostic = fuseScale(cues)!;
    const male = fuseScale(cues, 'male')!;

    const err = (r: { scale: number }) => Math.abs((67 / trueScale) * r.scale - 67);
    expect(err(male)).toBeLessThan(err(agnostic));
  });

  it('boş ve bozuk girdide çöker değil null döner', () => {
    expect(fuseScale([])).toBeNull();
    expect(fuseScale([{ key: 'interpupillary', observed: 0 }])).toBeNull();
    expect(fuseScale([{ key: 'interpupillary', observed: NaN }])).toBeNull();
  });
});

describe('sağlam istatistik', () => {
  it('medyan aykırı değerden etkilenmez', () => {
    expect(median([62, 63, 64, 63, 900])).toBe(63);
  });

  it('robustSigma aykırı değeri yutar', () => {
    const clean = robustSigma([62, 63, 64, 63, 62]);
    const dirty = robustSigma([62, 63, 64, 63, 62, 900]);
    expect(dirty).toBeLessThan(clean * 3);
  });
});
