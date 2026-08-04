import type { CueKey, CuePrior } from '../types.js';

/**
 * Antropometrik priorlar — ölçek füzyonunun tüm doğruluğu buradan gelir.
 *
 * ⚠ Bu sayılar literatür özetidir ve GÜN 5 KAPISINDA gerçek ölçümle
 * doğrulanana kadar TAHMİN muamelesi görmelidir. Özellikle bizygomatic
 * prior'ı, gerçek zygion değil yüz ovali proxy'si ölçüldüğü için
 * kalibrasyona en muhtaç olanıdır.
 *
 * Etik not (roadmap §6): cinsiyet/etnisite otomatik ÇIKARILMAZ. Kullanıcı
 * beyan ederse prior daraltılır; aksi halde cinsiyet-agnostik değer kullanılır.
 */
export const PRIORS: Record<CueKey, CuePrior> = {
  irisDiameterA: {
    key: 'irisDiameterA',
    label: 'İris çapı (A)',
    muMM: 11.7,
    sigmaMM: 0.5,
    source: 'Kornea/iris yatay çap normları — CV %4.3, en stabil ipucu',
  },
  irisDiameterB: {
    key: 'irisDiameterB',
    label: 'İris çapı (B)',
    muMM: 11.7,
    sigmaMM: 0.5,
    source: 'Aynı — A ile r≈0.95 korele, GLS bunu çift saymaz',
  },
  interpupillary: {
    key: 'interpupillary',
    label: 'Pupiller mesafe',
    muMM: 63.0,
    sigmaMM: 3.6,
    source: 'Yetişkin PD dağılımı, cinsiyet-agnostik — CV %5.7',
  },
  innerCanthal: {
    key: 'innerCanthal',
    label: 'İç kantal mesafe',
    muMM: 32.0,
    sigmaMM: 2.5,
    source: 'Endocanthion-endocanthion — CV %7.8, zayıf ama görece bağımsız',
  },
  bizygomatic: {
    key: 'bizygomatic',
    label: 'Yüz genişliği',
    muMM: 134.0,
    sigmaMM: 7.0,
    source: 'Yüz ovali yanal proxy — GERÇEK zygion DEĞİL, kalibrasyon şart',
  },
};

/**
 * Cinsiyet beyan edilirse daraltılmış priorlar. Yalnızca kullanıcı açıkça
 * seçerse uygulanır — otomatik tahmin yok.
 */
export const PRIORS_BY_SEX: Record<'male' | 'female', Partial<Record<CueKey, { muMM: number; sigmaMM: number }>>> = {
  male: {
    interpupillary: { muMM: 64.0, sigmaMM: 3.4 },
    bizygomatic: { muMM: 139.0, sigmaMM: 6.0 },
  },
  female: {
    interpupillary: { muMM: 61.7, sigmaMM: 3.6 },
    bizygomatic: { muMM: 130.0, sigmaMM: 5.0 },
  },
};

/**
 * İpuçları arası korelasyon.
 *
 * Bu matris füzyonun kalbi: iki iris ölçümü aynı büyüklüğün iki gözlemidir
 * (r≈0.95), naif ters-varyans ağırlıklandırma bunları bağımsız sanıp güveni
 * yapay olarak şişirir. GLS, korelasyonu hesaba katarak bunu engeller.
 */
const CORRELATION: Array<[CueKey, CueKey, number]> = [
  ['irisDiameterA', 'irisDiameterB', 0.95],
  ['irisDiameterA', 'interpupillary', 0.2],
  ['irisDiameterB', 'interpupillary', 0.2],
  ['irisDiameterA', 'innerCanthal', 0.15],
  ['irisDiameterB', 'innerCanthal', 0.15],
  ['irisDiameterA', 'bizygomatic', 0.2],
  ['irisDiameterB', 'bizygomatic', 0.2],
  ['interpupillary', 'innerCanthal', 0.6],
  ['interpupillary', 'bizygomatic', 0.5],
  ['innerCanthal', 'bizygomatic', 0.5],
];

const CORR_MAP = new Map<string, number>();
for (const [a, b, r] of CORRELATION) {
  CORR_MAP.set(`${a}|${b}`, r);
  CORR_MAP.set(`${b}|${a}`, r);
}

export function correlation(a: CueKey, b: CueKey): number {
  if (a === b) return 1;
  return CORR_MAP.get(`${a}|${b}`) ?? 0.3;
}

export function priorFor(key: CueKey, sex?: 'male' | 'female'): CuePrior {
  const base = PRIORS[key];
  const override = sex ? PRIORS_BY_SEX[sex][key] : undefined;
  return override ? { ...base, ...override } : base;
}
