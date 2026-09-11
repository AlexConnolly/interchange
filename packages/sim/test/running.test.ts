/**
 * What it costs to hold a business, what it costs to shut one, and what the
 * district is short of.
 *
 * Three things that are one feature. Owning a place was **free**: `Line.Upkeep`
 * existed and was posted for roads only, so a creamery starved of milk produced
 * nothing and cost nothing, and buying everything you could afford and letting it
 * rot was not merely viable but costless. The only consequence was
 * `stepSiteDecay` writing the capital off months later, with no line anywhere
 * saying this place had cost anything this week.
 *
 * So: a weekly bill makes it a business you *run*; the district ledger shows you
 * *why* it is losing money; and pausing is what you do about it while you fix the
 * supply. Any one alone is weak — a ledger with no bill is trivia, a bill with no
 * pause is a punishment with no answer, and a pause with no bill is a button
 * nobody presses.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld, TICKS_PER_DAY, DAYS_PER_WEEK, Line, LINE_COUNT, SiteState,
} from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

const D = 128;

function district(): ReturnType<typeof createWorld> {
  const w = createWorld({ seed: 1985, size: D, townCount: 3, companyCount: 1 });
  w.primeStock();
  const src: { x: number; y: number; strength: number }[] = [];
  for (let x = 8; x < D; x += 12) {
    for (let z = 8; z < D; z += 12) src.push({ x, y: z, strength: 3.2 });
  }
  w.refreshInfluence(src);
  w.companies.cash[w.player] = 5_000_000_00;
  return w;
}

function siteOf(w: ReturnType<typeof district>, id: string): number {
  for (let s = 0; s < w.sites.count; s++) {
    if (w.content.industries[w.sites.def[s]].id === id) return s;
  }
  return -1;
}

/** Whole weeks, so the weekly passes actually fire. */
function weeks(w: ReturnType<typeof district>, n: number): void {
  for (let d = 0; d < n * DAYS_PER_WEEK + 1; d++) {
    for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
  }
}

describe('what a business costs to hold', () => {
  it('is charged weekly on everything you own, and nothing you do not', () => {
    const w = district();
    const creamery = siteOf(w, 'creamery');
    expect(creamery).toBeGreaterThanOrEqual(0);

    /*
     * `ledgerTotal`, not `ledger`. The latter is month-to-date and `closeMonth`
     * zeroes it every month, so a test that ran past a month boundary would read
     * nothing and conclude the bill was never charged — which is exactly what the
     * first version of this did.
     */
    const idle = w.companies.ledgerTotal[w.player * LINE_COUNT + Line.Upkeep];
    weeks(w, 2);
    expect(w.companies.ledgerTotal[w.player * LINE_COUNT + Line.Upkeep], 'billed for a place you do not own')
      .toBe(idle);

    w.sites.owner[creamery] = w.player;
    weeks(w, 2);
    expect(w.companies.ledgerTotal[w.player * LINE_COUNT + Line.Upkeep]).toBeGreaterThan(idle);
  });

  it('scales with what the place is, so a yard is heavier than a shop', () => {
    // Flat against build cost rather than throughput: a bill that fell when a
    // works went idle would reward exactly the hoarding it exists to stop.
    const w = district();
    const shop = siteOf(w, 'village-shop');
    const creamery = siteOf(w, 'creamery');
    expect(shop).toBeGreaterThanOrEqual(0);
    expect(creamery).toBeGreaterThanOrEqual(0);
    expect(w.upkeepOf(creamery)).toBeGreaterThan(w.upkeepOf(shop));
    expect(w.upkeepOf(shop)).toBeGreaterThan(0);
  });

  it('bleeds a works nobody supplies, which is the whole point of it', () => {
    /*
     * The pressure. A creamery with no milk makes nothing and sells nothing, so
     * its entire effect on the accounts is the bill — measured, about £594 a
     * week against a starting balance of £11,500, so an idle creamery is a
     * problem inside a game month rather than a write-off nobody sees.
     */
    const w = district();
    const creamery = siteOf(w, 'creamery');
    w.sites.owner[creamery] = w.player;
    // Empty its sheds so it genuinely has nothing to work with.
    for (let c = 0; c < w.content.cargo.length; c++) {
      w.sites.takeStock(creamery, c, w.sites.stockOf(creamery, c));
    }
    const before = w.companies.cash[w.player];
    weeks(w, 4);
    expect(w.companies.cash[w.player], 'an idle works cost nothing')
      .toBeLessThan(before);
  });

  it('stops entirely when the place is dead', () => {
    const w = district();
    const creamery = siteOf(w, 'creamery');
    w.sites.owner[creamery] = w.player;
    w.sites.state[creamery] = SiteState.Dead;
    expect(w.upkeepOf(creamery)).toBe(0);
  });
});

