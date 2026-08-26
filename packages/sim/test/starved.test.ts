/**
 * A business nobody supplies has to look like one.
 *
 * `satisfaction` is an output measure and only moves when a cycle *completes*,
 * so a works with empty sheds never touched it: measured, a creamery cut off
 * from milk sat at a hundred per cent, state Thriving, having produced nothing
 * for ninety days. Every decay rule in the game reads satisfaction, so a place
 * starved of supply was in perfect health by every number the simulation had —
 * and since the price of a business is what you judge a purchase on, every
 * starved works was also priced as a going concern.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld, TICKS_PER_DAY, SiteState, Line, LINE_COUNT, facilitiesFor,
} from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

const make = () => createWorld({ seed: 1985, size: 128, townCount: 3, companyCount: 1 });

/** A works: something with inputs, so it can be starved of them. */
function worksOf(w: ReturnType<typeof make>): number {
  for (let s = 0; s < w.sites.count; s++) {
    if (w.recipes.inputs[w.sites.def[s]].length > 0
      && w.recipes.outputs[w.sites.def[s]].length > 0) return s;
  }
  return -1;
}

describe('a starved business', () => {
  it('starts fed and stops being fed once its sheds are empty', () => {
    const w = make();
    w.primeStock();
    const works = worksOf(w);
    expect(w.sites.fed[works]).toBe(100);
    for (let d = 0; d < 60; d++) for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    expect(w.sites.fed[works]).toBeLessThan(20);
  });

  it('reads as struggling rather than thriving', () => {
    const w = make();
    w.primeStock();
    const works = worksOf(w);
    for (let d = 0; d < 60; d++) for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    expect(w.sites.state[works]).toBe(SiteState.Struggling);
  });

  it('is not closed down for it, because one haulier cannot supply a district', () => {
    /*
     * The distinction the `fed` measure exists to make. Nobody taking what you
     * make is fatal; nobody bringing what you need is not, or a district would
     * shut down around a player who was doing nothing wrong.
     */
    const w = make();
    w.primeStock();
    const works = worksOf(w);
    for (let d = 0; d < 200; d++) for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    expect(w.sites.state[works]).not.toBe(SiteState.Mothballed);
    expect(w.sites.state[works]).not.toBe(SiteState.Dead);
  });

  it('costs less to buy than the same place supplied', () => {
    const fed = make();
    fed.primeStock();
    const works = worksOf(fed);
    const full = fed.priceOf(works);

    const starved = make();
    starved.primeStock();
    for (let d = 0; d < 60; d++) for (let t = 0; t < TICKS_PER_DAY; t++) starved.step();
    const cheap = starved.priceOf(works);

    expect(cheap).toBeLessThan(full);
    // Half price at the extreme, so the discount is worth chasing and never
    // makes a business free.
    expect(cheap).toBeGreaterThan(full * 0.45);
  });

  it('can be bought without owning a producer of anything', () => {
    /*
     * The gate that used to be here demanded you own a supplier of every input
     * first, which made the entry price of a rung the price of the whole chain
     * beneath it. What replaces it is the fleet: you may buy this today and
     * discover it wants lorries you have not got.
     */
    const w = make();
    w.primeStock();
    const works = worksOf(w);
    w.refreshInfluence([{ x: w.sites.x[works], y: w.sites.y[works], strength: 2.4 }]);
    w.companies.cash[w.player] = 500_000_00;
    let owned = 0;
    for (let s = 0; s < w.sites.count; s++) if (w.sites.owner[s] === w.player) owned++;
    expect(owned).toBe(0);
    const verdict = w.canBuySite(works);
    expect(verdict.ok, verdict.reason).toBe(true);
    // And it still says what you will have to arrange.
    expect(verdict.needs.length).toBeGreaterThan(0);
  });
});

