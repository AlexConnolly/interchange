/**
 * Money, in pence, as English.
 *
 * Pinned because the one bug this function ever had was invisible for months and
 * then wrong everywhere at once: the millions threshold was written
 * `100_000_00`, which reads as a hundred thousand and is, so every figure above
 * a hundred thousand pounds was divided by a hundred thousand and labelled with
 * an m. Nothing in the first ten minutes of a game goes near that, so it only
 * appeared the first time somebody started with enough to buy a business — and
 * then overstated every price in the game tenfold.
 *
 * The lesson worth keeping is that the boundary cases are the whole of it, so
 * they are all here.
 */

import { describe, it, expect } from 'vitest';
import { money } from '../src/Markers.tsx';

describe('money', () => {
  it('gives pence to the penny under a thousand pounds', () => {
    expect(money(0)).toBe('£0.00');
    expect(money(1)).toBe('£0.01');
    expect(money(34_50)).toBe('£34.50');
    expect(money(999_99)).toBe('£999.99');
  });

  it('drops the pence and groups thousands from a thousand pounds up', () => {
    expect(money(1_000_00)).toBe('£1,000');
    expect(money(11_500_00)).toBe('£11,500');
    expect(money(52_042_00)).toBe('£52,042');
    expect(money(999_999_00)).toBe('£999,999');
  });

  it('switches to millions at a million pounds and not at a hundred thousand', () => {
    // The bug, precisely: this used to say "£1.0m".
    expect(money(100_000_00)).toBe('£100,000');
    expect(money(1_000_000_00)).toBe('£1.0m');
    expect(money(1_500_000_00)).toBe('£1.5m');
    expect(money(14_900_000_00)).toBe('£14.9m');
  });

  it('reads negatives as debts rather than as small numbers', () => {
    // The threshold is on the magnitude, so an overdraft of two million is not
    // formatted as though it were pence.
    expect(money(-2_000_000_00)).toBe('£-2.0m');
    expect(money(-4_500_00)).toBe('£-4,500');
  });
});
