/**
 * Save the world, load it back, and prove nothing was lost.
 *
 * The serialiser walks the tables rather than naming their fields, which is the
 * only way it stays right as the game grows — and is worth nothing at all unless
 * something checks that what came back is what went in. That is this file.
 *
 * The shape of every test here is the same and it is the shape that matters:
 * **play** a game so the world is genuinely unlike a freshly generated one, save
 * it, restore into a fresh world from the same seed, and compare. `stateHash`
 * digests every value the walker can see, so a mismatch is a real difference
 * rather than a formatting one.
 *
 * A test that saved a brand new world and loaded it would pass while saving
 * nothing at all, which is the failure this is guarding against.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld, TICKS_PER_DAY, facilitiesFor, Mode, NO_WAY, NONE,
  saveState, restoreState, stateHash, STATE_VERSION, ContractState,
} from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

const D = 128;
const CONFIG = { seed: 1985, size: D, townCount: 3, companyCount: 4 };

function fresh() {
  const w = createWorld(CONFIG);
  w.settleLand();
  return w;
}

/**
 * A world somebody has actually played: a yard, lorries, land, a works built on
 * it, a track laid, a contract taken, and sixty days on the clock.
 *
 * Every one of those is a thing the *old* save format would have lost, because
 * none of them goes through the command queue. That is the point of the fixture.
 */
function played() {
  const w = fresh();
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
  w.companies.cash[w.player] = 5_000_000_00;
  w.refreshInfluence();

  // Land, and something built on it.
  const bought: number[] = [];
  for (const f of w.landForSale().slice(0, 4)) {
    if (w.buyLand(f.parcel).ok) bought.push(f.parcel);
  }
  const shop = w.content.industries.findIndex((i) => i.id === 'village-shop');
  let placed = NONE;
  for (const t of w.landOwnedTiles()) {
    if (!w.canPlaceSite(w.player, shop, t).ok) continue;
    const out = w.placeSite(shop, t);
    if (out.ok) { placed = out.site; break; }
  }

  // A track, so the road layer is not the generated one.
  let laid = 0;
  for (const t of w.landOwnedTiles()) {
    if (w.trackHere(w.player, t).ok && w.layTrackAt(w.player, t).ok) {
      laid++;
      if (laid >= 3) break;
    }
  }

  // Some contracts running, so services and vehicles have state.
  for (let i = 0; i < w.contractBoard.count; i++) {
    if (w.contractBoard.state[i] !== ContractState.Offered) continue;
    const free = w.driversFor(i).find((d) => d.suitable);
    if (!free) continue;
    w.acceptContract(i, w.player, free.vehicle);
    break;
  }

  // And let it run, so stock moves, money moves and lorries are mid-journey.
  for (let i = 0; i < 30 * TICKS_PER_DAY; i++) w.step();
  return { w, bought, placed, laid };
}