describe('supplying a place you own', () => {
  it('sets up a run inbound, not only outbound', () => {
    /*
     * The mechanism existed and pointed one way. It insisted you owned the
     * *origin*, which covers selling what you make and leaves the more pressing
     * half — getting goods to a business you have just bought — with no
     * mechanism at all. Nobody in this district delivers, so that half is the
     * whole of what owning a business asks of you.
     */
    const w = createWorld({ seed: 1985, size: 128, townCount: 3, companyCount: 1 });
    w.primeStock();
    let shop = -1;
    for (let s = 0; s < w.sites.count; s++) {
      if (w.content.industries[w.sites.def[s]].id === 'village-shop') { shop = s; break; }
    }
    expect(shop).toBeGreaterThanOrEqual(0);
    const produce = w.content.cargo.findIndex((c) => c.id === 'produce');
    let farm = -1;
    for (let s = 0; s < w.sites.count; s++) {
      const outs = w.recipes.outputs[w.sites.def[s]];
      for (let i = 0; i < outs.length; i += 2) if (outs[i] === produce) { farm = s; break; }
      if (farm >= 0) break;
    }
    expect(farm).toBeGreaterThanOrEqual(0);

    // Neither end is yours: there is nothing to arrange.
    expect(w.supply(farm, shop, produce)).toBe(false);

    w.refreshInfluence([{ x: w.sites.x[shop], y: w.sites.y[shop], strength: 2.4 }]);
    w.companies.cash[w.player] = 500_000_00;
    w.sites.servedDay[shop] = w.day;
    expect(w.buySite(shop).ok).toBe(true);

    const before = w.services.count;
    expect(w.supply(farm, shop, produce)).toBe(true);
    expect(w.services.count).toBe(before + 1);
  });
});

describe('trading into your own business', () => {
  /**
   * One run, from a farm you own to a works, for a fortnight.
   *
   * The same seed and the same two places both times, so the route, the tonnage
   * and the distance are identical and the only difference is who owns the far
   * end. Comparing two real hauls rather than reaching into the payment function
   * is the point: it is the *rule* that matters — a tonne into your own business
   * is worth more — and a test that called the payment directly would still pass
   * if the rule were never reached from a delivery.
   */
  function fortnight(ownFarEnd: boolean): { haulage: number; trading: number } {
    const w = createWorld({ seed: 1985, size: 128, townCount: 3, companyCount: 1 });
    w.tick = 60 * TICKS_PER_DAY;
    const o = w.planOpening();
    w.refreshInfluence([{ x: o.x, y: o.y, strength: 3.2 }]);
    w.companies.cash[w.player] = 500_000_00;
    w.primeStock();

    // A farm and a works that takes what it makes.
    let farm = -1;
    let works = -1;
    let cargo = -1;
    outer: for (let a = 0; a < w.sites.count; a++) {
      if (w.recipes.inputs[w.sites.def[a]].length > 0) continue;
      const outs = w.recipes.outputs[w.sites.def[a]];
      for (let i = 0; i < outs.length; i += 2) {
        for (let b = 0; b < w.sites.count; b++) {
          const ins = w.recipes.inputs[w.sites.def[b]];
          for (let k = 0; k < ins.length; k += 2) {
            if (ins[k] !== outs[i]) continue;
            farm = a; works = b; cargo = outs[i];
            break outer;
          }
        }
      }
    }
    expect(farm).toBeGreaterThanOrEqual(0);

    w.sites.owner[farm] = w.player;
    if (ownFarEnd) w.sites.owner[works] = w.player;

    const yard = w.foundYard(w.sites.x[farm], w.sites.y[farm] + 2, 'Yard');
    const vi = w.openingVehicle(cargo);
    const veh = w.content.vehicles[vi];
    if (yard >= 0) {
      w.yards.add(yard, facilitiesFor({
        handling: veh.handling as readonly string[], cls: veh.class,
      }));
    }
    w.buyVehicleAtYard(vi, yard);
    expect(w.supply(farm, works, cargo)).toBe(true);
    for (let d = 0; d < 14; d++) for (let t = 0; t < TICKS_PER_DAY; t++) w.step();

    const base = w.player * LINE_COUNT;
    return {
      haulage: w.companies.ledgerTotal[base + Line.Haulage],
      trading: w.companies.ledgerTotal[base + Line.Trading],
    };
  }

  it('pays into Trading rather than Haulage, and pays half again', () => {
    const hire = fortnight(false);
    const mine = fortnight(true);

    // Hauling to somebody else is haulage and nothing else.
    expect(hire.haulage).toBeGreaterThan(0);
    expect(hire.trading).toBe(0);

    // Into your own, it is trading and nothing else.
    expect(mine.trading).toBeGreaterThan(0);
    expect(mine.haulage).toBe(0);

    // And it is worth half again for the identical run.
    expect(mine.trading / hire.haulage).toBeCloseTo(1.5, 1);
  });

  it('cannot be a money printer, because a full shed accepts nothing', () => {
    /*
     * The property that makes better-than-market rates safe to hand out. A
     * business earns only while goods are physically reaching it, so what it can
     * ever earn is capped by what it actually gets through — there is no lump sum
     * for owning anything and no revenue that arrives while you sleep.
     */
    const w = createWorld({ seed: 1985, size: 128, townCount: 3, companyCount: 1 });
    w.primeStock();
    let works = -1;
    for (let s = 0; s < w.sites.count; s++) {
      if (w.recipes.inputs[w.sites.def[s]].length > 0
        && w.recipes.outputs[w.sites.def[s]].length > 0) { works = s; break; }
    }
    w.sites.owner[works] = w.player;
    const cargo = w.recipes.inputs[w.sites.def[works]][0];
    const room = w.sites.roomFor(works, cargo);
    expect(w.sites.addStock(works, cargo, room)).toBe(room);
    expect(w.sites.addStock(works, cargo, 1)).toBe(0);
  });
});

