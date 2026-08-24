/**
 * Hierarchical A* over the tile grid. Phase 0, spike 3.
 *
 * A million tiles is too many to search flat, so the region is cut into
 * clusters, the clusters are joined at *entrances*, and a query becomes a
 * small search over entrances followed by a walk down precomputed
 * within-cluster paths. The abstract graph for a 1024-tile region is a few
 * thousand nodes rather than a million, and the refinement is a memcpy.
 *
 * The first attempt at this refined each abstract segment with a fresh local
 * A*, which sounds harmless and is not: the refinement searches were most of
 * the query time, and any one of them failing dropped the whole thing to a
 * full-region search — median 2.7 ms with a 58 ms tail. Storing the path
 * alongside the distance at preparation time removes both problems, because a
 * segment that has an abstract edge is by construction a segment we have
 * already walked.
 *
 * Preparation is lazy and driven by the abstract search itself, so a query
 * across a corner of the map never touches the rest of it.
 */

import { Heap } from './heap.ts';
import { DIR_DX, DIR_DY } from './constants.ts';
import { SEA_LEVEL, type Terrain } from './terrain.ts';

/** Side of a cluster, in tiles. Sixteen keeps the local Dijkstra under 256
 *  cells while leaving the abstract graph small enough to search flat. */
export const CLUSTER = 16;

/**
 * Cost of laying one tile of way. Steep ground and water are expensive rather
 * than forbidden, which is what design.md means by terrain being a cost and
 * not a paint tool — a river crossing is a decision about money, not a wall.
 */
export function tileBuildCost(t: Terrain, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= t.size || y >= t.size) return Infinity;
  const i = y * t.size + x;
  const h = t.height[i];
  if (h <= SEA_LEVEL) return 70;
  const s = slope4(t, x, y);
  // Squared, so the router prefers two gentle tiles to one steep one and
  // alignments find valleys without being told to.
  return 10 + s * s * 0.25;
}

function slope4(t: Terrain, x: number, y: number): number {
  const h = t.height[y * t.size + x];
  let m = 0;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d];
    const ny = y + DIR_DY[d];
    const nh = nx < 0 || ny < 0 || nx >= t.size || ny >= t.size ? h : t.height[ny * t.size + nx];
    const s = nh > h ? nh - h : h - nh;
    if (s > m) m = s;
  }
  return m;
}

interface Cluster {
  /** Tile index of each entrance on this cluster's border. */
  entrances: number[];
  /** entrances^2 cost matrix, Infinity where unreachable within the cluster. */
  dist: Float64Array;
  /** entrances^2 paths, each a tile list from i to j inclusive. */
  paths: (Int32Array | null)[];
  prepared: boolean;
}

export class TileRouter {
  private readonly t: Terrain;
  private readonly size: number;
  private readonly cols: number;
  private readonly clusters: Cluster[] = [];

  /** Abstract nodes, parallel arrays. */
  private absTile: number[] = [];
  private absCluster: number[] = [];
  private absOf = new Map<number, number>();
  private absTo: number[][] = [];
  private absCost: number[][] = [];
  /** Which (cluster, i, j) an abstract edge came from, so refinement can find
   *  the stored path instead of searching for it again. */
  private absVia: number[][] = [];

  // Scratch for the local Dijkstra, in cluster-local coordinates.
  private localCost = new Float64Array(CLUSTER * CLUSTER);
  private localFrom = new Int32Array(CLUSTER * CLUSTER);
  private localStamp = new Int32Array(CLUSTER * CLUSTER);
  private localHeap = new Heap(CLUSTER * CLUSTER * 2);
  private stamp = 0;

  // Scratch for the abstract search.
  private absG: Float64Array = new Float64Array(1024);
  private absFrom = new Int32Array(1024);
  private absEdge = new Int32Array(1024);
  private absStamp = new Int32Array(1024);
  private absHeap = new Heap(4096);
  private absSearchStamp = 0;

  lastExpanded = 0;
  lastPrepared = 0;

  constructor(t: Terrain) {
    this.t = t;
    this.size = t.size;
    this.cols = Math.ceil(t.size / CLUSTER);
    for (let i = 0; i < this.cols * this.cols; i++) {
      this.clusters.push({ entrances: [], dist: new Float64Array(0), paths: [], prepared: false });
    }
  }

