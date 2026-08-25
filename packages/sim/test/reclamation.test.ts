/**
 * Reclamation edits the map, which nothing else in the game does, so the
 * limits on it are the feature.
 *
 * design.md §13 says terrain is a cost and not a paint tool, and a game whose
 * coastline can be redrawn freely has no terrain problem left — which is most
 * of what makes a route interesting. Every case here is one of the rules that
 * keeps it a decision.
 */

import { describe, expect, it } from 'vitest';
import {
  createWorld, planReclamation, reclaim, RECLAIM_FROM_ERA, RECLAIM_LEVEL,
  RECLAIM_MAX_DEPTH, SEA_LEVEL, Charter, TileFlag,
} from '../src/index.ts';

/** A region, and a shallow tile against the shore in it. */
function coast(seed = 1860) {
  const w = createWorld({ seed, size: 256, townCount: 6, companyCount: 2 });
  const size = w.terrain.size;
  let shallow = -1;
  let deep = -1;
  for (let y = 2; y < size - 2 && (shallow < 0 || deep < 0); y++) {
    for (let x = 2; x < size - 2; x++) {
      const t = y * size + x;
      const h = w.terrain.height[t];
      if (h > SEA_LEVEL) continue;
      if ((w.terrain.flags[t] & TileFlag.River) !== 0) continue;
      const nextToLand = [t - 1, t + 1, t - size, t + size]
        .some((n) => w.terrain.height[n] > SEA_LEVEL);
      if (shallow < 0 && h >= RECLAIM_MAX_DEPTH && nextToLand) shallow = t;
      if (deep < 0 && h < RECLAIM_MAX_DEPTH - 20 && nextToLand) deep = t;
    }
  }
  return { w, shallow, deep, size };
}

describe('land reclamation', () => {
  it('is not possible before its era', () => {
    const { w, shallow } = coast();
    expect(shallow).toBeGreaterThanOrEqual(0);
    const plan = planReclamation(w.terrain, [shallow], RECLAIM_FROM_ERA - 1);
    expect(plan.ok).toBe(false);
  });

  it('fills an inlet against the shore', () => {
    const { w, shallow } = coast();
    const plan = planReclamation(w.terrain, [shallow], RECLAIM_FROM_ERA);
    expect(plan.ok, plan.problem).toBe(true);
    expect(plan.cost).toBeGreaterThan(0);

    const before = w.terrain.height[shallow];
    expect(before).toBeLessThanOrEqual(SEA_LEVEL);
    reclaim(w.terrain, plan);
    expect(w.terrain.height[shallow]).toBe(RECLAIM_LEVEL);
    expect(w.terrain.flags[shallow] & TileFlag.Buildable).toBeTruthy();
  });

  it('refuses to build an island', () => {
    const { w, size } = coast();
    // A tile with nothing but water around it.
    let offshore = -1;
    for (let y = 4; y < size - 4 && offshore < 0; y++) {
      for (let x = 4; x < size - 4; x++) {
        const t = y * size + x;
        if (w.terrain.height[t] > SEA_LEVEL) continue;
        const lonely = [t - 1, t + 1, t - size, t + size]
          .every((n) => w.terrain.height[n] <= SEA_LEVEL);
        if (lonely) { offshore = t; break; }
      }
    }
    expect(offshore).toBeGreaterThanOrEqual(0);
    // Made shallow by hand, so depth cannot be the reason it is refused and
    // the only rule left to catch it is the one being tested. Open water is
    // usually deep as well as lonely, and a test that passes for the wrong
    // reason is worse than no test.
    w.terrain.height[offshore] = -2;
    const plan = planReclamation(w.terrain, [offshore], RECLAIM_FROM_ERA);
    expect(plan.ok).toBe(false);
    expect(plan.problem).toContain('shore');
  });

  it('refuses water that is genuinely deep', () => {
    const { w, deep } = coast();
    if (deep < 0) return; // this seed has no deep water against a shore
    const plan = planReclamation(w.terrain, [deep], RECLAIM_FROM_ERA);
    expect(plan.ok).toBe(false);
    expect(plan.problem).toContain('deep');
  });

  it('lets a scheme grow from its own new ground, one pass', () => {
    const { w, shallow, size } = coast();
    // Two tiles: one against the shore, and one against the first.
    const neighbour = [shallow - 1, shallow + 1, shallow - size, shallow + size]
      .find((n) => w.terrain.height[n] <= SEA_LEVEL
        && w.terrain.height[n] >= RECLAIM_MAX_DEPTH
        && (w.terrain.flags[n] & TileFlag.River) === 0);
    if (neighbour === undefined) return;
    const plan = planReclamation(w.terrain, [shallow, neighbour], RECLAIM_FROM_ERA);
    expect(plan.ok, plan.problem).toBe(true);
    expect(plan.tiles.length).toBe(2);
  });

  it('costs more the deeper it is', () => {
    const { w, shallow } = coast();
    const shallowPlan = planReclamation(w.terrain, [shallow], RECLAIM_FROM_ERA);
    // Push the same tile down and price it again.
    w.terrain.height[shallow] = RECLAIM_MAX_DEPTH;
    const deeperPlan = planReclamation(w.terrain, [shallow], RECLAIM_FROM_ERA);
    expect(deeperPlan.ok, deeperPlan.problem).toBe(true);
    expect(deeperPlan.cost).toBeGreaterThan(shallowPlan.cost);
  });

  it('needs a land charter and enough money, through the world', () => {
    const { w, shallow } = coast();
    while (w.era < RECLAIM_FROM_ERA) w.step();
    w.companies.charter[w.player] = Charter.Extraction;
    expect(w.reclaimLand(w.player, [shallow])).toBe(false);

    w.companies.charter[w.player] = Charter.Land;
    w.companies.cash[w.player] = 1;
    expect(w.reclaimLand(w.player, [shallow])).toBe(false);

    w.companies.cash[w.player] = 900_000_000;
    expect(w.reclaimLand(w.player, [shallow])).toBe(true);
    expect(w.terrain.height[shallow]).toBe(RECLAIM_LEVEL);
  });
});
