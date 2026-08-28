/**
 * The little world behind the menu.
 *
 * Two things here have a right answer and both were got wrong by the obvious
 * approach: which seeds are worth showing, and whether a fresh one is actually
 * fresh.
 */

import { describe, expect, it } from 'vitest';
import { DIORAMA_ELEVATION, CAMERA_ELEVATION } from '@interchange/render';
import {
  DIORAMA_SIZE, DIORAMA_ACROSS, DIORAMA_TRIES, DIORAMA_DAY, DIORAMA_BASE,
  dioramaAcross, goodEnough, seedFor,
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

/**
 * Does the whole block fit the frame, at every rotation?
 *
 * The arithmetic the menu turns on, and it is short enough to state. Under an
 * orthographic camera at elevation `el`, a world point offset `(dx, dz)` from the
 * centre lands at screen `x = dx*cos a - dz*sin a` and
 * `y = -(dx*sin a + dz*cos a) * sin(el) + dy * cos(el)`.
 *
 * The four edge midpoints sit `size/2` from the centre along a principal axis, so
 * the worst case over all rotations is `size/2` horizontally and
 * `(size/2)*sin(el)` vertically — plus the slab hanging `BASE_DEPTH*cos(el)` below
 * the waterline, which is the part that went off the bottom of the screen.
 *
 * Returns the vertical half-extent needed, in tiles.
 */
function needsVertically(size: number, el: number, base: number): number {
  return (size / 2) * Math.sin(el) + base * Math.cos(el);
}

/** What the frame gives, in tiles, for a window of this shape. */
function halfHeight(across: number, aspect: number): number {
  return (across / 2) * aspect;
}

describe('fitting the block in the frame', () => {
  /*
   * Every window shape anybody actually uses, plus the extremes.
   *
   * The bug this exists for: three screenshots in a row looked as though the slab
   * had never been built, and it had — its near cut face was one pixel below the
   * bottom of the window. A fixed frame width hid that on one monitor and brought
   * it straight back on a wide one.
   */
  const SHAPES: [string, number, number][] = [
    ['16:10 laptop', 1600, 1000],
    ['16:9', 1920, 1080],
    ['4:3', 1440, 1080],
    ['21:9 ultrawide', 2560, 1080],
    ['32:9, which is two monitors', 3840, 1080],
    ['a tall narrow window', 900, 1400],
  ];

  for (const [name, w, h] of SHAPES) {
    it(`keeps the near edge and its cut face on screen at ${name}`, () => {
      const across = dioramaAcross(h / w);
      expect(needsVertically(DIORAMA_SIZE, DIORAMA_ELEVATION, DIORAMA_BASE))
        .toBeLessThanOrEqual(halfHeight(across, h / w) + 1e-9);
    });

    it(`keeps the block's edges on screen horizontally at ${name}`, () => {
      expect(DIORAMA_SIZE / 2).toBeLessThan(dioramaAcross(h / w) / 2);
    });
  }

  it('never frames tighter than the floor, however tall the window', () => {
    expect(dioramaAcross(10)).toBe(DIORAMA_ACROSS);
  });

  it('does not ask for an infinite frame on a window with no height', () => {
    expect(Number.isFinite(dioramaAcross(0))).toBe(true);
  });

  it('would not have fitted at the game camera angle on a wide window', () => {
    /*
     * Pinned because it is the whole reason `DIORAMA_ELEVATION` exists. At the
     * game's 38 degrees the block needs a quarter more vertical room than at 28,
     * and on a 21:9 window that is the difference between fitting and not.
     */
    const wide = 1080 / 2560;
    const across = dioramaAcross(wide);
    expect(needsVertically(DIORAMA_SIZE, CAMERA_ELEVATION, DIORAMA_BASE))
      .toBeGreaterThan(halfHeight(across, wide));
  });

  it('shows the parish in leaf rather than in February', () => {
    /*
     * Day sixty is where the *game* starts, and at day sixty the trees are bare and
     * nothing is standing in the fields. A title card wants the other half of the
     * year.
     */
    expect(DIORAMA_DAY).toBeGreaterThan(120);
    expect(DIORAMA_DAY).toBeLessThan(250);
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
