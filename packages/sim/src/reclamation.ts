/**
 * Land reclamation. features.md §13, Phase 4.
 *
 * The one place in the game where the *map itself* changes. Everything else a
 * player builds sits on top of the region; this makes more region.
 *
 * That is why it is expensive, slow, and hedged about. A transport game whose
 * terrain can be edited freely is a transport game with no terrain problem,
 * and the terrain problem is most of what makes a route interesting —
 * design.md §13 is explicit that terrain is a cost and not a paint tool. So
 * the rules here are all about keeping reclamation a *decision* rather than a
 * brush:
 *
 *   - only shallow water, so it fills an inlet and never builds an island
 *   - only against existing shore, so it grows the coast rather than dotting it
 *   - priced by depth, so the cheap tiles run out and the next ones cost more
 *   - a land charter, because remaking the coastline is not a haulier's job
 *
 * The Zuiderzee works and the Dutch polders are the model, and so is their
 * pace: this is decades of work for a few hundred hectares, and the price is
 * set so it reads that way rather than as a terraforming button.
 */

import { SEA_LEVEL, TileFlag, type Terrain } from './terrain.ts';

/** Deeper than this and it is the sea, not an inlet. In height units, so
 *  minus twelve is about six metres. */
export const RECLAIM_MAX_DEPTH = -12;

/** What the new ground stands at. Just above the tide, which is what a polder
 *  is: land that is only land because somebody is holding the water back. */
export const RECLAIM_LEVEL = 3;

/** Pence per tile at the waterline, before the depth multiplier. */
export const RECLAIM_BASE_COST = 900_000;

/** The era anybody has the plant for it. Steam dredgers and hydraulic fill,
 *  which is the same era the design gives deep-water ports. */
export const RECLAIM_FROM_ERA = 5;

export interface ReclaimPlan {
  tiles: number[];
  cost: number;
  ok: boolean;
  problem: string;
}

/**
 * Work out what a reclamation would cost, without doing it.
 *
 * Returns the same shape as an alignment estimate, for the same reason: the
 * player is told the price before they buy it, and the price is itemised by
 * what makes it expensive rather than folded into one number.
 */
export function planReclamation(
  terrain: Terrain, tiles: readonly number[], era: number,
): ReclaimPlan {
  const out: ReclaimPlan = { tiles: [], cost: 0, ok: true, problem: '' };
  if (era < RECLAIM_FROM_ERA) {
    out.ok = false;
    out.problem = 'Nobody can drain a bay yet. That wants steam dredgers.';
    return out;
  }
  if (tiles.length === 0) {
    out.ok = false;
    out.problem = 'Nothing selected.';
    return out;
  }

  const size = terrain.size;
  // A copy of what the sea floor will look like as the work proceeds, so that
  // a tile counts its neighbour as shore once that neighbour is filled. This
  // is what lets a player reclaim an inlet in one go rather than one ring at
  // a time, while still refusing an island.
  const filled = new Set<number>();

  for (const tile of tiles) {
    const x = tile % size;
    const y = (tile / size) | 0;
    if (x < 1 || y < 1 || x >= size - 1 || y >= size - 1) {
      out.ok = false;
      out.problem = 'Too close to the edge of the region.';
      return out;
    }
    const h = terrain.height[tile];
    if (h > SEA_LEVEL) {
      out.ok = false;
      out.problem = 'That is already land.';
      return out;
    }
    if ((terrain.flags[tile] & TileFlag.River) !== 0) {
      out.ok = false;
      out.problem = 'That is a river. Damming one is a different undertaking.';
      return out;
    }
    if (h < RECLAIM_MAX_DEPTH) {
      out.ok = false;
      out.problem = 'Too deep. Reclamation fills an inlet, it does not build an island.';
      return out;
    }
    // Against the shore, or against something else in this same scheme.
    let touchesLand = false;
    for (const n of [tile - 1, tile + 1, tile - size, tile + size]) {
      if (terrain.height[n] > SEA_LEVEL || filled.has(n)) {
        touchesLand = true;
        break;
      }
    }
    if (!touchesLand) {
      out.ok = false;
      out.problem = 'Reclamation has to grow from the shore. Start against the land.';
      return out;
    }
    filled.add(tile);
    out.tiles.push(tile);
    // Depth is the whole cost curve: the shallows are affordable and the
    // channel is not, so a bay fills from its edges inward and gets dearer as
    // it goes, which is exactly how it went in the Netherlands.
    const depth = Math.max(0, SEA_LEVEL - h) + (RECLAIM_LEVEL - SEA_LEVEL);
    out.cost += Math.round(RECLAIM_BASE_COST * (0.5 + depth / 8));
  }
  return out;
}

/**
 * Do it. Returns the tiles that changed, so the caller can rebuild what needs
 * rebuilding — the graph, the chunk meshes, and the amenity field, none of
 * which this module knows about.
 */
export function reclaim(terrain: Terrain, plan: ReclaimPlan): number[] {
  if (!plan.ok) return [];
  for (const tile of plan.tiles) {
    terrain.height[tile] = RECLAIM_LEVEL;
    terrain.flags[tile] |= TileFlag.Buildable;
    // New ground is flat, drained and characterless, which is what a polder
    // is. It scores low on amenity for the same reason and recovers slowly,
    // the same as anywhere else industry has been.
    terrain.amenityBase[tile] = 34;
  }
  return plan.tiles;
}
