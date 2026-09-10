/**
 * Building a business, rather than buying one.
 *
 * Three things are worth pinning and the rest is taste.
 *
 * The **price**, because the whole feature falls over if it is wrong in either
 * direction: cheaper than buying and nobody would ever buy anything again, dearer
 * and it is a tax on wanting your works in the right place. "Land plus building
 * should always cost roughly the same."
 *
 * The **footprint**, because it is the one rule the player sees before they
 * commit, and a preview that disagrees with the click is worse than no preview.
 *
 * And **road access**, which is the interesting rule: needed to work, not to
 * build. You are allowed to put a creamery in the middle of a field and strand it,
 * and it has to actually stop rather than quietly carry on.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld, TICKS_PER_DAY, facilitiesFor, Mode, NO_WAY, NONE,
  SITE_LEVEL_PER_TILE,
} from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

const D = 128;

/** A district with a yard, a lorry, and money enough not to be the variable. */
function district() {
  const w = createWorld({ seed: 1985, size: D, townCount: 3, companyCount: 4 });
  w.tick = 60 * TICKS_PER_DAY;
  const o = w.planOpening();
  const yard = w.foundYard(Math.round(o.x), Math.round(o.y) + 2, 'Yard');
  const vi = w.openingVehicle(o.cargo);
  const veh = w.content.vehicles[vi];
  if (yard >= 0) {
    w.yards.add(yard, facilitiesFor({
      handling: veh.handling as readonly string[], cls: veh.class,
    }));
  }
  w.buyVehicleAtYard(vi, yard);
  w.companies.cash[w.player] = 50_000_000_00;
  w.refreshInfluence();
  return w;
}

/** The same district with a few fields bought, which is the state this feature
 *  actually runs in: you cannot build until you own ground. */
function landed() {
  const w = district();
  for (const f of w.landForSale().slice(0, 6)) w.buyLand(f.parcel);
  /*
   * Well thought of, so that the parish is not the thing under test.
   *
   * Approval gates building now — a creamery wants 35 where you are standing and a
   * fresh district sits at the resting 30 — so without this every test in this
   * file about footprints and ground would be measuring the approval gate instead.
   * It has its own file. Two tests here failed on exactly this and were right to.
   */
  w.approval = 100;
  return w;
}

const defOf = (w: ReturnType<typeof district>, id: string): number =>
  w.content.industries.findIndex((i) => i.id === id);

describe('a footprint', () => {
  it('is as many tiles across as the content says', () => {
    const w = district();
    for (let d = 0; d < w.content.industries.length; d++) {
      const n = w.content.industries[d].footprint;
      expect(w.footprintOf(d)).toBe(n);
      // Anchored well inside the map, so nothing is clipped.
      expect(w.footprintTiles(d, 40 * D + 40).length).toBe(n * n);
    }
  });

  it('is a solid square growing down and right of the tile you point at', () => {
    const w = district();
    const three = w.content.industries.findIndex((i) => i.footprint === 3);
    const at = 40 * D + 40;
    const tiles = w.footprintTiles(three, at);
    expect(tiles).toContain(at);
    expect(tiles).toContain(at + 2 + 2 * D);
    expect(tiles).not.toContain(at - 1);
    expect(tiles).not.toContain(at - D);
  });

  it('is clipped rather than wrapped at the edge of the map', () => {
    // A footprint that ran off the right-hand edge would otherwise reappear on
    // the left, which is the classic way a tile index becomes a bug.
    const w = district();
    const four = w.content.industries.findIndex((i) => i.footprint === 4);
    const corner = 10 * D + (D - 2);
    const tiles = w.footprintTiles(four, corner);
    expect(tiles.length).toBeLessThan(16);
    for (const t of tiles) expect(t % D).toBeGreaterThanOrEqual(D - 2);
  });
});

