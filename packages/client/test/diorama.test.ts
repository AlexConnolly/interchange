/**
 * The little world behind the menu.
 *
 * Two things here have a right answer and both were got wrong by the obvious
 * approach: which seeds are worth showing, and whether a fresh one is actually
 * fresh.
 */

import { describe, expect, it } from 'vitest';
import {
  DIORAMA_SIZE, DIORAMA_ACROSS, DIORAMA_TRIES, goodEnough, seedFor,
} from '../src/diorama.ts';

describe('choosing a seed', () => {
  it('gives a different world on every launch', () => {
    /*
     * The whole of "rotate the seed every time". A menu that showed the same
     * district each time would be a picture; one that shows a new one is the game
     * telling you it makes places.
     */
    const seen = new Set<number>();
    for (let ms = 0; ms < 200; ms++) seen.add(seedFor(1_700_000_000_000 + ms, 0));
    expect(seen.size).toBe(200);
  });

  it('does not give a nearly-identical world one millisecond later', () => {
    /*
     * Hashed rather than used raw, and this is why. Consecutive seeds out of the
     * generator give districts that differ in detail and share their shape, and a
     * menu that comes back *nearly* the same reads as the game having failed to
     * regenerate rather than as variety.
     */
    for (let ms = 0; ms < 50; ms++) {
      const a = seedFor(1_700_000_000_000 + ms, 0);
      const b = seedFor(1_700_000_000_000 + ms + 1, 0);
      expect(Math.abs(a - b)).toBeGreaterThan(50);
    }
  });

  it('gives each retry a different seed from the one that failed', () => {
    const now = 1_700_000_000_000;
    const tries = new Set<number>();
    for (let a = 0; a < DIORAMA_TRIES; a++) tries.add(seedFor(now, a));
    expect(tries.size).toBe(DIORAMA_TRIES);
  });

  it('never returns zero, which some generators read as no seed', () => {
    for (let ms = 0; ms < 500; ms++) {
      expect(seedFor(1_700_000_000_000 + ms, ms % DIORAMA_TRIES)).toBeGreaterThan(0);
    }
  });
});

describe('deciding whether a world is worth looking at', () => {
  it('turns down the barren ones', () => {
    /*
     * The measured failure: two seeds in thirty at this size came out with no
     * town, no road and two lone farms. Those are the numbers, verbatim.
     */
    expect(goodEnough({ towns: 0, sites: 2, roadTiles: 0 })).toBe(false);
  });

  it('accepts the thin end of the good range', () => {
    // Also measured: the poorest passing seed of the thirty.
    expect(goodEnough({ towns: 1, sites: 5, roadTiles: 35 })).toBe(true);
  });

  it('turns down a world with a town and no roads to it', () => {
    /*
     * They fail together in practice, but the point of testing each is that a
     * diorama with no road in it has nothing for a lorry to be on — and a lorry is
     * the thing the picture is meant to be about.
     */
    expect(goodEnough({ towns: 2, sites: 9, roadTiles: 0 })).toBe(false);
  });
});

describe('the framing', () => {
  it('is wider than the world, so the block has air round it as it turns', () => {
    /*
     * A square seen corner-on is its diagonal wide, so a frame merely equal to the
     * world clips two corners off twice a revolution.
     */
    expect(DIORAMA_ACROSS).toBeGreaterThan(DIORAMA_SIZE);
  });

  it('keeps the world big enough for the generator to furnish it', () => {
    /*
     * Measured at 32, 40 and 48 tiles: no towns and no roads at all, because the
     * town placer needs room to stand back from the coast. Shrinking this to make
     * the menu cuter would empty it.
     */
    expect(DIORAMA_SIZE).toBeGreaterThanOrEqual(56);
  });
});
