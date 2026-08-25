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
 * that pins this down. It should be a half: the middle of the tile. Dead on 0.0
 * is the bug this was written for, where a tile index was used as a position and
 * every lorry drove up the verge. Which side of the centre a vehicle then sits on
 * is a rendering matter and is tested in `facing.test.ts`.
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
  it('runs down the middle of the lane, not along the tile boundary', () => {
    const f = crossFractions(district(), 900);
    expect(f.length).toBeGreaterThan(50);
    /*
     * Dead centre is now the *right* answer, and it did not used to be.
     *
     * A tile index names its corner, so a projection that stopped there put every
     * lorry half a tile into the verge — the bug this test was written for. The
     * lane offset that keeps a vehicle to the left of the centreline has since
     * moved into the renderer, because computing it per link made it flip axis at
     * every junction and jump the vehicle sideways; see `laneOffset`. So what the
     * simulation reports is the centreline, and what this asserts is that the
     * centreline really is the centre.
     */
    for (const v of f) expect(Math.abs(v - 0.5)).toBeLessThan(0.02);
  });
});


/**
 * The simulated position never jumps at a junction.
 *
 * This is the measurement that finally caught the spin. The lane offset used to
 * be computed per link, perpendicular to that link's direction — so the instant a
 * vehicle changed link the offset changed axis and the position moved a quarter of
 * a tile sideways in one tick. Measured: a largest single-tick step of 0.2342
 * tiles against a top speed of 0.0731, a sideways flip more than three times the
 * real motion, and every one of the top ten steps was exactly that same figure —
 * one per junction.
 *
 * The renderer derives a vehicle's facing from how it is moving, so for a few
 * frames after each junction a vehicle faced the flip rather than the road, and a
 * van turning left span the long way round. Halving the road speeds made it far
 * worse, because the jump stayed the same size while the real motion halved.
 *
 * So the assertion is simply that the largest step is a plausible step. Anything
 * that reintroduces a positional discontinuity here brings the spin back with it.
 */
describe('the simulated path is continuous', () => {
  it('never moves a vehicle further in one tick than it could drive', () => {
    const w = district();
    let prev: { x: number; z: number } | null = null;
    let worst = 0;
    for (let t = 0; t < TICKS_PER_DAY * 2; t++) {
      w.step();
      w.project();
      for (let v = 0; v < w.vehicles.count; v++) {
        if (!w.vehicles.alive[v] || w.vehicles.company[v] !== w.player) continue;
        if (w.vehicles.link[v] === -1) { prev = null; continue; }
        const at = { x: w.vehicles.x[v] / 65536, z: w.vehicles.y[v] / 65536 };
        if (prev) worst = Math.max(worst, Math.hypot(at.x - prev.x, at.z - prev.z));
        prev = at;
      }
    }
    expect(worst).toBeGreaterThan(0);
    // Top speed is about 0.073 tiles a tick; the junction flip was 0.234.
    expect(worst).toBeLessThan(0.12);
  });
});
