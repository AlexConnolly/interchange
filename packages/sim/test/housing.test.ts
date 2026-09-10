/**
 * Housing, and the wall it is there to build.
 *
 * The ladder ended in a hole. A distribution yard and a freight terminal want 55
 * local approval against a resting 30, and the cheapest door through that gate
 * was **buying more businesses**: a village shop is +9, ungated and profitable,
 * so three of them cost £62,400 and unlocked a £336,000 building. The answer to
 * "what stops you buying every business in the district" was nothing.
 *
 * Housing closes it because it is the one investment that cannot be rushed.
 * Developers will not build where the parish is not already doing well, so it
 * pays you for work you have already done — and then the people who move in
 * crowd the place, which costs you the approval you were spending. The gain
 * arrives first and the bill follows, which is the shape of every real
 * development and the reason this is a decision rather than a purchase.
 *
 * What is pinned below is that loop in both directions: that a field cannot be
 * released where a street could not go, that the gate holds and then releases,
 * that a village grows only as far as it has room, and that being crowded shows
 * up on the parish dial as a reason a player can read and act on.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld, TICKS_PER_DAY, DAYS_PER_MONTH, Line,
  LandUse, PEOPLE_PER_PLOT, HOUSING_APPROVAL, APPROVAL_REST,
  crowding, roomLeft,
} from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

const D = 128;

function district(): ReturnType<typeof createWorld> {
  const w = createWorld({ seed: 1985, size: D, townCount: 3, companyCount: 1 });
  w.tick = 60 * TICKS_PER_DAY;
  w.primeStock();
  const src: { x: number; y: number; strength: number }[] = [];
  for (let x = 8; x < D; x += 12) {
    for (let z = 8; z < D; z += 12) src.push({ x, y: z, strength: 3.2 });
  }
  w.refreshInfluence(src);
  w.companies.cash[w.player] = 5_000_000_00;
  return w;
}

/** A field of the player's that would take a street. */
function releasable(w: ReturnType<typeof district>): number {
  for (const offer of w.landForSale()) {
    if (!w.buyLand(offer.parcel).ok) continue;
    if (w.canReleaseForHousing(offer.parcel).ok) return offer.parcel;
  }
  return -1;
}

/** Well thought of, so the parish is not the thing under test. */
function welcome(w: ReturnType<typeof district>): void {
  w.approval = 95;
  w.refreshApproval();
}

/** Run whole months, so the monthly developer pass actually fires. */
function months(w: ReturnType<typeof district>, n: number): void {
  for (let d = 0; d < n * DAYS_PER_MONTH + 2; d++) {
    for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
  }
}

describe('releasing a field', () => {
  it('refuses one that is not yours', () => {
    const w = district();
    const offer = w.landForSale()[0];
    expect(offer).toBeDefined();
    expect(w.canReleaseForHousing(offer.parcel).reason).toBe('Not your land.');
  });

  it('refuses one with no road along it, because a street needs a lane', () => {
    /*
     * The rule that does most of the work, and the one that keeps housing a
     * *land* decision. A field in the middle of nowhere is not a development site
     * until you have laid a track to it — which is a tool the player already has
     * and the cheapest thing in the game.
     */
    const w = district();
    let refused = 0;
    let checked = 0;
    for (const offer of w.landForSale()) {
      if (!w.buyLand(offer.parcel).ok) continue;
      checked++;
      const v = w.canReleaseForHousing(offer.parcel);
      if (!v.ok && v.reason === 'No road along it. Lay a track first.') refused++;
    }
    expect(checked).toBeGreaterThan(3);
    // Not all of them, or the rule would be a wall. Some fields front a lane.
    expect(refused).toBeLessThan(checked);
  });

  it('offers plots in proportion to the ground, and never more than the cap', () => {
    const w = district();
    for (const offer of w.landForSale()) {
      if (!w.buyLand(offer.parcel).ok) continue;
      const v = w.canReleaseForHousing(offer.parcel);
      if (!v.ok) continue;
      expect(v.plots).toBeGreaterThan(0);
      expect(v.plots).toBeLessThanOrEqual(12);
      expect(v.plots).toBeLessThanOrEqual(w.land.acres(offer.parcel));
    }
  });

  it('costs nothing, because you already bought the land', () => {
    const w = district();
    const p = releasable(w);
    expect(p).toBeGreaterThanOrEqual(0);
    const before = w.companies.cash[w.player];
    expect(w.releaseForHousing(p).ok).toBe(true);
    expect(w.companies.cash[w.player]).toBe(before);
    expect(w.land.use[p]).toBe(LandUse.Housing);
    expect(w.land.housing(p)).toBe(true);
  });

  it('cannot be done twice', () => {
    const w = district();
    const p = releasable(w);
    expect(w.releaseForHousing(p).ok).toBe(true);
    expect(w.releaseForHousing(p).reason).toBe('Already given over to housing.');
  });

  it('does not care what the parish thinks, because that is a different question', () => {
    /*
     * Whether the ground will take a street is a fact about the ground. Whether
     * anybody will buy a house on it is what the parish thinks of you. Two answers,
     * and the panel gives both — a release refused for approval would be telling a
     * player to fix the wrong thing.
     */
    const w = district();
    const p = releasable(w);
    w.approval = APPROVAL_REST;
    w.refreshApproval();
    expect(w.housingGate(p).ok).toBe(false);
    expect(w.canReleaseForHousing(p).ok).toBe(true);
  });
});

