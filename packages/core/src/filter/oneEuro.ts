/**
 * One Euro filter — Casiez, Roussel & Vogel (2012).
 *
 * Kesme frekansını hıza göre uyarlar: yavaş harekette çok yumuşatır
 * (titreme gider), hızlı harekette az yumuşatır (gecikme olmaz).
 *
 *     f_c = f_c_min + β·|ẋ̂|
 *
 * Kalman'a üstünlüğü ayarının kolay olması ve latency/jitter dengesini
 * insan algısına uygun tutması. Gözlük render'ında ham poz kullanılırsa
 * çerçeve titrer — bu filtre olmadan hiçbir şey production kalitesinde
 * görünmez (roadmap §9).
 */
export interface OneEuroOptions {
  /** Minimum kesme frekansı (Hz). Düşük = daha çok yumuşatma. */
  minCutoff: number;
  /** Hız katsayısı. Yüksek = hızlı harekette daha az gecikme. */
  beta: number;
  /** Türev kanalının kesme frekansı (Hz). */
  dCutoff: number;
}

const DEFAULTS: OneEuroOptions = { minCutoff: 1.0, beta: 0.05, dCutoff: 1.0 };

class LowPass {
  private y: number | null = null;
  private s: number | null = null;

  filter(x: number, alpha: number): number {
    this.s = this.s === null ? x : alpha * x + (1 - alpha) * this.s;
    this.y = x;
    return this.s;
  }

  get hasValue(): boolean {
    return this.s !== null;
  }

  reset(): void {
    this.y = null;
    this.s = null;
  }
}

function alphaFor(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuroFilter {
  private readonly opts: OneEuroOptions;
  private readonly x = new LowPass();
  private readonly dx = new LowPass();
  private lastTime: number | null = null;
  private lastRaw: number | null = null;

  constructor(options: Partial<OneEuroOptions> = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  /** @param timestampMs monoton artan zaman damgası (performance.now()). */
  filter(value: number, timestampMs: number): number {
    if (!Number.isFinite(value)) return value;

    const dt =
      this.lastTime === null || timestampMs <= this.lastTime
        ? 1 / 60 // ilk kare veya bozuk zaman damgası — makul varsayılan
        : (timestampMs - this.lastTime) / 1000;
    this.lastTime = timestampMs;

    const rawDerivative = this.lastRaw === null ? 0 : (value - this.lastRaw) / dt;
    this.lastRaw = value;

    const edx = this.dx.filter(rawDerivative, alphaFor(this.opts.dCutoff, dt));
    const cutoff = this.opts.minCutoff + this.opts.beta * Math.abs(edx);
    return this.x.filter(value, alphaFor(cutoff, dt));
  }

  reset(): void {
    this.x.reset();
    this.dx.reset();
    this.lastTime = null;
    this.lastRaw = null;
  }
}

/** Vec3 gibi çok kanallı büyüklükler için kanal başına bağımsız filtre. */
export class OneEuroVector {
  private readonly filters: OneEuroFilter[];

  constructor(channels: number, options: Partial<OneEuroOptions> = {}) {
    this.filters = Array.from({ length: channels }, () => new OneEuroFilter(options));
  }

  filter(values: number[], timestampMs: number): number[] {
    return values.map((v, i) => this.filters[i]!.filter(v, timestampMs));
  }

  reset(): void {
    for (const f of this.filters) f.reset();
  }
}
