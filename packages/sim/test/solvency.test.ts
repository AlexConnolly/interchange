/**
 * Two bugs that each emptied the region, and neither of which looked like
 * anything when it happened.
 *
 * Both were found by the timelapse tool rather than by the balance sweep, for
 * the same reason: the sweep runs 140 years and averages, and both of these
 * are slow. A picture of two centuries showed a region with no vehicles in it
 * from about 1940 onward, which no summary statistic had ever said.
 */

import { describe, expect, it } from 'vitest';
import {
  createWorld, CompanyTable, TICKS_PER_YEAR, TICKS_PER_DAY, MONTHS_PER_YEAR,
  DAYS_PER_MONTH, LINE_COUNT, Line, AUTHORITY, SiteState,
} from '../src/index.ts';
import { loadContent } from '@interchange/data';

loadContent();

describe('the twelve-month window', () => {
  it('does not empty itself on the first of January', () => {
    /*
     * It used to. `closeYear` zeroed the annual ledger on the year boundary,
     * so on new year's day every company in the region read as having earned
     * nothing whatever it had actually done — and the AI's retrenchment rule,
     * which asks whether income covers running costs, answered no for
     * everybody and started selling fleets.
     *
     * Tested against the table directly rather than through a world, because
     * a world's own trading moves between one month and the next and would
     * make this assertion about the region rather than about the window.
     */
    const t = new CompanyTable();
    const c = t.alloc('Wentbridge Carrying', 100_000, true, 0);
    const base = c * LINE_COUNT;
    // A steady thousand a month, for two full years.
    for (let m = 0; m < MONTHS_PER_YEAR * 2; m++) {
      t.post(c, Line.Haulage, 1000);
      t.closeMonth();
    }
    // Twelve months in the window, whatever the calendar thinks.
    expect(t.ledgerYear[base + Line.Haulage]).toBe(12_000);
    expect(t.ledgerTotal[base + Line.Haulage]).toBe(24_000);
    // And another month does not empty it.
    t.post(c, Line.Haulage, 1000);
    t.closeMonth();
    expect(t.ledgerYear[base + Line.Haulage]).toBe(12_000);
  });

  it('drops the oldest month when a new one arrives', () => {
    const t = new CompanyTable();
    const c = t.alloc('Marchbank & Son', 0, true, 0);
    const base = c * LINE_COUNT;
    t.post(c, Line.Haulage, 5000);
    for (let m = 0; m < MONTHS_PER_YEAR; m++) t.closeMonth();
    // Still just inside the window.
    expect(t.ledgerYear[base + Line.Haulage]).toBe(5000);
    t.closeMonth();
    // And now it has aged out — gradually, at the back, never all at once.
    expect(t.ledgerYear[base + Line.Haulage]).toBe(0);
    expect(t.ledgerTotal[base + Line.Haulage]).toBe(5000);
  });

  it('is a window, so what leaves it is only what aged out', () => {
    const w = createWorld({ seed: 5, size: 128, townCount: 5, companyCount: 3 });
    for (let i = 0; i < TICKS_PER_YEAR * 2; i++) w.step();
    const c = 1;
    const base = c * LINE_COUNT;
    // The window can never hold more than the lifetime total.
    for (let l = 0; l < LINE_COUNT; l++) {
      expect(w.companies.ledgerYear[base + l])
        .toBeLessThanOrEqual(w.companies.ledgerTotal[base + l] + 1e-6);
    }
  });

  it('covers twelve months of history and no more', () => {
    expect(MONTHS_PER_YEAR * DAYS_PER_MONTH * TICKS_PER_DAY).toBe(TICKS_PER_YEAR);
  });
});

/*
 * The failed-operator tests went with the rivals cut, and it is worth saying
 * what they were for so the loss is deliberate.
 *
 * They pinned a bug that ended every region: bankruptcy put a company's ways on
 * the market, the slot was re-used by the next entrant, and the ways were still
 * attached to it - so every new operator was born owning the derelict network
 * of the company that had just died of owning it. Nine ways, four hundred
 * thousand a year of upkeep, on the first morning, against a quarter of a
 * million of capital.
 *
 * There is now one company in the district and no entrants, so there is no
 * slot to re-use and nothing to inherit. The bug cannot occur because the
 * machinery that produced it is gone.
 *
 * What survives above is the twelve-month window, and that is the half worth
 * keeping: it was the other cause of the same collapse, it is not about rivals
 * at all, and every valuation and credit decision still reads it.
 */
