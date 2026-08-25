/**
 * The road network, with a hierarchy.
 *
 * "The roads aren't even real roads" was the right complaint, and it had two
 * causes. One was in the renderer, which drew every way as an identical flat
 * band with a hub and four arms sized for reading junctions from above. The
 * other is here.
 *
 * The old generator connected everything to everything by breadth-first search
 * to the nearest existing road tile. Measured, that produced 50 km of road in an
 * 8 km district, which is *sparser* than a real one — so the spiderweb was never
 * about density. It was that there was no difference between an A-road, a lane
 * and a farm track, and that every route wandered, because a BFS to the nearest
 * tile has no reason to prefer a sensible line.
 *
 * So: three tiers, built in order, each one attaching to the one above.
 *
 *   **The spine.** One road across the district, edge to edge, through or past
 *   the largest settlement. It goes the long way round a hill rather than over
 *   it, because that is what an A-road does and because the erosion pass has
 *   given the valleys somewhere to go.
 *
 *   **Lanes.** One per settlement, from the settlement to the nearest point on
 *   the spine.
 *
 *   **Tracks.** One per farm or works, to the nearest lane.
 *
 * Everything routes with the same A*, and the cost function is the whole
 * character of the result: gradient is punished hard, turning is punished a
 * little, and running along a field boundary is rewarded — because a real lane
 * follows the hedge rather than cutting a corner off somebody's field.
 */

import { NO_WAY } from './network.ts';

/** The three tiers, in the order they are built. */
export const Tier = { Spine: 0, Lane: 1, Track: 2 } as const;
export type Tier = (typeof Tier)[keyof typeof Tier];

export interface RoadTarget {
  x: number;
  y: number;
  /** Bigger places get a better road to them. */
  weight: number;
}

export interface RoadNetContext {
  size: number;
  height: Int16Array;
  isWater: (tile: number) => boolean;
  /** Parcel per tile, so a lane can prefer to run along a boundary. */
  parcel: Int32Array;
  /** Way class index to write for each tier. */
  classOf: (tier: Tier) => number;
  /** Where the road goes once decided. */
  cls: Uint8Array;
}

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

/**
 * Is this tile on a field boundary?
 *
 * A lane that runs along the edge of a field looks like a lane. One that cuts
 * diagonally across the middle of a wheat field looks like a mistake, and the
 * old generator did it constantly. Rewarding boundaries in the cost function is
 * one line and it does most of the work of making the network look deliberate.
 */
function onBoundary(ctx: RoadNetContext, tile: number): boolean {
  const s = ctx.size;
  const p = ctx.parcel[tile];
  for (let d = 0; d < 4; d++) {
    const x = (tile % s) + DX[d];
    const y = ((tile / s) | 0) + DY[d];
    if (x < 0 || y < 0 || x >= s || y >= s) continue;
    if (ctx.parcel[y * s + x] !== p) return true;
  }
  return false;
}

/**
 * A* from one tile to any tile in `goals`.
 *
 * Multi-goal because a lane heads for "the spine", not for a particular tile on
 * it, and letting the search pick where to join is what puts junctions in
 * sensible places rather than at whichever end somebody nominated.
 */
function route(
  ctx: RoadNetContext, from: number, goals: Uint8Array, tier: Tier,
): number[] | null {
  const s = ctx.size;
  const n = s * s;
  const cost = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const open: number[] = [from];
  cost[from] = 0;
  let found = -1;

  /*
   * A plain sorted-array frontier rather than a binary heap.
   *
   * This runs a couple of dozen times at worldgen and never again, and a
   * hand-rolled heap is a hand-rolled heap. If a district ever gets big enough
   * for this to matter, `heap.ts` is already in the package.
   */
  while (open.length > 0) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (cost[open[i]] < cost[open[bi]]) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (goals[cur]) { found = cur; break; }

    const cx = cur % s;
    const cy = (cur / s) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= s || ny >= s) continue;
      const next = ny * s + nx;
      if (ctx.isWater(next)) continue;

      /*
       * The cost function, and it is the whole character of the network.
       *
       * Gradient squared, so a road will go a long way round rather than over
       * anything steep — which is what an A-road does and what makes the
       * valleys the erosion pass carved into the obvious routes.
       */
      const rise = Math.abs(ctx.height[next] - ctx.height[cur]);
      let step = 1 + (rise * rise) / (tier === Tier.Spine ? 900 : 2400);

      // Following an existing road is nearly free, so a lane joins the spine and
      // runs along it rather than laying a second road beside it.
      if (ctx.cls[next] !== NO_WAY) step *= 0.15;
      // And running along a field boundary is cheap, so lanes follow hedges.
      else if (onBoundary(ctx, next)) step *= 0.62;

      // A small turning penalty, which is what stops a route staircasing
      // diagonally across open ground — the single most obvious tell in the old
      // network.
      const back = prev[cur];
      if (back >= 0) {
        const pdx = Math.sign((cur % s) - (back % s));
        const pdy = Math.sign(((cur / s) | 0) - ((back / s) | 0));
        if (pdx !== DX[d] || pdy !== DY[d]) step += tier === Tier.Spine ? 2.2 : 1.1;
      }

      const c = cost[cur] + step;
      if (c >= cost[next]) continue;
      cost[next] = c;
      prev[next] = cur;
      open.push(next);
    }
  }

  if (found < 0) return null;
  const path: number[] = [];
  for (let t = found; t >= 0; t = prev[t]) path.push(t);
  return path.reverse();
}