describe('the developers', () => {
  it('build nothing while the parish is indifferent', () => {
    const w = district();
    const p = releasable(w);
    w.releaseForHousing(p);
    w.approval = APPROVAL_REST;
    w.refreshApproval();
    months(w, 6);
    expect(w.land.made[p]).toBe(0);
  });

  it('build once it thinks well enough of you, and pay you for it', () => {
    const w = district();
    const p = releasable(w);
    w.releaseForHousing(p);
    welcome(w);
    expect(w.housingGate(p).ok).toBe(true);
    const before = w.companies.cash[w.player];
    months(w, 2);
    expect(w.land.made[p]).toBeGreaterThan(0);
    expect(w.companies.cash[w.player]).toBeGreaterThan(before);
    expect(w.companies.ledger[w.player * 12 + Line.AssetTrade]).toBeDefined();
  });

  it('never build more than the field was released for', () => {
    const w = district();
    const p = releasable(w);
    w.releaseForHousing(p);
    const plots = w.land.plots[p];
    welcome(w);
    months(w, plots + 14);
    expect(w.land.made[p]).toBe(plots);
  });

  it('go at a plot a month across the district, not per field', () => {
    // Otherwise a player with six fields released collects six a month for
    // nothing, and the pacing the gate exists to create is gone.
    const w = district();
    const fields: number[] = [];
    for (const offer of w.landForSale()) {
      if (!w.buyLand(offer.parcel).ok) continue;
      if (!w.canReleaseForHousing(offer.parcel).ok) continue;
      w.releaseForHousing(offer.parcel);
      fields.push(offer.parcel);
      if (fields.length >= 3) break;
    }
    expect(fields.length).toBe(3);
    welcome(w);
    months(w, 3);
    const total = fields.reduce((n, p) => n + w.land.made[p], 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(4);
  });

  it('price a house off the ground it stands on', () => {
    // Which keeps the one gradient the game has: a house at the town gate is
    // worth more than one up a lane because the ground under it is.
    const w = district();
    const prices: { price: number; land: number }[] = [];
    for (const offer of w.landForSale()) {
      if (!w.buyLand(offer.parcel).ok) continue;
      if (!w.canReleaseForHousing(offer.parcel).ok) continue;
      prices.push({
        price: w.housePrice(offer.parcel),
        land: w.landPriceOf(offer.parcel) / Math.max(1, w.land.acres(offer.parcel)),
      });
    }
    expect(prices.length).toBeGreaterThan(2);
    for (const q of prices) {
      expect(q.price).toBeGreaterThan(q.land);
    }
  });
});

describe('room to grow', () => {
  it('starts with headroom, so nobody is behind before they begin', () => {
    const w = district();
    for (let t = 0; t < w.towns.count; t++) {
      expect(crowding(w.towns, t)).toBeLessThan(1);
      expect(roomLeft(w.towns, t)).toBe(1);
    }
  });

  it('rises when a plot goes up', () => {
    const w = district();
    const p = releasable(w);
    w.releaseForHousing(p);
    const before = w.towns.capacity.slice(0, w.towns.count);
    welcome(w);
    months(w, 2);
    const made = w.land.made[p];
    expect(made).toBeGreaterThan(0);
    const after = w.towns.capacity.slice(0, w.towns.count);
    let gained = 0;
    for (let t = 0; t < w.towns.count; t++) gained += after[t] - before[t];
    expect(gained).toBe(made * PEOPLE_PER_PLOT);
  });

  it('is never badly overcrowded by a district left completely alone', () => {
    /*
     * The penalty has to be *earned*. A town under `LOCAL_SUPPLY_POP` is fed by
     * its own fields whatever anybody hauls, so it grows with no player in the
     * game at all — and at the first headroom figure it grew straight into most of
     * an eighteen-point approval penalty for doing nothing. See `alloc`.
     *
     * A nudge is right. A wall is not.
     */
    const w = district();
    for (let d = 0; d < 400; d++) for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
    for (let t = 0; t < w.towns.count; t++) {
      expect(crowding(w.towns, t), `${w.towns.names[t]} crowded itself`)
        .toBeLessThan(1.2);
    }
  });

  it('is what growth tapers against, so a full town creeps rather than stops', () => {
    /*
     * Tapered rather than capped, and the difference is a mechanic against a wall.
     * A hard ceiling stops the number dead with nothing on screen to say why; a
     * taper means the town still wants its deliveries and the reason it has stopped
     * moving is a crowded parish the player can read and fix.
     */
    const w = district();
    expect(roomLeft(w.towns, 0)).toBe(1);
    w.towns.capacity[0] = w.towns.population[0];
    expect(roomLeft(w.towns, 0)).toBe(1);
    w.towns.capacity[0] = Math.round(w.towns.population[0] / 1.25);
    expect(roomLeft(w.towns, 0)).toBeGreaterThan(0);
    expect(roomLeft(w.towns, 0)).toBeLessThan(1);
    w.towns.capacity[0] = Math.round(w.towns.population[0] / 2);
    expect(roomLeft(w.towns, 0)).toBe(0);
  });
});

describe('what the parish makes of it', () => {
  it('says a crowded village is crowded, in the reasons behind the dial', () => {
    /*
     * The whole of "fold it into the parish dial". No second number and no second
     * screen: a crowded village arrives as a row beside the creamery it is
     * complaining about, and the rows add up to the figure shown.
     */
    const w = district();
    w.towns.capacity[0] = Math.round(w.towns.population[0] / 1.5);
    w.refreshApproval();
    const reasons = w.approvalReasons(w.towns.x[0], w.towns.y[0]);
    const row = reasons.find((r) => r.label.includes('is crowded'));
    expect(row, 'no crowding row on the panel').toBeDefined();
    expect(row?.points).toBeLessThan(0);
    expect(row?.label).toContain(w.towns.names[0]);
  });

  it('costs approval where the village is, and not across the district', () => {
    const w = district();
    const at = w.approvalAt(w.towns.x[0], w.towns.y[0]);
    w.towns.capacity[0] = Math.round(w.towns.population[0] / 1.5);
    w.refreshApproval();
    expect(w.approvalAt(w.towns.x[0], w.towns.y[0])).toBeLessThan(at);
    // Far away, nothing. Approval is local and crowding is a local fact.
    const far = w.approvalAt(2, 2);
    w.towns.capacity[0] = w.towns.population[0] * 2;
    w.refreshApproval();
    expect(w.approvalAt(2, 2)).toBe(far);
  });

  it('welcomes the houses themselves, so the gain comes before the bill', () => {
    const w = district();
    const p = releasable(w);
    w.releaseForHousing(p);
    welcome(w);
    months(w, 2);
    expect(w.land.made[p]).toBeGreaterThan(0);
    const c = w.land.centres[p];
    const reasons = w.approvalReasons(c.x, c.y);
    const row = reasons.find((r) => r.label.startsWith('New houses'));
    expect(row, 'the new houses are not on the panel').toBeDefined();
    expect(row?.points).toBeGreaterThan(0);

    /*
     * Measured against the same instant with the houses taken away, not against
     * two months ago. The district-wide part of approval decays toward
     * indifference at two per cent a day — half a year of neglect undoes a
     * fortnight of good work — so a before-and-after across two months measures
     * the decay and not the houses.
     */
    const withThem = w.approvalAt(c.x, c.y);
    const made = w.land.made[p];
    w.land.made[p] = 0;
    w.refreshApproval();
    expect(withThem).toBeGreaterThan(w.approvalAt(c.x, c.y));
    w.land.made[p] = made;
  });

  it('wants less of you for a house than for a distribution yard', () => {
    // Housing is the rung between being tolerated and being trusted. If it wanted
    // as much as the thing it is supposed to unlock, it would unlock nothing.
    const w = district();
    const yard = w.content.industries.findIndex((i) => i.id === 'distribution-centre');
    expect(HOUSING_APPROVAL).toBeGreaterThan(APPROVAL_REST);
    expect(HOUSING_APPROVAL).toBeLessThan(w.content.industries[yard].approvalNeed);
  });
});

describe('the school', () => {
  it('is worth nothing to the parish while nobody supplies it', () => {
    /*
     * The point of it. A green is welcome for ever and costs one payment; a school
     * with no supplies is a building the parish walks past. That makes the answer
     * to a crowded village a thing that needs a lorry rather than an ornament.
     */
    const w = district();
    const def = w.content.industries.findIndex((i) => i.id === 'village-school');
    expect(def).toBeGreaterThanOrEqual(0);
    expect(w.content.industries[def].servesParish).toBe(true);
    expect(w.content.industries[def].approvalNeed).toBe(0);

    const p = releasable(w);
    const tile = w.land.tiles[p][0];
    const site = w.placeSite(w.player, def, tile);
    if (!site.ok) return;
    const s = site.site;
    w.sites.fed[s] = 0;
    w.refreshApproval();
    const starved = w.approvalAt(w.sites.x[s], w.sites.y[s]);
    w.sites.fed[s] = 100;
    w.refreshApproval();
    expect(w.approvalAt(w.sites.x[s], w.sites.y[s])).toBeGreaterThan(starved);
  });
});
