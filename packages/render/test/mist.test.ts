import { describe, expect, it } from 'vitest';
import { mistAt } from '../src/air.ts';

/**
 * When there is fog, and — more importantly — when there is not.
 *
 * Radiation fog forms overnight on still ground and burns off within an hour or
 * two of the sun reaching it, which in England means it is a thing you see
 * between about four and nine in the morning and at no other time. The failure
 * this guards against is not "too little fog": it is fog at two in the
 * afternoon, which stops reading as weather and starts reading as a dirty
 * screen. That is a one-character mistake in a comparison and nothing else in
 * the renderer would notice it.
 */
describe('morning mist', () => {
  it('is at full strength before the sun gets to it', () => {
    expect(mistAt(5)).toBe(1);
    expect(mistAt(6.5)).toBe(1);
    expect(mistAt(7.4)).toBe(1);
  });

  it('is gone by mid-morning and stays gone all day', () => {
    expect(mistAt(10)).toBe(0);
    expect(mistAt(12)).toBe(0);
    expect(mistAt(15)).toBe(0);
    expect(mistAt(20)).toBe(0);
  });

  it('is gone in the small hours too, before it has formed', () => {
    expect(mistAt(0)).toBe(0);
    expect(mistAt(2.9)).toBe(0);
  });

  it('burns off rather than switching off', () => {
    /*
     * The shape either side matters as much as the extent. A step to zero at a
     * fixed hour is a whole district changing in one frame, which is the same
     * class of mistake as the street lamps all going out together — see
     * `streetOn` in `scene.ts`, which was faded for this reason.
     */
    const morning = [7.5, 8, 8.5, 9, 9.5, 10].map(mistAt);
    for (let i = 1; i < morning.length; i++) {
      expect(morning[i]).toBeLessThan(morning[i - 1] + 1e-9);
      expect(morning[i - 1] - morning[i]).toBeLessThan(0.45);
    }
    // And it comes up rather than appearing.
    expect(mistAt(3.5)).toBeGreaterThan(0);
    expect(mistAt(3.5)).toBeLessThan(1);
  });
});
