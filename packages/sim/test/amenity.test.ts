/**
 * Amenity is the design's central tension and it has to actually bite.
 *
 * design.md §2.3 makes a specific promise: open a pit above a lake valley and
 * the resort down the shore starts losing money, and you own both. That is
 * testable, and it is worth testing, because every part of it is easy to build
 * in a way that technically runs and changes nothing anybody would notice.
 */

import { describe, expect, it } from 'vitest';
import {
  AmenityField, stepAmenity, tourismYield, RECOVERY_PER_YEAR,
  REMEDIATION_FROM_ERA, SiteTable, createWorld, Charter, TICKS_PER_YEAR,
} from '../src/index.ts';

/** A field where every cell is pleasant, and one site in the middle of it. */
function pleasantRegion(size = 64) {
  const field = new AmenityField(size);
  field.potential.fill(80);
  field.current.fill(80);
  const sites = new SiteTable(8);
  return { field, sites };
}

const noTraffic = { trafficAt: () => 0 };

describe('the amenity field', () => {
  it('is spoiled by an industry, worst at the pithead', () => {
    const { field, sites } = pleasantRegion();
    const s = sites.alloc(0, 32, 32, 32 * 64 + 32, 1, 100);
    expect(s).toBeGreaterThanOrEqual(0);

    stepAmenity(field, sites, {
      size: 64, penaltyOf: () => 40, radiusOf: () => 6, ...noTraffic, yearFraction: 1,
    });

    const atPit = field.at(32, 32);
    const nearby = field.at(32 + 10, 32);
    const faraway = field.at(32, 60);
    expect(atPit).toBeLessThan(50);
    expect(nearby).toBeGreaterThan(atPit);
    expect(faraway).toBe(80);
  });

  it('spoils at once and mends slowly, which is the whole point', () => {
    const { field, sites } = pleasantRegion();
    sites.alloc(0, 32, 32, 32 * 64 + 32, 1, 100);
    const ctx = {
      size: 64, penaltyOf: () => 40, radiusOf: () => 6, ...noTraffic, yearFraction: 1,
    };
    stepAmenity(field, sites, ctx);
    const spoiled = field.at(32, 32);
    expect(spoiled).toBeLessThan(50);

    // The pit closes. One year later it is barely better.
    const gone = { ...ctx, penaltyOf: () => 0 };
    stepAmenity(field, sites, gone);
    expect(field.at(32, 32)).toBeLessThanOrEqual(spoiled + RECOVERY_PER_YEAR + 1);

    // Forty years later it has come back.
    for (let i = 0; i < 40; i++) stepAmenity(field, sites, gone);
    expect(field.at(32, 32)).toBeGreaterThan(75);
  });

  it('counts traffic noise, weighted by how busy the way is', () => {
    const { field, sites } = pleasantRegion();
    const quiet = { size: 64, penaltyOf: () => 0, radiusOf: () => 0, trafficAt: () => 0, yearFraction: 1 };
    stepAmenity(field, sites, quiet);
    expect(field.at(10, 10)).toBe(80);

    const busy = { ...quiet, trafficAt: (tile: number) => (tile === 10 * 64 + 10 ? 1 : 0) };
    stepAmenity(field, sites, busy);
    expect(field.at(10, 10)).toBeLessThan(70);
    // And the next valley over is untouched.
    expect(field.at(40, 40)).toBe(80);
  });
});

describe('what a resort earns', () => {
  it('falls away steeply as the valley is spoiled', () => {
    expect(tourismYield(90)).toBeGreaterThan(0.7);
    expect(tourismYield(60)).toBeLessThan(tourismYield(90) * 0.6);
    expect(tourismYield(20)).toBe(0);
    expect(tourismYield(0)).toBe(0);
  });
});

/*
 * The remediation tests went with the Phase A cut.
 *
 * Amenity itself stays and is now core rather than deferred: design.md 7 makes
 * it the counterweight to the top rung of the ladder, because siting industry
 * without a downside is not a decision. What went is the *command* that lets a
 * player pay to clean ground up, which was gated behind a land charter and an
 * era, and belongs with industry siting in Phase E.
 *
 * So the field is tested here and the acting on it is not, because there is
 * nothing yet to act with.
 */
