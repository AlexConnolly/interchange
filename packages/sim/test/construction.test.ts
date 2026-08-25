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
        /*
         * Flat, not merely dry.
         *
         * The classes now have real gradient limits that differ between them - a
         * dual carriageway will not climb what a farm track will - so a run that
         * is only "above sea level" refuses the wider classes and the test read
         * that as the palette being broken. It was the gradient rule working.
         */
        if (i > 0 && Math.abs(w.terrain.height[tile] - w.terrain.height[tile - 1]) > 14) {
          ok = false;
          break;
        }
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
      /*
       * No stepping to an era, because there is only one and the game starts in
       * it (decisions.md D7).
       *
       * This used to walk the clock to `(era.from + 1 - 1860) * TICKS_PER_YEAR`,
       * which was a few thousand ticks when the game began in 1860 with a
       * 11,520-tick year. It is twenty-nine million now that it begins in 1985
       * with a 230,400-tick year, and the test took a hundred and fifteen
       * seconds. An arithmetic expression with a hard-coded epoch in it is a
       * test that expires.
       */
      const mode = MODE_NAMES.indexOf(way.mode as never);
      expect(mode).toBeGreaterThanOrEqual(0);

      const run = straightRun(w, 6);
      expect(run.length).toBe(6);
      const cls = C.ways.indexOf(way);
      if (w.buildWay(w.player, mode, cls, run)) built.push(way.id);
      else refused.push(way.id);
    }

    expect(refused).toEqual([]);
    /*
     * Four, and the number is the assertion.
     *
     * This asked for more than eight, which was right when there were sixteen
     * way classes across five modes and eight eras. There are four now — farm
     * track, lane, road, dual carriageway — and a test that expects a big
     * content set is a test that fights a content cut.
     */
    expect(built.length).toBe(C.ways.filter((x) => x.buildCost > 0).length);
  });

  /*
   * The era-gate test went with the eras (decisions.md D7).
   *
   * It asked for a class the current era had not opened, which was a safe thing
   * to ask for across eight eras and is impossible across one: there is nothing
   * beyond the only era there is. The charter gate below covers the case that
   * still exists - being refused because of who you are rather than when it is.
   */

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

/*
 * The canal tests went with canals (cut.md). They pinned locks lifting a route
 * over a hill in chambers rather than refusing to be built, and locks not being
 * put on a railway - both good behaviour, and both about a mode that is not in
 * the game: canal freight was finished by 1985, so this is a content cut rather
 * than a deferral.
 */

void NONE;
