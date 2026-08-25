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

const MACHINES = { plough: 3, drill: 4, sprayer: 5, combine: 6 };

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

function district(worked?: Set<number>, job: 'plough' | 'combine' = 'plough'): Farmwork {
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
    job: () => job,
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
    const n = farm.step(dt, MACHINES, 0, vx, vz, vh, vl, vm, vi);
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
    /*
     * Long enough for a full visit at the district's *current* pace.
     *
     * Four hundred seconds was enough until the machines were halved in speed,
     * at which point this failed at thirty-eight tiles of forty-eight — which is
     * the test doing its job: it is tied to a tuning constant and it said so the
     * moment the constant moved. Doubled, with room to spare, so the next change
     * of pace does not fail it for the same uninteresting reason.
     */
    run(1200, worked);
    /*
     * Every tile of the field, not "more than six".
     *
     * The first version of this assertion was `> 6` on a field of forty-eight
     * tiles, which is no assertion at all — it would have passed with an eighth
     * of the field done, and the complaint that brought me back here was
     * precisely that ground driven over was not changing. A coverage count is the
     * only version of this test worth having.
     */
    const tiles = (FIELD.x1 - FIELD.x0 + 1) * (FIELD.z1 - FIELD.z0 + 1);
    expect(worked.size).toBe(tiles);
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
  it('holds on the lane for a vehicle on a more important road', () => {
    /*
     * Measured on the lane only, and over long enough for a machine to have
     * finished a field and set off again.
     *
     * The first version of this test watched tractor zero and ran for thirteen
     * seconds. Both assumptions were wrong once fields could be claimed: which
     * machine gets the one field is decided by whoever's idle timer fires first,
     * and half of them start out already mid-furrow and so never drive the lane
     * at all. It measured nothing and said so by returning zero for both cases.
     */
    const run = (laneRank: number, otherRank: number): number => {
      const cap = 64;
      const vx = new Float32Array(cap);
      const vz = new Float32Array(cap);
      const vh = new Float32Array(cap);
      const vl = new Uint8Array(cap);
      const vm = new Uint8Array(cap);
      const vi = new Int32Array(cap);
      const farm = new Farmwork({
        size: SIZE,
        farms: () => [{ tile: t(4, 10), x: 4.5, z: 10.5 }],
        fields: () => [FIELD],
        usable: () => true,
        route: (from) => (from === t(4, 10) ? [...LANE] : [...LANE].reverse()),
        work: () => {},
        needsWork: () => true,
        // The obstruction sits on tile (7,10); everything else is the lane.
        rank: (tile) => (tile === t(7, 10) ? otherRank : laneRank),
        job: () => 'plough' as const,
      });
      const last = new Map<number, number>();
      let moved = 0;
      for (let s = 0; s < 30 * 200; s++) {
        // A parked obstruction on the lane, written before the machines so they
        // can see it.
        vx[0] = 7.5;
        vz[0] = 10.5;
        vi[0] = 99;
        const n = farm.step(1 / 30, MACHINES, 1, vx, vz, vh, vl, vm, vi);
        for (let k = 1; k < n; k++) {
          // Only while it is on the lane, which is where the junction is.
          if (vz[k] < 9.5 || vz[k] > 11.5) { last.delete(vi[k]); continue; }
          const was = last.get(vi[k]);
          if (was !== undefined && Math.abs(vx[k] - was) > 1e-4) moved++;
          last.set(vi[k], vx[k]);
        }
      }
      return moved;
    };

    const yielding = run(1, 3);
    const equal = run(1, 1);
    // Both cases have to be doing something, or the comparison is vacuous — the
    // mistake the first version of this test made.
    expect(equal).toBeGreaterThan(50);
    expect(yielding).toBeLessThan(equal);
  });
});

