/**
 * The pub: the village shop's cousin, and a rung the economy already had a
 * place for. Where the shop retails produce and parcels grown or trucked in
 * from nowhere in particular, the pub retails beer — a good the brewery
 * already makes and previously had exactly one buyer for, the distribution
 * centre. The pub gives it a second, closer one, which is the point: it
 * should be a genuine link in the existing chain rather than an isolated
 * cash sink with its own invented cargo.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, TICKS_PER_DAY } from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

const make = (seed: number) =>
  createWorld({ seed, size: 128, townCount: 3, companyCount: 1 });

const pubOf = (w: ReturnType<typeof make>): number => {
  for (let s = 0; s < w.sites.count; s++) {
    if (w.content.industries[w.sites.def[s]].id === 'pub') return s;
  }
  return -1;
};

describe('the pub', () => {
  it('drinks beer, and nothing that needs a fridge', () => {
    /*
     * Beer is a liquid, like fuel, so a pub is served by the same tanker a
     * filling station is — not a new class of vehicle the player has to go
     * and buy before the pub is worth anything.
     */
    const w = make(1985);
    const pub = pubOf(w);
    expect(pub, 'seed 1985 should generate a pub once a brewery exists').toBeGreaterThanOrEqual(0);
    const ins = w.recipes.inputs[w.sites.def[pub]];
    const handling = new Set<string>();
    const cargoIds = new Set<string>();
    for (let i = 0; i < ins.length; i += 2) {
      handling.add(w.content.cargo[ins[i]].handling);
      cargoIds.add(w.content.cargo[ins[i]].id);
    }
    expect([...handling]).toEqual(['liquid']);
    expect([...cargoIds]).toEqual(['beer']);
  });

  it('stands in the village rather than out in the fields', () => {
    const w = make(1985);
    const pub = pubOf(w);
    let nearest = Infinity;
    for (let tn = 0; tn < w.towns.count; tn++) {
      const dx = w.towns.x[tn] - w.sites.x[pub];
      const dy = w.towns.y[tn] - w.sites.y[pub];
      nearest = Math.min(nearest, Math.hypot(dx, dy));
    }
    expect(nearest).toBeLessThanOrEqual(6);
  });

  it('can be bought by anybody who can afford it', () => {
    const w = make(1985);
    const pub = pubOf(w);
    w.refreshInfluence([{ x: w.sites.x[pub], y: w.sites.y[pub], strength: 2.4 }]);
    w.companies.cash[w.player] = 50_000_00;
    expect(w.canBuySite(pub).ok, w.canBuySite(pub).reason).toBe(true);
    expect(w.buySite(pub).ok).toBe(true);
    expect(w.sites.owner[pub]).toBe(w.player);
  });

  it('is a stronger community anchor than the shop it stands beside', () => {
    /*
     * design's ask: "meaningfully welcoming ... higher approvalImpact than
     * the village shop". Pinned here so a future rebalance cannot walk the
     * pub back below the shop without the test saying so.
     */
    const w = make(1985);
    const shop = w.content.industries.find((i) => i.id === 'village-shop')!;
    const pub = w.content.industries.find((i) => i.id === 'pub')!;
    expect(pub.approvalImpact).toBeGreaterThan(shop.approvalImpact);
    expect(pub.approvalImpact).toBeGreaterThan(0);
  });

  it('earns standing while its cellar is full, and not once it runs dry', () => {
    const w = make(1985);
    const pub = pubOf(w);
    w.refreshInfluence([{ x: w.sites.x[pub], y: w.sites.y[pub], strength: 2.4 }]);
    w.companies.cash[w.player] = 50_000_00;
    expect(w.buySite(pub).ok).toBe(true);

    const beer = w.content.cargo.findIndex((c) => c.id === 'beer');
    const start = w.approval;
    for (let d = 0; d < 20; d++) {
      w.sites.addStock(pub, beer, 99);
      for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    }
    const stocked = w.approval;
    expect(stocked).toBeGreaterThan(start);

    /*
     * The cellar is emptied rather than left to run down. A counter's trade is
     * capped by the people it can reach now, so a pub gets through a couple of
     * tonnes a day instead of nine and ninety-nine tonnes of beer outlasts any
     * sensible test — which is the cap working and nothing to do with what this
     * is pinning.
     */
    w.sites.takeStock(pub, beer, w.sites.stockOf(pub, beer));
    for (let d = 0; d < 20; d++) {
      for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    }
    expect(w.approval).toBeLessThan(stocked);
  });
});
