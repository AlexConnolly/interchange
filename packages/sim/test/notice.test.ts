/**
 * How fast the parish notices you, and why a first van has to feel it.
 *
 * "If I do something great early game there's no scale — it gives me maybe +1%.
 * Nothing. Surely early game that impacts more?"
 *
 * It gave *nothing*, and the measurement said so exactly. A load was worth 0.055 and
 * a flat drift took 0.16 a day, so it took 2.9 loads a day just to stand still — and
 * a working first van on the opening contract runs 2.50. Approval sat at exactly
 * 30.00 for a whole game year while the haulier earned £925,000.
 *
 * Two changes, and the drift was as much to blame as the rate:
 *
 * A *proportional* decay rather than a flat one, so any gain at all lifts you off
 * the floor and the number settles at `rest + gain/decay` instead of being clamped.
 *
 * And the value of a load divided by the size of the fleet, because what the parish
 * registers is not how many loads you shifted but how much of *you* they saw doing
 * it. Which is the request answered from the other end: nothing is made deliberately
 * generous to a beginner, it is just that a beginner's one lorry genuinely is their
 * whole business.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld, TICKS_PER_DAY, facilitiesFor, ContractState,
  APPROVAL_REST, APPROVAL_DECAY_PER_DAY, noticePerLoad,
} from '../src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

const D = 128;

/** A haulier with a yard, a van, and the opening contract in hand. */
function working() {
  const w = createWorld({ seed: 1985, size: D, townCount: 3, companyCount: 4 });
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
  w.refreshInfluence();
  w.offerWorkNow();
  for (let i = 0; i < 3 * TICKS_PER_DAY; i++) w.step();
  const b = w.contractBoard;
  for (let i = 0; i < b.count; i++) {
    if (b.state[i] !== ContractState.Offered) continue;
    const free = w.driversFor(i).find((d) => d.suitable);
    if (!free) continue;
    if (w.acceptContract(i, w.player, free.vehicle)) break;
  }
  return w;
}

function run(w: ReturnType<typeof working>, days: number): void {
  for (let i = 0; i < days * TICKS_PER_DAY; i++) w.step();
}

describe('a haulier in their first month', () => {
  it('is noticed, which is the whole of the complaint', () => {
    /*
     * The number that was zero. Anything above a point or two is a fix; this asks
     * for five, which is the difference between "something happened" and "the
     * number moved".
     */
    const w = working();
    run(w, 24);
    expect(w.approval - APPROVAL_REST).toBeGreaterThan(5);
  });

  it('would not have been, under the old flat drift', () => {
    /*
     * The old arithmetic, stated so the regression is visible rather than
     * remembered: 0.055 a load against 0.16 a day of drift needs 2.9 loads a day,
     * and the opening van runs 2.50. It was not close and it was not noisy — it was
     * pinned at the floor to the second decimal place.
     */
    const OLD_PER_LOAD = 0.055;
    const OLD_DRIFT = 0.16;
    const OPENING_LOADS_A_DAY = 2.5;
    expect(OLD_PER_LOAD * OPENING_LOADS_A_DAY).toBeLessThan(OLD_DRIFT);
  });

  it('keeps climbing, then levels off rather than running to the ceiling', () => {
    const w = working();
    run(w, 24);
    const month = w.approval;
    run(w, 72);
    const quarter = w.approval;
    run(w, 96);
    const later = w.approval;

    expect(quarter, 'still climbing at three months').toBeGreaterThan(month);
    expect(later, 'still above where it was').toBeGreaterThan(quarter - 1);
    // And nowhere near a hundred, which is what a ratchet would have reached.
    expect(later).toBeLessThan(75);
  });
});

describe('stopping', () => {
  it('costs you, and visibly', () => {
    /*
     * The other half of a proportional decay: it has to be able to fall. A flat
     * drift could only ever take you back to the floor at one speed regardless of
     * how far up you were.
     */
    const w = working();
    run(w, 120);
    const earned = w.approval;
    expect(earned).toBeGreaterThan(APPROVAL_REST + 10);

    // Take the lorry off everything and let a season pass.
    for (let v = 0; v < w.vehicles.count; v++) {
      if (w.vehicles.alive[v] && w.vehicles.company[v] === w.player) {
        const svc = w.vehicles.service[v];
        if (svc >= 0) w.endRun(svc);
      }
    }
    run(w, 96);
    expect(w.approval, 'a quarter of doing nothing costs you').toBeLessThan(earned - 5);
    expect(w.approval, 'but never below indifference')
      .toBeGreaterThanOrEqual(APPROVAL_REST - 1e-6);
  });
});

describe('what a load is worth', () => {
  it('is divided by the fleet, so one van counts for its whole business', () => {
    expect(noticePerLoad(1)).toBeGreaterThan(noticePerLoad(2));
    expect(noticePerLoad(4)).toBeCloseTo(noticePerLoad(1) / 4, 10);
  });

  it('does not divide by nothing when the fleet is empty', () => {
    expect(Number.isFinite(noticePerLoad(0))).toBe(true);
    expect(noticePerLoad(0)).toBe(noticePerLoad(1));
  });

  it('measures how well you serve rather than how big you are', () => {
    /*
     * The design decision this makes, stated as arithmetic: a fleet that is twice
     * the size and does twice the work is regarded the same. Growing is rewarded
     * everywhere else in this game; here it is neutral, and what separates a large
     * operator from a small one is what they have *built*, which is the local half
     * of the approval field.
     */
    const oneVan = noticePerLoad(1) * 2.5;
    const fourVans = noticePerLoad(4) * 10;
    expect(fourVans).toBeCloseTo(oneVan, 10);
  });

  it('falls if the extra lorries are not pulling their weight', () => {
    /*
     * Measured on seed 1985: four lorries queued on one milk run manage 3.33 loads
     * a day between them where a single van manages 2.50, so the parish sees four
     * times the lorries and a third more service. That reads as a badly run firm
     * and the number says so.
     */
    const busy = noticePerLoad(1) * 2.5;
    const idle = noticePerLoad(4) * 3.33;
    expect(idle).toBeLessThan(busy);
  });
});

describe('the decay', () => {
  it('settles where the gain balances it, not at a floor or a ceiling', () => {
    /*
     * `rest + gain/decay`, which is the property that makes any amount of work
     * visible however small. Checked as arithmetic because it is the reason the
     * shape was changed.
     */
    const gain = noticePerLoad(1) * 2.5;
    const settled = APPROVAL_REST + gain / APPROVAL_DECAY_PER_DAY;
    expect(settled).toBeGreaterThan(45);
    expect(settled).toBeLessThan(70);
  });

  it('is slow enough to be a record and quick enough to be felt', () => {
    // A time constant between a month and a season, in days.
    const constant = 1 / APPROVAL_DECAY_PER_DAY;
    expect(constant).toBeGreaterThan(24);
    expect(constant).toBeLessThan(96);
  });
});
