/**
 * Populating a fresh region: companies, towns, industries, and the authority's
 * road network.
 *
 * Act I's premise is that roads exist and they are bad (roadmap.md, Phase 1),
 * so the authority lays a sparse network of dirt tracks between the towns
 * before the player has done anything. Every tile of it is owned by the
 * authority and carries an access charge, which is why the player's very first
 * income statement has a line on it they can do nothing about.
 */

import { AUTHORITY, DIR_BIT, DIR_DX, DIR_DY, DIR_OPPOSITE, Mode } from './constants.ts';
import { NONE } from './network.ts';
import { Deposit, SEA_LEVEL, TileFlag, type Terrain } from './terrain.ts';
import { SiteState } from './sites.ts';
import type { World } from './world.ts';

const LIVERY_NAMES = [
  'Regional Authority',
  'Your company',
  'Marchbank Haulage',
  'Coldwell & Sons',
  'Tyne Carrying Co.',
  'Ashfield Transport',
  'Kelso Wagon Works',
  'Brightside Carriers',
  'Northern Union',
];

export function generateWorld(w: World): void {
  const t = w.terrain;
  const c = w.content;

  // ---- companies --------------------------------------------------------
  // Company 0 is always the authority. design.md §3.1.
  w.companies.alloc(LIVERY_NAMES[0], 0, true, 0);
  w.companies.alloc(LIVERY_NAMES[1], c.balance.startingCash, false, 1);
  for (let i = 2; i < Math.max(2, w.config.companyCount); i++) {
    const id = w.companies.alloc(LIVERY_NAMES[i % LIVERY_NAMES.length], c.balance.startingCash, true, i);
    // design.md §2.5: personalities are weightings, not code paths.
    w.companies.aggression[id] = 30 + w.rng.int(60);
    w.companies.horizon[id] = 25 + w.rng.int(65);
    w.companies.thrift[id] = 25 + w.rng.int(65);
  }

  // ---- towns ------------------------------------------------------------
  for (const seed of t.towns) {
    w.towns.alloc(seed.x, seed.y, t.idx(seed.x, seed.y), seed.name, seed.population, seed.character);
  }

  // ---- extraction sites -------------------------------------------------
  const era1 = (defIndex: number): boolean => c.industries[defIndex].fromEra <= 1;
  for (const d of t.deposits) {
    const options = (c.industriesByDeposit[d.kind] ?? []).filter(era1);
    if (options.length === 0) continue;
    let x = d.x;
    let y = d.y;
    // A fishery is a harbour, so it belongs on the land beside the water, not
    // on the water. Offshore extraction waits for the water network in Act IV.
    if (d.kind === Deposit.Fish) {
      const landing = nearestLand(t, x, y, 8);
      if (!landing) continue;
      x = landing[0];
      y = landing[1];
    } else if (d.kind === Deposit.Oil) {
      continue;
    }
    if (!t.isLand(x, y)) continue;
    const def = options[w.rng.int(options.length)];
    const site = w.sites.alloc(def, x, y, t.idx(x, y), AUTHORITY);
    w.sites.richness[site] = d.richness;
  }

  // ---- processing and terminal sites ------------------------------------
  // Placed near towns and chosen so that whatever the region actually digs up
  // has somewhere to go. A map with four collieries and no gasworks is a map
  // where the player's only cargo is worthless.
  const producedNearby = new Map<number, number>();
  for (let s = 0; s < w.sites.count; s++) {
    const outs = c.industries[w.sites.def[s]].recipe.outputs;
    for (const id of Object.keys(outs)) {
      const ci = c.cargoIndex.get(id);
      if (ci !== undefined) producedNearby.set(ci, (producedNearby.get(ci) ?? 0) + 1);
    }
  }

  const consumers: number[] = [];
  c.industries.forEach((ind, i) => {
    if (ind.fromEra > 1) return;
    if (ind.kind !== 'processing' && ind.kind !== 'terminal') return;
    const ins = Object.keys(ind.recipe.inputs).map((k) => c.cargoIndex.get(k) ?? -1);
    // Only offer an industry whose first input the region can actually supply.
    if (ins.some((ci) => ci >= 0 && (producedNearby.get(ci) ?? 0) > 0)) consumers.push(i);
  });

  for (let townId = 0; townId < w.towns.count; townId++) {
    const count = 1 + (w.towns.population[townId] > 1200 ? 1 : 0) + (townId % 3 === 0 ? 1 : 0);
    for (let k = 0; k < count && consumers.length > 0; k++) {
      const def = consumers[(townId * 3 + k) % consumers.length];
      const spot = findSiteSpot(t, w.towns.x[townId], w.towns.y[townId], 4, 11, w);
      if (!spot) continue;
      w.sites.alloc(def, spot[0], spot[1], t.idx(spot[0], spot[1]), AUTHORITY);
    }
  }

  // ---- stock capacities --------------------------------------------------
  const cargoCount = c.cargo.length;
  for (let s = 0; s < w.sites.count; s++) {
    const ind = c.industries[w.sites.def[s]];
    for (const [id, amount] of Object.entries(ind.recipe.inputs)) {
      const ci = c.cargoIndex.get(id);
      if (ci !== undefined) w.sites.capacity[s * cargoCount + ci] = amount * 30;
    }
    for (const [id, amount] of Object.entries(ind.recipe.outputs)) {
      const ci = c.cargoIndex.get(id);
      if (ci === undefined) continue;
      // Output capacity is the pressure valve: a yard that fills is the signal
      // the player is not collecting, and satisfaction is measured from it.
      w.sites.capacity[s * cargoCount + ci] = amount * 40;
    }
    w.sites.cycle[s] = 1 + w.rng.int(ind.recipe.period);
    // Processing sites need a starting stock or nothing moves for a fortnight
    // while the first extraction cycles complete, which reads as a dead map.
    if (ind.kind !== 'extraction') {
      for (const [id, amount] of Object.entries(ind.recipe.inputs)) {
        const ci = c.cargoIndex.get(id);
        if (ci !== undefined) w.sites.addStock(s, ci, amount * 6);
      }
    } else {
      for (const [id, amount] of Object.entries(ind.recipe.outputs)) {
        const ci = c.cargoIndex.get(id);
        if (ci !== undefined) w.sites.addStock(s, ci, amount * 8);
      }
    }
  }

  // ---- the authority's roads --------------------------------------------
  buildPublicRoads(w);

  w.rebuild();
}

