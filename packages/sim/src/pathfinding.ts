/**
 * Routing over the link graph, with *per-company* edge weights.
 *
 * D14's consequence: access charges differ per company, so every company sees
 * a different cost graph and the caches are keyed by company rather than
 * shared (architecture.md §6). The mitigation risks.md R5 names is that only
 * the *weights* are per company — the topology is one graph, built once — so
 * the multiplier applies to the cheap part.
 *
 * The other half of the problem, hierarchical search over the raw tile grid
 * for construction planning, is in `tilerouter.ts`.
 */

import { Heap } from './heap.ts';
import { AUTHORITY, PATH_LATENCY_TICKS } from './constants.ts';
import { FX_ONE, fxDiv } from './fixed.ts';
import { NONE, type AssetTable, type Graph } from './network.ts';


// ---------------------------------------------------------------- router

export interface RouteCosts {
  /** Q16.16 tiles per tick per way class. */
  speedLimit: Int32Array;
  /** Pence per tick of journey time. Turns time into money so a toll and a
   *  detour can be compared on one scale. */
  valueOfTime: number;
}

interface CachedRoute {
  links: Int32Array;
  /** Total cost in pence, for reporting the pay-versus-bypass comparison. */
  cost: number;
  charge: number;
  ticks: number;
  graphVersion: number;
  costVersion: number;
}

/**
 * Per-company routing over the link graph.
 *
 * The cache is keyed by company because the cost graph is (D14). It is
 * invalidated by three things, and the third is the one that is easy to
 * forget: a network edit, an ownership change, and an **access-charge
 * change**. A rival dropping their toll has to pull traffic back onto their
 * road, or the toll curve — the primary snowball damper — does not exist.
 */
export class Router {
  private caches: Map<number, CachedRoute>[] = [];
  private heap = new Heap(4096);
  private gScore: Float64Array;
  private cameFrom: Int32Array;
  private visitStamp: Int32Array;
  private stamp = 0;
  /** Bumped by the world on any ownership or charge change. */
  costVersion = 0;

  hits = 0;
  misses = 0;
  lastExpanded = 0;

  constructor(maxCompanies: number, maxNodes: number) {
    for (let i = 0; i < maxCompanies; i++) this.caches.push(new Map());
    this.gScore = new Float64Array(maxNodes);
    this.cameFrom = new Int32Array(maxNodes);
    this.visitStamp = new Int32Array(maxNodes);
  }

  invalidate(): void {
    this.costVersion++;
  }

  clear(): void {
    for (const c of this.caches) c.clear();
  }

  /** Cost in pence of one company traversing one link. */
  linkCost(
    g: Graph, assets: AssetTable, costs: RouteCosts, link: number, company: number,
  ): number {
    const speed = costs.speedLimit[g.linkCls[link]];
    const len = g.linkLength[link];
    // Ticks = length / speed, both Q16.16, so the ratio is plain.
    const ticks = speed > 0 ? fxDiv(len, speed) / FX_ONE : 1e9;
    let cost = ticks * costs.valueOfTime;

    const asset = g.linkAsset[link];
    if (asset !== NONE) {
      if (assets.owner[asset] !== company) {
        cost += g.linkCharge[link] * (g.linkChainLen[link] - 1);
      }
      const cond = assets.condition[asset];
      if (cond < 128) cost *= 1 + (128 - cond) / 255;
    } else if (g.linkCharge[link] > 0) {
      cost += g.linkCharge[link] * (g.linkChainLen[link] - 1);
    }

    // Congestion. Without it every vehicle picks the same road and the jam is
    // permanent rather than self-correcting; with it, traffic spreads and the
    // congestion overlay shows something that moves.
    const flow = g.linkFlowPrev[link];
    if (flow > 0) {
      const capacity = Math.max(1, (g.linkCellCount[link] * 4) | 0);
      cost *= 1 + Math.min(3, (flow / capacity) * 0.5);
    }
    return cost;
  }

