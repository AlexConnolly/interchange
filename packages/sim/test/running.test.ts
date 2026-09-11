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
  createWorld, TICKS_PER_DAY, DAYS_PER_WEEK, Line, LINE_COUNT, SiteState, tasteOf,
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

  it('calls anything with no taker at all unwanted', () => {
    /*
     * Stated as a rule over every row rather than by naming a cargo, because
     * which cargo it is depends entirely on what worldgen happened to build.
     * The first version of this named dairy and sawn — true of the content at the
     * time, and false the moment a pub and a distribution yard turned up in the
     * district and gave both of them a customer.
     *
     * The structural point survives that and is worth keeping: a district where
     * one building has `retail: true` will always have finished goods with
     * nowhere to go, whichever ones they are this seed.
     */
    const w = district();
    const rows = w.districtBalance();
    let orphans = 0;
    for (const r of rows) {
      if (r.wantedByWorks + r.wantedByTowns > 0) continue;
      orphans++;
      expect(r.verdict, `${w.content.cargo[r.cargo].id} has no taker and is not unwanted`)
        .toBe('unwanted');
    }
    expect(orphans, 'every cargo in the district has a customer').toBeGreaterThan(0);
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

describe('trade is somewhere, not something', () => {
  /*
   * The plainest exploit the game had. Retail throughput was a property of the
   * *building*: measured before this, one pub got through **nine tonnes of beer a
   * day** in a district of 2,512 people — seven pints a head, daily, from one pub
   * — and nothing stopped you building ten more and selling ninety. The village
   * shop was the same at thirteen tonnes of produce.
   *
   * So the answer to "how do I sell more" was "another building", for ever, and
   * the district's population had no bearing on anything.
   */
  it('grows a village trade when there is more to go to, and tops out', () => {
    /*
     * The first version of the split conserved the total, which conserves nothing
     * worth having: it made the second pub pure cannibalisation and the only
     * sensible number of them one. "Two pubs is bad" is a rule, not a decision,
     * and it is also wrong about villages — a place with two pubs drinks more
     * than a place with one.
     *
     * So each counter added earns something and each earns less than the last,
     * toward a ceiling the people there set. See `TRADE_RIVALRY`.
     */
    const w = district();
    weeks(w, 1);
    const pub = siteOf(w, 'pub');
    if (pub < 0) return;
    const alone = w.tradeShare(pub);
    expect(alone).toBeGreaterThan(0);

    const def = w.sites.def[pub];
    const x = w.sites.x[pub];
    const y = w.sites.y[pub];
    const added: number[] = [];
    for (let i = 0; i < 5; i++) {
      const id = w.sites.alloc(def, x + 1, y + 1, (y + 1) * D + (x + 1), 0);
      if (id >= 0) added.push(id);
    }
    expect(added.length).toBe(5);
    weeks(w, 1);

    let together = w.tradeShare(pub);
    for (const a of added) together += w.tradeShare(a);

    // More in total than one managed…
    expect(together, 'six pubs sell no more than one').toBeGreaterThan(alone);
    // …and less each, so the sixth is a judgement against its own upkeep.
    expect(w.tradeShare(pub), 'the sixth pub cost the first nothing')
      .toBeLessThan(alone);
    /*
     * And nowhere near six times, which is the whole point. The ceiling is the
     * pull of the people there — about twice what a lone counter takes, since a
     * lone one gets `pull / (1 + 1)`.
     */
    expect(together, 'trade scaled with buildings rather than with people')
      .toBeLessThan(alone * 2.2);
  });

  it('leaves a counter in another village alone', () => {
    // Which is the other half: stacking gains nothing, spreading out gains
    // everything. Trade is somewhere rather than something.
    const w = district();
    weeks(w, 1);
    let first = -1;
    let far = -1;
    for (let s = 0; s < w.sites.count; s++) {
      if (w.content.industries[w.sites.def[s]].id !== 'pub') continue;
      if (first < 0) { first = s; continue; }
      const d = Math.hypot(w.sites.x[s] - w.sites.x[first], w.sites.y[s] - w.sites.y[first]);
      if (d > 20) { far = s; break; }
    }
    if (first < 0 || far < 0) return;
    const before = w.tradeShare(far);
    const def = w.sites.def[first];
    for (let i = 0; i < 4; i++) {
      w.sites.alloc(def, w.sites.x[first] + 1, w.sites.y[first] + 1,
        (w.sites.y[first] + 1) * D + w.sites.x[first] + 1, 0);
    }
    weeks(w, 1);
    // Loose for the same reason, plus a week of the village growing under it.
    expect(w.tradeShare(far)).toBeCloseTo(before, 1);
  });

  it('pays a counter more where there are more people', () => {
    /*
     * And this is where housing pays into retail. A pub in a village of four
     * hundred is a third as busy as one in a village of twelve hundred, so
     * releasing land near your own counter raises its takings — two decisions
     * that used to be unrelated.
     */
    const w = district();
    weeks(w, 1);
    const pub = siteOf(w, 'pub');
    if (pub < 0) return;
    const quiet = w.tradeShare(pub);
    for (let t = 0; t < w.towns.count; t++) {
      w.towns.population[t] *= 3;
      w.towns.capacity[t] *= 3;
    }
    weeks(w, 1);
    expect(w.tradeShare(pub), 'more people did not mean more trade')
      .toBeGreaterThan(quiet);
  });

  it('gives nothing to a counter with nobody near it', () => {
    const w = district();
    const pub = siteOf(w, 'pub');
    if (pub < 0) return;
    const away = w.sites.alloc(w.sites.def[pub], 2, 2, 2 * D + 2, 0);
    expect(away).toBeGreaterThanOrEqual(0);
    weeks(w, 1);
    expect(w.tradeShare(away)).toBe(0);
  });
});

describe('one place is not another', () => {
  /*
   * `cut.md` had settlement character down as cut and cheap to bring back —
   * *"flavour on a demand basket… genuinely nice; not load-bearing"* — and the
   * scaffolding outlived the cut: `towns.character` has been assigned from the
   * terrain since the beginning and read by nothing but the determinism hash.
   *
   * What it buys is that a district stops being uniform. A pub in a working town
   * is worth half again what the same pub is worth in a commuter village, so
   * *where* you build is a decision before *what* is.
   */
  it('gives a district more than one kind of town', () => {
    /*
     * The measurement that forced the rule. Town heights are strictly bimodal —
     * eleven of eighteen between 1 and 15, the rest between 257 and 497, nothing
     * in between — so deriving character from terrain alone gave districts of
     * three ports, and a taste table has nothing to say to those.
     */
    for (const seed of [1985, 7, 42, 99, 123]) {
      const w = createWorld({ seed, size: D, townCount: 3, companyCount: 1 });
      const kinds = new Set<number>();
      for (let t = 0; t < w.towns.count; t++) kinds.add(w.towns.character[t]);
      expect(kinds.size, `seed ${seed} is all one kind of town`).toBeGreaterThan(1);
    }
  });

  it('makes a working town thirstier than a commuter one', () => {
    expect(tasteOf('industrial', 'beer', 0, 1)).toBeGreaterThan(tasteOf('dormitory', 'beer', 0, 1));
    expect(tasteOf('dormitory', 'parcels', 0, 1)).toBeGreaterThan(tasteOf('industrial', 'parcels', 0, 1));
    expect(tasteOf('resort', 'produce', 0, 1)).toBeGreaterThan(tasteOf('industrial', 'produce', 0, 1));
  });

  it('separates two towns of the same kind, so it is a place and not a label', () => {
    // Character alone would make every market town identical, which is a district
    // built from four rubber stamps.
    const a = tasteOf('resort', 'beer', 0, 1985);
    const b = tasteOf('resort', 'beer', 1, 1985);
    expect(a).not.toBe(b);
  });

  it('holds the same taste for the whole game and across a reload', () => {
    // Hashed from the town and the seed rather than drawn from the world's rng,
    // which would make the answer depend on what else had asked a question first.
    for (let t = 0; t < 3; t++) {
      expect(tasteOf('port', 'beer', t, 42)).toBe(tasteOf('port', 'beer', t, 42));
    }
  });

  it('never turns a preference into a permanent shortfall', () => {
    /*
     * Taste multiplies what a town wants *and* what its own fields supply,
     * because `LOCAL_SUPPLY_POP` counts people rather than tonnes. Scaling one
     * side only would make every thirsty town unservable — so a district nobody
     * hauls to must still settle, whatever its towns are like.
     */
    const w = district();
    for (let d = 0; d < 300; d++) for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    for (let t = 0; t < w.towns.count; t++) {
      expect(w.towns.population[t], `${w.towns.names[t]} emptied out`).toBeGreaterThan(59);
    }
  });
});

describe('the parish, village by village', () => {
  /*
   * The same world the district ledger reads by cargo, read by place. The two
   * answer neighbouring halves of one question: the ledger says the district is
   * short of beer, and this says which village is thirsty and whether anything is
   * already selling to it.
   *
   * It exists because the pieces were scattered and one of them was nowhere.
   * Population lived only inside the land price, how well a village was served
   * drove its growth and appeared on nothing, and character was assigned at
   * worldgen and read by the determinism hash.
   */
  it('gives every settlement its figures, biggest first', () => {
    const w = district();
    const rows = w.parishOverview();
    expect(rows.length).toBe(w.towns.count);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].population).toBeGreaterThanOrEqual(rows[i].population);
    }
    for (const r of rows) {
      expect(r.name).not.toBe('');
      expect(r.population).toBeGreaterThan(0);
      expect(r.capacity).toBeGreaterThan(0);
      expect(r.crowding).toBeCloseTo(r.population / r.capacity, 5);
    }
  });

  it('says what each village wants more of than the average', () => {
    const w = district();
    const rows = w.parishOverview();
    const tastes = new Set<string>();
    for (const r of rows) {
      for (const want of r.wants) {
        expect(want.perDay).toBeGreaterThan(0);
        tastes.add(`${r.character}:${want.taste.toFixed(3)}`);
      }
    }
    // Not one number repeated. Character and jitter between them have to make
    // two villages genuinely different or the page is three identical cards.
    expect(tastes.size).toBeGreaterThan(2);
  });

  it('counts only the counters actually within a shopper walk', () => {
    // The same reach `refreshTrade` splits trade over, so the list on the page is
    // the list sharing the village's trade rather than a second opinion.
    const w = district();
    for (const r of w.parishOverview()) {
      for (const c of r.counters) {
        const d = Math.hypot(
          w.sites.x[c.site] - w.towns.x[r.town], w.sites.y[c.site] - w.towns.y[r.town],
        );
        expect(d).toBeLessThanOrEqual(20);
        expect(w.content.industries[c.def].retail).toBe(true);
      }
    }
  });

  it('reports what those counters actually sell, not what their recipe could', () => {
    /*
     * The bug this caught: `sites.trade` starts at one — "as busy as it can be" —
     * and was only recomputed on the day boundary, so a panel opened on a new game
     * showed every counter fully busy and a pub in an empty valley selling as much
     * as one in a town. Worldgen settles it now.
     */
    const w = district();
    for (const r of w.parishOverview()) {
      for (const b of r.buys) {
        let could = 0;
        for (const c of r.counters) could += w.intakePerDay(c.site, b.cargo);
        expect(b.perDay).toBeLessThanOrEqual(could + 0.001);
      }
      if (r.counters.length === 0) expect(r.buys.length).toBe(0);
    }
  });

  it('is settled before the first tick, not after the first day', () => {
    const fresh = createWorld({ seed: 1985, size: D, townCount: 3, companyCount: 1 });
    let retail = 0;
    let busy = 0;
    for (let s = 0; s < fresh.sites.count; s++) {
      if (fresh.content.industries[fresh.sites.def[s]]?.retail !== true) continue;
      retail++;
      if (fresh.tradeShare(s) >= 1) busy++;
    }
    expect(retail, 'no counters in the district').toBeGreaterThan(0);
    expect(busy, 'every counter reads as fully busy on a fresh world').toBe(0);
  });
});
