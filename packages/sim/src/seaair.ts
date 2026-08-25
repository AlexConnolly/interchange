/**
 * Sea lanes and air corridors: the two modes you do not build.
 *
 * A road has to be laid and a railway has to be surveyed, but the sea is
 * already there and so is the sky. What you build is the *terminal* — a wharf,
 * a deep-water port, an airstrip — and the network between terminals exists
 * for free. That is why `seaway` and `airway` are the two way classes with a
 * build cost of zero, and why they are generated rather than placed.
 *
 * The consequence for the ownership spine is the interesting one. Nobody owns
 * the sea, so nobody charges for it — but everybody owns their own quay, and
 * port dues are exactly as real as a turnpike toll (design.md §3.4). The money
 * in sea and air is in the terminal, not the route, and that is a different
 * shape of business from road and rail. Act IV is partly about noticing that.
 */

import { AUTHORITY, DIR_BIT, DIR_DX, DIR_DY, DIR_OPPOSITE, Mode } from './constants.ts';
import { NONE, type AssetTable, type WayLayer } from './network.ts';
import { SEA_LEVEL, type Terrain } from './terrain.ts';

/** Tiles between sea lanes. Coarse: a ship does not need a lane every tile,
 *  and a fine grid over the ocean is a hundred thousand pointless cells. */
export const SEA_SPACING = 12;

/** How far offshore a lane may run. Beyond this it is open ocean and there is
 *  nothing to route to. */
export const SEA_MARGIN = 3;

/**
 * Lay a coarse grid of sea lanes over navigable water.
 *
 * Coarse and rectilinear rather than following the coast: a sea lane is not a
 * thing that exists in the world, it is a routing convenience, and making it
 * hug every inlet would cost a great deal of graph for a route nobody can
 * tell apart from the straight one.
 */
export function generateSeaLanes(
  terrain: Terrain,
  layer: WayLayer,
  assets: AssetTable,
  cls: number,
  tick: number,
): number {
  const size = terrain.size;
  const asset = assets.alloc(Mode.Water, cls, AUTHORITY, 0, tick);
  if (asset === NONE) return 0;
  let laid = 0;

  const navigable = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= size || y >= size) return false;
    return terrain.height[y * size + x] <= SEA_LEVEL;
  };
  const put = (x: number, y: number): boolean => {
    if (!navigable(x, y)) return false;
    const tile = y * size + x;
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

  for (let y = SEA_MARGIN; y < size - SEA_MARGIN; y += SEA_SPACING) {
    for (let x = SEA_MARGIN; x < size - SEA_MARGIN - 1; x++) {
      if (put(x, y) && put(x + 1, y)) join(x, y, x + 1, y);
    }
  }
  for (let x = SEA_MARGIN; x < size - SEA_MARGIN; x += SEA_SPACING) {
    for (let y = SEA_MARGIN; y < size - SEA_MARGIN - 1; y++) {
      if (put(x, y) && put(x, y + 1)) join(x, y, x, y + 1);
    }
  }
  assets.tiles[asset] = laid;
  assets.buildCost[asset] = 0;
  if (laid === 0) assets.count--;
  return laid;
}

/**
 * Connect a coastal terminal to the sea lanes.
 *
 * Walks outward from the quay until it meets a lane, laying water tiles as it
 * goes. A short approach channel, in other words — which is what a harbour
 * mouth is.
 */
