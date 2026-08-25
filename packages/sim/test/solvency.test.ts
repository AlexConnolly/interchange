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

describe('a failed operator', () => {
  it('does not leave its ways round the neck of the next one', () => {
    /*
     * The bug this pins is the one that ended the region.
     *
     * Bankruptcy puts a company's ways on the market, which is design.md 3.8
     * and is right. But the company slot is then re-used by the next entrant,
     * and the ways were still attached to it — so every new operator was born
     * owning the derelict network of the company that had just died of owning
     * it, and inherited its upkeep on the first morning. There was no sequence
     * of good decisions that survived that, and the region reliably ran out of
     * vehicles altogether and stayed empty for the rest of the game.
     */
    const w = createWorld({ seed: 7, size: 160, townCount: 6, companyCount: 4 });
    // Give a rival a way to own, then fail it.
    for (let i = 0; i < TICKS_PER_YEAR * 6; i++) w.step();
    // Not slot 1: that is the player, and the entrant rules leave it alone.
    const victim = 2;
    let owned = 0;
    for (let a = 0; a < w.assets.count; a++) {
      if (w.assets.owner[a] === AUTHORITY) {
        w.assets.owner[a] = victim;
        owned++;
        if (owned >= 3) break;
      }
    }
    expect(owned).toBeGreaterThan(0);

    // Strand it: no fleet, no money. checkStalled winds it up after its grace
    // period, and some years later somebody takes the slot on.
    for (let v = 0; v < w.vehicles.count; v++) {
      if (w.vehicles.alive[v] && w.vehicles.company[v] === victim) w.sellVehicle(v, false);
    }
    w.companies.cash[victim] = 0;
    const name = w.companies.names[victim];
    for (let y = 0; y < 14 && w.companies.names[victim] === name; y++) {
      for (let i = 0; i < TICKS_PER_YEAR; i++) w.step();
      w.companies.cash[victim] = Math.min(w.companies.cash[victim], 0);
    }
    expect(w.companies.names[victim]).not.toBe(name);

    // Whoever it is now, they do not own the dead company's network.
    let inherited = 0;
    for (let a = 0; a < w.assets.count; a++) if (w.assets.owner[a] === victim) inherited++;
    expect(inherited).toBe(0);
  });

  it('leaves a region that still has vehicles in it two centuries later', () => {
    /*
     * The end-to-end version, and the assertion the timelapse made obvious.
     * Not a demand that the region prosper — only that it still be a game in
     * 2100 rather than an empty map with nine derelict ways on it.
     */
    const w = createWorld({ seed: 1860, size: 256, townCount: 10, companyCount: 5 });
    for (let i = 0; i < TICKS_PER_YEAR * 240; i++) w.step();

    let vehicles = 0;
    for (let v = 0; v < w.vehicles.count; v++) if (w.vehicles.alive[v]) vehicles++;
    expect(vehicles).toBeGreaterThan(0);

    let trading = 0;
    for (let c = 1; c < w.companies.count; c++) {
      if (w.companies.ledgerYear[c * LINE_COUNT + Line.Haulage] > 0) trading++;
    }
    expect(trading).toBeGreaterThan(0);

    let alive = 0;
    for (let s = 0; s < w.sites.count; s++) if (w.sites.state[s] !== SiteState.Dead) alive++;
    expect(alive).toBeGreaterThan(0);
  }, 120_000);
});
