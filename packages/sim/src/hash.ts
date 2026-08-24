/**
 * Rolling state hash. Compared every 256 ticks across platforms; a mismatch is
 * a desync and the tick number localises it. FNV-1a over the raw bytes of the
 * SoA arrays — order matters and is fixed by the caller.
 */

const FNV_PRIME = 0x01000193;
const FNV_OFFSET = 0x811c9dc5;

export class Hasher {
  private h = FNV_OFFSET;

  reset(): this {
    this.h = FNV_OFFSET;
    return this;
  }

  int(v: number): this {
    let h = this.h;
    const n = v | 0;
    h = Math.imul(h ^ (n & 0xff), FNV_PRIME);
    h = Math.imul(h ^ ((n >>> 8) & 0xff), FNV_PRIME);
    h = Math.imul(h ^ ((n >>> 16) & 0xff), FNV_PRIME);
    h = Math.imul(h ^ ((n >>> 24) & 0xff), FNV_PRIME);
    this.h = h;
    return this;
  }

  /** Money and populations exceed int32, so they are hashed as two halves.
   *  Values must be integral — a fractional input would hash differently on a
   *  platform that rounded the division differently. */
  big(v: number): this {
    const lo = v % 0x100000000;
    const hi = Math.floor(v / 0x100000000);
    return this.int(lo).int(hi);
  }

  array(a: { length: number; [i: number]: number }, count?: number): this {
    const n = count === undefined ? a.length : count;
    for (let i = 0; i < n; i++) this.int(a[i] | 0);
    return this;
  }

  value(): number {
    return this.h >>> 0;
  }

  hex(): string {
    return (this.h >>> 0).toString(16).padStart(8, '0');
  }
}

export function hashInts(values: readonly number[]): number {
  const h = new Hasher();
  for (const v of values) h.int(v);
  return h.value();
}
