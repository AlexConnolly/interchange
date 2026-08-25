/**
 * Yards, and the facilities that decide what they can take.
 *
 * design.md §3: a yard is not a spawn point. It is a place you own, with bays
 * and equipment, and a vehicle needs the right equipment or it cannot be based
 * there.
 *
 * That is the good constraint in the whole design, and it is good because of how
 * the *failure* reads. "Buy a tanker" refusing with **your yard has no tank
 * bay** is one sentence, obviously true, and fixed by a purchase. Compare a
 * tech tree, where the same refusal is "you have not researched tankers" — which
 * is a rule, not a reason.
 *
 * It also does the work of three other mechanics at once. It makes *where* a
 * yard is matter, because a yard with a chiller in the wrong valley is no use.
 * It makes buying production bite, because owning the creamery means milk, and
 * milk means a tanker, and a tanker means a bay you have not got. And it gives
 * the second and third yards a reason to exist that is not simply "more".
 */

import { NONE } from './network.ts';

export const MAX_YARDS = 8;

/**
 * What a yard can have. A bitmask, because a vehicle asks "does this yard have
 * all of these" and a bitmask answers in one instruction.
 */
export const Facility = {
  /** Every yard has one. Somewhere to park. */
  Hardstanding: 1 << 0,
  /** Tippers and anything bulk: you cannot run bulk without weighing it. */
  Weighbridge: 1 << 1,
  /** Refrigerated. Milk, dairy, meat. */
  Chiller: 1 << 2,
  /** Tankers. */
  TankBay: 1 << 3,
  /** Artics, which need room to turn as much as room to stand. */
  LongBay: 1 << 4,
  /** Keeps the whole fleet running: without one, everything wears faster. */
  Workshop: 1 << 5,
} as const;
export type Facility = (typeof Facility)[keyof typeof Facility];

export const FACILITY_NAMES: [number, string][] = [
  [Facility.Hardstanding, 'Hardstanding'],
  [Facility.Weighbridge, 'Weighbridge'],
  [Facility.Chiller, 'Chiller'],
  [Facility.TankBay, 'Tank bay'],
  [Facility.LongBay, 'Long bay'],
  [Facility.Workshop, 'Workshop'],
];

/** What each one costs to put in, in pence. */
export const FACILITY_COST: Record<number, number> = {
  [Facility.Hardstanding]: 180_000,
  [Facility.Weighbridge]: 620_000,
  [Facility.Chiller]: 940_000,
  [Facility.TankBay]: 780_000,
  [Facility.LongBay]: 1_350_000,
  [Facility.Workshop]: 1_600_000,
};

export class YardTable {
  count = 0;
  readonly x = new Int32Array(MAX_YARDS);
  readonly y = new Int32Array(MAX_YARDS);
  readonly tile = new Int32Array(MAX_YARDS).fill(NONE);
  readonly owner = new Int16Array(MAX_YARDS).fill(-1);
  readonly facilities = new Int32Array(MAX_YARDS);
  /** How many vehicles can be based here. A yard is a finite place. */
  readonly bays = new Int32Array(MAX_YARDS);
  names: string[] = [];

  alloc(x: number, y: number, tile: number, owner: number, name: string): number {
    if (this.count >= MAX_YARDS) return NONE;
    const id = this.count++;
    this.x[id] = x;
    this.y[id] = y;
    this.tile[id] = tile;
    this.owner[id] = owner;
    // Every yard starts as a patch of hardstanding and four bays. Everything
    // else is bought.
    this.facilities[id] = Facility.Hardstanding;
    this.bays[id] = 4;
    this.names[id] = name;
    return id;
  }

  has(yard: number, facility: number): boolean {
    return (this.facilities[yard] & facility) !== 0;
  }

  add(yard: number, facility: number): void {
    this.facilities[yard] |= facility;
  }
}

export interface VehicleNeeds {
  /** Handling classes the vehicle offers, from the content. */
  handling: readonly string[];
  /** Its class: 'van', 'lorry', 'tipper', 'tanker', 'artic'. */
  cls: string;
}

/**
 * What a vehicle needs of a yard.
 *
 * Derived from what the vehicle *is* rather than listed per vehicle, so adding a
 * vehicle to the content cannot forget to say what it needs — the commonest way
 * a rule like this rots.
 */
export function facilitiesFor(v: VehicleNeeds): number {
  let need = Facility.Hardstanding;
  if (v.handling.includes('refrigerated')) need |= Facility.Chiller;
  if (v.handling.includes('liquid')) need |= Facility.TankBay;
  if (v.cls === 'tipper' || v.handling.includes('bulk')) need |= Facility.Weighbridge;
  if (v.cls === 'artic') need |= Facility.LongBay;
  return need;
}

export interface YardVerdict {
  ok: boolean;
  /** What is missing, in words, for the one-sentence refusal. */
  missing: string[];
  /** True when the yard has the kit but no room. A different problem and a
   *  different fix, so it is a different answer. */
  full: boolean;
}

/**
 * Can this yard take this vehicle?
 *
 * Returns the reason rather than a boolean, because the reason is the entire
 * point: a greyed-out button that says why is a signpost, and one that does not
 * is a wall.
 */
export function canBase(
  yards: YardTable, yard: number, v: VehicleNeeds, basedHere: number,
): YardVerdict {
  const need = facilitiesFor(v);
  const missing: string[] = [];
  for (const [bit, name] of FACILITY_NAMES) {
    if ((need & bit) !== 0 && !yards.has(yard, bit)) missing.push(name.toLowerCase());
  }
  const full = basedHere >= yards.bays[yard];
  return { ok: missing.length === 0 && !full, missing, full };
}

/** The one-sentence refusal, ready to show. */
export function refusalText(yards: YardTable, yard: number, verdict: YardVerdict): string {
  const name = yards.names[yard] ?? 'The yard';
  if (verdict.missing.length > 0) {
    return `${name} has no ${verdict.missing.join(' and no ')}.`;
  }
  if (verdict.full) return `${name} has no free bay.`;
  return '';
}
