/**
 * The construction tool.
 *
 * Grid-snapped placement from a palette (D2), with the route between the two
 * ends found by the same hierarchical search the region generator uses — so
 * the alignment the player is offered is the alignment a surveyor would have
 * drawn, and they are not fighting a router with different opinions from
 * their own.
 *
 * The estimate is shown before the commitment, and it itemises the earthworks.
 * That is the whole of design.md §13's "terrain is a cost, not a paint tool":
 * the player finds out that going over the ridge costs four times going round
 * it *before* they spend the money, which is what makes the choice a choice.
 */

import { Mode, type Alignment, type World } from '@interchange/sim';
import { content } from '@interchange/data';
import type { Engine } from './engine.ts';

const C = content();

export interface BuildSelection {
  mode: number;
  cls: number;
}

export interface BuildState {
  selection: BuildSelection | null;
  demolish: boolean;
  fromTile: number;
  toTile: number;
  plan: Alignment | null;
  path: Int32Array | null;
}

export function emptyBuildState(): BuildState {
  return { selection: null, demolish: false, fromTile: -1, toTile: -1, plan: null, path: null };
}

/** Way classes this company may lay right now: the era has opened it, and the
 *  charter permits building at all. */
export function availableWays(world: World): { index: number; id: string; name: string; mode: number; cost: number }[] {
  const era = world.era;
  const out: { index: number; id: string; name: string; mode: number; cost: number }[] = [];
  C.ways.forEach((w, i) => {
    if (w.era > era) return;
    // Sea lanes and air corridors are not laid; they exist. Wires, pipes and
    // conveyors arrive with the utility networks in Act III.
    if (w.buildCost === 0) return;
    if (w.mode !== 'road' && w.mode !== 'rail') return;
    out.push({
      index: i,
      id: w.id,
      name: w.name,
      mode: w.mode === 'rail' ? Mode.Rail : Mode.Road,
      cost: w.buildCost,
    });
  });
  return out;
}

/**
 * Recompute the ghost for the current drag.
 *
 * Returns true if anything changed, so the caller can avoid rebuilding the
 * preview geometry sixty times a second while the cursor sits still.
 */
export function updatePlan(engine: Engine, state: BuildState, toTile: number): boolean {
  if (!state.selection || state.fromTile < 0 || toTile < 0) return false;
  if (toTile === state.toTile) return false;
  state.toTile = toTile;

  const world = engine.world;
  if (state.fromTile === toTile) {
    state.path = Int32Array.of(toTile);
    state.plan = null;
    return true;
  }
  const path = world.proposeRoute(state.fromTile, toTile, state.selection.cls);
  state.path = path;
  state.plan = path ? world.planWay(state.selection.mode, state.selection.cls, path) : null;
  return true;
}

export function applyPreview(engine: Engine, state: BuildState): void {
  const r = engine.renderer;
  if (!r) return;
  if (!state.path || !state.plan) {
    r.setPreview(null, null, null, true, engine.world.config.size);
    return;
  }
  const levels = new Int16Array(state.plan.tiles.length);
  const flags = new Uint8Array(state.plan.tiles.length);
  const tiles = new Int32Array(state.plan.tiles.length);
  state.plan.tiles.forEach((t, i) => {
    tiles[i] = t.tile;
    levels[i] = t.level;
    flags[i] = t.flags;
  });
  r.setPreview(tiles, levels, flags, state.plan.ok, engine.world.config.size);
}

export function clearPreview(engine: Engine, state: BuildState): void {
  state.fromTile = -1;
  state.toTile = -1;
  state.plan = null;
  state.path = null;
  engine.renderer?.setPreview(null, null, null, true, engine.world.config.size);
}