function nearestLand(t: Terrain, x: number, y: number, radius: number): [number, number] | null {
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (t.isLand(nx, ny) && (t.flags[t.idx(nx, ny)] & TileFlag.Buildable) !== 0) return [nx, ny];
      }
    }
  }
  return null;
}

/** Buildable ground in an annulus around a town, avoiding anything already
 *  occupied so two industries do not land on the same tile. */
function findSiteSpot(
  t: Terrain, cx: number, cy: number, min: number, max: number, w: World,
): [number, number] | null {
  const taken = new Set<number>();
  for (let s = 0; s < w.sites.count; s++) taken.add(w.sites.tile[s]);
  for (let tries = 0; tries < 160; tries++) {
    const r = min + w.rng.int(max - min + 1);
    const a = w.rng.int(4096);
    const dx = Math.round((r * Math.cos((a / 4096) * Math.PI * 2)));
    const dy = Math.round((r * Math.sin((a / 4096) * Math.PI * 2)));
    const x = cx + dx;
    const y = cy + dy;
    if (!t.inBounds(x, y) || !t.isLand(x, y)) continue;
    const tile = t.idx(x, y);
    if ((t.flags[tile] & TileFlag.Buildable) === 0) continue;
    if (taken.has(tile)) continue;
    let clear = true;
    for (const other of taken) {
      const ox = other % t.size;
      const oy = (other / t.size) | 0;
      if (Math.abs(ox - x) < 3 && Math.abs(oy - y) < 3) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    return [x, y];
  }
  return null;
}

/**
 * The public road network.
 *
 * A minimum spanning tree over the towns, plus a handful of extra edges. The
 * extras matter more than they look: without them every journey has exactly
 * one possible route, so there is nothing for congestion to spread onto and no
 * such thing as a bypass — and the ownership triangle collapses from three
 * options to two.
 */
function buildPublicRoads(w: World): void {
  const t = w.terrain;
  const layer = w.layers[Mode.Road];
  const trackCls = w.content.wayIndex.get('track') ?? 0;
  const macadamCls = w.content.wayIndex.get('macadam') ?? trackCls;
  const track = w.content.ways[trackCls];
  const macadam = w.content.ways[macadamCls];

  const n = w.towns.count;
  if (n === 0) return;

  const dist = (a: number, b: number): number =>
    Math.hypot(w.towns.x[a] - w.towns.x[b], w.towns.y[a] - w.towns.y[b]);

  // Prim's, deterministic because ties break on index.
  const inTree = new Uint8Array(n);
  const edges: [number, number][] = [];
  inTree[0] = 1;
  for (let k = 1; k < n; k++) {
    let bestA = -1;
    let bestB = -1;
    let bestD = Infinity;
    for (let a = 0; a < n; a++) {
      if (!inTree[a]) continue;
      for (let b = 0; b < n; b++) {
        if (inTree[b]) continue;
        const d = dist(a, b);
        if (d < bestD - 1e-9) {
          bestD = d;
          bestA = a;
          bestB = b;
        }
      }
    }
    if (bestB < 0) break;
    inTree[bestB] = 1;
    edges.push([bestA, bestB]);
  }

  // Extra edges: the shortest pairs not already joined, so the network has
  // loops and therefore alternatives.
  const joined = new Set(edges.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
  const extras: [number, number, number][] = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (joined.has(`${a}-${b}`)) continue;
      extras.push([a, b, dist(a, b)]);
    }
  }
  extras.sort((p, q) => p[2] - q[2] || p[0] - q[0] || p[1] - q[1]);
  for (let i = 0; i < Math.min(extras.length, Math.max(2, Math.floor(n / 3))); i++) {
    edges.push([extras[i][0], extras[i][1]]);
  }

  for (const [a, b] of edges) {
    const path = w.tileRouter.route(w.towns.tile[a], w.towns.tile[b]);
    if (!path) continue;
    // The two biggest towns on an edge get macadam; everything else is dirt,
    // which is the difference the player is meant to feel in Act I.
    const major = w.towns.population[a] > 1200 && w.towns.population[b] > 1200;
    const cls = major ? macadamCls : trackCls;
    const def = major ? macadam : track;
    layWay(w, layer, path, cls, AUTHORITY, def.publicCharge, def.buildCost);
  }

  // ---- spurs to every site and town centre ------------------------------
  for (let s = 0; s < w.sites.count; s++) {
    connect(w, layer, w.sites.tile[s], trackCls, track.publicCharge, track.buildCost);
    w.siteAccessTile[s] = w.sites.tile[s];
  }
  for (let i = 0; i < w.towns.count; i++) {
    connect(w, layer, w.towns.tile[i], trackCls, track.publicCharge, track.buildCost);
    w.townAccessTile[i] = w.towns.tile[i];
  }
}

