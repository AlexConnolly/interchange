import { describe, expect, it } from 'vitest';
import { mistAt, mistOnDay } from '../src/air.ts';

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

describe('which mornings are foggy', () => {
  it('is not every morning', () => {
    /*
     * It was every morning, which is both wrong and self-defeating: a thing that
     * happens daily stops being weather. The first foggy dawn is the district
     * showing you something; the fortieth is a filter you have stopped seeing.
     */
    let foggy = 0;
    for (let day = 0; day < 288; day++) if (mistOnDay(day) > 0) foggy++;
    expect(foggy).toBeGreaterThan(288 * 0.1);
    expect(foggy).toBeLessThan(288 * 0.4);
  });

  it('favours the back end of the year, the way radiation fog does', () => {
    const month = (m: number): number => {
      let n = 0;
      for (let d = m * 24; d < (m + 1) * 24; d++) if (mistOnDay(d) > 0) n++;
      return n;
    };
    // October and November against May and June. The offset that puts the peak
    // in autumn was wrong on the first attempt and landed it in July, so this is
    // the assertion that caught it.
    const autumn = month(9) + month(10);
    const summer = month(4) + month(5);
    expect(autumn).toBeGreaterThan(summer * 2);
  });

  it('is the same for a given date however often you ask', () => {
    // Hashed off the day rather than rolled, so it costs no state and a date
    // cannot change its weather when you look away and back.
    for (const day of [3, 40, 191, 250]) {
      expect(mistOnDay(day)).toBe(mistOnDay(day));
      expect(mistOnDay(day + 288)).toBe(mistOnDay(day + 288));
    }
  });

  it('is mostly thin when it happens at all', () => {
    // How far under the line the roll fell decides the thickness, so a real
    // blanket is rare and a thin morning in the hollows is the common case.
    const thick: number[] = [];
    for (let day = 0; day < 288; day++) {
      const m = mistOnDay(day);
      if (m > 0) thick.push(m);
    }
    const full = thick.filter((m) => m > 0.9).length;
    expect(full).toBeLessThan(thick.length / 2);
  });
});