describe('a save of a played world', () => {
  it('restores to exactly the same state', () => {
    /*
     * The whole point, in one assertion. `stateHash` digests every field the
     * walker can see across eleven tables, the way layers and the world's own
     * scalars — so this passing means the save is complete for everything the
     * walker reaches, and the only remaining hole is a *table* missing from
     * `ROOTS`, which is a list short enough to read.
     */
    const { w } = played();
    const before = stateHash(w);
    const file = JSON.parse(JSON.stringify(saveState(w)));

    const back = fresh();
    expect(stateHash(back), 'a fresh world is not already the played one')
      .not.toBe(before);

    restoreState(back, file);
    expect(stateHash(back)).toBe(before);
  });

  it('survives being written and read as text', () => {
    // It goes through `localStorage`, so it has to survive `JSON.stringify` — and
    // in particular the typed arrays have to come back bit-exact, which is why
    // they are base64 of the bytes rather than arrays of decimals.
    const { w } = played();
    const text = JSON.stringify(saveState(w));
    expect(text.length).toBeGreaterThan(1000);
    const back = fresh();
    restoreState(back, JSON.parse(text));
    expect(stateHash(back)).toBe(stateHash(w));
  });

  it('carries the things the old command-log save would have lost', () => {
    /*
     * Named individually rather than left to the hash, because these are the
     * reason the format changed. None of `buyLand`, `placeSite` or `layTrackAt`
     * pushes a command, so a replay-based save reproduced a district where the
     * player had bought nothing, built nothing and laid nothing.
     */
    const { w, bought, placed, laid } = played();
    expect(bought.length, 'the fixture bought land').toBeGreaterThan(0);
    expect(placed, 'the fixture built something').not.toBe(NONE);
    expect(laid, 'the fixture laid track').toBeGreaterThan(0);

    const back = fresh();
    restoreState(back, JSON.parse(JSON.stringify(saveState(w))));

    for (const p of bought) expect(back.land.owner[p]).toBe(back.player);
    expect(back.sites.count).toBe(w.sites.count);
    expect(back.sites.owner[placed]).toBe(back.player);
    expect(back.sites.def[placed]).toBe(w.sites.def[placed]);

    let backRoads = 0;
    let wasRoads = 0;
    for (let t = 0; t < D * D; t++) {
      if (back.layers[Mode.Road].cls[t] !== NO_WAY) backRoads++;
      if (w.layers[Mode.Road].cls[t] !== NO_WAY) wasRoads++;
    }
    expect(backRoads).toBe(wasRoads);
    expect(back.companies.cash[back.player]).toBe(w.companies.cash[w.player]);
    expect(back.tick).toBe(w.tick);
  });

  it('keeps the road network usable, not merely present', () => {
    /*
     * The failure this is really about. The graph, the router and the influence
     * field are all caches over the roads, and none of them is in the save — so a
     * restore that put the roads back without rebuilding them would give a
     * district full of lanes that no lorry could route down. Present and useless
     * looks exactly like a pathfinding bug.
     */
    const { w } = played();
    const back = fresh();
    restoreState(back, JSON.parse(JSON.stringify(saveState(w))));

    let pairs = 0;
    let routed = 0;
    for (let a = 0; a < w.sites.count && pairs < 12; a++) {
      for (let b = a + 1; b < w.sites.count && pairs < 12; b++) {
        const wasRoute = w.roadRoute(w.siteAccessTile[a], w.siteAccessTile[b]);
        if (wasRoute.length === 0) continue;
        pairs++;
        const now = back.roadRoute(back.siteAccessTile[a], back.siteAccessTile[b]);
        if (now.length > 0) routed++;
      }
    }
    expect(pairs, 'there were routes to compare').toBeGreaterThan(4);
    expect(routed).toBe(pairs);
  });

  it('keeps carrying on from where it left off', () => {
    /*
     * A save that restores identically and then *diverges* on the next tick is
     * still broken — it would mean something the simulation reads is not in the
     * save and got a default instead. Stepping both worlds and comparing again is
     * the cheapest way to catch that, and it catches a whole class of it.
     */
    const { w } = played();
    const back = fresh();
    restoreState(back, JSON.parse(JSON.stringify(saveState(w))));
    expect(stateHash(back)).toBe(stateHash(w));

    for (let i = 0; i < 3 * TICKS_PER_DAY; i++) { w.step(); back.step(); }
    expect(stateHash(back), 'diverged after loading').toBe(stateHash(w));
  });
});

describe('the save format itself', () => {
  it('says which version it is', () => {
    const { w } = played();
    expect(saveState(w).version).toBe(STATE_VERSION);
  });

  it('carries the config, because the terrain is not in the file', () => {
    // The one thing a load cannot do without. The heightmap is a pure function of
    // the seed, so the seed *is* the terrain — and a save without it is a save of
    // a world nobody can rebuild.
    const { w } = played();
    expect(saveState(w).config).toEqual(CONFIG);
  });

  it('carries only the one part of the terrain the sim rewrites', () => {
    /*
     * The claim `snapshot.ts` made — "the terrain is a pure function of the seed" —
     * is very nearly true and was worth checking rather than inheriting. One array
     * is not: `fields.crop` is rewritten all year as ground is ploughed, drilled,
     * grown, cut and left in stubble. So the save carries exactly that and nothing
     * else from the terrain, and this is what says so.
     */
    const { w } = played();
    expect(Object.keys(saveState(w).terrain)).toEqual(['fields.crop']);
  });

  it('stays small enough for localStorage', () => {
    /*
     * Checked by size because the claim is about cost, and because the first
     * version of this walker produced **13.2 megabytes** — every table is allocated
     * at its maximum capacity and used from the front, so it was saving 417 KB of
     * unused asset slots per field. Folding the trailing run brought it to 71 KB.
     * A limit here is what stops that coming back unnoticed.
     */
    const { w } = played();
    const text = JSON.stringify(saveState(w));
    expect(text.length).toBeGreaterThan(2000);
    // A browser gives about 5 MB for the whole origin, and a player wants several
    // saves in it. Half a megabyte each is the outside of reasonable.
    expect(text.length).toBeLessThan(500_000);
  });

  it('does not carry the derived caches', () => {
    const s = saveState(w0());
    expect(Object.keys(s.roots)).not.toContain('graph');
    expect(Object.keys(s.roots)).not.toContain('router');
    expect(Object.keys(s.roots)).not.toContain('terrain');
  });

  function w0() {
    const w = fresh();
    w.tick = 10;
    return w;
  }
});
