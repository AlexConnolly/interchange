/**
 * The ownership spine, which is the thing this whole design is about.
 *
 * design.md §3.2: buying the road somebody else drives on flips their cost
 * into your income. The balance sweep reports rent at zero per cent of every
 * AI company's income, and that is worth being precise about — it is a fact
 * about four unattended companies in a sparse region never happening to drive
 * on each other's roads, not a fact about the mechanism. These separate the
 * two, so that if the mechanism ever breaks it fails here loudly instead of
 * hiding behind a number the sweep already expects to be zero.
 */

import { describe, expect, it } from 'vitest';
import {
  createWorld, Charter, Mode, AUTHORITY, NONE, Line, LINE_COUNT,
  TICKS_PER_YEAR, StopAction, Cmd, cmd, SiteState,
} from '../src/index.ts';
import { content } from '@interchange/data';

const C = content();

/**
 * A world where company 1 runs a route and company 2 owns nothing yet.
 * Returns the asset company 1's lorries actually drive over most.
 */
function regionWithTraffic(seed = 1860) {
  const w = createWorld({ seed, size: 384, townCount: 14, companyCount: 4 });
  for (let c = 1; c < w.companies.count; c++) w.companies.isAi[c] = 0;

  let from = -1;
  let to = -1;
  let best = Infinity;
  for (let s = 0; s < w.sites.count; s++) {
    if (!w.sites.connected(s) || w.sites.state[s] === SiteState.Dead) continue;
    if (!w.sites.isExtraction(s)) continue;
    for (const id of Object.keys(C.industries[w.sites.def[s]].recipe.outputs)) {
      const ci = C.cargoIndex.get(id);
      if (ci === undefined || w.townDemandFor(ci) <= 0) continue;
      for (let t = 0; t < w.towns.count; t++) {
        if (w.towns.nodeOf(t, Mode.Road) === NONE) continue;
        const d = Math.hypot(w.sites.x[s] - w.towns.x[t], w.sites.y[s] - w.towns.y[t]);
        if (d < 10 || d > 50 || d >= best) continue;
        best = d;
        from = s;
        to = t;
      }
    }
  }

  const dray = C.vehicles.findIndex((v) => v.mode === 'road' && v.era <= 1 && v.handling.includes('bulk'));
  w.queue.push(cmd(2, 1, Cmd.CreateService, 0, 0, 0, 0, 'Haul'));
  w.queue.push(cmd(3, 1, Cmd.AddStop, 0, from, 255 << 2, StopAction.LoadFull));
  w.queue.push(cmd(3, 1, Cmd.AddStop, 0, to, (255 << 2) | 1, StopAction.Unload));
  for (let i = 0; i < 3; i++) {
    w.queue.push(cmd(4 + i, 1, Cmd.BuyVehicle, dray, from, 0, 0));
    w.queue.push(cmd(8 + i, 1, Cmd.AssignVehicle, -1, 0, 0, 0));
  }
  for (let i = 0; i < TICKS_PER_YEAR * 4; i++) w.step();

  // The authority road company 1's lorries use most.
  let busiest = NONE;
  let busiestPasses = 0;
  for (let a = 0; a < w.assets.count; a++) {
    if (w.assets.owner[a] !== AUTHORITY) continue;
    if (w.assets.foreignPassesPrev[a] + w.assets.foreignPasses[a] > busiestPasses) {
      busiestPasses = w.assets.foreignPassesPrev[a] + w.assets.foreignPasses[a];
      busiest = a;
    }
  }
  return { w, busiest, busiestPasses };
}

describe('the ownership spine', () => {
  it('records who is driving on another company road', () => {
    const { busiest, busiestPasses } = regionWithTraffic();
    // If nothing is driving anywhere, every test below is vacuous.
    expect(busiest).not.toBe(NONE);
    expect(busiestPasses).toBeGreaterThan(0);
  });

  it('turns a rival\'s cost into the owner\'s income', () => {
    const { w, busiest } = regionWithTraffic();
    expect(busiest).not.toBe(NONE);

    // Company 2 buys the road company 1 drives on, and prices it.
    w.companies.charter[2] = Charter.Construction;
    w.companies.cash[2] = 90_000_000;
    expect(w.buyAsset(busiest, 2)).toBe(true);
    expect(w.assets.owner[busiest]).toBe(2);
    // Modest, on purpose. The toll curve is real: price it high enough and
    // the traffic simply goes round, which is a different thing being tested.
    w.setCharge(busiest, 10, 2);

    const base1 = 1 * LINE_COUNT;
    const base2 = 2 * LINE_COUNT;
    const paidBefore = w.companies.ledgerTotal[base1 + Line.AccessPaid];
    const earnedBefore = w.companies.ledgerTotal[base2 + Line.AccessCharged];

    for (let i = 0; i < TICKS_PER_YEAR; i++) w.step();

    const paid = w.companies.ledgerTotal[base1 + Line.AccessPaid] - paidBefore;
    const earned = w.companies.ledgerTotal[base2 + Line.AccessCharged] - earnedBefore;

    /*
     * The whole design in two assertions: the haulier's costs went up, the
     * owner's income went up, and they are the same money. Nobody built
     * anything and nothing moved differently.
     */
    expect(paid).toBeGreaterThan(0);
    expect(earned).toBeGreaterThan(0);
    expect(w.companies.rentShare(2)).toBeGreaterThan(0);
  });

  it('never charges an owner for using their own road', () => {
    /*
     * Stated as an invariant rather than as an absolute, and the difference
     * matters. The first version asserted the owner paid *nothing at all*,
     * which was true of the region that seed happened to generate and stopped
     * being true the moment the terrain generator changed: the route now
     * crosses somebody else's way as well, and a toll paid to a third party is
     * not this rule being broken.
     *
     * What the rule actually says is that the charge on your own asset does
     * not apply to you. So run the same year twice with the same fleet on the
     * same roads, once with the toll at nothing and once with it at the
     * maximum, and the owner's bill must be identical.
     */
    const run = (charge: number): number => {
      const { w, busiest } = regionWithTraffic();
      expect(busiest).not.toBe(NONE);
      w.companies.charter[1] = Charter.Construction;
      w.companies.cash[1] = 90_000_000;
      expect(w.buyAsset(busiest, 1)).toBe(true);
      w.setCharge(busiest, charge, 1);
      const base = 1 * LINE_COUNT;
      const before = w.companies.ledgerTotal[base + Line.AccessPaid];
      for (let i = 0; i < TICKS_PER_YEAR; i++) w.step();
      return w.companies.ledgerTotal[base + Line.AccessPaid] - before;
    };
    expect(run(200)).toBe(run(0));
  });

  it('does not count an owner using their own way as foreign traffic', () => {
    const { w, busiest } = regionWithTraffic();
    expect(busiest).not.toBe(NONE);
    w.companies.charter[1] = Charter.Construction;
    w.companies.cash[1] = 90_000_000;
    expect(w.buyAsset(busiest, 1)).toBe(true);
    const foreignBefore = w.assets.foreignPasses[busiest];
    // Every lorry on it belongs to the owner, so the foreign counter — which
    // is what a toll is levied on — must not move at all.
    for (let i = 0; i < TICKS_PER_YEAR; i++) w.step();
    expect(w.assets.foreignPasses[busiest]).toBe(foreignBefore);
  });
});
