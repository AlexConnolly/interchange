/**
 * The two things a tool has to be able to draw: where the road already is, and how
 * far you can reach.
 *
 * Both exist because of the same complaint arriving twice from the same session.
 * "He tried to build a road and it said already a road" — the tool was right and
 * the picture was no help. "It was not obvious that I did not have enough
 * influence" — and it was not, because land beyond your standing is not marked as
 * out of reach, it simply has no price on it, exactly like the sea.
 *
 * Both answers were already in the simulation and neither was on the screen. What
 * is worth pinning is not the drawing, which is the renderer's, but that these two
 * lists are the *same* lists the refusals are computed from. A highlight that is
 * nearly the truth is worse than none: it teaches a rule the game does not have,
 * and the player then trusts it.
 */

import { describe, expect, it } from 'vitest';
import { createWorld, TICKS_PER_DAY, Mode, NO_WAY } from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

const D = 128;

function district(): ReturnType<typeof createWorld> {
  const w = createWorld({ seed: 1985, size: D, townCount: 3, companyCount: 1 });
  w.tick = 60 * TICKS_PER_DAY;
  const o = w.planOpening();
  const inset = D * 0.3;
  const cl = (v: number): number => Math.max(inset, Math.min(D - inset, v));
  w.refreshInfluence([{ x: cl(o.x), y: cl(o.y), strength: 2.4 }]);
  w.companies.cash[w.player] = 500_000_00;
  return w;
}

describe('the roads a road tool lights up', () => {
  it('is every road inside your reach and nothing else', () => {
    /*
     * Stated as a set equality rather than as two spot checks, because the failure
     * that matters is a *missing* tile: a gap in a green ribbon reads as "no road
     * here", which is the one thing the highlight exists to deny.
     */
    const w = district();
    const cls = w.layers[Mode.Road].cls;
    const lit = new Set(w.roadTilesInReach());
    let roads = 0;
    for (let t = 0; t < cls.length; t++) {
      const road = cls[t] !== NO_WAY;
      const reach = w.influence.usable(t);
      if (road) roads++;
      expect(lit.has(t), `tile ${t}: road ${road}, in reach ${reach}`)
        .toBe(road && reach);
    }
    expect(roads, 'the district has no roads to light').toBeGreaterThan(50);
    expect(lit.size, 'nothing is lit').toBeGreaterThan(0);
  });

  it('picks up a track the moment it is laid', () => {
    /*
     * The freshness that matters. The whole point of the highlight is that you can
     * see what is already there, and the frame after you lay a spur is exactly when
     * that is being asked — so a list cached on anything at all is a list that can
     * show you a gap where your own new track is.
     */
    const w = district();
    let laid = -1;
    for (const p of w.landForSale()) {
      if (!w.buyLand(p.parcel).ok) continue;
      for (const t of w.land.tiles[p.parcel]) {
        if (w.trackHere(w.player, t).ok) { laid = t; break; }
      }
      if (laid >= 0) break;
    }
    expect(laid, 'nowhere to lay a track').toBeGreaterThanOrEqual(0);
    expect(w.roadTilesInReach()).not.toContain(laid);
    expect(w.layTrackAt(w.player, laid).ok).toBe(true);
    expect(w.roadTilesInReach()).toContain(laid);
  });
});

describe('the line round what you can reach', () => {
  it('is exactly the ground the influence test allows', () => {
    // The same test `landVisible` and every offer go through, so the line is where
    // the refusals start rather than near where they start.
    const w = district();
    const reach = new Set(w.reachTiles());
    for (let t = 0; t < D * D; t++) {
      expect(reach.has(t), `tile ${t}`).toBe(w.influence.usable(t));
    }
    expect(reach.size).toBeGreaterThan(0);
    expect(reach.size, 'the whole map is reachable, so the line says nothing')
      .toBeLessThan(D * D);
  });

  it('holds every field the land market will deal in, and no field outside it', () => {
    /*
     * The line's job in one sentence: it is drawn round the ground the market will
     * deal in. A field for sale beyond it would make the line a lie.
     *
     * It is a limit and not a promise, and the difference is worth stating because
     * a player will read it as one. Inside the line a field can still be refused —
     * "buy toward it, or find a road" — since standing is only the first of two
     * tests and adjacency is the second. That refusal arrives in words on a chip
     * the player has pressed, which is the half that was already working; what was
     * missing is any mark at all on the ground the market will not discuss.
     */
    const w = district();
    const reach = new Set(w.reachTiles());
    const inside = (p: number): boolean => w.land.tiles[p].some((t) => reach.has(t));
    for (const offer of w.landForSale()) {
      expect(inside(offer.parcel), `field ${offer.parcel} is for sale beyond the line`)
        .toBe(true);
    }
    let outside = 0;
    for (let p = 0; p < w.land.owner.length; p++) {
      if (inside(p)) continue;
      outside++;
      expect(w.canBuyLand(w.player, p).ok, `field ${p} is outside the line and buyable`)
        .toBe(false);
    }
    expect(outside, 'no field is outside the line').toBeGreaterThan(0);
  });

  it('is the same line the businesses are gated on, not a second one', () => {
    /*
     * Influence gates two markets — land, and the businesses standing on it — and
     * the line is drawn once. If the two disagreed anywhere, the line would be
     * telling the truth about one of them and lying about the other, and a player
     * has no way to know which.
     */
    const w = district();
    const reach = new Set(w.reachTiles());
    let out = 0;
    for (let s = 0; s < w.sites.count; s++) {
      if (w.sites.owner[s] === w.player) continue;
      const tile = w.siteAccessTile[s];
      if (tile >= 0 && reach.has(tile)) continue;
      out++;
      expect(w.canBuySite(s).reason, `business ${s}`)
        .toBe('Too far out. You have no standing there yet.');
    }
    expect(out, 'every business in the district is within reach').toBeGreaterThan(0);
  });
});