  private passable(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  private node(tile: number): number {
    const found = this.absOf.get(tile);
    if (found !== undefined) return found;
    const id = this.absTile.length;
    this.absTile.push(tile);
    this.absCluster.push(
      (((tile / this.size) | 0) / CLUSTER | 0) * this.cols + ((tile % this.size) / CLUSTER | 0),
    );
    this.absTo.push([]);
    this.absCost.push([]);
    this.absVia.push([]);
    this.absOf.set(tile, id);
    if (id >= this.absG.length) {
      const n = this.absG.length * 2;
      const g = new Float64Array(n);
      const f = new Int32Array(n);
      const e = new Int32Array(n);
      const s = new Int32Array(n);
      g.set(this.absG);
      f.set(this.absFrom);
      e.set(this.absEdge);
      s.set(this.absStamp);
      this.absG = g;
      this.absFrom = f;
      this.absEdge = e;
      this.absStamp = s;
    }
    return id;
  }

  private edge(a: number, b: number, cost: number, via: number): void {
    const to = this.absTo[a];
    for (let i = 0; i < to.length; i++) {
      if (to[i] === b) {
        if (cost < this.absCost[a][i]) {
          this.absCost[a][i] = cost;
          this.absVia[a][i] = via;
        }
        return;
      }
    }
    to.push(b);
    this.absCost[a].push(cost);
    this.absVia[a].push(via);
  }

  /**
   * Find a cluster's entrances and the cost and path between each pair.
   *
   * An entrance is the middle of each maximal run of mutually passable tiles
   * along a shared border. One per *run* rather than one per border is what
   * stops a cliff halfway along an edge being routed through; the middle
   * rather than every tile is what keeps the abstract graph small.
   */
  private prepare(ci: number): void {
    const cluster = this.clusters[ci];
    if (cluster.prepared) return;
    cluster.prepared = true;
    this.lastPrepared++;

    const cx = ci % this.cols;
    const cy = (ci / this.cols) | 0;
    const x0 = cx * CLUSTER;
    const y0 = cy * CLUSTER;
    const x1 = Math.min(this.size, x0 + CLUSTER);
    const y1 = Math.min(this.size, y0 + CLUSTER);

    const addRuns = (
      count: number,
      inner: (k: number) => number,
      outer: (k: number) => number,
    ): void => {
      let run = -1;
      for (let k = 0; k <= count; k++) {
        const open = k < count && Number.isFinite(this.costOf(inner(k))) && Number.isFinite(this.costOf(outer(k)));
        if (open && run < 0) run = k;
        if (!open && run >= 0) {
          const mid = (run + k - 1) >> 1;
          const it = inner(mid);
          const ot = outer(mid);
          const a = this.node(it);
          const b = this.node(ot);
          const cost = (this.costOf(it) + this.costOf(ot)) / 2;
          // A border step is its own tiny path, marked with via = -1.
          this.edge(a, b, cost, -1);
          this.edge(b, a, cost, -1);
          if (!cluster.entrances.includes(it)) cluster.entrances.push(it);
          run = -1;
        }
      }
    };

    const idx = (x: number, y: number): number => y * this.size + x;
    if (y0 > 0) addRuns(x1 - x0, (k) => idx(x0 + k, y0), (k) => idx(x0 + k, y0 - 1));
    if (x0 > 0) addRuns(y1 - y0, (k) => idx(x0, y0 + k), (k) => idx(x0 - 1, y0 + k));
    if (y1 < this.size) addRuns(x1 - x0, (k) => idx(x0 + k, y1 - 1), (k) => idx(x0 + k, y1));
    if (x1 < this.size) addRuns(y1 - y0, (k) => idx(x1 - 1, y0 + k), (k) => idx(x1, y0 + k));

    // Entrances in a fixed order, so the matrix indices mean the same thing on
    // every machine.
    cluster.entrances.sort((a, b) => a - b);
    const n = cluster.entrances.length;
    cluster.dist = new Float64Array(n * n).fill(Infinity);
    cluster.paths = new Array(n * n).fill(null);

    for (let i = 0; i < n; i++) {
      this.dijkstraWithin(cluster.entrances[i], x0, y0, x1, y1);
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const target = cluster.entrances[j];
        const lx = (target % this.size) - x0;
        const ly = ((target / this.size) | 0) - y0;
        const li = ly * CLUSTER + lx;
        if (this.localStamp[li] !== this.stamp) continue;
        cluster.dist[i * n + j] = this.localCost[li];
        cluster.paths[i * n + j] = this.tracebackLocal(li, x0, y0);
        this.edge(
          this.node(cluster.entrances[i]),
          this.node(cluster.entrances[j]),
          this.localCost[li],
          ci * 4096 + i * 64 + j,
        );
      }
    }
  }