  /**
   * Shortest route between two nodes for one company. Returns link ids.
   *
   * This is deliberately synchronous. The *appearance* of asynchrony — the
   * eight-tick latency in constants.ts — is imposed by the request queue in
   * world.ts, not by the search, precisely so a result can never be applied on
   * the tick it happened to finish on. See risks.md R2: a path applied on
   * arrival is the single most likely desync in the project, and the defence
   * is that the sim exposes no way to do it.
   */
  find(
    g: Graph, assets: AssetTable, costs: RouteCosts,
    fromNode: number, toNode: number, company: number,
    size: number,
  ): CachedRoute | null {
    const cache = this.caches[company] ?? this.caches[AUTHORITY];
    const key = fromNode * 1048576 + toNode;
    const hit = cache.get(key);
    if (hit && hit.graphVersion === g.version && hit.costVersion === this.costVersion) {
      this.hits++;
      return hit;
    }
    this.misses++;
    if (fromNode === toNode) {
      const empty: CachedRoute = {
        links: new Int32Array(0), cost: 0, charge: 0, ticks: 0,
        graphVersion: g.version, costVersion: this.costVersion,
      };
      cache.set(key, empty);
      return empty;
    }

    const stamp = ++this.stamp;
    const heap = this.heap;
    heap.clear();
    const goalTile = g.nodeTile[toNode];
    const gx = goalTile % size;
    const gy = (goalTile / size) | 0;
    // Admissible heuristic: straight-line tiles times the cheapest possible
    // per-tile cost, which is the fastest way class at zero toll.
    let bestSpeed = 1;
    for (let i = 0; i < costs.speedLimit.length; i++) {
      if (costs.speedLimit[i] > bestSpeed) bestSpeed = costs.speedLimit[i];
    }
    const perTile = (FX_ONE / bestSpeed) * costs.valueOfTime;
    const h = (node: number): number => {
      const t = g.nodeTile[node];
      const dx = (t % size) - gx;
      const dy = ((t / size) | 0) - gy;
      return Math.sqrt(dx * dx + dy * dy) * perTile;
    };

    this.gScore[fromNode] = 0;
    this.cameFrom[fromNode] = -1;
    this.visitStamp[fromNode] = stamp;
    heap.push(h(fromNode), fromNode);
    let expanded = 0;

    while (heap.size > 0) {
      const node = heap.pop();
      if (node === toNode) break;
      if (++expanded > 200000) break;
      const gn = this.gScore[node];
      const start = g.nodeOutStart[node];
      const end = g.nodeOutStart[node + 1];
      for (let i = start; i < end; i++) {
        const link = g.outLinks[i];
        const to = g.linkTo[link];
        const ng = gn + this.linkCost(g, assets, costs, link, company);
        if (this.visitStamp[to] === stamp && this.gScore[to] <= ng) continue;
        this.visitStamp[to] = stamp;
        this.gScore[to] = ng;
        this.cameFrom[to] = link;
        heap.push(ng + h(to), to);
      }
    }
    this.lastExpanded = expanded;

    if (this.visitStamp[toNode] !== stamp) {
      cache.set(key, {
        links: new Int32Array(0), cost: Infinity, charge: 0, ticks: 0,
        graphVersion: g.version, costVersion: this.costVersion,
      });
      return null;
    }

    const links: number[] = [];
    let cur = toNode;
    let charge = 0;
    let ticks = 0;
    let guard = 0;
    while (cur !== fromNode) {
      if (++guard > 100000) return null;
      const link = this.cameFrom[cur];
      if (link < 0) break;
      links.push(link);
      const asset = g.linkAsset[link];
      if (asset === NONE || assets.owner[asset] !== company) {
        charge += g.linkCharge[link] * (g.linkChainLen[link] - 1);
      }
      const speed = costs.speedLimit[g.linkCls[link]];
      ticks += speed > 0 ? fxDiv(g.linkLength[link], speed) / FX_ONE : 0;
      cur = g.linkFrom[link];
    }
    links.reverse();

    const route: CachedRoute = {
      links: Int32Array.from(links),
      cost: this.gScore[toNode],
      charge,
      ticks,
      graphVersion: g.version,
      costVersion: this.costVersion,
    };
    cache.set(key, route);
    // Caches are per company and unbounded would be a leak on a long game;
    // a route that has not been asked for in a whole graph version is dropped.
    if (cache.size > 20000) cache.clear();
    return route;
  }

  cacheSize(): number {
    let n = 0;
    for (const c of this.caches) n += c.size;
    return n;
  }
}

export { PATH_LATENCY_TICKS };