describe('what building costs', () => {
  it('comes out level with buying one, once the field is paid for', () => {
    /*
     * The rule the whole price exists to satisfy. Checked against every business
     * that exists in the district, at the spot the existing one stands on.
     *
     * It used to be satisfied by two matching curves — build and buy both doubled
     * at a town gate — and it is now satisfied by two flat figures, which is the
     * same rule with the survey taken out of it. `foundPrice` says why.
     */
    const w = landed();
    const sale = w.landForSale();
    const field = sale.map((s) => s.price).sort((a, b) => a - b)[sale.length >> 1];
    let checked = 0;
    for (let s = 0; s < w.sites.count; s++) {
      const buy = w.priceOf(s);
      const build = w.foundPrice(w.sites.def[s]);
      const ratio = (build + field) / buy;
      expect(ratio, w.content.industries[w.sites.def[s]].name)
        .toBeGreaterThan(0.9);
      expect(ratio, w.content.industries[w.sites.def[s]].name)
        .toBeLessThan(1.4);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('never comes out cheaper than buying, so building is not the loophole', () => {
    /*
     * And it is level or above rather than below, which is the direction that
     * matters: "the big value in building is having it exactly where you want it",
     * so a player should pay for that rather than save by it. The field is then on
     * top, which is where the whole of the position premium now lives.
     *
     * Level, not above, against a fully fed works — the flat build price is exactly
     * what the market asks for a going concern nobody is starving. Every real
     * comparison a player makes is against something less than perfectly supplied,
     * and the field is the rest of the answer.
     */
    const w = landed();
    const sale = w.landForSale();
    const field = sale.map((s) => s.price).sort((a, b) => a - b)[sale.length >> 1];
    for (let s = 0; s < w.sites.count; s++) {
      const buy = w.priceOf(s);
      expect(w.foundPrice(w.sites.def[s])).toBeGreaterThanOrEqual(buy);
      expect(w.foundPrice(w.sites.def[s]) + field).toBeGreaterThan(buy);
    }
  });

  it('costs the same where it is built up as it does up a lane', () => {
    /*
     * The town premium is gone, and this is where it used to be pinned.
     *
     * It was the land-value gradient applied to the building, and the objection to
     * it is that the player has already paid that gradient once, on the field, at
     * the land market. Charging it again for standing a shed on ground that is by
     * then their own is a second bill for the same thing — and because the tray has
     * to quote a price before a spot is chosen, it was also a quote the checkout
     * did not honour. See `foundPrice`.
     */
    const w = district();
    const shop = defOf(w, 'village-shop');
    let nearTown = -1;
    let farOut = -1;
    for (let t = 0; t < D * D; t++) {
      if (w.terrain.height[t] <= 0) continue;
      let d = 1e9;
      for (let n = 0; n < w.towns.count; n++) {
        const dx = w.towns.x[n] - (t % D);
        const dy = w.towns.y[n] - ((t / D) | 0);
        d = Math.min(d, Math.sqrt(dx * dx + dy * dy));
      }
      if (d < 4 && nearTown < 0) nearTown = t;
      if (d > 45 && farOut < 0) farOut = t;
    }
    expect(nearTown).toBeGreaterThanOrEqual(0);
    expect(farOut).toBeGreaterThanOrEqual(0);
    expect(w.canPlaceSite(w.player, shop, nearTown).price)
      .toBe(w.canPlaceSite(w.player, shop, farOut).price);
  });
});

describe('where you may build', () => {
  it('refuses ground you do not own', () => {
    const w = district();
    const shop = defOf(w, 'village-shop');
    let refused = 0;
    for (let t = 4000; t < 4200; t++) {
      const v = w.canPlaceSite(w.player, shop, t);
      if (!v.ok && v.reason === 'You do not own that ground.') refused++;
    }
    expect(refused).toBeGreaterThan(0);
  });

  it('offers plenty of room once you own fields, and less of it for a big works', () => {
    /*
     * Not an exact count — that would break every time the generator changed —
     * but the *ordering*, which is the thing that has to hold: a bigger footprint
     * fits in fewer places, and a one-tile business fits nearly anywhere on your
     * own land.
     */
    const w = landed();
    const owned = w.landOwnedTiles();
    expect(owned.length).toBeGreaterThan(60);
    const spots = (id: string): number => {
      const d = defOf(w, id);
      let n = 0;
      for (const t of owned) if (w.canPlaceSite(w.player, d, t).ok) n++;
      return n;
    };
    const one = spots('village-shop');
    const three = spots('creamery');
    const four = spots('terminal');
    expect(one).toBeGreaterThan(20);
    expect(three).toBeGreaterThan(0);
    expect(one).toBeGreaterThan(three);
    expect(three).toBeGreaterThanOrEqual(four);
  });

  it('will not put a works on top of a road', () => {
    const w = landed();
    const shop = defOf(w, 'village-shop');
    const onRoad = w.landOwnedTiles()
      .find((t) => w.layers[Mode.Road].cls[t] !== NO_WAY);
    expect(onRoad).toBeDefined();
    if (onRoad === undefined) return;
    expect(w.canPlaceSite(w.player, shop, onRoad).reason)
      .toBe('There is a road across it.');
  });

  it('will not put one on a slope it cannot stand on', () => {
    /*
     * The rule that replaced `TileFlag.Buildable`, which was the town
     * generator's own flag and far too narrow — it carried on only 791 of the
     * 3,194 enclosed field tiles, and three of the twenty-one generated
     * businesses stand on ground without it. Using it refused three quarters of
     * a player's own field as too steep.
     */
    const w = landed();
    const creamery = defOf(w, 'creamery');
    const n = w.footprintOf(creamery);
    let sawSteep = false;
    for (const t of w.landOwnedTiles()) {
      const tiles = w.footprintTiles(creamery, t);
      if (tiles.length !== n * n) continue;
      let lo = Infinity;
      let hi = -Infinity;
      for (const q of tiles) {
        lo = Math.min(lo, w.terrain.height[q]);
        hi = Math.max(hi, w.terrain.height[q]);
      }
      if (hi - lo <= SITE_LEVEL_PER_TILE * n) continue;
      expect(w.canPlaceSite(w.player, creamery, t).ok).toBe(false);
      sawSteep = true;
    }
    expect(sawSteep).toBe(true);
  });

  it('will not put two works up against each other', () => {
    const w = landed();
    const shop = defOf(w, 'village-shop');
    const spot = w.landOwnedTiles().find((t) => w.canPlaceSite(w.player, shop, t).ok);
    expect(spot).toBeDefined();
    if (spot === undefined) return;
    expect(w.placeSite(shop, spot).ok).toBe(true);
    expect(w.canPlaceSite(w.player, shop, spot).reason).toBe('Too close to another works.');
    // And the ring around it, because a works needs a way in.
    expect(w.canPlaceSite(w.player, shop, spot + 1).reason).toBe('Too close to another works.');
  });

  it('refuses when you cannot pay, and says so', () => {
    const w = landed();
    const creamery = defOf(w, 'creamery');
    const spot = w.landOwnedTiles().find((t) => w.canPlaceSite(w.player, creamery, t).ok);
    expect(spot).toBeDefined();
    if (spot === undefined) return;
    w.companies.cash[w.player] = 100_00;
    expect(w.canPlaceSite(w.player, creamery, spot).reason).toBe('Not enough in the bank.');
    expect(w.placeSite(creamery, spot).ok).toBe(false);
  });
});

describe('building one', () => {
  it('takes the money and puts it on the map, owned by you', () => {
    const w = landed();
    const shop = defOf(w, 'village-shop');
    const spot = w.landOwnedTiles().find((t) => w.canPlaceSite(w.player, shop, t).ok);
    expect(spot).toBeDefined();
    if (spot === undefined) return;
    const price = w.canPlaceSite(w.player, shop, spot).price;
    const cash = w.companies.cash[w.player];
    const before = w.sites.count;

    const out = w.placeSite(shop, spot);
    expect(out.ok).toBe(true);
    expect(w.sites.count).toBe(before + 1);
    expect(w.companies.cash[w.player]).toBe(cash - price);
    expect(w.sites.owner[out.site]).toBe(w.player);
    expect(w.sites.tile[out.site]).toBe(spot);
    expect(w.sites.def[out.site]).toBe(shop);
  });

  it('agrees with its own preview, always', () => {
    /*
     * The one invariant the interface depends on. The preview paints a square
     * green from `canPlaceSite` and the click calls `placeSite`; if those two can
     * ever disagree then the game refuses something it just offered, which is the
     * worst failure a placement tool has.
     */
    const w = landed();
    let checked = 0;
    for (let d = 0; d < w.content.industries.length; d++) {
      for (const t of w.landOwnedTiles()) {
        const said = w.canPlaceSite(w.player, d, t);
        if (!said.ok) continue;
        // A fresh world each time, so earlier placements cannot change the answer.
        const w2 = landed();
        w2.companies.cash[w2.player] = 50_000_000_00;
        expect(w2.placeSite(d, t).ok, `${w.content.industries[d].id} at ${t}`).toBe(true);
        checked++;
        break;
      }
    }
    expect(checked).toBeGreaterThan(6);
  });
});

describe('a works with no road', () => {
  /** An owned spot with no road on or beside the footprint. */
  function strandedSpotOf(w: ReturnType<typeof district>, d: number): number {
    for (const t of w.landOwnedTiles()) {
      if (!w.canPlaceSite(w.player, d, t).ok) continue;
      if (w.accessRoadFor(d, t) === NONE) return t;
    }
    return NONE;
  }

  it('can be built — placement does not need access', () => {
    const w = landed();
    const shop = defOf(w, 'village-shop');
    const spot = strandedSpotOf(w, shop);
    expect(spot).not.toBe(NONE);
    const out = w.placeSite(shop, spot);
    expect(out.ok).toBe(true);
    expect(w.siteStranded(out.site)).toBe(true);
  });

  it('produces nothing while it is cut off, and starts when the track arrives', () => {
    /*
     * The whole point of the rule, and it is checked on a works that is *only*
     * blocked by the road: its inputs are filled by hand, so if it makes nothing
     * the road is the only thing left to blame.
     *
     * A processing industry, deliberately. The first version of this used the
     * village shop because it is one tile and fits anywhere, and the shop is a
     * *terminal* - `outputs: {}` - so "made nothing" was true before, during and
     * after, and the test could not have failed. A rule about production has to be
     * tested on something that produces.
     */
    const w = landed();
    let def = NONE;
    let spot = NONE;
    for (let d = 0; d < w.content.industries.length && spot === NONE; d++) {
      if (Object.keys(w.content.industries[d].recipe.outputs).length === 0) continue;
      const at = strandedSpotOf(w, d);
      if (at !== NONE) { def = d; spot = at; }
    }
    expect(spot, 'somewhere off-road to build a producer').not.toBe(NONE);
    const site = w.placeSite(def, spot).site;
    expect(w.siteStranded(site)).toBe(true);

    const cargoCount = w.content.cargo.length;
    const recipe = w.content.industries[def].recipe;
    const fill = (): void => {
      for (const id of Object.keys(recipe.inputs)) {
        const ci = w.content.cargoIndex.get(id);
        if (ci !== undefined) w.sites.stock[site * cargoCount + ci] = 500;
      }
    };
    const made = (): number => {
      let total = 0;
      for (const id of Object.keys(recipe.outputs)) {
        const ci = w.content.cargoIndex.get(id);
        if (ci !== undefined) total += w.sites.stock[site * cargoCount + ci];
      }
      return total;
    };

    fill();
    for (let i = 0; i < 20 * TICKS_PER_DAY; i++) w.step();
    expect(made(), 'stranded').toBe(0);

    // A road on a tile beside it, then a rebuild, which is what laying a track
    // amounts to. Nothing else is touched.
    const x = spot % D;
    const y = (spot / D) | 0;
    const beside = y * D + Math.max(0, x - 1);
    w.layers[Mode.Road].cls[beside] = 0;
    w.rebuild();
    expect(w.siteStranded(site), 'after the track').toBe(false);

    fill();
    for (let i = 0; i < 20 * TICKS_PER_DAY; i++) w.step();
    expect(made(), 'connected').toBeGreaterThan(0);
  });

  it('leaves every generated business exactly as it was', () => {
    /*
     * The compatibility check that made this safe to do at all. All twenty-one
     * businesses the generator places stand on a road tile, so trying the site's
     * own tile first means none of them can change access tile or become
     * stranded — and if that ever stops being true, this fails rather than the
     * whole district quietly stopping work.
     */
    const w = district();
    for (let s = 0; s < w.sites.count; s++) {
      expect(w.siteStranded(s), `site ${s}`).toBe(false);
      expect(w.siteAccessTile[s]).toBe(w.sites.tile[s]);
    }
  });
});