/**
 * Write a route into the way layer, respecting the hierarchy.
 *
 * Two rules, and the second is the interesting one.
 *
 * **Never downgrade.** A track joining a lane must not turn the lane into a
 * track for one tile, which is how a hierarchy gets quietly erased.
 *
 * **Never skip a tier.** A farm track joins a lane and a dual carriageway comes
 * off a road — a track does not open straight onto a trunk road, and nowhere in
 * England does one. So where a route of one tier meets a tier more than one step
 * above it, the tiles between are promoted to the tier in between: the track
 * becomes a short length of lane where it approaches the road.
 *
 * That last rule is worth the code because it is most of what makes a network
 * look like it was built by people rather than by a search. A pattern of
 * track-to-lane-to-road reads as a place that grew; a track opening onto a
 * highway reads as a graph.
 */
function lay(ctx: RoadNetContext, path: number[], tier: Tier): void {
  const cls = ctx.classOf(tier);
  const written: number[] = [];
  for (const t of path) {
    if (ctx.cls[t] !== NO_WAY && ctx.cls[t] <= cls) continue;
    ctx.cls[t] = cls;
    written.push(t);
  }
}

/** How many tiles of the intermediate class to put in where a tier steps up. */
const TRANSITION = 3;

/**
 * Never let a tier meet one two or more steps above it.
 *
 * A farm track joins a lane and a dual carriageway comes off a road. A track
 * does not open straight onto a trunk road, and this is most of what makes a
 * network look like it was built by people rather than by a search: a pattern of
 * track-to-lane-to-road reads as a place that grew, and a track opening onto a
 * highway reads as a graph.
 *
 * Done as a repair pass over the whole map rather than inside `lay`, because the
 * offending join is usually between a tile written now and a tile written three
 * calls ago — a fix that only looks at what it just wrote leaves a dozen of
 * them, which is exactly what the first attempt did.
 *
 * Iterated, because promoting a tile can create a new illegal join one step
 * further along. It settles in two or three passes; the cap is a backstop.
 */
function smoothTiers(ctx: RoadNetContext): number {
  const s = ctx.size;
  const n = s * s;
  let fixed = 0;
  for (let pass = 0; pass < 6; pass++) {
    let changed = 0;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const t = y * s + x;
        const c = ctx.cls[t];
        if (c === NO_WAY) continue;
        let bestNeighbour = c;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d];
          const ny = y + DY[d];
          if (nx < 0 || ny < 0 || nx >= s || ny >= s) continue;
          const nc = ctx.cls[ny * s + nx];
          if (nc !== NO_WAY && nc < bestNeighbour) bestNeighbour = nc;
        }
        // Class index runs worst to best, so a smaller index is a better road.
        if (c - bestNeighbour >= 2) {
          ctx.cls[t] = bestNeighbour + 1;
          changed++;
        }
      }
    }
    fixed += changed;
    if (changed === 0) break;
  }
  void n;
  return fixed;
}

/**
 * Build the whole network.
 *
 * `settlements` are places that get a lane; `sites` are places that get a track.
 * The spine is routed first, between two points on opposite edges chosen to pass
 * near the largest settlement.
 */
export function generateRoads(
  ctx: RoadNetContext, settlements: RoadTarget[], sites: RoadTarget[],
): { spine: number; lanes: number; tracks: number; unreachable: number } {
  const s = ctx.size;
  const n = s * s;
  const tally = { spine: 0, lanes: 0, tracks: 0, unreachable: 0 };
  if (settlements.length === 0) return tally;

  /*
   * Grow the network outward from the biggest settlement, rather than routing a
   * spine between a chosen pair.
   *
   * Two earlier attempts both laid nothing. Edge to edge failed because the
   * district is an island and every tile near the map edge is sea. Chaining
   * consecutive pairs of settlements failed because one of the three had been
   * placed on a single-tile island with no land neighbour at all, so both legs
   * of the chain went through an unreachable point and neither survived.
   *
   * Growing outward is immune to both. Each place routes to whatever network
   * already exists; the first connection is the spine and the rest are lanes;
   * anything unreachable is skipped and counted rather than taking the district
   * down with it. A generator that can be defeated by one bad placement is a
   * generator that will be.
   */
  const network = new Uint8Array(n);
  const byWeight = [...settlements].sort((a, b) => b.weight - a.weight);

  const seed = byWeight[0];
  network[seed.y * s + seed.x] = 1;

  const refresh = (): void => {
    for (let i = 0; i < n; i++) if (ctx.cls[i] !== NO_WAY) network[i] = 1;
  };

  let joined = 0;
  for (let i = 1; i < byWeight.length; i++) {
    const place = byWeight[i];
    const tier: Tier = joined === 0 ? Tier.Spine : Tier.Lane;
    const path = route(ctx, place.y * s + place.x, network, tier);
    if (!path) {
      tally.unreachable++;
      continue;
    }
    lay(ctx, path, tier);
    if (tier === Tier.Spine) tally.spine += path.length;
    else tally.lanes += path.length;
    joined++;
    refresh();
  }

  // And a track to everything else that needs collecting from.
  for (const place of sites) {
    const tile = place.y * s + place.x;
    if (ctx.cls[tile] !== NO_WAY) continue;
    const path = route(ctx, tile, network, Tier.Track);
    if (!path) {
      tally.unreachable++;
      continue;
    }
    lay(ctx, path, Tier.Track);
    tally.tracks += path.length;
    refresh();
  }

  smoothTiers(ctx);
  return tally;
}