export function connectToSea(
  terrain: Terrain,
  layer: WayLayer,
  assets: AssetTable,
  cls: number,
  fromTile: number,
  maxRange: number,
  owner: number,
  tick: number,
): boolean {
  const size = terrain.size;
  // Breadth-first over water to the nearest existing lane.
  const seen = new Map<number, number>();
  const queue: number[] = [];
  const startX = fromTile % size;
  const startY = (fromTile / size) | 0;

  for (let d = 0; d < 4; d++) {
    const nx = startX + DIR_DX[d];
    const ny = startY + DIR_DY[d];
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
    if (terrain.height[ny * size + nx] > SEA_LEVEL) continue;
    const t = ny * size + nx;
    seen.set(t, fromTile);
    queue.push(t);
  }
  if (queue.length === 0) return false;

  let target = NONE;
  for (let head = 0; head < queue.length && head < maxRange * maxRange; head++) {
    const t = queue[head];
    if (layer.cls[t] !== 255) {
      target = t;
      break;
    }
    const x = t % size;
    const y = (t / size) | 0;
    if (Math.abs(x - startX) + Math.abs(y - startY) > maxRange) continue;
    for (let d = 0; d < 4; d++) {
      const nx = x + DIR_DX[d];
      const ny = y + DIR_DY[d];
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const nt = ny * size + nx;
      if (seen.has(nt)) continue;
      if (terrain.height[nt] > SEA_LEVEL) continue;
      seen.set(nt, t);
      queue.push(nt);
    }
  }
  if (target === NONE) return false;

  const asset = assets.alloc(Mode.Water, cls, owner, 0, tick);
  if (asset === NONE) return false;
  let laid = 0;
  let cur = target;
  let guard = 0;
  while (cur !== fromTile && guard++ < maxRange * 4) {
    const prev = seen.get(cur);
    if (prev === undefined) break;
    if (layer.cls[cur] === 255) {
      layer.cls[cur] = cls;
      layer.asset[cur] = asset;
      layer.tileCount++;
      laid++;
    }
    /*
     * The quay itself sits on land, and it still has to be *on* the water
     * layer, because a terminal that is merely next to the network is not on
     * it: the graph tracer walks tiles that carry a class, so a quay with no
     * class gets no node, and a town with no node cannot be routed to. This
     * condition used to be written so that it only fired when the tile
     * already had a class, which is to say never — twelve thousand tiles of
     * sea lane were generated and not one town or industry in the region
     * could reach any of it.
     */
    if (prev === fromTile && layer.cls[prev] === 255) {
      layer.cls[prev] = cls;
      layer.asset[prev] = asset;
      layer.tileCount++;
      laid++;
    }
    const dx = (prev % size) - (cur % size);
    const dy = ((prev / size) | 0) - ((cur / size) | 0);
    for (let d = 0; d < 4; d++) {
      if (DIR_DX[d] === dx && DIR_DY[d] === dy) {
        layer.dir[cur] |= DIR_BIT[d];
        layer.dir[prev] |= DIR_BIT[DIR_OPPOSITE[d]];
      }
    }
    cur = prev;
  }
  assets.tiles[asset] = laid;
  layer.terminal[fromTile] = 1;
  if (laid === 0) assets.count--;
  return laid > 0;
}

/**
 * Air corridors between every pair of airports.
 *
 * A complete graph, because that is what flying is: there is no intermediate
 * geography and no reason to route through anywhere. Laid as tiles along the
 * straight line so the existing graph tracer and traffic model handle aircraft
 * with no special case — an aeroplane is a vehicle on a link like any other,
 * and the only thing that makes it an aeroplane is that its link happens to go
 * over a mountain.
 */
export function generateAirCorridors(
  terrain: Terrain,
  layer: WayLayer,
  assets: AssetTable,
  cls: number,
  airports: number[],
  tick: number,
): number {
  if (airports.length < 2) return 0;
  const size = terrain.size;
  const asset = assets.alloc(Mode.Air, cls, AUTHORITY, 0, tick);
  if (asset === NONE) return 0;
  let laid = 0;

  const put = (x: number, y: number): number => {
    const tile = y * size + x;
    if (layer.cls[tile] === 255) {
      layer.cls[tile] = cls;
      layer.asset[tile] = asset;
      layer.tileCount++;
      laid++;
    }
    return tile;
  };

  const sorted = airports.slice().sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const ax = sorted[i] % size;
      const ay = (sorted[i] / size) | 0;
      const bx = sorted[j] % size;
      const by = (sorted[j] / size) | 0;
      // Manhattan, so the corridor lies on the tile grid the tracer expects.
      let cx = ax;
      let cy = ay;
      let prev = put(cx, cy);
      const step = (nx: number, ny: number): void => {
        const t = put(nx, ny);
        const dx = nx - (prev % size);
        const dy = ny - ((prev / size) | 0);
        for (let d = 0; d < 4; d++) {
          if (DIR_DX[d] === dx && DIR_DY[d] === dy) {
            layer.dir[prev] |= DIR_BIT[d];
            layer.dir[t] |= DIR_BIT[DIR_OPPOSITE[d]];
          }
        }
        prev = t;
      };
      while (cx !== bx) { cx += bx > cx ? 1 : -1; step(cx, cy); }
      while (cy !== by) { cy += by > cy ? 1 : -1; step(cx, cy); }
      layer.terminal[sorted[i]] = 1;
      layer.terminal[sorted[j]] = 1;
    }
  }
  assets.tiles[asset] = laid;
  if (laid === 0) assets.count--;
  return laid;
}