/** Join a tile to whatever road is nearest. */
function connect(
  w: World, layer: { cls: Uint8Array; dir: Uint8Array; asset: Int32Array; terminal: Uint8Array; tileCount: number },
  tile: number, cls: number, charge: number, buildCost: number,
): void {
  const t = w.terrain;
  const size = t.size;
  if (layer.cls[tile] !== 255) {
    layer.terminal[tile] = 1;
    return;
  }
  // Nearest existing road tile by breadth-first search, then a route to it.
  const target = nearestRoadTile(layer, size, tile, 90);
  if (target === NONE) {
    layer.terminal[tile] = 1;
    return;
  }
  const path = w.tileRouter.route(tile, target);
  if (!path || path.length < 2) {
    layer.terminal[tile] = 1;
    return;
  }
  layWay(w, layer as never, path, cls, AUTHORITY, charge, buildCost);
  layer.terminal[tile] = 1;
}

function nearestRoadTile(
  layer: { cls: Uint8Array }, size: number, from: number, maxRadius: number,
): number {
  const fx = from % size;
  const fy = (from / size) | 0;
  for (let r = 1; r <= maxRadius; r++) {
    let best = NONE;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = fx + dx;
        const y = fy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const tile = y * size + x;
        if (layer.cls[tile] === 255) continue;
        // Lowest tile index at this radius, so the choice is deterministic.
        if (best === NONE || tile < best) best = tile;
      }
    }
    if (best !== NONE) return best;
  }
  return NONE;
}

/**
 * Lay a way along a path of tiles, creating one asset for the whole run.
 *
 * The asset is the unit of ownership (network.ts), so "one act of
 * construction, one asset" is the rule that makes buying a road mean buying
 * the road rather than buying an arbitrary chain between two junctions.
 */
export function layWay(
  w: World,
  layer: import('./network.ts').WayLayer,
  path: Int32Array | number[],
  cls: number,
  owner: number,
  charge: number,
  buildCostPerTile: number,
): number {
  const size = w.terrain.size;
  const asset = w.assets.alloc(layer.mode, cls, owner, charge, w.tick);
  let laid = 0;
  for (let i = 0; i < path.length; i++) {
    const tile = path[i];
    if (layer.cls[tile] === 255) {
      layer.cls[tile] = cls;
      layer.asset[tile] = asset;
      layer.tileCount++;
      laid++;
    } else if (w.content.ways[cls].buildCost > w.content.ways[layer.cls[tile]].buildCost) {
      // Upgrading in place keeps the existing owner: you cannot acquire a
      // rival's road by resurfacing it.
      layer.cls[tile] = cls;
    }
    if (i + 1 < path.length) {
      const a = path[i];
      const b = path[i + 1];
      const dx = (b % size) - (a % size);
      const dy = ((b / size) | 0) - ((a / size) | 0);
      let d = -1;
      for (let k = 0; k < 4; k++) if (DIR_DX[k] === dx && DIR_DY[k] === dy) d = k;
      if (d >= 0) {
        layer.dir[a] |= DIR_BIT[d];
        layer.dir[b] |= DIR_BIT[DIR_OPPOSITE[d]];
      }
    }
  }
  w.assets.tiles[asset] = laid;
  w.assets.buildCost[asset] = laid * buildCostPerTile;
  if (laid === 0) {
    // Nothing new was laid — the run was entirely over existing road. Drop the
    // empty asset back so the ownership list is not full of phantoms.
    w.assets.count--;
    return NONE;
  }
  return asset;
}

export { SiteState, SEA_LEVEL };