describe('a tractor never teleports', () => {
  it('moves in small steps for its whole visit, turns included', () => {
    const farm = district();
    const cap = 64;
    const vx = new Float32Array(cap);
    const vz = new Float32Array(cap);
    const vh = new Float32Array(cap);
    const vl = new Uint8Array(cap);
    const vm = new Uint8Array(cap);
    const vi = new Int32Array(cap);
    const last = new Map<number, { x: number; z: number }>();
    let worst = 0;
    const dt = 1 / 30;
    for (let s = 0; s < 30 * 240; s++) {
      const n = farm.step(dt, MACHINES, 0, vx, vz, vh, vl, vm, vi);
      const drawn = new Set<number>();
      for (let k = 0; k < n; k++) {
        drawn.add(vi[k]);
        const was = last.get(vi[k]);
        const at = { x: vx[k], z: vz[k] };
        if (was) worst = Math.max(worst, Math.hypot(at.x - was.x, at.z - was.z));
        last.set(vi[k], at);
      }
      /*
       * A tractor sitting in its yard is not drawn at all, and the next thing it
       * does is appear somewhere else entirely. That is a gap in the record, not a
       * jump in a journey — so forgetting where it was is the honest way to
       * measure, rather than a distance threshold that would also hide the bug.
       */
      for (const id of [...last.keys()]) if (!drawn.has(id)) last.delete(id);
    }
    expect(worst).toBeGreaterThan(0);
    /*
     * A tenth of what it was, and the threshold is now a real bound rather than
     * a guess: the fastest machine is a sprayer at about one and a fifth tiles a
     * second, sampled thirty times a second, so a legitimate frame moves about
     * four hundredths of a tile. Eight hundredths leaves room for the gate run's
     * slightly quicker pace and nothing else.
     */
    expect(worst).toBeLessThan(0.08);
  });
});


/**
 * Two machines are never sent to the same field.
 *
 * With seven of them and a handful of fields wanting work in a given week, this
 * happened constantly — and the second to arrive drove the whole field towing a
 * plough over ground the first had already turned over. The work was real and
 * had been done an hour earlier by somebody else, which from the air is
 * indistinguishable from a machine that does nothing.
 */
describe('two machines never share a field', () => {
  it('claims a field and does not offer it again', () => {
    const seen = new Map<number, Set<number>>();
    const fields: FarmField[] = [
      FIELD,
      { parcel: 2, x0: 22, x1: 28, z0: 12, z1: 17, road: t(20, 10), entryX: 22.5, entryZ: 12.5 },
    ];
    const laneLong: number[] = [];
    for (let x = 4; x <= 22; x++) laneLong.push(t(x, 10));
    const farm = new Farmwork({
      size: SIZE,
      farms: () => [{ tile: t(4, 10), x: 4.5, z: 10.5 }],
      fields: () => fields,
      usable: () => true,
      route: (from) => (from === t(4, 10) ? [...laneLong] : [...laneLong].reverse()),
      work: () => {},
      needsWork: () => true,
      rank: () => 1,
      job: () => 'plough' as const,
    });
    const cap = 64;
    const vx = new Float32Array(cap);
    const vz = new Float32Array(cap);
    const vh = new Float32Array(cap);
    const vl = new Uint8Array(cap);
    const vm = new Uint8Array(cap);
    const vi = new Int32Array(cap);
    for (let s = 0; s < 30 * 300; s++) {
      const n = farm.step(1 / 30, MACHINES, 0, vx, vz, vh, vl, vm, vi);
      // Which field is each machine standing in?
      const inField = new Map<number, number>();
      for (let k = 0; k < n; k++) {
        for (const f of fields) {
          if (vx[k] >= f.x0 && vx[k] <= f.x1 + 1 && vz[k] >= f.z0 && vz[k] <= f.z1 + 1) {
            inField.set(vi[k], f.parcel);
          }
        }
      }
      for (const [id, p] of inField) {
        const set = seen.get(p) ?? new Set<number>();
        set.add(id);
        seen.set(p, set);
      }
      // At any instant, no two machines in the same field.
      const counts = new Map<number, number>();
      for (const p of inField.values()) counts.set(p, (counts.get(p) ?? 0) + 1);
      for (const [, c] of counts) expect(c).toBeLessThan(2);
    }
    // And both fields did get visited, or the claim is simply blocking everything.
    expect(seen.size).toBe(2);
  });
});


