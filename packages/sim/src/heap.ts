/**
 * Binary min-heap over typed arrays.
 *
 * Ties are broken by the item id, not by insertion order. That looks like
 * fussiness and is not: two nodes with equal f-cost are common in a grid
 * search, and a heap that resolves them by whichever happened to be pushed
 * first will resolve them differently once anything upstream changes its
 * iteration order. The path would still be *a* shortest path, just not the
 * same one on both machines — which is a desync that only shows up when two
 * players watch the same lorry take two different turnings.
 */
export class Heap {
  private keys: Float64Array;
  private items: Int32Array;
  size = 0;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.items = new Int32Array(capacity);
  }

  clear(): void {
    this.size = 0;
  }

  private grow(): void {
    const k = new Float64Array(this.keys.length * 2);
    const it = new Int32Array(this.items.length * 2);
    k.set(this.keys);
    it.set(this.items);
    this.keys = k;
    this.items = it;
  }

  push(key: number, item: number): void {
    if (this.size === this.keys.length) this.grow();
    let i = this.size++;
    this.keys[i] = key;
    this.items[i] = item;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(i, p)) {
        this.swap(i, p);
        i = p;
      } else break;
    }
  }

  /** Item of the minimum, or -1 when empty. */
  pop(): number {
    if (this.size === 0) return -1;
    const top = this.items[0];
    this.size--;
    if (this.size > 0) {
      this.keys[0] = this.keys[this.size];
      this.items[0] = this.items[this.size];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.size && this.less(l, m)) m = l;
        if (r < this.size && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  peekKey(): number {
    return this.size === 0 ? Infinity : this.keys[0];
  }

  private less(a: number, b: number): boolean {
    const ka = this.keys[a];
    const kb = this.keys[b];
    if (ka !== kb) return ka < kb;
    return this.items[a] < this.items[b];
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = k;
    const i = this.items[a];
    this.items[a] = this.items[b];
    this.items[b] = i;
  }
}
