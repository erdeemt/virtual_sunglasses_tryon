/** Küçük yoğun matris işlemleri (n ≤ 5). Bağımlılık eklemeye değmez. */

/** Kısmi pivotlamalı Gauss-Jordan tersleme. Tekil matriste null döner. */
export function invert(m: number[][]): number[][] | null {
  const n = m.length;
  // [m | I]
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    }
    const pv = a[pivot]![col]!;
    if (Math.abs(pv) < 1e-12) return null;

    if (pivot !== col) {
      const t = a[pivot]!;
      a[pivot] = a[col]!;
      a[col] = t;
    }

    const row = a[col]!;
    for (let j = 0; j < 2 * n; j++) row[j] = row[j]! / pv;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r]![col]!;
      if (f === 0) continue;
      const target = a[r]!;
      for (let j = 0; j < 2 * n; j++) target[j] = target[j]! - f * row[j]!;
    }
  }

  return a.map((row) => row.slice(n));
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((p, q) => p - q);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Medyan mutlak sapmadan sağlam standart sapma.
 * Aykırı karelere (yanlış tespit, göz kırpma) duyarsızdır.
 */
export function robustSigma(values: number[]): number {
  if (values.length < 2) return 0;
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med)));
  return 1.4826 * mad;
}
