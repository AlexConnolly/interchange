/**
 * Generated objectives and milestones. features.md §11, Phase 3.
 *
 * The fourth pressure system from D10. Solvency constrains, decay punishes
 * neglect, rivals create urgency — and objectives break routine, by pointing
 * at something the player was not already doing.
 *
 * So the generator deliberately picks targets the player is *near* but not
 * *on*: a cargo they move a little of, a town they nearly serve, a corner of
 * the region they have not touched. An objective that restates what somebody
 * is already doing is a congratulation, not a pressure.
 */

import { TICKS_PER_DAY } from './constants.ts';
import type { Rng } from './rng.ts';

export const MAX_OBJECTIVES = 64;

export const ObjectiveKind = {
  MoveCargo: 0,
  ServeTown: 1,
  AnnualRevenue: 2,
  OwnInfrastructure: 3,
  ConnectPlaces: 4,
  FoundIndustry: 5,
} as const;

export const ObjectiveState = {
  Open: 0,
  Met: 1,
  Expired: 2,
} as const;

export class ObjectiveTable {
  count = 0;
  readonly kind = new Uint8Array(MAX_OBJECTIVES);
  readonly state = new Uint8Array(MAX_OBJECTIVES);
  readonly company = new Int16Array(MAX_OBJECTIVES);
  /** What is being counted: a cargo index, a town id, or nothing. */
  readonly subject = new Int32Array(MAX_OBJECTIVES);
  readonly subjectB = new Int32Array(MAX_OBJECTIVES);
  readonly target = new Float64Array(MAX_OBJECTIVES);
  readonly progress = new Float64Array(MAX_OBJECTIVES);
  readonly reward = new Float64Array(MAX_OBJECTIVES);
  readonly deadline = new Int32Array(MAX_OBJECTIVES);
  readonly issued = new Int32Array(MAX_OBJECTIVES);
  text: string[] = [];

  private free: number[] = [];

  alloc(): number {
    if (this.free.length === 0 && this.count >= MAX_OBJECTIVES) return -1;
    const id = this.free.length > 0 ? (this.free.pop() as number) : this.count++;
    this.state[id] = ObjectiveState.Open;
    this.progress[id] = 0;
    return id;
  }

  release(id: number): void {
    this.free.push(id);
  }

  openFor(company: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] === ObjectiveState.Open && this.company[i] === company) out.push(i);
    }
    return out;
  }
}

export interface ObjectiveContext {
  tick: number;
  era: number;
  cargoName: (index: number) => string;
  townName: (index: number) => string;
  /** Tonnes of each cargo this company has moved so far. */
  movedByCargo: Float64Array;
  townCount: number;
  townServed: (t: number) => number;
  annualRevenue: number;
  ownedAssets: number;
  ownedSites: number;
  /** Cargo indices that exist in this era and something produces. */
  liveCargo: number[];
}

/**
 * Offer one objective, or nothing.
 *
 * Every branch here picks a target relative to where the player already is,
 * which is what stops the list being either trivial or absurd: "move another
 * three hundred tonnes of coal" means something different to a player moving
 * ten a year and one moving ten thousand.
 */
