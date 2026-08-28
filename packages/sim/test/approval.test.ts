/**
 * Approval: a consequence of what you build, and a gate on what you build next.
 *
 * The mechanic it replaced was a planning board where approval was a currency —
 * be useful, watch a number rise, spend it on permission to widen a lane. The
 * objection was that it "only allows you to influence, not do", and the answer is
 * this: nothing is spent, nothing is bought, and the number decides what you are
 * allowed to put up *at the spot you are standing on*.
 *
 * The move the old design could not express, and the one these tests are mostly
 * about: improve a neighbourhood, then earn the right to industrialise it.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld, TICKS_PER_DAY, APPROVAL_REST, COUNTED_AT, WIDEN_APPROVAL,
  facilitiesFor,
} from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

const D = 128;

function district() {
  const w = createWorld({ seed: 1985, size: D, townCount: 3, companyCount: 4 });
  w.tick = 60 * TICKS_PER_DAY;
  /*
   * With a yard and a lorry, which is not decoration: land is only for sale
   * inside your influence and influence comes from having a presence, so a
   * district with no yard has nothing to buy and nowhere to build.
   */
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
  w.companies.cash[w.player] = 500_000_000_00;
  w.refreshInfluence();
  return w;
}

/** A district with ground of your own to build on. */
function landed() {
  const w = district();
  for (const f of w.landForSale().slice(0, 8)) w.buyLand(f.parcel);
  return w;
}

const defOf = (w: ReturnType<typeof district>, id: string): number =>
  w.content.industries.findIndex((i) => i.id === id);

/** The first tile of your own ground where this would actually stand. */
function spotFor(w: ReturnType<typeof district>, def: number): number {
  for (const t of w.landOwnedTiles()) {
    if (w.canPlaceSite(w.player, def, t).ok) return t;
  }
  return -1;
}

/**
 * A spot where this would stand if the parish allowed it — every other rule met.
 *
 * Approval has to be lifted to ask, and that is the point of the helper rather
 * than an awkwardness in it: without this a test looking for "somewhere a creamery
 * is refused for approval" finds somewhere it is refused because the footprint
 * runs off your land, and then measures the wrong rule. The first version of this
 * file did exactly that and reported the gate broken when the message was "you do
 * not own that ground".
 */
function spotButForApproval(w: ReturnType<typeof district>, def: number): number {
  const had = w.approval;
  w.approval = 100;
  const t = spotFor(w, def);
  w.approval = had;
  return t;
}

/**
 * The *nearest* legal spot to a target, at least `gap` tiles off it.
 *
 * Nearest matters for every test about one building affecting another: the impact
 * falls off with distance, so "the first spot the scan happens to reach" measures
 * whatever the parcel order gives you. It is also the spot a player would pick.
 */
function nearestSpot(
  w: ReturnType<typeof district>, def: number, target: number, gap = 5,
): number {
  let best = Infinity;
  let found = -1;
  for (const t of w.landOwnedTiles()) {
    const dx = (t % D) - (target % D);
    const dy = ((t / D) | 0) - ((target / D) | 0);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < gap || d >= best) continue;
    if (!w.canPlaceSite(w.player, def, t).ok) continue;
    best = d;
    found = t;
  }
  return found;
}

describe('a district nobody has heard of you in', () => {
  it('thinks the same of you everywhere, and that is indifference', () => {
    const w = district();
    expect(w.approval).toBe(APPROVAL_REST);
    expect(w.approvalOverall()).toBeCloseTo(APPROVAL_REST, 5);
    for (const [x, y] of [[10, 10], [64, 64], [120, 30]]) {
      expect(w.approvalAt(x, y)).toBeCloseTo(APPROVAL_REST, 5);
    }
  });

  it('lets you put up what nobody minds and refuses what they would', () => {
    /*
     * The ladder, at rest. This is the shape of the whole mechanic in one
     * assertion: a shop and a farm are yours for the asking, and the heavy end of
     * the list is not, anywhere, until you have done something about it.
     */
    const w = landed();
    const allowed = (id: string): boolean => {
      const d = defOf(w, id);
      const t = spotFor(w, d);
      return t >= 0;
    };
    /*
     * Deliberately not a farm: dairy and arable sit on deposit 9 and are refused
     * for the ground rather than for the parish, which would make this test pass
     * or fail on something it is not about.
     */
    for (const id of ['village-shop', 'village-green', 'park']) {
      expect(allowed(id), `${id} should be allowed at rest`).toBe(true);
    }
    for (const id of ['creamery', 'abattoir', 'distribution-centre']) {
      expect(allowed(id), `${id} should be refused at rest`).toBe(false);
    }
  });

  it('says why, in a sentence naming both figures', () => {
    const w = landed();
    const depot = defOf(w, 'distribution-centre');
    const t = w.landOwnedTiles().find((tt) => {
      const v = w.canPlaceSite(w.player, depot, tt);
      return !v.ok && v.reason.includes('parish');
    });
    expect(t).toBeDefined();
    if (t === undefined) return;
    const reason = w.canPlaceSite(w.player, depot, t).reason;
    expect(reason).toContain('55');
    expect(reason).toContain('30');
  });
});

