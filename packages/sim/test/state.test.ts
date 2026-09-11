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
  worldArrays, worldArraysSkipped,
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

  // A field given over to housing, with a street on it and a village grown to
  // match. Three columns on the land register and one on the town table, none of
  // which existed when this fixture was written.
  let released = NONE;
  for (const p of bought) {
    if (!w.canReleaseForHousing(p).ok) continue;
    if (w.releaseForHousing(p).ok) { released = p; break; }
  }
  if (released !== NONE) {
    w.approval = 95;
    w.refreshApproval();
  }

  // And let it run, so stock moves, money moves and lorries are mid-journey.
  for (let i = 0; i < 30 * TICKS_PER_DAY; i++) w.step();
  return { w, bought, placed, laid, released };
}

describe('a save of a played world', () => {
  it('carries housing, which the walker test cannot prove on its own', () => {
    /*
     * `stateHash` digests whatever `saveState` produced, so a field the walker
     * cannot see is invisible to the round-trip test *and* to the hash — the two
     * agree with each other about a value neither of them has. The guard below
     * (`worldArrays`) closes that for `World`'s own arrays and does not reach a
     * field on a table, so `LandRegister` and `TownTable` need saying out loud.
     *
     * The specific trap: `bagOf` keeps typed arrays and scalars and silently drops
     * anything else, so a `number[]` added to the land register would vanish on
     * save, pass every existing test, and turn up as a district whose streets had
     * gone back to being fields.
     */
    const { w, released } = played();
    expect(released, 'the fixture released no field').not.toBe(NONE);
    expect(w.land.housing(released)).toBe(true);
    expect(w.land.plots[released]).toBeGreaterThan(0);
    expect(w.land.made[released], 'the fixture built no plot').toBeGreaterThan(0);

    const capacity = [...w.towns.capacity.slice(0, w.towns.count)];
    expect(capacity.some((c) => c > 0)).toBe(true);

    const file = JSON.parse(JSON.stringify(saveState(w)));
    const back = fresh();
    expect(back.land.housing(released), 'a fresh world already has housing')
      .toBe(false);

    restoreState(back, file);
    expect(back.land.use[released]).toBe(w.land.use[released]);
    expect(back.land.plots[released]).toBe(w.land.plots[released]);
    expect(back.land.made[released]).toBe(w.land.made[released]);
    expect([...back.towns.capacity.slice(0, back.towns.count)]).toEqual(capacity);
    // And the parish still knows why, which is a *derived* thing rather than a
    // saved one: crowding is read off population against capacity, so a capacity
    // that failed to load would read as a district that had quietly got roomier.
    expect(back.crowdingAt(0)).toBeCloseTo(w.crowdingAt(0), 5);
  });

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

describe('nothing is quietly left out', () => {
  it('carries every typed array on the World, or names why not', () => {
    /*
     * The test that should have existed first, and the bug that proves it.
     *
     * The World's arrays were an allow-list of eight names written out by hand, and
     * the first thing anybody said about saving was "save lost my vehicles" —
     * because `vehicleYard` was not one of the eight. Every lorry came back
     * belonging to no yard, so the fleet screen and the bays were empty.
     *
     * And the round-trip test could not see it. `stateHash` walks the same list, so
     * a field missing from it is missing from *both* halves of the comparison and
     * they agree perfectly about a world with no yards in it. Enumerated: there are
     * twenty-nine typed arrays on the World and the list named eight — the money
     * journal, `loadOriginX/Y` and `lapStart` were gone too.
     *
     * So the split is the thing under test. Every typed array is either saved or on
     * the deny-list, and a new field is saved by default rather than forgotten by
     * default.
     */
    const w = fresh();
    const saved = new Set(worldArrays(w as unknown as object));
    const skipped = new Set(worldArraysSkipped(w as unknown as object));
    let seen = 0;
    for (const key of Object.keys(w)) {
      const v = (w as unknown as Record<string, unknown>)[key];
      if (!ArrayBuffer.isView(v) || v instanceof DataView) continue;
      seen++;
      expect(
        saved.has(key) || skipped.has(key),
        `${key} is neither saved nor on the deny-list`,
      ).toBe(true);
    }
    expect(seen, 'there are arrays to check').toBeGreaterThan(20);
    // And the one that started it.
    expect(saved.has('vehicleYard')).toBe(true);
  });

  it('keeps a lorry in its yard', () => {
    /*
     * The reported bug, stated as the player saw it. Named separately from the hash
     * because "the state matches" and "my vehicles are still in a yard" are
     * different claims, and it was the second one that failed.
     */
    const { w } = played();
    let had = 0;
    for (let v = 0; v < w.vehicles.count; v++) {
      if (w.vehicles.alive[v] && w.vehicleYard[v] >= 0) had++;
    }
    expect(had, 'the fixture has lorries in yards').toBeGreaterThan(0);

    const back = fresh();
    restoreState(back, JSON.parse(JSON.stringify(saveState(w))));
    for (let v = 0; v < w.vehicles.count; v++) {
      expect(back.vehicleYard[v], `vehicle ${v}`).toBe(w.vehicleYard[v]);
    }
  });

  it('keeps the money journal, which is the whole Money tab', () => {
    // Six arrays, none of them on the old list. A loaded game would have shown an
    // empty ledger for a business with a year of trading behind it.
    const { w } = played();
    const back = fresh();
    restoreState(back, JSON.parse(JSON.stringify(saveState(w))));
    for (let i = 0; i < 40; i++) {
      expect(back.journalTick[i]).toBe(w.journalTick[i]);
      expect(back.journalPence[i]).toBe(w.journalPence[i]);
      expect(back.journalKind[i]).toBe(w.journalKind[i]);
    }
  });

  it('does not carry the pathfinder s scratch memory', () => {
    // `routePool` is 1.9 million entries of A* working memory holding whatever the
    // last search left in it. Seven megabytes of noise, and meaningless between
    // calls.
    const w = fresh();
    expect(worldArraysSkipped(w as unknown as object)).toContain('routePool');
    expect(JSON.stringify(saveState(w).world)).not.toContain('routePool');
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
