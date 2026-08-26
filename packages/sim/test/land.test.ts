import { describe, expect, it } from 'vitest';
import { createWorld, TICKS_PER_DAY } from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

/**
 * Land you own, and the one thing owning it lets you do.
 *
 * The planning board is the last rung of the ladder: gated on approval and on
 * owning four vehicles, so between buying a business and earning the parish's
 * ear there was nothing a player could do about a bad approach. This is that
 * missing agency, and the whole rule is that the tiles have to be yours.
 *
 * What is worth pinning is the refusals, not the success. A build action that
 * quietly permits one tile too many is how a player ends up laying a road across
 * somebody else's farm, and the failure is invisible until they notice the map
 * is theirs.
 */

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

/** A site the player can be given, and the parcels that come with it. */
function ownSomething(w: ReturnType<typeof createWorld>): number {
  for (let s = 0; s < w.sites.count; s++) {
    if (w.terrain.fields.parcel[w.sites.tile[s]] < 0) continue;
    w.sites.owner[s] = w.player;
    return s;
  }
  return -1;
}

describe('land you own', () => {
  it('is nothing at all before you own anything on it', () => {
    const w = district();
    expect(w.ownedParcels(w.player).size).toBe(0);
  });

  it('comes with a business, as whole parcels', () => {
    const w = district();
    const site = ownSomething(w);
    expect(site).toBeGreaterThanOrEqual(0);
    const owned = w.ownedParcels(w.player);
    // The parcel it stands in at least, and usually a neighbour or two — it is
    // the tile's whole neighbourhood, so a farm in a field corner gets both.
    expect(owned.size).toBeGreaterThan(0);
    expect(owned.has(w.terrain.fields.parcel[w.sites.tile[site]])).toBe(true);
  });

  it('will not let you build on someone else\u2019s field', () => {
    const w = district();
    ownSomething(w);
    const owned = w.ownedParcels(w.player);
    // Find a land tile in a parcel that is not ours.
    let theirs = -1;
    for (let t = 0; t < D * D; t++) {
      const p = w.terrain.fields.parcel[t];
      if (p < 0 || owned.has(p)) continue;
      if (w.terrain.height[t] <= 0) continue;
      if (w.layers[0].cls[t] !== 255) continue;
      theirs = t;
      break;
    }
    expect(theirs).toBeGreaterThanOrEqual(0);
    expect(w.canBuildOn(w.player, theirs)).toBe(false);
  });

  it('refuses a track that goes nowhere near a road', () => {
    const w = district();
    const site = ownSomething(w);
    const owned = w.ownedParcels(w.player);
    // A run of our own tiles that touches no road at all.
    const mine: number[] = [];
    for (let t = 0; t < D * D && mine.length < 2; t++) {
      const p = w.terrain.fields.parcel[t];
      if (p < 0 || !owned.has(p)) continue;
      if (w.layers[0].cls[t] !== 255) continue;
      let nearRoad = false;
      for (const d of [1, -1, D, -D]) if (w.layers[0].cls[t + d] !== 255) nearRoad = true;
      if (nearRoad) continue;
      mine.push(t);
    }
    void site;
    expect(mine.length).toBe(2);
    const r = w.layTrack(w.player, mine);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('meet a road');
  });

  it('lays one, charges for it, and puts it on the map', () => {
    const w = district();
    const site = ownSomething(w);
    const owned = w.ownedParcels(w.player);
    const layer = w.layers[0];
    // Start from the site's own access road and run out across our land.
    const from = w.siteAccessTile[site];
    expect(from).toBeGreaterThanOrEqual(0);
    const run: number[] = [from];
    let at = from;
    for (let k = 0; k < 3; k++) {
      let next = -1;
      for (const d of [1, -1, D, -D]) {
        const t = at + d;
        const p = w.terrain.fields.parcel[t];
        if (p < 0 || !owned.has(p)) continue;
        if (layer.cls[t] !== 255) continue;
        if (run.includes(t)) continue;
        next = t;
        break;
      }
      if (next < 0) break;
      run.push(next);
      at = next;
    }
    // Not an escape hatch: if this ever fails the test below is measuring
    // nothing, and a test that silently measures nothing is worse than no test.
    expect(run.length).toBeGreaterThan(1);
    const before = w.companies.cash[w.player];
    const r = w.layTrack(w.player, run);
    expect(r.reason).toBe('');
    expect(r.ok).toBe(true);
    // Paid for, and actually there.
    expect(w.companies.cash[w.player]).toBeLessThan(before);
    let laid = 0;
    for (const t of run) if (layer.cls[t] !== 255) laid++;
    expect(laid).toBe(run.length);
  });
});