describe('improving a neighbourhood', () => {
  it('opens the thing the parish was refusing', () => {
    /*
     * The heart of it, and the reason the gate is local rather than a district
     * total. A village green costs six thousand pounds and is welcome; putting one
     * up near a spot lifts local approval there past a creamery's threshold.
     *
     * This is the move that was impossible under the old design: approval there
     * was one number for the whole district, so there was nothing you could *do*
     * in a place to change what you were allowed to do in it.
     */
    const w = landed();
    const creamery = defOf(w, 'creamery');
    const green = defOf(w, 'village-green');

    const spot = spotButForApproval(w, creamery);
    expect(spot).toBeGreaterThanOrEqual(0);
    const refused = w.canPlaceSite(w.player, creamery, spot);
    expect(refused.ok, 'refused at rest').toBe(false);
    expect(refused.reason, 'and refused for the parish, not the ground')
      .toContain('parish');

    const near = nearestSpot(w, green, spot);
    expect(near).toBeGreaterThanOrEqual(0);
    expect(w.placeSite(green, near).ok).toBe(true);

    const gate = w.approvalForBuild(creamery, spot);
    expect(gate.here, 'the green lifted it past the threshold')
      .toBeGreaterThanOrEqual(gate.need);
    expect(w.canPlaceSite(w.player, creamery, spot).ok, 'and now allowed').toBe(true);
  });

  it('is local, so it does not open the same thing across the district', () => {
    const w = landed();
    const green = defOf(w, 'village-green');
    const near = spotFor(w, green);
    expect(w.placeSite(green, near).ok).toBe(true);
    const gx = near % D;
    const gy = (near / D) | 0;
    // Far enough that the widest radius in the content cannot reach.
    const fx = gx > 64 ? 8 : 120;
    expect(w.approvalAt(fx, gy)).toBeCloseTo(APPROVAL_REST, 5);
  });
});

describe('building something they do not want', () => {
  it('costs you approval around it, and the second one is refused', () => {
    /*
     * The pressure the mechanic exists to create. A depot drops local approval by
     * more than the depot threshold's headroom, so a second one beside the first
     * is refused — you have to go somewhere else, or make somewhere else better.
     */
    const w = landed();
    const depot = defOf(w, 'distribution-centre');
    w.approval = 70;
    w.refreshApproval();

    const spot = spotFor(w, depot);
    expect(spot).toBeGreaterThanOrEqual(0);
    expect(w.placeSite(depot, spot).ok).toBe(true);
    const dx = spot % D;
    const dy = (spot / D) | 0;

    expect(w.approvalAt(dx, dy), 'the neighbours noticed').toBeLessThan(70);

    /*
     * The nearest spot a *second depot* could legally take — same footprint, same
     * ground rules — so the only thing left to refuse it is the parish. Asking
     * about a green-sized spot instead measured the footprint rule again.
     */
    let near = -1;
    let best = Infinity;
    const was = w.approval;
    w.approval = 100;
    for (const t of w.landOwnedTiles()) {
      const ddx = (t % D) - dx;
      const ddy = ((t / D) | 0) - dy;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d < 1 || d >= best) continue;
      if (!w.canPlaceSite(w.player, depot, t).ok) continue;
      best = d;
      near = t;
    }
    w.approval = was;
    expect(near, 'somewhere near it to try').toBeGreaterThanOrEqual(0);
    // Inside the depot's own radius, or the question is not being asked.
    expect(best).toBeLessThan(16);

    const second = w.canPlaceSite(w.player, depot, near);
    expect(second.ok, 'a second one, next door').toBe(false);
    expect(second.reason).toContain('parish');
  });

  it('blames you only for what you built, not for what you bought', () => {
    /*
     * Buying the abattoir on the edge of the village does not make the village any
     * worse off — it was there and it already smelt. Without this the mechanic
     * would punish a purchase for a decision somebody else took, and buying a
     * going concern would be a worse move than building the same thing.
     */
    const w = landed();
    const theirs = (() => {
      for (let s = 0; s < w.sites.count; s++) {
        if (w.sites.owner[s] !== w.player && w.recipes.approvalImpact[w.sites.def[s]] < -5) return s;
      }
      return -1;
    })();
    expect(theirs).toBeGreaterThanOrEqual(0);
    const x = w.sites.x[theirs];
    const y = w.sites.y[theirs];
    const before = w.approvalAt(x, y);

    w.sites.owner[theirs] = w.player;
    w.refreshApproval();
    expect(w.approvalAt(x, y), 'buying it changes nothing').toBeCloseTo(before, 5);
    expect(w.sites.raised[theirs]).toBe(0);
  });
});

