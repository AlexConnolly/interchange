/**
 * The palette has to keep working for everybody, and keep working when the
 * colour is gone.
 *
 * art-direction.md §10 states the rule and this is what stops it from being a
 * sentence in a document. A palette drifts one hex at a time, and the day two
 * companies become indistinguishable to a deuteranope is not a day anybody
 * notices without a check.
 */

import { describe, expect, it } from 'vitest';
import {
  findClashes, semanticOrderHolds, patternsCarryIdentity, perceptualDistance,
  simulate, Vision, LIVERIES, SEMANTIC,
} from '../src/index.ts';

describe('liveries', () => {
  it('gives the first four companies four different patterns', () => {
    // The one that matters: with the colour thrown away entirely, the shapes
    // still say whose it is.
    expect(patternsCarryIdentity(4)).toBe(true);
  });

  it('keeps same-pattern liveries apart under every kind of vision', () => {
    const clashes = findClashes();
    expect(clashes).toEqual([]);
  });

  it('is measuring something — two near-identical colours would clash', () => {
    // Guards the test itself. A distance function that returned a large number
    // for everything would pass the case above and be worthless.
    const a = LIVERIES[1].colour;
    const nearlyA: [number, number, number] = [a[0] * 1.02, a[1] * 1.02, a[2] * 1.02];
    expect(perceptualDistance(a, nearlyA)).toBeLessThan(4);
    expect(perceptualDistance(LIVERIES[1].colour, LIVERIES[2].colour)).toBeGreaterThan(12);
  });

  it('does not collapse red and green into each other for a deuteranope', () => {
    const crimson = LIVERIES.find((l) => l.name === 'Crimson');
    const green = LIVERIES.find((l) => l.name === 'Green');
    expect(crimson && green).toBeTruthy();
    if (!crimson || !green) return;
    const d = perceptualDistance(
      simulate(crimson.colour, Vision.Deuteranopia),
      simulate(green.colour, Vision.Deuteranopia),
    );
    // They are told apart by pattern too, but they should not be the same
    // colour either — this is the classic failure and worth naming.
    expect(d).toBeGreaterThan(8);
  });
});

describe('the congestion scale', () => {
  it('stays ordered by lightness under every kind of vision', () => {
    /*
     * Green-amber-orange-red is the worst possible scheme for a deuteranope
     * and is used anyway, because every player already knows it. What makes
     * that defensible is that the four are always shown as an ordered scale,
     * so position carries the meaning and hue only confirms it — and that
     * only works if the rungs stay distinct in lightness when the hue goes.
     */
    for (const row of semanticOrderHolds()) {
      expect(row.ok, `${row.vision}: ${row.lightness.map((l) => l.toFixed(1)).join(' ')}`).toBe(true);
    }
  });

  it('keeps free and jammed unmistakable, which is the pair that matters most', () => {
    for (const vision of [Vision.Normal, Vision.Protanopia, Vision.Deuteranopia, Vision.Tritanopia]) {
      const d = perceptualDistance(
        simulate(SEMANTIC.free, vision),
        simulate(SEMANTIC.jammed, vision),
      );
      expect(d).toBeGreaterThan(20);
    }
  });
});
