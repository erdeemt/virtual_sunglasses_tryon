import { toHead, type HeadFrame } from './headFrame.js';

/** Kamera uzayında (mm) üçgen mesh. Üretimde: unprojectToMM çıktısı + tesselation. */
export interface MeshMM {
  /** xyz üçlüleri */
  positions: ArrayLike<number>;
  /** üçgen başına 3 indeks */
  indices: ArrayLike<number>;
}

/**
 * Baş uzayında yüz yüzeyi sorgusu: "(x, y) noktasında yüzey ne kadar önde?"
 *
 * Çözücünün tek geometrik ilkel işlemi bu — -z yönünde ışın atıp en öndeki
 * kesişimi bulmak. Kare başına ~1000 sorgu yapılıyor; 852 üçgenin hepsine
 * bakmak 850k test demek. Üçgenler xy düzleminde 4 mm'lik bir ızgaraya
 * dağıtılınca sorgu başına ~10 üçgen kalıyor.
 */
export class HeadSurface {
  private readonly vx: Float64Array;
  private readonly vy: Float64Array;
  private readonly vz: Float64Array;
  private readonly tri: Uint32Array;
  private readonly cellSize: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells: Uint32Array[];

  constructor(mesh: MeshMM, frame: HeadFrame, cellSize = 4) {
    const n = Math.floor(mesh.positions.length / 3);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.vz = new Float64Array(n);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < n; i++) {
      const q = toHead(frame, {
        x: mesh.positions[i * 3]!,
        y: mesh.positions[i * 3 + 1]!,
        z: mesh.positions[i * 3 + 2]!,
      });
      this.vx[i] = q.x;
      this.vy[i] = q.y;
      this.vz[i] = q.z;
      if (q.x < minX) minX = q.x;
      if (q.x > maxX) maxX = q.x;
      if (q.y < minY) minY = q.y;
      if (q.y > maxY) maxY = q.y;
    }

    const triCount = Math.floor(mesh.indices.length / 3);
    this.tri = new Uint32Array(triCount * 3);
    for (let i = 0; i < triCount * 3; i++) this.tri[i] = mesh.indices[i]!;

    this.cellSize = cellSize;
    this.minX = Number.isFinite(minX) ? minX : 0;
    this.minY = Number.isFinite(minY) ? minY : 0;
    this.cols = Math.max(1, Math.ceil((maxX - this.minX) / cellSize) + 1);
    this.rows = Math.max(1, Math.ceil((maxY - this.minY) / cellSize) + 1);

    const buckets: number[][] = Array.from({ length: this.cols * this.rows }, () => []);
    for (let t = 0; t < triCount; t++) {
      const a = this.tri[t * 3]!;
      const b = this.tri[t * 3 + 1]!;
      const c = this.tri[t * 3 + 2]!;
      if (a >= n || b >= n || c >= n) continue;
      const x0 = Math.min(this.vx[a]!, this.vx[b]!, this.vx[c]!);
      const x1 = Math.max(this.vx[a]!, this.vx[b]!, this.vx[c]!);
      const y0 = Math.min(this.vy[a]!, this.vy[b]!, this.vy[c]!);
      const y1 = Math.max(this.vy[a]!, this.vy[b]!, this.vy[c]!);
      const c0 = Math.floor((x0 - this.minX) / cellSize);
      const c1 = Math.floor((x1 - this.minX) / cellSize);
      const r0 = Math.floor((y0 - this.minY) / cellSize);
      const r1 = Math.floor((y1 - this.minY) / cellSize);
      for (let r = r0; r <= r1; r++) {
        for (let col = c0; col <= c1; col++) buckets[r * this.cols + col]!.push(t);
      }
    }
    this.cells = buckets.map((b) => Uint32Array.from(b));
  }

  /** (x, y) noktasında en öndeki yüzey z'si; mesh dışındaysa null. */
  zAt(x: number, y: number): number | null {
    const col = Math.floor((x - this.minX) / this.cellSize);
    const row = Math.floor((y - this.minY) / this.cellSize);
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return null;
    const bucket = this.cells[row * this.cols + col];
    if (!bucket) return null;

    let best = -Infinity;
    for (let k = 0; k < bucket.length; k++) {
      const t = bucket[k]!;
      const a = this.tri[t * 3]!;
      const b = this.tri[t * 3 + 1]!;
      const c = this.tri[t * 3 + 2]!;
      const x0 = this.vx[a]!;
      const y0 = this.vy[a]!;
      const x1 = this.vx[b]!;
      const y1 = this.vy[b]!;
      const x2 = this.vx[c]!;
      const y2 = this.vy[c]!;

      const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (Math.abs(d) < 1e-12) continue; // xy'de kenardan görünen üçgen
      const l0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / d;
      const l1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / d;
      const l2 = 1 - l0 - l1;
      const eps = -1e-9;
      if (l0 < eps || l1 < eps || l2 < eps) continue;

      const z = l0 * this.vz[a]! + l1 * this.vz[b]! + l2 * this.vz[c]!;
      if (z > best) best = z;
    }
    return Number.isFinite(best) ? best : null;
  }
}