describe('the parish counting you as one of their own', () => {
  it('happens because of what you did there, and is not bought', () => {
    /*
     * This is what became of "ask to be counted", which used to be a button
     * costing nine thousand pounds and twenty-two points of approval. There is no
     * call that does it now: a town that thinks well enough of you counts you.
     */
    const w = landed();
    expect(w.standing).toBe(0);
    expect((w as unknown as Record<string, unknown>).fundParish).toBeUndefined();
    expect((w as unknown as Record<string, unknown>).propose).toBeUndefined();

    w.approval = COUNTED_AT + 2;
    w.refreshStanding();
    expect(w.standing, 'every town now counts you').toBe(w.towns.count);

    w.approval = APPROVAL_REST;
    w.refreshStanding();
    expect(w.standing, 'and stops when you stop deserving it').toBe(0);
  });
});

describe('making up a lane', () => {
  it('is gated where the lane is, and no longer spends anything', () => {
    const w = landed();
    const works = w.roadWorks();
    if (works.length === 0) return;
    const one = works[0];
    expect(one.approval).toBe(WIDEN_APPROVAL);
    expect(one.here).toBeCloseTo(APPROVAL_REST, 5);
    expect(one.ok, 'refused at rest').toBe(false);

    const refused = w.widenTo(one.from);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain(String(WIDEN_APPROVAL));

    w.approval = 80;
    const before = w.approval;
    const done = w.widenTo(one.from);
    expect(done.ok, done.reason).toBe(true);
    /*
     * And it costs no approval. The old version charged eight points for using
     * the mechanic, which meant using it reduced your ability to use it again for
     * no reason anybody could state.
     */
    expect(w.approval).toBe(before);
  });
});

describe('the reasons behind the dial', () => {
  it('add up to the figure the dial is showing', () => {
    /*
     * The panel lists what is affecting approval here and the top of the screen
     * shows a number; if the list does not sum to the number the panel is lying.
     * It did, by about a point: the field summed over integer cell offsets and the
     * reasons used exact tile distances.
     */
    const w = landed();
    const green = defOf(w, 'village-green');
    const spot = spotFor(w, green);
    expect(w.placeSite(green, spot).ok).toBe(true);
    const x = spot % D;
    const y = (spot / D) | 0;

    const reasons = w.approvalReasons(x, y);
    expect(reasons.length).toBeGreaterThan(1);
    const summed = reasons.reduce((acc, r) => acc + r.points, 0);
    expect(summed).toBeCloseTo(w.approvalAt(x, y), 4);
  });

  it('puts the worst first, because that is the question being asked', () => {
    const w = landed();
    w.approval = 70;
    w.refreshApproval();
    const depot = defOf(w, 'distribution-centre');
    const green = defOf(w, 'village-green');
    const spot = spotFor(w, depot);
    expect(w.placeSite(depot, spot).ok).toBe(true);
    const near = nearestSpot(w, green, spot);
    if (near >= 0) w.placeSite(green, near);

    const reasons = w.approvalReasons(spot % D, (spot / D) | 0);
    for (let i = 1; i < reasons.length; i++) {
      expect(reasons[i].points).toBeGreaterThanOrEqual(reasons[i - 1].points);
    }
  });
});

describe('a park', () => {
  it('needs no road to be a park', () => {
    /*
     * Every trading place freezes when it has no road access, and a green is not a
     * trading place. Without its own kind it would have been founded, marked
     * stranded, and shown the player a warning about contracts it can never have.
     */
    const w = landed();
    const green = defOf(w, 'village-green');
    const spot = spotFor(w, green);
    const made = w.placeSite(green, spot);
    expect(made.ok).toBe(true);
    expect(w.sites.stranded[made.site], 'a green is never stranded').toBe(0);
  });
});