export function generateObjective(
  table: ObjectiveTable,
  company: number,
  ctx: ObjectiveContext,
  rng: Rng,
): number {
  const roll = rng.int(100);

  // A cargo they touch but do not dominate.
  if (roll < 40 && ctx.liveCargo.length > 0) {
    const cargo = ctx.liveCargo[rng.int(ctx.liveCargo.length)];
    const moved = ctx.movedByCargo[cargo] ?? 0;
    const target = Math.max(120, Math.round((moved + 60) * (1.6 + rng.int(60) / 100)));
    const id = table.alloc();
    if (id < 0) return -1;
    table.kind[id] = ObjectiveKind.MoveCargo;
    table.company[id] = company;
    table.subject[id] = cargo;
    table.target[id] = target;
    table.progress[id] = moved;
    table.reward[id] = Math.round(target * 260);
    table.deadline[id] = ctx.tick + (200 + rng.int(200)) * TICKS_PER_DAY;
    table.issued[id] = ctx.tick;
    table.text[id] = `Move ${Math.round(target)} tonnes of ${ctx.cargoName(cargo)} in total`;
    return id;
  }

  // A town that is nearly served, because pushing it over is a real task and
  // pushing a town that is already at ninety is not.
  if (roll < 65 && ctx.townCount > 0) {
    let worst = -1;
    let worstScore = 101;
    for (let t = 0; t < ctx.townCount; t++) {
      const s = ctx.townServed(t);
      if (s < worstScore) {
        worstScore = s;
        worst = t;
      }
    }
    if (worst >= 0 && worstScore < 78) {
      const id = table.alloc();
      if (id < 0) return -1;
      const target = Math.min(92, worstScore + 18 + rng.int(10));
      table.kind[id] = ObjectiveKind.ServeTown;
      table.company[id] = company;
      table.subject[id] = worst;
      table.target[id] = target;
      table.reward[id] = 900000 + rng.int(600000);
      table.deadline[id] = ctx.tick + (240 + rng.int(240)) * TICKS_PER_DAY;
      table.issued[id] = ctx.tick;
      table.text[id] = `Get ${ctx.townName(worst)} to ${target}% served`;
      return id;
    }
  }

  if (roll < 82) {
    const id = table.alloc();
    if (id < 0) return -1;
    const target = Math.max(1200000, Math.round(ctx.annualRevenue * (1.5 + rng.int(80) / 100)));
    table.kind[id] = ObjectiveKind.AnnualRevenue;
    table.company[id] = company;
    table.target[id] = target;
    table.reward[id] = Math.round(target * 0.14);
    table.deadline[id] = ctx.tick + (360 + rng.int(240)) * TICKS_PER_DAY;
    table.issued[id] = ctx.tick;
    table.text[id] = `Reach ${Math.round(target / 100).toLocaleString('en-GB')} of revenue in a year`;
    return id;
  }

  if (roll < 93) {
    const id = table.alloc();
    if (id < 0) return -1;
    const target = ctx.ownedAssets + 2 + rng.int(4);
    table.kind[id] = ObjectiveKind.OwnInfrastructure;
    table.company[id] = company;
    table.target[id] = target;
    table.reward[id] = 1400000 + rng.int(1200000);
    table.deadline[id] = ctx.tick + (300 + rng.int(300)) * TICKS_PER_DAY;
    table.issued[id] = ctx.tick;
    table.text[id] = `Own ${target} pieces of infrastructure`;
    return id;
  }

  if (ctx.era >= 3) {
    const id = table.alloc();
    if (id < 0) return -1;
    const target = ctx.ownedSites + 1 + rng.int(2);
    table.kind[id] = ObjectiveKind.FoundIndustry;
    table.company[id] = company;
    table.target[id] = target;
    table.reward[id] = 2200000 + rng.int(1800000);
    table.deadline[id] = ctx.tick + (360 + rng.int(240)) * TICKS_PER_DAY;
    table.issued[id] = ctx.tick;
    table.text[id] = `Own ${target} industries`;
    return id;
  }
  return -1;
}

/** Returns the ids that were met this pass, so the caller can pay them. */
export function checkObjectives(
  table: ObjectiveTable,
  ctx: ObjectiveContext,
): { met: number[]; expired: number[] } {
  const met: number[] = [];
  const expired: number[] = [];
  for (let i = 0; i < table.count; i++) {
    if (table.state[i] !== ObjectiveState.Open) continue;
    switch (table.kind[i]) {
      case ObjectiveKind.MoveCargo:
        table.progress[i] = ctx.movedByCargo[table.subject[i]] ?? 0;
        break;
      case ObjectiveKind.ServeTown:
        table.progress[i] = ctx.townServed(table.subject[i]);
        break;
      case ObjectiveKind.AnnualRevenue:
        table.progress[i] = ctx.annualRevenue;
        break;
      case ObjectiveKind.OwnInfrastructure:
        table.progress[i] = ctx.ownedAssets;
        break;
      case ObjectiveKind.FoundIndustry:
        table.progress[i] = ctx.ownedSites;
        break;
      default:
        break;
    }
    if (table.progress[i] >= table.target[i]) {
      table.state[i] = ObjectiveState.Met;
      met.push(i);
    } else if (ctx.tick >= table.deadline[i]) {
      table.state[i] = ObjectiveState.Expired;
      expired.push(i);
    }
  }
  return { met, expired };
}
