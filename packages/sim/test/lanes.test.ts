import { describe, expect, it } from 'vitest';
import { createWorld, TICKS_PER_DAY, facilitiesFor } from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

/**
 * Are the lorries actually on the road?
 *
 * A tile index converts to the tile's *corner*, and the road surface is drawn
 * from there to the next corner with its centreline at plus a half. The
 * projection stopped at the corner, so every vehicle in the game was drawn half
 * a tile up and half a tile left of the lane it was on — which beside a farmhouse
 * means inside the farmhouse, and which is what "vehicles are driving through
 * buildings" was. Nothing caught it because the ambient traffic, written later
 * and by hand, had always used tile centres and looked correct.
 *
 * The first version of this test asserted the position floored to a road tile,
 * and passed against the broken code — a corner *is* a point of its own tile, so
 * the measurement could not see the bug it existed to catch. What discriminates
 * is the offset across the lane, below.
 */

loadContent();

const D = 128;

function district(): ReturnType<typeof createWorld> {
  const w = createWorld({ seed: 1985, size: D, townCount: 3, companyCount: 1 });
  w.tick = 60 * TICKS_PER_DAY;
  const opening = w.planOpening();
  const inset = D * 0.3;
  const clamp = (v: number): number => Math.max(inset, Math.min(D - inset, v));
  const cx = clamp(opening.x);
  const cz = clamp(opening.y);
  w.refreshInfluence([{ x: cx, y: cz, strength: 2.4 }]);
  w.companies.cash[w.player] = w.content.balance.startingCash;
  w.primeStock();
  const yard = w.foundYard(Math.round(cx), Math.round(cz), 'Yard');
  const vi = w.openingVehicle(opening.cargo);
  const def = w.content.vehicles[vi];
  w.yards.add(yard, facilitiesFor({
    handling: def.handling as readonly string[], cls: def.class,
  }));
  w.buyVehicleAtYard(vi, yard);
  w.offerWorkNow();
  const board = w.contractBoard;
  for (let i = 0; i < board.count; i++) {
    const d = w.driversFor(i).find((x) => x.suitable);
    if (d && w.acceptContract(i, w.player, d.vehicle)) break;
  }
  return w;
}

/**
 * Where the vehicle sits *across* its lane, sample by sample.
 *
 * The measurement has to pick out the cross axis rather than the one it is
 * driving along, because the along-axis coordinate sweeps the whole tile and its
 * fractional part says nothing. Consecutive samples give it away: the axis that
 * barely changes is the one across the road.
 *
 * The returned figure is that axis's fractional part, and it is the one number
 * that pins the whole thing down. On a lane it should be about 0.34 or 0.66 —
 * half a tile to reach the centreline, a sixth back for keeping left. Dead on 0.0
 * is the bug where a tile index was used as a position; dead on 0.5 is the bug
 * where there is no lane offset and two lorries meeting head-on drive through
 * each other.
 */
function crossFractions(w: ReturnType<typeof createWorld>, ticks: number): number[] {
  const out: number[] = [];
  let prev: { x: number; z: number } | null = null;
  for (let t = 0; t < ticks; t++) {
    w.step();
    w.project();
    for (let v = 0; v < w.vehicles.count; v++) {
      if (!w.vehicles.alive[v] || w.vehicles.company[v] !== w.player) continue;
      if (w.vehicles.link[v] === -1) { prev = null; continue; }
      const at = { x: w.vehicles.x[v] / 65536, z: w.vehicles.y[v] / 65536 };
      if (prev !== null) {
        const dx = Math.abs(at.x - prev.x);
        const dz = Math.abs(at.z - prev.z);
        // Only while it is running along one axis. At a junction both change and
        // neither of them is "across".
        if (Math.max(dx, dz) > 1e-4 && Math.min(dx, dz) < Math.max(dx, dz) * 0.2) {
          const cross = dx < dz ? at.x : at.z;
          out.push(((cross % 1) + 1) % 1);
        }
      }
      prev = at;
    }
  }
  return out;
}

describe('vehicles on the road', () => {
  it('drives down the lane rather than along the tile boundary', () => {
    const f = crossFractions(district(), 900);
    expect(f.length).toBeGreaterThan(50);
    const onTheLine = f.filter((v) => v < 0.15 || v > 0.85).length;
    expect(onTheLine / f.length).toBeLessThan(0.05);
  });

  it('keeps left, so two lorries meeting do not pass through each other', () => {
    const f = crossFractions(district(), 900);
    const deadCentre = f.filter((v) => Math.abs(v - 0.5) < 0.08).length;
    expect(deadCentre / f.length).toBeLessThan(0.05);
  });

  it('sits about a sixth of a tile off the centreline', () => {
    const f = crossFractions(district(), 900);
    const mean = f.reduce((a, b) => a + Math.abs(b - 0.5), 0) / f.length;
    expect(mean).toBeGreaterThan(0.10);
    expect(mean).toBeLessThan(0.24);
  });
});
