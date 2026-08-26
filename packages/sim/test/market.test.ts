/**
 * The market, which is where stock turns into money without a lorry.
 *
 * It exists because owning a producer left the player holding goods and nothing
 * to do with them: a shunt into another place of your own pays nothing, and a run
 * to somebody else's works pays a *fare* rather than a price. So a farm's output
 * piled up and the only question the game could answer about it was "which
 * lorry".
 *
 * What is pinned here is the *order of the rates*, because that is the whole
 * design. If dumping stock ever pays better than delivering it, the game starts
 * quietly advising the player not to buy lorries.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld, TICKS_PER_DAY, MARKET_TERMS, haulageRate, RATE_WEIGHT_BY_TIER,
  MoneyKind,
} from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

function owning() {
  const w = createWorld({ seed: 1985, size: 128, townCount: 3, companyCount: 1 });
  w.primeStock();
  const src: { x: number; y: number; strength: number }[] = [];
  for (let x = 8; x < 128; x += 12) {
    for (let z = 8; z < 128; z += 12) src.push({ x, y: z, strength: 3.2 });
  }
  w.refreshInfluence(src);
  w.companies.cash[w.player] = 500_000_00;
  for (let s = 0; s < w.sites.count; s++) {
    if (w.recipes.inputs[w.sites.def[s]].length === 0) w.sites.owner[s] = w.player;
  }
  return w;
}

describe('what things are worth', () => {
  it('prices a made thing above the things it was made from', () => {
    /*
     * Derived from the recipes rather than authored, which is the point: dairy is
     * dearer than milk because six milk went into four dairy, and nobody had to
     * type that in. It is also the "what did it cost to produce" figure, seen from
     * the other side — in a game where inputs are the only cost, the value of a
     * thing's inputs *is* what it cost.
     */
    const w = owning();
    const of = (id: string): number =>
      w.valueOf(w.content.cargo.findIndex((c) => c.id === id));
    expect(of('dairy')).toBeGreaterThan(of('milk'));
    expect(of('feed')).toBeGreaterThan(of('grain'));
    expect(of('meat')).toBeGreaterThan(of('livestock'));
    expect(of('sawn')).toBeGreaterThan(of('timber'));
  });

  it('pays more for patience, and that is the only axis', () => {
    const w = owning();
    const offers = w.marketOffers(w.content.cargo.findIndex((c) => c.id === 'milk'));
    expect(offers.length).toBe(MARKET_TERMS.length);
    for (let i = 1; i < offers.length; i++) {
      expect(offers[i].pence).toBeGreaterThan(offers[i - 1].pence);
      expect(offers[i].days).toBeGreaterThan(offers[i - 1].days);
    }
  });

  it('pays worse than carrying the stuff yourself, for raw goods', () => {
    /*
     * The rate that must never invert. Selling milk off the farm has to be worse
     * than putting it on a lorry, or the vehicle — the entire subject of the game
     * — becomes optional.
     */
    const w = owning();
    const milk = w.content.cargo.findIndex((c) => c.id === 'milk');
    const best = w.marketOffers(milk)[MARKET_TERMS.length - 1].pence;
    const fare = haulageRate(
      w.content.cargo[milk].basePrice, 20,
      RATE_WEIGHT_BY_TIER[w.content.cargo[milk].tier] ?? 1,
    );
    expect(best).toBeLessThan(fare);
  });
});

describe('selling on the market', () => {
  it('takes the goods now and pays on the agreed day', () => {
    const w = owning();
    const milk = w.content.cargo.findIndex((c) => c.id === 'milk');
    const held = w.stockHeld().find((h) => h.cargo === milk);
    expect(held).toBeTruthy();

    const cash = w.companies.cash[w.player];
    expect(w.sellOnMarket(milk, 20, 2)).toBe(true);
    // Stock has gone…
    expect(w.stockHeld().find((h) => h.cargo === milk)?.tonnes ?? 0)
      .toBe((held?.tonnes ?? 0) - 20);
    // …and the money has not arrived.
    expect(w.companies.cash[w.player]).toBe(cash);
    expect(w.pendingSales().length).toBe(1);

    // Thirty days later it has.
    for (let d = 0; d < 31; d++) for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    expect(w.companies.cash[w.player]).toBeGreaterThan(cash);
    expect(w.pendingSales().length).toBe(0);
  });

  it('pays at once on cash terms', () => {
    const w = owning();
    const milk = w.content.cargo.findIndex((c) => c.id === 'milk');
    const cash = w.companies.cash[w.player];
    expect(w.sellOnMarket(milk, 10, 0)).toBe(true);
    for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    expect(w.companies.cash[w.player]).toBeGreaterThan(cash);
  });

  it('will not sell what you have not got', () => {
    const w = owning();
    const dairy = w.content.cargo.findIndex((c) => c.id === 'dairy');
    // Nothing owned makes dairy, so there is none to sell.
    expect(w.stockHeld().find((h) => h.cargo === dairy)).toBeUndefined();
    expect(w.sellOnMarket(dairy, 5, 0)).toBe(false);
  });

  it('records the sale where the money can be read', () => {
    const w = owning();
    const milk = w.content.cargo.findIndex((c) => c.id === 'milk');
    expect(w.sellOnMarket(milk, 5, 0)).toBe(true);
    for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    // Not tied to a place: the market is nowhere in particular, which is why the
    // journal takes -1 for the site.
    const rows = w.moneyAt(-1).filter((r) => r.kind === MoneyKind.Market);
    expect(rows.length).toBe(1);
    expect(rows[0].tonnes).toBe(5);
  });
});
