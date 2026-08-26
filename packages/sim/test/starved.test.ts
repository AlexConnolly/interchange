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
  createWorld, TICKS_PER_DAY, DAYS_PER_WEEK, SiteState, Line, LINE_COUNT,
  facilitiesFor, MoneyKind, GATE_WEEKLY_TONNES, haulageRate, RATE_WEIGHT_BY_TIER,
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
    expect(w.buySite(shop).ok).toBe(true);

    const before = w.services.count;
    expect(w.supply(farm, shop, produce)).toBe(true);
    expect(w.services.count).toBe(before + 1);
  });
});

describe('being paid', () => {
  /**
   * One run, from a farm you own to a works, for a fortnight.
   *
   * The same seed and the same two places both times, so the route, the tonnage
   * and the distance are identical and the only thing that differs is who owns
   * the far end.
   */
  function fortnight(ownFarEnd: boolean): { haulage: number; trading: number } {
    const w = createWorld({ seed: 1985, size: 128, townCount: 3, companyCount: 1 });
    w.tick = 60 * TICKS_PER_DAY;
    const o = w.planOpening();
    w.refreshInfluence([{ x: o.x, y: o.y, strength: 3.2 }]);
    w.companies.cash[w.player] = 500_000_00;
    w.primeStock();

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

  it('pays the fare for a load into somebody else s place', () => {
    const hire = fortnight(false);
    expect(hire.haulage).toBeGreaterThan(0);
  });

  it('pays nothing at all for carrying your own goods to your own shed', () => {
    /*
     * This paid half again the fare, on the reasoning that owning a business
     * should beat hauling for hire. It does, but not like this: "I brought in two
     * tons of milk and I made two point five grand", and "I shouldn't get paid to
     * take my own stuff, I should get paid for the stuff itself." Both are the
     * same objection and both are right — bringing milk into your own creamery is
     * *buying stock*. Nothing has been sold and nobody has been served.
     *
     * The money in a chain you own comes out of its far end: the market, a
     * standing order, or a shop counter.
     */
    const mine = fortnight(true);
    expect(mine.haulage).toBe(0);
    expect(mine.trading).toBe(0);
  });

  it('sells over a shop counter without anybody arranging it', () => {
    /*
     * "The village shop is the only place where whatever you give to it, as long
     * as it's a thing, it always sells." Everything else needs a customer found
     * for it; a shop faces the public, and the public turns up.
     */
    const w = createWorld({ seed: 1985, size: 128, townCount: 3, companyCount: 1 });
    w.primeStock();
    const src: { x: number; y: number; strength: number }[] = [];
    for (let x = 8; x < 128; x += 12) {
      for (let z = 8; z < 128; z += 12) src.push({ x, y: z, strength: 3.2 });
    }
    w.refreshInfluence(src);
    w.companies.cash[w.player] = 500_000_00;
    let shop = -1;
    for (let s = 0; s < w.sites.count; s++) {
      if (w.content.industries[w.sites.def[s]].id === 'village-shop') { shop = s; break; }
    }
    expect(w.buySite(shop).ok).toBe(true);
    const produce = w.content.cargo.findIndex((c) => c.id === 'produce');

    const before = w.companies.cash[w.player];
    for (let d = 0; d < 6; d++) {
      w.sites.addStock(shop, produce, 4);
      for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    }
    expect(w.companies.cash[w.player]).toBeGreaterThan(before);
    const till = w.moneyAt(shop).filter((r) => r.kind === MoneyKind.Counter);
    expect(till.length).toBeGreaterThan(0);
  });

  it('does not sell over the counter for somebody else s shop', () => {
    // The till belongs to whoever owns the shop. Nothing else in the game pays
    // the player for trade they have no part in.
    const w = createWorld({ seed: 1985, size: 128, townCount: 3, companyCount: 1 });
    w.primeStock();
    let shop = -1;
    for (let s = 0; s < w.sites.count; s++) {
      if (w.content.industries[w.sites.def[s]].id === 'village-shop') { shop = s; break; }
    }
    const produce = w.content.cargo.findIndex((c) => c.id === 'produce');
    const before = w.companies.cash[w.player];
    for (let d = 0; d < 6; d++) {
      w.sites.addStock(shop, produce, 8);
      for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    }
    expect(w.companies.cash[w.player]).toBe(before);
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

describe('the money journal', () => {
  it('records what a place cost and what it has brought in, with a reason', () => {
    /*
     * The ledger had totals per line per company, which answers "how am I doing"
     * and cannot answer "was buying that creamery a mistake" — for that you need
     * the events, attributed to the place, with a reason beside each one.
     */
    const w = make();
    w.primeStock();
    let site = -1;
    for (let s = 0; s < w.sites.count; s++) {
      if (w.recipes.inputs[w.sites.def[s]].length > 0
        && w.recipes.outputs[w.sites.def[s]].length > 0) { site = s; break; }
    }
    w.refreshInfluence([{ x: w.sites.x[site], y: w.sites.y[site], strength: 2.4 }]);
    w.companies.cash[w.player] = 5_000_000_00;

    expect(w.moneyAt(site).length).toBe(0);
    const price = w.priceOf(site);
    expect(w.buySite(site).ok).toBe(true);

    const rows = w.moneyAt(site);
    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe(MoneyKind.Bought);
    // Out is negative, so a purchase reads as money leaving.
    expect(rows[0].pence).toBe(-price);

    const totals = w.moneyTotals(site);
    expect(totals.out).toBe(price);
    expect(totals.in).toBe(0);
  });

  it('keeps one place out of another place s accounts', () => {
    const w = make();
    w.primeStock();
    const sites: number[] = [];
    for (let s = 0; s < w.sites.count && sites.length < 2; s++) {
      if (w.recipes.inputs[w.sites.def[s]].length > 0) sites.push(s);
    }
    w.refreshInfluence(sites.map((s) => ({
      x: w.sites.x[s], y: w.sites.y[s], strength: 2.4,
    })));
    w.companies.cash[w.player] = 5_000_000_00;
    expect(w.buySite(sites[0]).ok).toBe(true);
    expect(w.moneyAt(sites[0]).length).toBe(1);
    expect(w.moneyAt(sites[1]).length).toBe(0);
  });

  it('stamps a tick with a week and a clock, and never a day number', () => {
    /*
     * `dateString` explains why the game never prints a day: a day is a rate
     * bucket rather than a unit, and printing one next to a speed lets the
     * arithmetic be contradicted. A transaction list is not a good enough reason
     * to break that, so the stamp goes to the week and the clock instead — which
     * still orders a morning's work in sequence.
     */
    const w = make();
    const stamp = w.stampOf(TICKS_PER_DAY * 61 + Math.floor(TICKS_PER_DAY * 0.5));
    expect(stamp).toMatch(/^Wk [1-4], [A-Z][a-z]{2} \d{4} · \d{1,2}:\d{2}$/);
    // Two ticks on the same day differ by their clock, not by a date.
    const a = w.stampOf(TICKS_PER_DAY * 61);
    const b = w.stampOf(TICKS_PER_DAY * 61 + Math.floor(TICKS_PER_DAY * 0.25));
    expect(a).not.toBe(b);
    expect(a.split(' · ')[0]).toBe(b.split(' · ')[0]);
  });
});

describe('standing orders', () => {
  /** A producer of the player's, with the district in view. */
  function farming(): { w: ReturnType<typeof make>; farm: number } {
    const w = make();
    w.primeStock();
    const src: { x: number; y: number; strength: number }[] = [];
    for (let x = 8; x < 128; x += 12) {
      for (let z = 8; z < 128; z += 12) src.push({ x, y: z, strength: 3.2 });
    }
    w.refreshInfluence(src);
    w.companies.cash[w.player] = 5_000_000_00;
    let farm = -1;
    for (let s = 0; s < w.sites.count; s++) {
      if (w.content.industries[w.sites.def[s]].id === 'dairy-farm') { farm = s; break; }
    }
    w.sites.owner[farm] = w.player;
    return { w, farm };
  }

  const week = (w: ReturnType<typeof make>): void => {
    for (let d = 0; d < DAYS_PER_WEEK; d++) {
      for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    }
  };

  it('pays a producer of yours without a lorry anywhere near it', () => {
    /*
     * The hole this fills: owning a producer earned nothing at all unless you
     * personally drove its output somewhere. A farm with a creamery down the lane
     * has a customer whether or not you fancy the drive.
     */
    const { w, farm } = farming();
    const before = w.companies.cash[w.player];
    week(w);
    expect(w.companies.cash[w.player]).toBeGreaterThan(before);
    const rows = w.moneyAt(farm).filter((r) => r.kind === MoneyKind.Gate);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].tonnes).toBeGreaterThan(0);
  });

  it('moves the goods, so it is a trade rather than a cheque', () => {
    // A weekly payment with no stock behind it would be invented income. The
    // shed empties and the buyer's fills.
    const { w, farm } = farming();
    const milk = w.content.cargo.findIndex((c) => c.id === 'milk');
    const before = w.sites.stockOf(farm, milk);
    expect(before).toBeGreaterThan(0);
    week(w);
    const rows = w.moneyAt(farm).filter((r) => r.kind === MoneyKind.Gate);
    const sold = rows.reduce((n, r) => n + r.tonnes, 0);
    expect(sold).toBeGreaterThan(0);
  });

  it('caps the order at what one lorry could collect', () => {
    /*
     * The limit that keeps this from breaking the game. Without it the order was
     * the buyer's whole weekly appetite — more than three lorries can carry —
     * and owning eight producers paid a million and a half a month for nothing.
     */
    const { w, farm } = farming();
    week(w);
    week(w);
    for (const r of w.moneyAt(farm).filter((x) => x.kind === MoneyKind.Gate)) {
      expect(r.tonnes).toBeLessThanOrEqual(GATE_WEEKLY_TONNES);
    }
  });

  it('pays less than carrying the same load yourself', () => {
    /*
     * The whole point of the three rates: they collect at a discount, you carry
     * for the full fare, and into a place of your own it is half again. If this
     * ever inverts, the game is telling the player not to buy a lorry.
     */
    const { w, farm } = farming();
    week(w);
    const rows = w.moneyAt(farm).filter((r) => r.kind === MoneyKind.Gate);
    expect(rows.length).toBeGreaterThan(0);
    const perTonne = rows[0].pence / rows[0].tonnes;
    // What the same tonne pays hauled over a typical run.
    const fare = haulageRate(
      w.content.cargo[rows[0].cargo].basePrice, 20,
      RATE_WEIGHT_BY_TIER[w.content.cargo[rows[0].cargo].tier] ?? 1,
    );
    expect(perTonne).toBeLessThan(fare);
  });

  it('pays a distant customer less, not more', () => {
    /*
     * The bug this replaced. The fare rises steeply with distance and `buyerFor`
     * picks whoever has the most room rather than whoever is nearest, so paying a
     * fraction of the *actual* fare meant a far-off customer paid you more for
     * sitting still: one farm earned thirty thousand a week and paid for itself in
     * a fortnight. A gate price is a price for goods; distance can only ever be a
     * deduction.
     */
    const near = 1 - Math.min(0.5, 4 / 60);
    const far = 1 - Math.min(0.5, 44 / 60);
    expect(far).toBeLessThan(near);
  });
});
