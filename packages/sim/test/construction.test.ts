/**
 * Every way class the palette offers has to be one the simulation will lay.
 *
 * The palette used to offer road and rail only, so canals, pipelines,
 * transmission lines and conveyors existed in the content, existed in the
 * simulation's grid code, and could not be built by anybody. Opening the
 * palette up is only half of that fix; this is the half that stays true.
 */

import { describe, expect, it } from 'vitest';
import {
  createWorld, Charter, Mode, MODE_NAMES, NONE, AUTHORITY, TICKS_PER_YEAR,
} from '../src/index.ts';
import { content } from '@interchange/data';

const C = content();

/** A world where the player may build anything the era allows. */
function builderWorld(seed = 8100) {
  const w = createWorld({ seed, size: 256, townCount: 8, companyCount: 2 });
  w.companies.charter[w.player] = Charter.Land;
  w.companies.cash[w.player] = 900_000_000;
  return w;
}

/** A straight run of tiles across flat-ish ground, avoiding the sea. */
function straightRun(w: ReturnType<typeof builderWorld>, length: number): number[] {
  const size = w.terrain.size;
  for (let y = 8; y < size - 8; y += 7) {
    for (let x = 8; x < size - 8 - length; x += 7) {
      const tiles: number[] = [];
      let ok = true;
      for (let i = 0; i < length; i++) {
        const tile = y * size + (x + i);
        if (w.terrain.height[tile] <= 0) { ok = false; break; }
        tiles.push(tile);
      }
      if (ok) return tiles;
    }
  }
  return [];
}

describe('the construction palette', () => {
  it('lays every class it lists, in the era that lists it', () => {
    const built: string[] = [];
    const refused: string[] = [];

    for (const way of C.ways) {
      // Sea lanes and air corridors are generated, not laid. They are the one
      // thing the palette is right to leave out.
      if (way.buildCost === 0) continue;
      const w = builderWorld();
      // Push the calendar to the era that opens this class.
      const era = C.eras.find((e) => e.n === way.era);
      if (era) {
        // The calendar is derived from the tick, so the only honest way to
        // reach an era is to get there.
        const target = (era.from + 1 - 1860) * TICKS_PER_YEAR;
        while (w.tick < target) w.step();
      }
      const mode = MODE_NAMES.indexOf(way.mode as never);
      expect(mode).toBeGreaterThanOrEqual(0);

      const run = straightRun(w, 6);
      expect(run.length).toBe(6);
      const cls = C.ways.indexOf(way);
      if (w.buildWay(w.player, mode, cls, run)) built.push(way.id);
      else refused.push(way.id);
    }

    expect(refused).toEqual([]);
    expect(built.length).toBeGreaterThan(8);
  });

  it('will not lay a class the era has not opened', () => {
    const w = builderWorld();
    /*
     * Measured against the world's own era rather than a hard-coded one.
     *
     * This asked for a class from era five or later, which was safely in the
     * future when the game began in 1860 and is the present now that it begins
     * in 1985. A gate test that names an era is a test that expires.
     */
    const late = C.ways.findIndex((x) => x.era > w.era && x.buildCost > 0);
    expect(late).toBeGreaterThanOrEqual(0);
    const mode = MODE_NAMES.indexOf(C.ways[late].mode as never);
    expect(w.buildWay(w.player, mode, late, straightRun(w, 5))).toBe(false);
  });

  it('will not lay anything at all without a construction charter', () => {
    const w = createWorld({ seed: 8100, size: 256, townCount: 8, companyCount: 2 });
    w.companies.cash[w.player] = 900_000_000;
    w.companies.charter[w.player] = Charter.Carrier;
    const track = C.ways.findIndex((x) => x.id === 'track');
    expect(w.buildWay(w.player, Mode.Road, track, straightRun(w as never, 5))).toBe(false);
  });

  it('creates one asset for one act of construction, owned by the builder', () => {
    const w = builderWorld();
    const before = w.assets.count;
    const track = C.ways.findIndex((x) => x.id === 'track');
    const run = straightRun(w, 8);
    expect(w.buildWay(w.player, Mode.Road, track, run)).toBe(true);
    expect(w.assets.count).toBe(before + 1);
    const asset = w.assets.count - 1;
    expect(w.assets.owner[asset]).toBe(w.player);
    expect(w.assets.owner[asset]).not.toBe(AUTHORITY);
  });
});

describe('canals and locks', () => {
  it('climbs a hill in chambers rather than refusing to be built', () => {
    const w = builderWorld();
    const canal = C.ways.findIndex((x) => x.id === 'canal');
    // A run that actually goes somewhere uphill, so the gradient is real.
    const size = w.terrain.size;
    let run: number[] = [];
    for (let y = 10; y < size - 10 && run.length === 0; y += 5) {
      for (let x = 10; x < size - 24; x += 5) {
        const tiles: number[] = [];
        let ok = true;
        let rise = 0;
        for (let i = 0; i < 12; i++) {
          const tile = y * size + (x + i);
          if (w.terrain.height[tile] <= 0) { ok = false; break; }
          if (i > 0) rise += Math.abs(w.terrain.height[tile] - w.terrain.height[tile - 1]);
          tiles.push(tile);
        }
        if (ok && rise > 40) { run = tiles; break; }
      }
    }
    expect(run.length).toBe(12);

    const plan = w.planWay(Mode.Water, canal, run);
    expect(plan.ok).toBe(true);
    expect(plan.locks).toBeGreaterThan(0);
    // A flight of locks is not free, and the estimate has to say so.
    const flat = C.ways[canal].buildCost * run.length;
    expect(plan.totalCost).toBeGreaterThan(flat);
  });

  it('does not put locks on a railway', () => {
    const w = builderWorld();
    const rail = C.ways.findIndex((x) => x.id === 'rail-light');
    const plan = w.planWay(Mode.Rail, rail, straightRun(w, 10));
    expect(plan.locks).toBe(0);
  });
});

void NONE;