/**
 * The road tool, tile by tile.
 *
 * A build tool's refusals *are* its interface — the blue markers the player sees
 * are this predicate asked of every tile in view — so what matters is that it
 * says no for the right reasons and yes only where a track would actually be
 * useful. Every one of these is a thing that, permitted, would leave the player
 * with either a road through a barn or a road that goes nowhere.
 */
describe('the road tool', () => {
  it('will not lay a track that joins nothing', () => {
    const w = district();
    ownSomething(w);
    const owned = w.ownedParcels(w.player);
    let lonely = -1;
    for (let t = D; t < D * (D - 1); t++) {
      const p = w.terrain.fields.parcel[t];
      if (p < 0 || !owned.has(p)) continue;
      if (w.layers[0].cls[t] !== 255) continue;
      let touches = false;
      for (const d of [1, -1, D, -D]) if (w.layers[0].cls[t + d] !== 255) touches = true;
      if (touches) continue;
      lonely = t;
      break;
    }
    expect(lonely).toBeGreaterThanOrEqual(0);
    const r = w.layTrackAt(w.player, lonely);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('join a road');
  });

  it('will not lay one on land that is not yours', () => {
    const w = district();
    ownSomething(w);
    const owned = w.ownedParcels(w.player);
    let theirs = -1;
    for (let t = D; t < D * (D - 1); t++) {
      const p = w.terrain.fields.parcel[t];
      if (p < 0 || owned.has(p)) continue;
      if (w.layers[0].cls[t] !== 255 || w.terrain.height[t] <= 0) continue;
      let touches = false;
      for (const d of [1, -1, D, -D]) if (w.layers[0].cls[t + d] !== 255) touches = true;
      if (!touches) continue;
      theirs = t;
      break;
    }
    expect(theirs).toBeGreaterThanOrEqual(0);
    expect(w.layTrackAt(w.player, theirs).reason).toContain('Not your land');
  });

  it('will not lay one through a building', () => {
    const w = district();
    const site = ownSomething(w);
    const r = w.trackHere(w.player, w.sites.tile[site]);
    expect(r.ok).toBe(false);
    // Either verdict is correct and both are refusals; what must never happen is
    // a yes on the tile a barn is standing on.
    expect(['A building is there.', 'Already a road.']).toContain(r.reason);
  });

  it('lays one that extends the network, and takes it up again', () => {
    const w = district();
    ownSomething(w);
    const owned = w.ownedParcels(w.player);
    let spot = -1;
    for (let t = D; t < D * (D - 1); t++) {
      if (w.trackHere(w.player, t, owned).ok) { spot = t; break; }
    }
    expect(spot).toBeGreaterThanOrEqual(0);
    expect(w.layTrackAt(w.player, spot).reason).toBe('');
    expect(w.layers[0].cls[spot]).not.toBe(255);
    // And back off again, because a tool you cannot undo is a tool nobody uses.
    expect(w.liftTrackAt(w.player, spot).reason).toBe('');
    expect(w.layers[0].cls[spot]).toBe(255);
  });

  it('refuses to lift a road something needs to get out', () => {
    const w = district();
    const site = ownSomething(w);
    const access = w.siteAccessTile[site];
    expect(access).toBeGreaterThanOrEqual(0);
    const r = w.liftTrackAt(w.player, access);
    expect(r.ok).toBe(false);
  });
});
