/**
 * What counts as water, and the case that got through twice.
 *
 * The first water fix asked `height > 0` — sea level — and a beck in this district
 * is a flagged channel cut into ground well above it: measured on the opening
 * district, 385 of 387 river tiles sit above sea level. So the test caught the
 * coast, waved every river through, and the tractors carried on fording them.
 *
 * "Tractors are still driving through rivers because the farm fields are on them."
 * Exactly right, and it is the *bounding box* that puts them there — 16 of the 87
 * workable fields have a river across theirs, against the 6 the sea-level test was
 * catching.
 *
 * So this pins the predicate itself rather than the tractor. The tractor test in
 * `farmwork.test.ts` supplies its own `dry` and would pass against either version
 * of this file, which is why the bug survived it.
 */

import { describe, expect, it } from 'vitest';
import { TileFlag } from '@interchange/sim';
import { isStream, isWet } from '../src/water.ts';

const NONE = 0;
const RIVER = TileFlag.River;
/** Flags a tile can carry that have nothing to do with water. */
const OTHER = TileFlag.Mainland | TileFlag.Buildable;

describe('a river', () => {
  it('is water even though it is well above sea level', () => {
    // The whole bug, in one assertion. A beck at height 400 is water.
    expect(isWet(RIVER, 400)).toBe(true);
    expect(isStream(RIVER, 400)).toBe(true);
  });

  it('is water at any height above the sea, however high the ground', () => {
    for (const h of [1, 50, 400, 900]) {
      expect(isWet(RIVER, h), `height ${h}`).toBe(true);
    }
  });

  it('is still water when the tile carries other flags too', () => {
    // Terrain flags are a bitfield, and a river tile is also Mainland — an
    // equality test rather than a mask would have missed every one of them.
    expect(isWet(RIVER | OTHER, 400)).toBe(true);
    expect(isStream(RIVER | OTHER, 400)).toBe(true);
  });
});

describe('the sea', () => {
  it('is water', () => {
    expect(isWet(NONE, 0)).toBe(true);
    expect(isWet(NONE, -3)).toBe(true);
    expect(isWet(OTHER, -120)).toBe(true);
  });

  it('is not a stream, even where a river runs into it', () => {
    /*
     * The half of `isStream` that looks redundant and is not. A river flag on
     * ground already under the sea is the *mouth* of the river, and drawing a
     * channel across open water is drawing a line on the sea.
     */
    expect(isStream(RIVER, 0)).toBe(false);
    expect(isStream(RIVER, -5)).toBe(false);
    // But it is certainly still wet.
    expect(isWet(RIVER, -5)).toBe(true);
  });
});

describe('ordinary ground', () => {
  it('is dry', () => {
    for (const h of [1, 200, 400, 1200]) {
      expect(isWet(NONE, h), `height ${h}`).toBe(false);
      expect(isWet(OTHER, h), `height ${h}`).toBe(false);
    }
  });

  it('is not made wet by a flag that is not the river one', () => {
    // `Coast` in particular: a beach is dry land, and refusing to drive on it
    // would take a strip out of every field beside the sea for no reason.
    for (const f of [TileFlag.Coast, TileFlag.TownLand, TileFlag.Steep, TileFlag.Buildable]) {
      expect(isWet(f, 400), `flag ${f}`).toBe(false);
    }
  });
});

describe('the two answers agree', () => {
  it('anything drawn as a stream is something nothing may drive on', () => {
    /*
     * The invariant the whole file exists for. The renderer decides whether to
     * *draw* water and the machinery decides whether to *drive* on it, and those
     * being separate expressions is what let them drift apart. Checked across the
     * whole space rather than by inspection.
     */
    for (const f of [NONE, RIVER, OTHER, RIVER | OTHER, TileFlag.Coast]) {
      for (const h of [-10, -1, 0, 1, 100, 400]) {
        if (isStream(f, h)) expect(isWet(f, h), `flags ${f} height ${h}`).toBe(true);
      }
    }
  });
});
