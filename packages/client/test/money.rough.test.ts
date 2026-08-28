/**
 * A price to compare, not to budget with.
 *
 * The Build tray puts a figure under each building so they can be weighed against
 * each other. `shortMoney` was the obvious thing to reach for and it gives
 * "£130.0k" — a decimal place of false precision on a number whose hundreds are
 * unknowable anyway, because the real price depends on where the building goes.
 */

import { describe, expect, it } from 'vitest';
import { roughMoney, shortMoney, money } from '../src/format.ts';

describe('a rough price', () => {
  it('drops the decimal once there are more than ten of a unit', () => {
    expect(roughMoney(13_002_000)).toBe('£130k');
    expect(roughMoney(9_402_000)).toBe('£94k');
    expect(roughMoney(33_578_000)).toBe('£336k');
  });

  it('keeps one decimal below ten, where it is most of the number', () => {
    /*
     * "£1m" and "£2m" would flatten the whole interesting range of a big depot into
     * two values; 1.2 against 1.9 is a real difference to a player with two million
     * pounds.
     */
    expect(roughMoney(120_000_000)).toBe('£1.2m');
    expect(roughMoney(950_000)).toBe('£9.5k');
  });

  it('says plain pounds under a thousand', () => {
    expect(roughMoney(52_000)).toBe('£520');
    expect(roughMoney(99)).toBe('£1');
  });

  it('is shorter than the exact figure for every real building price', () => {
    /*
     * The point of it. A tray button is 62px and holds about eight characters at this
     * size; "£130,020" is on that limit and "£335,780" is over it.
     */
    for (const p of [2_058_000, 13_002_000, 25_248_000, 33_578_000]) {
      expect(roughMoney(p).length).toBeLessThanOrEqual(6);
      expect(roughMoney(p).length).toBeLessThan(money(p).length);
    }
  });

  it('does not lose the sign', () => {
    expect(roughMoney(-13_002_000)).toBe('-£130k');
  });

  it('differs from `shortMoney` only in dropping false precision', () => {
    /*
     * Kept side by side deliberately: `shortMoney` is used elsewhere and this is not
     * a replacement for it, it is a second opinion for a narrower job.
     */
    expect(shortMoney(13_002_000)).toBe('£130.0k');
    expect(roughMoney(13_002_000)).toBe('£130k');
  });
});
