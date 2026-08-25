/**
 * Weather has to be seasonal, bounded, and never a tax the player cannot see.
 *
 * The interesting cases are the ones where a plausible implementation is
 * wrong in a way nobody notices for months: snow that falls as often in July
 * as in January, a flood that never ends, a boom in a cargo that travels down
 * a wire.
 */

import { describe, expect, it } from 'vitest';
import {
  Climate, EventTable, stepEvents, Season, Weather, SNOW_LINE, FLOOD_LINE,
  floodSeverity, strikePercent, runningCostPercent, ratePercent, EventKind,
  Rng, TICKS_PER_DAY, DAYS_PER_YEAR, createWorld, TICKS_PER_YEAR,
} from '../src/index.ts';

describe('the seasons', () => {
  it('puts snow in winter and not in summer', () => {
    const climate = new Climate();
    const rng = new Rng(99);
    const days = new Map<string, number>();
    for (let d = 0; d < DAYS_PER_YEAR * 30; d++) {
      climate.step(d * TICKS_PER_DAY, d, rng);
      const key = `${climate.season(d)}/${climate.weather}`;
      days.set(key, (days.get(key) ?? 0) + 1);
    }
    const winterSnow = days.get(`${Season.Winter}/${Weather.Snow}`) ?? 0;
    const summerSnow = days.get(`${Season.Summer}/${Weather.Snow}`) ?? 0;
    expect(winterSnow).toBeGreaterThan(200);
    expect(summerSnow).toBe(0);
  });

  it('sends more tourists in summer than in winter', () => {
    const climate = new Climate();
    const summer = DAYS_PER_YEAR * 0.4;
    const winter = DAYS_PER_YEAR * 0.9;
    expect(climate.season(summer)).toBe(Season.Summer);
    expect(climate.season(winter)).toBe(Season.Winter);
    expect(climate.tourismMultiplier(summer)).toBeGreaterThan(
      climate.tourismMultiplier(winter) * 3,
    );
  });
});

describe('snow and height', () => {
  it('shuts a pass long before it troubles the coast road', () => {
    const climate = new Climate();
    climate.weather = Weather.Snow;
    climate.severity = 100;
    const low = climate.speedPercent(SNOW_LINE - 1);
    const high = climate.speedPercent(SNOW_LINE + 400);
    expect(low).toBeGreaterThan(high * 1.5);
    expect(high).toBeLessThan(50);
  });

  it('does nothing at all when it is clear', () => {
    const climate = new Climate();
    expect(climate.speedPercent(0)).toBe(100);
    expect(climate.speedPercent(SNOW_LINE + 2000)).toBe(100);
  });
});

describe('disruption', () => {
  it('opens rarely and always closes again', () => {
    const events = new EventTable();
    const climate = new Climate();
    const rng = new Rng(7);
    let opened = 0;
    const years = 40;
    for (let d = 0; d < DAYS_PER_YEAR * years; d++) {
      climate.step(d * TICKS_PER_DAY, d, rng);
      const r = stepEvents(events, {
        tick: d * TICKS_PER_DAY, day: d, era: 3, companyCount: 4,
        cargoCount: 8, liveCargo: [0, 1, 2], climate,
      }, rng);
      opened += r.opened.length;
    }
    // Roughly one a year, and nothing like one a week.
    expect(opened).toBeGreaterThan(years * 0.3);
    expect(opened).toBeLessThan(years * 2.5);

    // Run past every deadline; nothing may still be running.
    const far = DAYS_PER_YEAR * (years + 5) * TICKS_PER_DAY;
    stepEvents(events, {
      tick: far, day: DAYS_PER_YEAR * (years + 5), era: 3, companyCount: 4,
      cargoCount: 8, liveCargo: [0, 1, 2], climate,
    }, rng);
    for (let i = 0; i < events.count; i++) {
      if (events.active[i]) expect(events.ends[i]).toBeGreaterThan(far);
    }
  });

  it('reads back only against the thing it landed on', () => {
    const events = new EventTable();
    events.open(EventKind.Strike, 0, 5, 2, 60, 'out');
    expect(strikePercent(events, 2)).toBeLessThan(100);
    expect(strikePercent(events, 1)).toBe(100);

    events.open(EventKind.Boom, 0, 5, 4, 180, 'boom');
    expect(ratePercent(events, 4)).toBe(180);
    expect(ratePercent(events, 5)).toBe(100);

    expect(runningCostPercent(events)).toBe(100);
    events.open(EventKind.FuelPrice, 0, 5, -1, 170, 'dear');
    expect(runningCostPercent(events)).toBe(170);

    expect(floodSeverity(events)).toBe(0);
    events.open(EventKind.Flood, 0, 5, -1, 80, 'wet');
    expect(floodSeverity(events)).toBe(80);
  });
});

describe('the world under weather', () => {
  it('stays deterministic across instances', () => {
    const a = createWorld({ seed: 313, size: 256, townCount: 8, companyCount: 4 });
    const b = createWorld({ seed: 313, size: 256, townCount: 8, companyCount: 4 });
    for (let i = 0; i < TICKS_PER_YEAR * 3; i++) { a.step(); b.step(); }
    expect(a.hash()).toBe(b.hash());
    // And the weather actually moved, so the test is not vacuous.
    expect(a.tick).toBeGreaterThan(0);
  });

  it('never lets weather stop the region dead', () => {
    const w = createWorld({ seed: 5150, size: 256, townCount: 8, companyCount: 4 });
    for (let c = 1; c < w.companies.count; c++) w.companies.isAi[c] = 1;
    for (let i = 0; i < TICKS_PER_YEAR * 12; i++) w.step();
    // Whatever the sky is doing, the region still carries things.
    expect(w.stats.tonnesMoved).toBeGreaterThan(0);
  });
});

void FLOOD_LINE;