/**
 * Field work is daylight work.
 *
 * Tractors ran round the clock, which meant a village with every light off and a
 * full harvest going on in the dark around it, and it threw away the one thing a
 * night is for: the countryside going still. The combine is the exception, in the
 * game and in life — when the crop is fit you cut until you cannot see.
 *
 * These drive the clock directly rather than through the frame loop, because what
 * is being pinned is the *rule* and not the plumbing: `hour` is a plain field
 * precisely so it can be set to three in the morning without simulating a night.
 */
function machinesOut(hour: number, job: 'plough' | 'combine'): number {
  const farm = district(undefined, job);
  const cap = 64;
  const vx = new Float32Array(cap);
  const vz = new Float32Array(cap);
  const vh = new Float32Array(cap);
  const vl = new Uint8Array(cap);
  const vm = new Uint8Array(cap);
  const vi = new Int32Array(cap);
  const dt = 1 / 30;
  let most = 0;
  // Two minutes, which is far longer than the second and a half the machines
  // stagger their first dispatch over — so "none went out" means none ever will.
  for (let k = 0; k < 120 * 30; k++) {
    farm.hour = hour;
    most = Math.max(most, farm.step(dt, MACHINES, 0, vx, vz, vh, vl, vm, vi));
  }
  return most;
}

describe('the working day', () => {
  it('sends machines out in the afternoon', () => {
    // The hour the game opens at, which had better be a district with work in it.
    expect(machinesOut(17, 'plough')).toBeGreaterThan(0);
  });

  it('keeps them in the yard in the small hours', () => {
    expect(machinesOut(3, 'plough')).toBe(0);
    // Not even the combine, which is the whole point of it being three more
    // hours rather than no limit at all.
    expect(machinesOut(3, 'combine')).toBe(0);
  });

  it('stops the plough at eight but lets the combine cut on', () => {
    expect(machinesOut(21, 'plough')).toBe(0);
    expect(machinesOut(21, 'combine')).toBeGreaterThan(0);
  });

  it('brings a machine that is already out home when the day ends', () => {
    /*
     * The soft end, and the reason it has to be soft: a machine abandoned
     * mid-furrow reads as a fault rather than as the end of a day. So it works
     * until the shift is over, finishes the pass it is on, and drives home.
     *
     * Measured against its own baseline, which is the only way this can mean
     * anything. The first version asserted simply that the field eventually
     * emptied — and it passed with the rule disabled, because a machine that
     * works all four passes and goes home does that too. What discriminates is
     * *when*: knocking off has to be sooner than finishing.
     */
    const home = (endShiftAt: number): number => {
      const farm = district(undefined, 'plough');
      const cap = 64;
      const vx = new Float32Array(cap);
      const vz = new Float32Array(cap);
      const vh = new Float32Array(cap);
      const vl = new Uint8Array(cap);
      const vm = new Uint8Array(cap);
      const vi = new Int32Array(cap);
      const dt = 1 / 30;
      let out = 0;
      for (let k = 0; k < 900 * 30; k++) {
        // Afternoon until the given moment, then the day is over.
        farm.hour = k / 30 < endShiftAt ? 17 : 22;
        const n = farm.step(dt, MACHINES, 0, vx, vz, vh, vl, vm, vi);
        // The first time the field is empty again *after* it had something in it.
        if (out > 0 && n === 0) return k / 30;
        out = Math.max(out, n);
      }
      return Infinity;
    };
    // Working the field, then sent home a minute in.
    const knockedOff = home(60);
    // The same run with the shift never ending: it finishes all four passes.
    const finished = home(Infinity);
    expect(finished).toBeLessThan(Infinity);
    expect(knockedOff).toBeLessThan(finished);
  });
});