describe('shutting a place', () => {
  it('is yours to do and undo', () => {
    const w = district();
    const creamery = siteOf(w, 'creamery');
    expect(w.pauseSite(creamery).reason, 'paused a place you do not own').toBe('Not yours.');

    w.sites.owner[creamery] = w.player;
    expect(w.pauseSite(creamery).ok).toBe(true);
    expect(w.sites.state[creamery]).toBe(SiteState.Paused);
    expect(w.pauseSite(creamery).reason).toBe('Already shut.');
    expect(w.resumeSite(creamery).ok).toBe(true);
    expect(w.sites.state[creamery]).toBe(SiteState.Struggling);
    expect(w.resumeSite(creamery).reason).toBe('It is already working.');
  });

  it('stops it taking stock in and stops it making anything', () => {
    /*
     * The behaviour that was already built and unreachable: `stepSites` has
     * always skipped a stopped site. What was missing was a way in, and a way to
     * tell "shut on purpose" from "failing".
     */
    const w = district();
    const creamery = siteOf(w, 'creamery');
    w.sites.owner[creamery] = w.player;
    const milk = w.content.cargoIndex.get('milk') as number;
    const dairy = w.content.cargoIndex.get('dairy') as number;
    w.sites.addStock(creamery, milk, 60);
    const milkBefore = w.sites.stockOf(creamery, milk);
    const dairyBefore = w.sites.stockOf(creamery, dairy);

    w.pauseSite(creamery);
    weeks(w, 3);
    expect(w.sites.stockOf(creamery, milk), 'a shut works ate its milk').toBe(milkBefore);
    expect(w.sites.stockOf(creamery, dairy), 'a shut works made dairy').toBe(dairyBefore);
  });

  it('costs less than running it, and never nothing', () => {
    // Not free. A building you have switched off is still a building you own, and
    // pausing at no cost would be a parking space for capital.
    const w = district();
    const creamery = siteOf(w, 'creamery');
    w.sites.owner[creamery] = w.player;
    const open = w.upkeepOf(creamery);
    w.pauseSite(creamery);
    const shut = w.upkeepOf(creamery);
    expect(shut).toBeGreaterThan(0);
    expect(shut).toBeLessThan(open);
  });

  it('does not decay and does not die, however long it is shut', () => {
    /*
     * The distinction that earns `Paused` its own state. A mothballed works is
     * failing and dies after the grace period; counting a deliberate closure the
     * same way would mean shutting a creamery for a winter and coming back to a
     * ruin, which makes the button a trap rather than a tool.
     */
    const w = district();
    const creamery = siteOf(w, 'creamery');
    w.sites.owner[creamery] = w.player;
    w.pauseSite(creamery);
    for (let d = 0; d < 200; d++) for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    expect(w.sites.state[creamery]).toBe(SiteState.Paused);
  });
});

describe('what the district is short of', () => {
  it('reports a flow on each side and a level at each end', () => {
    // The levels are not decoration: a ratio under one has two opposite causes
    // and the flows alone cannot tell them apart.
    const w = district();
    const rows = w.districtBalance();
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) {
      expect(r.made).toBeGreaterThanOrEqual(0);
      expect(r.wantedByWorks).toBeGreaterThanOrEqual(0);
      expect(r.atMakers).toBeGreaterThanOrEqual(0);
      expect(['short', 'stranded', 'unwanted', 'balanced']).toContain(r.verdict);
    }
  });

  it('calls a finished good with nowhere to go unwanted', () => {
    /*
     * The finding this screen exists for. One building in the whole content has
     * `retail: true`, so the chain has somewhere to start and nowhere to end —
     * measured on this seed, dairy is over-made fifty-six times over and nothing
     * takes sawn timber at all.
     */
    const w = district();
    const rows = w.districtBalance();
    const byId = (id: string) => rows.find(
      (r) => w.content.cargo[r.cargo].id === id,
    );
    expect(byId('dairy')?.verdict).toBe('unwanted');
    expect(byId('sawn')?.verdict).toBe('unwanted');
  });

  it('tells a haulage problem from a production one', () => {
    /*
     * Milk runs at about three quarters of what the creameries want *and* there
     * are a couple of hundred tonnes standing at the farms — so it is a shortage
     * of lorries, not of milk, and building another dairy farm would make it
     * worse. That distinction is the whole value of the screen.
     */
    const w = district();
    const milk = w.districtBalance().find(
      (r) => w.content.cargo[r.cargo].id === 'milk',
    );
    expect(milk).toBeDefined();
    expect(milk?.made).toBeLessThan(milk?.wantedByWorks as number);
    expect(milk?.atMakers, 'no milk standing at the farms').toBeGreaterThan(50);
    expect(milk?.verdict).toBe('stranded');

    // And with the sheds emptied it is a genuine shortage instead.
    const c = milk?.cargo as number;
    for (let s = 0; s < w.sites.count; s++) {
      w.sites.takeStock(s, c, w.sites.stockOf(s, c));
    }
    const again = w.districtBalance().find((r) => r.cargo === c);
    expect(again?.verdict).toBe('short');
  });

  it('leaves a paused works out of both sides of the sum', () => {
    // A works you have shut is neither making nor wanting, and counting it would
    // report a demand nothing is going to meet.
    const w = district();
    const creamery = siteOf(w, 'creamery');
    w.sites.owner[creamery] = w.player;
    const milk = w.content.cargoIndex.get('milk') as number;
    const before = w.districtBalance().find((r) => r.cargo === milk);
    w.pauseSite(creamery);
    const after = w.districtBalance().find((r) => r.cargo === milk);
    expect(after?.wantedByWorks).toBeLessThan(before?.wantedByWorks as number);
  });
});