  private costOf(tile: number): number {
    return tileBuildCost(this.t, tile % this.size, (tile / this.size) | 0);
  }

  /**
   * Dijkstra confined to one cluster, in cluster-local coordinates.
   *
   * Local coordinates rather than tile indices is the whole optimisation: the
   * visited set is a 256-entry typed array with a stamp instead of a Map, so
   * a cluster search is a few microseconds rather than a few hundred.
   */
  private dijkstraWithin(from: number, x0: number, y0: number, x1: number, y1: number): void {
    const stamp = ++this.stamp;
    const heap = this.localHeap;
    heap.clear();
    const fx = (from % this.size) - x0;
    const fy = ((from / this.size) | 0) - y0;
    const start = fy * CLUSTER + fx;
    this.localCost[start] = 0;
    this.localFrom[start] = -1;
    this.localStamp[start] = stamp;
    heap.push(0, start);

    while (heap.size > 0) {
      const li = heap.pop();
      const lx = li % CLUSTER;
      const ly = (li / CLUSTER) | 0;
      const g = this.localCost[li];
      for (let d = 0; d < 4; d++) {
        const nx = lx + DIR_DX[d];
        const ny = ly + DIR_DY[d];
        if (nx < 0 || ny < 0 || nx + x0 >= x1 || ny + y0 >= y1) continue;
        const c = tileBuildCost(this.t, nx + x0, ny + y0);
        if (!Number.isFinite(c)) continue;
        const ni = ny * CLUSTER + nx;
        const ng = g + c;
        if (this.localStamp[ni] === stamp && this.localCost[ni] <= ng) continue;
        this.localStamp[ni] = stamp;
        this.localCost[ni] = ng;
        this.localFrom[ni] = li;
        heap.push(ng, ni);
      }
    }
  }

  private tracebackLocal(li: number, x0: number, y0: number): Int32Array {
    const out: number[] = [];
    let cur = li;
    let guard = 0;
    while (cur >= 0 && guard++ < CLUSTER * CLUSTER + 4) {
      out.push((((cur / CLUSTER) | 0) + y0) * this.size + (cur % CLUSTER) + x0);
      cur = this.localFrom[cur];
    }
    out.reverse();
    return Int32Array.from(out);
  }

  /** Splice a loose tile into the abstract graph via its own cluster. */
  private splice(tile: number): number {
    const x = tile % this.size;
    const y = (tile / this.size) | 0;
    const ci = ((y / CLUSTER) | 0) * this.cols + ((x / CLUSTER) | 0);
    this.prepare(ci);
    const cluster = this.clusters[ci];
    const node = this.node(tile);
    const x0 = ((x / CLUSTER) | 0) * CLUSTER;
    const y0 = ((y / CLUSTER) | 0) * CLUSTER;
    const x1 = Math.min(this.size, x0 + CLUSTER);
    const y1 = Math.min(this.size, y0 + CLUSTER);
    this.dijkstraWithin(tile, x0, y0, x1, y1);
    let linked = 0;
    for (const ent of cluster.entrances) {
      const lx = (ent % this.size) - x0;
      const ly = ((ent / this.size) | 0) - y0;
      const li = ly * CLUSTER + lx;
      if (this.localStamp[li] !== this.stamp) continue;
      const path = this.tracebackLocal(li, x0, y0);
      const e = this.node(ent);
      // Stored on the edge itself rather than in the cluster matrix, because a
      // spliced endpoint is not an entrance and has no row in it.
      this.edgeWithPath(node, e, this.localCost[li], path);
      this.edgeWithPath(e, node, this.localCost[li], reverse(path));
      linked++;
    }
    return linked > 0 ? node : -1;
  }

  /** Ad-hoc edges from spliced endpoints keep their path in a side table. */
  private adhoc = new Map<number, Int32Array>();

  private edgeWithPath(a: number, b: number, cost: number, path: Int32Array): void {
    const key = a * 1048576 + b;
    this.adhoc.set(key, path);
    this.edge(a, b, cost, -2);
  }