describe('buying a business', () => {
  function ready(): { w: ReturnType<typeof make>; site: number } {
    const w = make();
    w.primeStock();
    let site = -1;
    for (let s = 0; s < w.sites.count; s++) {
      if (w.recipes.inputs[w.sites.def[s]].length > 0
        && w.recipes.outputs[w.sites.def[s]].length > 0) { site = s; break; }
    }
    w.refreshInfluence([{ x: w.sites.x[site], y: w.sites.y[site], strength: 2.4 }]);
    return { w, site };
  }

  it('takes the money out of the bank rather than putting it in', () => {
    /*
     * It put it in. `Line.AssetTrade` is an income line and `post` adds an
     * income line to cash, so buying a business paid you its price — which made
     * buying the district the single most profitable thing a player could do,
     * and made every other mechanic in the game pointless.
     */
    const { w, site } = ready();
    w.companies.cash[w.player] = 5_000_000_00;
    const before = w.companies.cash[w.player];
    const price = w.priceOf(site);
    expect(price).toBeGreaterThan(0);
    expect(w.buySite(site).ok).toBe(true);
    expect(w.companies.cash[w.player]).toBe(before - price);
  });

  it('is refused when the money is not there', () => {
    // Nothing checked. With the ownership gate gone the only condition left on
    // buying anything at all was being able to see it.
    const { w, site } = ready();
    w.companies.cash[w.player] = 1_00;
    const verdict = w.canBuySite(site);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('Not enough in the bank.');
    expect(w.buySite(site).ok).toBe(false);
    expect(w.sites.owner[site]).not.toBe(w.player);
  });

  it('ends any contract that delivered into it, and keeps the lorry running', () => {
    /*
     * You cannot be hired to deliver to yourself. Leaving the paperwork in place
     * paid a haulage rate and a completion bonus for carrying your own goods to
     * your own shed, on top of the trading premium the same load already earns.
     *
     * The run survives, which is the point of absorbing rather than cancelling:
     * the lorry keeps driving the route and simply stops being a job somebody
     * gave you.
     */
    const w = make();
    w.tick = 60 * TICKS_PER_DAY;
    w.primeStock();
    const o = w.planOpening();
    w.refreshInfluence([{ x: o.x, y: o.y, strength: 3.2 }]);
    w.companies.cash[w.player] = 5_000_000_00;
    const vi = w.openingVehicle(o.cargo);
    const veh = w.content.vehicles[vi];
    const yard = w.foundYard(Math.round(o.x), Math.round(o.y) + 2, 'Yard');
    if (yard >= 0) {
      w.yards.add(yard, facilitiesFor({
        handling: veh.handling as readonly string[], cls: veh.class,
      }));
    }
    w.buyVehicleAtYard(vi, yard);
    w.offerWorkNow();

    const b = w.contractBoard;
    let taken = -1;
    for (let i = 0; i < b.count; i++) {
      const d = w.driversFor(i).find((x) => x.suitable);
      if (d && w.acceptContract(i, w.player, d.vehicle)) { taken = i; break; }
    }
    expect(taken).toBeGreaterThanOrEqual(0);
    const destination = b.to[taken];
    const service = b.service[taken];
    expect(service).toBeGreaterThanOrEqual(0);

    expect(w.buySite(destination).ok).toBe(true);
    // The paperwork is gone…
    expect(b.state[taken]).toBe(3);
    // …and the run is not.
    expect(w.services.active[service]).toBe(1);
    let stillDriving = false;
    for (let v = 0; v < w.vehicles.count; v++) {
      if (w.vehicles.alive[v] && w.vehicles.service[v] === service) stillDriving = true;
    }
    expect(stillDriving).toBe(true);
  });

  it('never offers a contract into a place of yours', () => {
    const { w, site } = ready();
    w.companies.cash[w.player] = 5_000_000_00;
    expect(w.buySite(site).ok).toBe(true);
    w.offerWorkNow();
    const b = w.contractBoard;
    for (let i = 0; i < b.count; i++) {
      if (b.state[i] === 3) continue;
      expect(w.sites.owner[b.to[i]]).not.toBe(w.player);
    }
  });
});
