import { describe, expect, it } from 'vitest';
import { Farmwork, type FarmField } from '../src/farmwork.ts';

/*
 * A tractor working a field, on a district of one lane, one farm and one field.
 *
 * What is worth testing here is not that a tractor exists — it is that it stays
 * inside the hedge and that it works the field rather than parking in it. Both
 * were things I got wrong on paper first: an inset of zero drives through the
 * boundary, and a furrow that does not alternate produces a tractor that
 * teleports back to the same end of every pass.
 */

const SIZE = 32;
const t = (x: number, z: number): number => z * SIZE + x;

// A lane along z = 10, from the farm at x = 4 to the field gate at x = 14.
const LANE: number[] = [];
for (let x = 4; x <= 14; x++) LANE.push(t(x, 10));

const FIELD: FarmField = {
  parcel: 1,
  x0: 12, x1: 19, z0: 12, z1: 17,
  road: t(14, 10),
  entryX: 14.5,
  entryZ: 12.5,
};

function district(worked?: Set<number>): Farmwork {
  return new Farmwork({
    size: SIZE,
    farms: () => [{ tile: t(4, 10), x: 4.5, z: 10.5 }],
    fields: () => [FIELD],
    usable: () => true,
    // Out along the lane, and back the same way.
    route: (from) => (from === t(4, 10) ? [...LANE] : [...LANE].reverse()),
    work: (tile) => { worked?.add(tile); },
    needsWork: () => true,
    // One class of road everywhere, so nothing outranks anything and the
    // give-way rule never fires. The following rule is what these tests are
    // about; priority has its own test below.
    rank: () => 1,
  });
}

/** Run the district for a while, collecting every position drawn. */
function run(seconds: number, worked?: Set<number>): { x: number; z: number }[] {
  const farm = district(worked);
  const cap = 64;
  const vx = new Float32Array(cap);
  const vz = new Float32Array(cap);
  const vh = new Float32Array(cap);
  const vl = new Uint8Array(cap);
  const vm = new Uint8Array(cap);
  const vi = new Int32Array(cap);
  const seen: { x: number; z: number }[] = [];
  const dt = 1 / 30;
  for (let s = 0; s < seconds * 30; s++) {
    const n = farm.step(dt, 3, 0, vx, vz, vh, vl, vm, vi);
    for (let k = 0; k < n; k++) seen.push({ x: vx[k], z: vz[k] });
  }
  return seen;
}

describe('tractors', () => {
  it('work the ground they pass over, and only inside the field', () => {
    // The whole point of them, and the assertion that matters: every tile they
    // report working must be one of the field's own. A tractor that ploughed
    // the lane it drove down would be very obvious and very wrong.
    const worked = new Set<number>();
    run(120, worked);
    expect(worked.size).toBeGreaterThan(6);
    for (const tile of worked) {
      const x = tile % SIZE;
      const z = Math.floor(tile / SIZE);
      expect(x).toBeGreaterThanOrEqual(FIELD.x0);
      expect(x).toBeLessThanOrEqual(FIELD.x1);
      expect(z).toBeGreaterThanOrEqual(FIELD.z0);
      expect(z).toBeLessThanOrEqual(FIELD.z1);
    }
  });

  it('come out of the farm and get drawn', () => {
    expect(run(20).length).toBeGreaterThan(0);
  });

  it('never leave the field or the lane they are entitled to', () => {
    // Everything drawn must be inside the field, on the lane, or on the short
    // run between the two. A tractor across the district is the failure this
    // catches, and it is the one that would be most obvious on screen.
    for (const p of run(120)) {
      const inField = p.x >= FIELD.x0 && p.x <= FIELD.x1 + 1
        && p.z >= FIELD.z0 && p.z <= FIELD.z1 + 1;
      const onLane = p.x >= 4 && p.x <= 15 && p.z >= 9.5 && p.z <= 11.5;
      const atGate = p.x >= 14 && p.x <= 15.5 && p.z >= 10 && p.z <= 13;
      expect(inField || onLane || atGate).toBe(true);
    }
  });

  it('works the field in passes rather than parking in it', () => {
    const inside = run(180).filter(
      (p) => p.x > FIELD.x0 && p.x < FIELD.x1 + 1 && p.z > FIELD.z0 + 0.2,
    );
    expect(inside.length).toBeGreaterThan(30);
    // Both ends of a furrow, and more than one furrow: the marks of a
    // boustrophedon rather than a tractor sat still.
    const xs = inside.map((p) => p.x);
    const zs = inside.map((p) => p.z);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(4);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(1);
  });
});


/**
 * Waiting at the end of the farm lane.
 *
 * A tractor pulling out of a track onto a road without looking is the one place
 * it genuinely holds up the traffic of England, and the one place it should not.
 * The rule is the road class: a lane gives way to anything on a better road.
 */
describe('a tractor at a junction', () => {
  it('holds for a vehicle on a more important road, and not for one on its own', () => {
    const cap = 64;
    const vx = new Float32Array(cap);
    const vz = new Float32Array(cap);
    const vh = new Float32Array(cap);
    const vl = new Uint8Array(cap);
    const vm = new Uint8Array(cap);
    const vi = new Int32Array(cap);

    // One vehicle already in the arrays, sitting on the lane a little ahead of
    // where a tractor leaving the farm will be.
    const run = (laneRank: number, otherRank: number): number => {
      const farm = new Farmwork({
        size: SIZE,
        farms: () => [{ tile: t(4, 10), x: 4.5, z: 10.5 }],
        fields: () => [FIELD],
        usable: () => true,
        route: (from) => (from === t(4, 10) ? [...LANE] : [...LANE].reverse()),
        work: () => {},
        needsWork: () => true,
        rank: (tile) => (tile === t(7, 10) ? otherRank : laneRank),
      });
      let moved = 0;
      let last = -1;
      for (let s = 0; s < 400; s++) {
        // A parked obstruction on tile (7,10), written before the tractors.
        vx[0] = 7.5;
        vz[0] = 10.5;
        vi[0] = 99;
        const n = farm.step(1 / 30, 3, 1, vx, vz, vh, vl, vm, vi);
        for (let k = 1; k < n; k++) {
          if (vi[k] !== -1000) continue;
          if (last >= 0 && Math.abs(vx[k] - last) > 1e-4) moved++;
          last = vx[k];
        }
      }
      return moved;
    };

    // On a better road, the obstruction is given way to and the first tractor
    // spends far more of its time standing still than when it outranks it.
    const yielding = run(1, 3);
    const equal = run(1, 1);
    expect(yielding).toBeLessThan(equal);
  });
});
