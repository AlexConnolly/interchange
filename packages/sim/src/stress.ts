/**
 * A developed region, on demand.
 *
 * Phase 0 spike 2 asks for 25,000 vehicles at 60 fps, and a freshly generated
 * Act I region cannot hold them: the authority's network is a few thousand
 * tiles, which is six thousand traffic cells, and a vehicle occupies one. So
 * the honest test is not "25,000 vehicles on the starting map" — it is
 * "25,000 vehicles on the map a player has spent four acts building", and this
 * builds that.
 *
 * Also used by the balance harness, which wants a late-game network without
 * simulating an evening to get one.
 */

import { AUTHORITY, DIR_BIT, DIR_OPPOSITE, MAX_ROUTES, Mode } from './constants.ts';
import { NONE } from './network.ts';
import { SEA_LEVEL } from './terrain.ts';
import type { World } from './world.ts';

export interface StressOptions {
  /** Tiles between grid lines. Eight is a dense industrial region. */
  spacing: number;
  /** How much of the region to cover, as a fraction from the centre. */
  extent: number;
  /** Way class id to lay. */
  wayId: string;
  /** Vehicles to spawn, spread over generated services. */
  vehicles: number;
  vehicleId: string;
  /** Companies to spread them across, so the per-company routing cost is real. */
  companies: number;
}

export const DEFAULT_STRESS: StressOptions = {
  spacing: 8,
  extent: 0.62,
  wayId: 'tarmac',
  vehicles: 25000,
  vehicleId: 'lorry-diesel',
  companies: 4,
};

export interface StressReport {
  roadTiles: number;
  cells: number;
  nodes: number;
  links: number;
  services: number;
  vehicles: number;
  ms: number;
}

/**
 * Lay a grid over the buildable middle of the region, then run services along
 * it. A grid rather than something organic on purpose: the point is to load
 * the traffic model and the renderer, and a grid produces the worst case for
 * junction arbitration — a four-arm conflict at every intersection.
 */
export function buildStressRegion(w: World, opts: Partial<StressOptions> = {}): StressReport {
  const o = { ...DEFAULT_STRESS, ...opts };
  const t0 = Date.now();
  const layer = w.layers[Mode.Road];
  const cls = w.content.wayIndex.get(o.wayId) ?? 0;
  const way = w.content.ways[cls];
  const size = w.config.size;
  const lo = Math.floor((size * (1 - o.extent)) / 2);
  const hi = size - lo;

  const asset = w.assets.alloc(Mode.Road, cls, AUTHORITY, way.publicCharge, w.tick);
  let laid = 0;

  const put = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= size || y >= size) return false;
    const tile = y * size + x;
    if (w.terrain.height[tile] <= SEA_LEVEL) return false;
    if (layer.cls[tile] === 255) {
      layer.cls[tile] = cls;
      layer.asset[tile] = asset;
      layer.tileCount++;
      laid++;
    }
    return true;
  };
  const join = (ax: number, ay: number, bx: number, by: number): void => {
    const a = ay * size + ax;
    const b = by * size + bx;
    const dx = bx - ax;
    const dy = by - ay;
    const d = dx === 1 ? 1 : dx === -1 ? 3 : dy === 1 ? 2 : 0;
    layer.dir[a] |= DIR_BIT[d];
    layer.dir[b] |= DIR_BIT[DIR_OPPOSITE[d]];
  };

  for (let y = lo; y < hi; y += o.spacing) {
    for (let x = lo; x < hi - 1; x++) {
      if (put(x, y) && put(x + 1, y)) join(x, y, x + 1, y);
    }
  }
  for (let x = lo; x < hi; x += o.spacing) {
    for (let y = lo; y < hi - 1; y++) {
      if (put(x, y) && put(x, y + 1)) join(x, y, x, y + 1);
    }
  }
  w.assets.tiles[asset] = laid;
  w.assets.buildCost[asset] = laid * way.buildCost;
  w.rebuild();

  // Services between pairs of nodes on the grid. Every vehicle needs somewhere
  // to be going or it parks and the test measures nothing.
  const nodes: number[] = [];
  for (let n = 0; n < w.graph.nodeCount; n++) nodes.push(n);
  const type = w.content.vehicleIndex.get(o.vehicleId) ?? 0;
  let services = 0;
  let spawned = 0;

  // The harness is a load test, not a game. Twenty-five thousand lorries cost
  // forty million pounds against a starting balance of two thousand four
  // hundred, so without this every company is insolvent by the second game day
  // and the insolvency rules — correctly — liquidate the entire fleet before a
  // single frame is measured. Capitalising them is the only cheat here, and it
  // is confined to this function.
  for (let company = 1; company < w.companies.count; company++) {
    w.companies.cash[company] = 1e13;
  }

  if (nodes.length >= 2) {
    // Bounded by the service table, not by the node count: a region with seven
    // thousand junctions does not get seven thousand services.
    const serviceTarget = Math.min(nodes.length, MAX_ROUTES - w.services.count - 4);
    const perService = Math.max(1, Math.ceil(o.vehicles / Math.max(1, serviceTarget)));
    // Company 0 is the authority and does not run services, so the spread is
    // over the trading companies only. Counting the authority in dropped one
    // service in four on the floor and the harness quietly spawned four fifths
    // of the fleet it was asked for.
    const traders = Math.max(1, Math.min(o.companies, w.companies.count - 1));
    for (let i = 0; i < serviceTarget && spawned < o.vehicles; i++) {
      const company = 1 + (i % traders);
      const a = nodes[i];
      const b = nodes[(i * 37 + 11) % nodes.length];
      if (a === b) continue;
      const svc = w.services.alloc(company, `Stress ${services}`);
      if (svc === NONE) break;
      // Stops are nodes rather than sites here, so the harness does not need
      // an industry at every junction. `stressNodeStops` is the only place the
      // sim allows that, and it exists for this.
      w.stressNodeStops(svc, a, b);
      services++;
      for (let k = 0; k < perService && spawned < o.vehicles; k++) {
        const v = w.buyVehicle(company, type, NONE);
        if (v === NONE) break;
        w.vehicles.targetNode[v] = a;
        w.assignVehicle(v, svc, company);
        spawned++;
      }
    }
  }

  return {
    roadTiles: laid,
    cells: w.graph.cellCount,
    nodes: w.graph.nodeCount,
    links: w.graph.linkCount,
    services,
    vehicles: spawned,
    ms: Date.now() - t0,
  };
}