  /**
   * A route between two tiles, as tile indices, or null.
   *
   * Clusters are prepared as the abstract search reaches them, so a query
   * across one corner of the region never touches the other three.
   */
  route(fromTile: number, toTile: number): Int32Array | null {
    this.lastExpanded = 0;
    this.lastPrepared = 0;
    if (fromTile === toTile) return Int32Array.of(fromTile);
    if (!Number.isFinite(this.costOf(fromTile)) || !Number.isFinite(this.costOf(toTile))) return null;

    const goal = this.splice(toTile);
    const start = this.splice(fromTile);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return Int32Array.of(fromTile, toTile);

    const gx = toTile % this.size;
    const gy = (toTile / this.size) | 0;
    // Admissible: ten is the cost of the cheapest possible tile, so the
    // straight-line tile count times ten can never overestimate.
    const h = (n: number): number => {
      const t = this.absTile[n];
      const dx = (t % this.size) - gx;
      const dy = ((t / this.size) | 0) - gy;
      // Ten is the cheapest a tile can be, so Manhattan distance times ten
      // never overestimates. The brackets matter: without them the heuristic
      // weights one axis ten times the other and the search wanders.
      return ((dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy)) * 10;
    };

    const stamp = ++this.absSearchStamp;
    const heap = this.absHeap;
    heap.clear();
    this.absG[start] = 0;
    this.absFrom[start] = -1;
    this.absEdge[start] = -1;
    this.absStamp[start] = stamp;
    heap.push(h(start), start);

    while (heap.size > 0) {
      const n = heap.pop();
      if (n === goal) return this.refine(start, goal, stamp);
      if (++this.lastExpanded > 40000) break;
      // Reaching a node is what makes its cluster worth preparing. Preparing
      // a box around the query instead would either do too much work or leave
      // a hole exactly where the route needed to go around a headland.
      this.prepare(this.absCluster[n]);
      const to = this.absTo[n];
      const cost = this.absCost[n];
      const gn = this.absG[n];
      for (let i = 0; i < to.length; i++) {
        const m = to[i];
        const ng = gn + cost[i];
        if (this.absStamp[m] === stamp && this.absG[m] <= ng) continue;
        this.absStamp[m] = stamp;
        this.absG[m] = ng;
        this.absFrom[m] = n;
        this.absEdge[m] = i;
        heap.push(ng + h(m), m);
      }
    }
    return null;
  }

  /** Walk the abstract path back, concatenating the stored tile paths. */
  private refine(start: number, goal: number, stamp: number): Int32Array {
    const chain: { from: number; to: number; edge: number }[] = [];
    let cur = goal;
    let guard = 0;
    while (cur !== start && guard++ < 100000) {
      const prev = this.absFrom[cur];
      if (prev < 0) break;
      chain.push({ from: prev, to: cur, edge: this.absEdge[cur] });
      cur = prev;
    }
    chain.reverse();
    void stamp;

    const out: number[] = [this.absTile[start]];
    for (const step of chain) {
      const via = this.absVia[step.from][step.edge];
      if (via === -1) {
        // A border step: one tile to its neighbour.
        out.push(this.absTile[step.to]);
      } else if (via === -2) {
        const path = this.adhoc.get(step.from * 1048576 + step.to);
        if (path) for (let i = 1; i < path.length; i++) out.push(path[i]);
        else out.push(this.absTile[step.to]);
      } else {
        const ci = (via / 4096) | 0;
        const i = ((via % 4096) / 64) | 0;
        const j = via % 64;
        const path = this.clusters[ci].paths[i * this.clusters[ci].entrances.length + j];
        if (path) for (let k = 1; k < path.length; k++) out.push(path[k]);
        else out.push(this.absTile[step.to]);
      }
    }
    return Int32Array.from(out);
  }

  /** Cost of a route, for the construction estimate the player is shown. */
  routeCost(path: Int32Array): number {
    let total = 0;
    for (let i = 0; i < path.length; i++) total += this.costOf(path[i]);
    return total;
  }

  get abstractNodes(): number {
    return this.absTile.length;
  }

  get preparedClusters(): number {
    let n = 0;
    for (const c of this.clusters) if (c.prepared) n++;
    return n;
  }
}

function reverse(a: Int32Array): Int32Array {
  const out = new Int32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[a.length - 1 - i];
  return out;
}
