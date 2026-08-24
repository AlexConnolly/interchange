/**
 * xoshiro128** — determinism rule 2. The state lives in the simulation and is
 * saved with it, so a reload resumes the identical stream.
 */

export class Rng {
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;

  constructor(seed: number) {
    this.seed(seed);
  }

  seed(seed: number): void {
    // splitmix32 to spread a single integer across the four words. Seeding all
    // four from the same value gives a stream that takes thousands of draws to
    // decorrelate, which shows up as visibly patterned terrain.
    let z = seed | 0;
    const next = (): number => {
      z = (z + 0x9e3779b9) | 0;
      let t = z;
      t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
      t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
      return (t ^ (t >>> 15)) | 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  getState(): Int32Array {
    return Int32Array.of(this.s0, this.s1, this.s2, this.s3);
  }

  setState(s: Int32Array | number[]): void {
    this.s0 = s[0] | 0;
    this.s1 = s[1] | 0;
    this.s2 = s[2] | 0;
    this.s3 = s[3] | 0;
  }

  /** Raw 32 bits, as an unsigned integer. */
  next(): number {
    const s1 = this.s1;
    const r = (Math.imul(rotl(Math.imul(s1, 5), 7), 9) | 0) >>> 0;
    const t = (s1 << 9) | 0;
    this.s2 ^= this.s0;
    this.s3 ^= s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return r;
  }

  /** Uniform in [0, n). Rejection-sampled, so no modulo bias. */
  int(n: number): number {
    if (n <= 1) return 0;
    const limit = (0x100000000 - (0x100000000 % n)) >>> 0;
    let v = this.next();
    // Bounded in practice: the rejection window is at most n/2^32 of the range.
    for (let guard = 0; v >= limit && guard < 64; guard++) v = this.next();
    return v % n;
  }

  /** Uniform in [lo, hi] inclusive. */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  /** Q16.16 in [0, 1). */
  fx(): number {
    return (this.next() >>> 16) | 0;
  }

  /** True with probability num/den. */
  chance(num: number, den: number): boolean {
    return this.int(den) < num;
  }

  /** Fisher-Yates, in place. Deterministic given the same input order. */
  shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  pick<T>(a: readonly T[]): T {
    return a[this.int(a.length)];
  }

  /** A fresh generator derived from this one, for a subsystem that must not
   *  perturb the main stream's alignment when its call count changes. */
  fork(): Rng {
    return new Rng(this.next() | 0);
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) | 0;
}
