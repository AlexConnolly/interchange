import { describe, expect, it } from 'vitest';
import { foliage } from '../src/fields.ts';
import { DAYS_PER_MONTH } from '../src/constants.ts';

/**
 * The year, in leaves.
 *
 * The district had four seasons from the beginning and the vegetation knew about
 * none of them — the same tree, in the same green, in January and July. This is
 * the curve that fixed it, and it is worth a test for the same reason `mistAt`
 * is: the failure that matters is not "slightly wrong shade of green", it is
 * *bare trees in July*, which is one sign error and which nothing else in the
 * renderer would notice.
 *
 * Mid-month, in a calendar of twelve twenty-four-day months.
 */
const mid = (month: number): { leaf: number; spring: number; autumn: number } =>
  foliage(month * DAYS_PER_MONTH + DAYS_PER_MONTH / 2);

const JAN = 0;
const APR = 3;
const JUL = 6;
const OCT = 9;

describe('the leaf year', () => {
  it('is bare in the depths of winter', () => {
    expect(mid(JAN).leaf).toBe(0);
    expect(mid(11).leaf).toBe(0);
    // And nothing is flowering or turning either.
    expect(mid(JAN).spring).toBe(0);
    expect(mid(JAN).autumn).toBe(0);
  });

  it('is in full leaf right through summer', () => {
    for (const m of [5, JUL, 7, 8]) {
      expect(mid(m).leaf, `month ${m}`).toBe(1);
      // No blossom and no turn in August, which is the mistake a naive pair of
      // sine waves makes and which reads as the year running backwards.
      expect(mid(m).spring, `month ${m}`).toBe(0);
    }
  });

  it('flowers on the way up, not on the way down', () => {
    /*
     * Daffodils and blackthorn flower on bare wood — that is the whole point of
     * them, and it is why spring is derived from the *arrival* of the leaf
     * rather than from a date range. April must have it; October must not, even
     * though the canopy is halfway in both.
     */
    expect(mid(APR).spring).toBeGreaterThan(0.4);
    expect(mid(OCT).spring).toBe(0);
    expect(mid(APR).leaf).toBeGreaterThan(0);
    expect(mid(APR).leaf).toBeLessThan(1);
  });

  it('turns on the way down, not on the way up', () => {
    expect(mid(OCT).autumn).toBeGreaterThan(0.4);
    expect(mid(APR).autumn).toBe(0);
  });

  it('never steps, anywhere in the year', () => {
    /*
     * Continuity is the whole discipline here, the same as the sun's. A season
     * that snapped on a date would change every tree in the district between one
     * frame and the next — and the trees are swapped for other *models* at the
     * ends of this curve, so a jump would be visible as the whole wood flicking
     * over at once.
     */
    let prev = foliage(0);
    for (let d = 1; d <= DAYS_PER_MONTH * 12; d++) {
      const now = foliage(d);
      expect(Math.abs(now.leaf - prev.leaf), `day ${d}`).toBeLessThan(0.09);
      expect(Math.abs(now.spring - prev.spring), `day ${d}`).toBeLessThan(0.19);
      expect(Math.abs(now.autumn - prev.autumn), `day ${d}`).toBeLessThan(0.19);
      prev = now;
    }
  });

  it('comes round again, so year two looks like year one', () => {
    for (const m of [JAN, APR, JUL, OCT]) {
      const a = mid(m);
      const b = foliage(m * DAYS_PER_MONTH + DAYS_PER_MONTH / 2 + DAYS_PER_MONTH * 12);
      expect(b.leaf).toBeCloseTo(a.leaf, 6);
      expect(b.autumn).toBeCloseTo(a.autumn, 6);
    }
  });
});
