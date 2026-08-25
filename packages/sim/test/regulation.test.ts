/**
 * The regulator has to be *earned*, which is the whole of the Phase 4 gate.
 *
 * That is a design claim, and a design claim that nothing checks is a design
 * claim that quietly stops being true. Each case below is one clause of it:
 * it does not act before it has the power, it does not act on a company that
 * is merely successful, it warns before it bites, and it lets go.
 */

import { describe, expect, it } from 'vitest';
import {
  RegulatorTable, stepRegulator, accessChargeFor, Intervention,
  CAPPED_CHARGE, PATIENCE_DAYS, REMISSION_DAYS, REGULATOR_FROM_ERA,
  AssetTable, CompanyTable, Mode, TICKS_PER_DAY, AUTHORITY,
} from '../src/index.ts';

/** A region where `share` of the way belongs to company 1 and the rest to the
 *  authority. Everything else about it is uninteresting on purpose. */
function region(share: number) {
  const assets = new AssetTable();
  const companies = new CompanyTable();
  companies.alloc('Authority', 0, false, 0);
  companies.alloc('Player', 100000, false, 1);
  companies.alloc('Rival', 100000, true, 2);

  const mine = assets.alloc(Mode.Road, 0, 1, 40, 0);
  assets.tiles[mine] = Math.round(1000 * share);
  assets.passesPrev[mine] = 500;
  const theirs = assets.alloc(Mode.Road, 0, AUTHORITY, 4, 0);
  assets.tiles[theirs] = 1000 - assets.tiles[mine];
  return { assets, companies, mine, theirs };
}

function run(
  reg: RegulatorTable, r: ReturnType<typeof region>, days: number, era: number,
  from = 0,
): { purchases: number } {
  let purchases = 0;
  for (let d = 0; d < days; d++) {
    stepRegulator(
      reg, r.assets, r.companies, era, (from + d) * TICKS_PER_DAY, 320,
      () => { purchases++; },
    );
  }
  return { purchases };
}

describe('the regulator', () => {
  it('has no powers before its era, however dominant the company', () => {
    const reg = new RegulatorTable();
    const r = region(0.95);
    run(reg, r, PATIENCE_DAYS * 4, REGULATOR_FROM_ERA - 2);
    expect(reg.level[1]).toBe(Intervention.None);
    expect(r.assets.charge[r.mine]).toBe(40);
  });

  it('leaves a company alone that owns a normal share of the region', () => {
    const reg = new RegulatorTable();
    const r = region(0.2);
    run(reg, r, PATIENCE_DAYS * 4, REGULATOR_FROM_ERA);
    expect(reg.level[1]).toBe(Intervention.None);
  });

  it('sends a letter before it caps anything', () => {
    const reg = new RegulatorTable();
    const r = region(0.9);
    // Just past the first threshold and no further.
    run(reg, r, PATIENCE_DAYS + 2, REGULATOR_FROM_ERA);
    expect(reg.level[1]).toBe(Intervention.Referral);
    // A referral is a letter. It costs nothing yet.
    expect(r.assets.charge[r.mine]).toBe(40);
  });

  it('escalates one step at a time, never two at once', () => {
    const reg = new RegulatorTable();
    const r = region(0.9);
    const seen: number[] = [];
    for (let step = 0; step < 4; step++) {
      run(reg, r, PATIENCE_DAYS + 2, REGULATOR_FROM_ERA, step * (PATIENCE_DAYS + 2));
      seen.push(reg.level[1]);
    }
    expect(seen).toEqual([
      Intervention.Referral,
      Intervention.ChargeCap,
      Intervention.OpenAccess,
      Intervention.CompulsoryPurchase,
    ]);
  });

  it('caps the charge once it reaches the charge cap, and opens access after', () => {
    const reg = new RegulatorTable();
    const r = region(0.9);
    run(reg, r, (PATIENCE_DAYS + 2) * 2, REGULATOR_FROM_ERA);
    expect(reg.level[1]).toBe(Intervention.ChargeCap);
    expect(r.assets.charge[r.mine]).toBe(CAPPED_CHARGE);

    // At a cap, the owner is still the one setting the (capped) price.
    expect(accessChargeFor(reg, r.assets, r.mine)).toBe(CAPPED_CHARGE);
    r.assets.charge[r.mine] = 400;
    reg.level[1] = Intervention.OpenAccess;
    // At open access it is common carriage whatever the owner writes down.
    expect(accessChargeFor(reg, r.assets, r.mine)).toBe(CAPPED_CHARGE);
  });

  it('buys, rather than seizes, and only at the last step', () => {
    const reg = new RegulatorTable();
    const r = region(0.9);
    const before = run(reg, r, (PATIENCE_DAYS + 2) * 3, REGULATOR_FROM_ERA);
    expect(reg.level[1]).toBe(Intervention.OpenAccess);
    expect(before.purchases).toBe(0);

    const after = run(
      reg, r, (PATIENCE_DAYS + 2) + 400, REGULATOR_FROM_ERA,
      (PATIENCE_DAYS + 2) * 3,
    );
    expect(reg.level[1]).toBe(Intervention.CompulsoryPurchase);
    expect(after.purchases).toBeGreaterThan(0);
  });

  it('lets go when the company stops being dominant', () => {
    const reg = new RegulatorTable();
    const r = region(0.9);
    run(reg, r, (PATIENCE_DAYS + 2) * 2, REGULATOR_FROM_ERA);
    expect(reg.level[1]).toBe(Intervention.ChargeCap);

    // Sell most of it to the authority, as a chastened operator would.
    r.assets.tiles[r.theirs] += r.assets.tiles[r.mine] - 100;
    r.assets.tiles[r.mine] = 100;
    run(reg, r, REMISSION_DAYS + 2, REGULATOR_FROM_ERA, 99999);
    expect(reg.level[1]).toBe(Intervention.Referral);
    run(reg, r, REMISSION_DAYS + 2, REGULATOR_FROM_ERA, 199999);
    expect(reg.level[1]).toBe(Intervention.None);
  });
});
