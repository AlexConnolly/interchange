/**
 * Money, contracts and services.
 *
 * The reporting here is not decoration. design.md §3.5 says the whole
 * haulier-to-magnate arc should be visible in the income statement — Act I is
 * a hundred per cent haulage, Act IV might be sixty per cent access charges —
 * and content-and-balance.md names "income mix over time" as one of the two
 * signals that tell us whether the ownership spine works at all. So the ledger
 * splits operating income from rent from the first tick of the first act, when
 * the rent line is guaranteed to be zero and looks pointless.
 */

import { MAX_COMPANIES, MAX_CONTRACTS, MAX_ROUTES, TICKS_PER_DAY, TICKS_PER_YEAR, AUTHORITY } from './constants.ts';
import { NONE } from './network.ts';
import type { Hasher } from './hash.ts';
import type { Rng } from './rng.ts';

/** Ledger lines. The split is the point; see the file header. */
export const Line = {
  Haulage: 0,
  ContractBonus: 1,
  AccessCharged: 2,
  AccessPaid: 3,
  RunningCosts: 4,
  Construction: 5,
  VehiclePurchase: 6,
  Upkeep: 7,
  Interest: 8,
  Penalties: 9,
  AssetTrade: 10,
  Subsidy: 11,
} as const;
export type Line = (typeof Line)[keyof typeof Line];
export const LINE_COUNT = 12;
export const LINE_NAMES = [
  'Haulage', 'Contract bonuses', 'Access charges earned', 'Access charges paid',
  'Running costs', 'Construction', 'Vehicle purchase', 'Upkeep', 'Interest',
  'Penalties', 'Asset trading', 'Subsidy',
] as const;
/** Which lines are income; the rest are expenditure. */
export const LINE_IS_INCOME = [true, true, true, false, false, false, false, false, false, false, true, true];

/** Charters, design.md §1. Each is a licence to do a category of thing. */
export const Charter = {
  Carrier: 0,
  Construction: 1,
  Extraction: 2,
  Land: 3,
} as const;
export type Charter = (typeof Charter)[keyof typeof Charter];
export const CHARTER_NAMES = ['Carrier', 'Construction', 'Extraction', 'Land'] as const;

/** How many months of ledger history a company keeps. */
export const HISTORY_MONTHS = 240;

export class CompanyTable {
  count = 0;
  names: string[] = [];
  readonly cash = new Float64Array(MAX_COMPANIES);
  readonly debt = new Float64Array(MAX_COMPANIES);
  /** Highest charter granted. Act gating, design.md §1. */
  readonly charter = new Uint8Array(MAX_COMPANIES);
  /** Livery index. art-direction.md §10: pattern plus colour, so it survives
   *  desaturation and works at fourteen pixels. */
  readonly livery = new Uint8Array(MAX_COMPANIES);
  readonly isAi = new Uint8Array(MAX_COMPANIES);
  /** Rival personality weightings, design.md §2.5. Not code paths. */
  readonly aggression = new Uint8Array(MAX_COMPANIES);
  readonly horizon = new Uint8Array(MAX_COMPANIES);
  readonly thrift = new Uint8Array(MAX_COMPANIES);
  readonly bankrupt = new Uint8Array(MAX_COMPANIES);

  /** Contracts completed and contracts missed, which is the reliability the
   *  contract board weighs bids by. design.md §4.4. */
  readonly delivered = new Int32Array(MAX_COMPANIES);
  readonly missed = new Int32Array(MAX_COMPANIES);

  /** ledger[company * LINE_COUNT + line], current month. */
  readonly ledger = new Float64Array(MAX_COMPANIES * LINE_COUNT);
  /** Rolling twelve-month totals, for valuation and the credit limit. */
  readonly ledgerYear = new Float64Array(MAX_COMPANIES * LINE_COUNT);
  /** history[company][month * LINE_COUNT + line]. */
  readonly history: Float64Array;
  historyMonths = 0;

  constructor() {
    this.history = new Float64Array(MAX_COMPANIES * HISTORY_MONTHS * LINE_COUNT);
  }

  alloc(name: string, cash: number, isAi: boolean, livery: number): number {
    if (this.count >= MAX_COMPANIES) return NONE;
    const id = this.count++;
    this.names[id] = name;
    this.cash[id] = cash;
    this.debt[id] = 0;
    this.charter[id] = Charter.Carrier;
    this.livery[id] = livery;
    this.isAi[id] = isAi ? 1 : 0;
    this.aggression[id] = 50;
    this.horizon[id] = 50;
    this.thrift[id] = 50;
    return id;
  }

  post(company: number, line: Line, amount: number): void {
    const i = company * LINE_COUNT + line;
    this.ledger[i] += amount;
    this.ledgerYear[i] += amount;
    this.cash[company] += LINE_IS_INCOME[line] ? amount : -amount;
  }

  /** Reliability 0..100, used to weight contract awards. A company with no
   *  record starts at seventy: trusted enough to bid, not enough to win on it. */
  reliability(company: number): number {
    const done = this.delivered[company];
    const bad = this.missed[company];
    if (done + bad === 0) return 70;
    return Math.round((done * 100) / (done + bad));
  }

  /** Total income and total expenditure this month. */
  monthIncome(company: number): number {
    let n = 0;
    for (let l = 0; l < LINE_COUNT; l++) if (LINE_IS_INCOME[l]) n += this.ledger[company * LINE_COUNT + l];
    return n;
  }

  monthSpend(company: number): number {
    let n = 0;
    for (let l = 0; l < LINE_COUNT; l++) if (!LINE_IS_INCOME[l]) n += this.ledger[company * LINE_COUNT + l];
    return n;
  }

  /**
   * The number design.md §3.5 is actually about: what fraction of income is
   * rent rather than operating. If this does not climb across the acts, the
   * ownership economy is mistuned and the balance harness should say so.
   */
  rentShare(company: number): number {
    const base = company * LINE_COUNT;
    const rent = this.ledgerYear[base + Line.AccessCharged];
    const operating =
      this.ledgerYear[base + Line.Haulage] + this.ledgerYear[base + Line.ContractBonus];
    const total = rent + operating;
    return total > 0 ? Math.round((rent * 100) / total) : 0;
  }

  closeMonth(): void {
    if (this.historyMonths < HISTORY_MONTHS) this.historyMonths++;
    for (let c = 0; c < this.count; c++) {
      // Shift history down by one month, newest last.
      const base = c * HISTORY_MONTHS * LINE_COUNT;
      this.history.copyWithin(base, base + LINE_COUNT, base + HISTORY_MONTHS * LINE_COUNT);
      for (let l = 0; l < LINE_COUNT; l++) {
        this.history[base + (HISTORY_MONTHS - 1) * LINE_COUNT + l] = this.ledger[c * LINE_COUNT + l];
        this.ledger[c * LINE_COUNT + l] = 0;
      }
    }
  }

  closeYear(): void {
    this.ledgerYear.fill(0);
  }
}

export const ContractState = {
  Offered: 0,
  Active: 1,
  Complete: 2,
  Failed: 3,
  Expired: 4,
} as const;
export type ContractState = (typeof ContractState)[keyof typeof ContractState];

/**
 * Generated haulage contracts. design.md §4.4: cargo, origin, destination,
 * rate, volume, deadline, penalty. You bid, rivals bid, and the award is on
 * price weighted by reliability history — so being cheap and late is a
 * strategy that stops working.
 */
export class ContractTable {
  count = 0;
  readonly state = new Uint8Array(MAX_CONTRACTS);
  readonly cargo = new Uint8Array(MAX_CONTRACTS);
  readonly fromSite = new Int32Array(MAX_CONTRACTS);
  readonly toSite = new Int32Array(MAX_CONTRACTS);
  /** Destination is a town when this is set; `toSite` indexes towns then. */
  readonly toIsTown = new Uint8Array(MAX_CONTRACTS);
  readonly fromIsTown = new Uint8Array(MAX_CONTRACTS);
  readonly volume = new Int32Array(MAX_CONTRACTS);
  readonly delivered = new Int32Array(MAX_CONTRACTS);
  /** Pence per tonne. */
  readonly rate = new Int32Array(MAX_CONTRACTS);
  readonly deadline = new Int32Array(MAX_CONTRACTS);
  readonly offeredUntil = new Int32Array(MAX_CONTRACTS);
  readonly penalty = new Float64Array(MAX_CONTRACTS);
  readonly holder = new Int16Array(MAX_CONTRACTS).fill(NONE);
  /** Bids: pence per tonne offered, per company. 0 means no bid. */
  readonly bids = new Int32Array(MAX_CONTRACTS * MAX_COMPANIES);

  private free: number[] = [];

  alloc(): number {
    if (this.free.length === 0 && this.count >= MAX_CONTRACTS) return NONE;
    const id = this.free.length > 0 ? this.free.pop()! : this.count++;
    this.state[id] = ContractState.Offered;
    this.delivered[id] = 0;
    this.holder[id] = NONE;
    for (let c = 0; c < MAX_COMPANIES; c++) this.bids[id * MAX_COMPANIES + c] = 0;
    return id;
  }

  release(id: number): void {
    this.state[id] = ContractState.Expired;
    this.free.push(id);
  }

  value(id: number): number {
    return this.volume[id] * this.rate[id];
  }
}

/** What a vehicle does at a stop. */
export const StopAction = {
  Load: 0,
  Unload: 1,
  /** Unload everything, then load whatever is waiting. The default. */
  Exchange: 2,
  /** Wait for a full load before leaving — the difference between a business
   *  and a half-empty lorry, and something the player has to learn. */
  LoadFull: 3,
} as const;
export type StopAction = (typeof StopAction)[keyof typeof StopAction];

export const MAX_STOPS = 12;

/**
 * A service: an ordered list of stops that vehicles cycle through.
 *
 * Deliberately not "one vehicle, one contract". A service is an asset the
 * player builds up and reasons about — a coal run from the colliery to the
 * gasworks — and contracts are satisfied by whatever happens to arrive. That
 * keeps the fleet management about routes and round-trip times, which is the
 * arithmetic Act I is supposed to teach.
 */
export class ServiceTable {
  count = 0;
  names: string[] = [];
  readonly company = new Int16Array(MAX_ROUTES);
  readonly stopCount = new Int32Array(MAX_ROUTES);
  /** stops[route * MAX_STOPS + i]: what `stopKind` says it is. */
  readonly stopTarget = new Int32Array(MAX_ROUTES * MAX_STOPS);
  /** 0 a site, 1 a town, 2 a bare network node. The third exists so a service
   *  can have a waypoint that is not a place — a depot, a station, or, in the
   *  performance harness, a junction on a grid with no industry at it. */
  readonly stopKind = new Uint8Array(MAX_ROUTES * MAX_STOPS);
  readonly stopAction = new Uint8Array(MAX_ROUTES * MAX_STOPS);
  readonly stopCargo = new Uint8Array(MAX_ROUTES * MAX_STOPS).fill(255);
  readonly vehicles = new Int32Array(MAX_ROUTES);
  readonly active = new Uint8Array(MAX_ROUTES);
  /** Rolling profit, so the player can see which services pay. */
  readonly revenue = new Float64Array(MAX_ROUTES);
  readonly costs = new Float64Array(MAX_ROUTES);
  readonly tonnes = new Float64Array(MAX_ROUTES);
  /** Mean round-trip time in ticks, the number that actually matters. */
  readonly roundTrip = new Int32Array(MAX_ROUTES);

  private free: number[] = [];

  /**
   * Returns NONE when the table is full.
   *
   * Bounds are checked because the alternative is worse than a hard failure: a
   * typed array silently discards a write past its end, so a service beyond
   * the limit gets an id, gets vehicles assigned to it, and then reads back as
   * inactive forever. Twenty thousand vehicles sat still for that reason and
   * the symptom looked like a pathfinding bug.
   */
  alloc(company: number, name: string): number {
    if (this.free.length === 0 && this.count >= MAX_ROUTES) return NONE;
    const id = this.free.length > 0 ? this.free.pop()! : this.count++;
    this.company[id] = company;
    this.names[id] = name;
    this.stopCount[id] = 0;
    this.vehicles[id] = 0;
    this.active[id] = 1;
    this.revenue[id] = 0;
    this.costs[id] = 0;
    this.tonnes[id] = 0;
    this.roundTrip[id] = 0;
    return id;
  }

  release(id: number): void {
    this.active[id] = 0;
    this.stopCount[id] = 0;
    this.free.push(id);
  }

  addStop(route: number, target: number, kind: number, action: StopAction, cargo: number): boolean {
    const n = this.stopCount[route];
    if (n >= MAX_STOPS) return false;
    const i = route * MAX_STOPS + n;
    this.stopTarget[i] = target;
    this.stopKind[i] = kind;
    this.stopAction[i] = action;
    this.stopCargo[i] = cargo;
    this.stopCount[route] = n + 1;
    return true;
  }
}

/**
 * Interest and the credit limit.
 *
 * Debt is drawn automatically when cash goes negative, up to a limit set by
 * trailing revenue — a haulier with a real business can borrow, one with a
 * single dray cannot. Past the limit the company is insolvent, and design.md
 * §3.8 says that is an event in the world rather than a modal dialog: the
 * assets go to auction and everyone else gets to respond.
 */
export function stepFinance(
  co: CompanyTable,
  balance: { interestBps: number; creditLimitPct: number },
  onInsolvent: (company: number) => void,
): void {
  for (let c = 0; c < co.count; c++) {
    // The clamp runs even for a company already in administration. Skipping it
    // leaves cash drifting further negative every day an administrator is
    // still paying penalties, and the balance sheet in the post-mortem report
    // reads as a number nobody could have reached.
    if (co.cash[c] < 0) {
      co.debt[c] += -co.cash[c];
      co.cash[c] = 0;
    } else if (co.debt[c] > 0 && co.cash[c] > 0) {
      const repay = Math.min(co.debt[c], co.cash[c]);
      co.debt[c] -= repay;
      co.cash[c] -= repay;
    }
    if (co.bankrupt[c]) continue;
    if (co.debt[c] > 0) {
      // Daily interest: the annual rate divided across the year, in pence.
      const daily = (co.debt[c] * balance.interestBps) / 10000 / 360;
      co.debt[c] += daily;
      co.ledger[c * LINE_COUNT + Line.Interest] += daily;
      co.ledgerYear[c * LINE_COUNT + Line.Interest] += daily;
    }

    const base = c * LINE_COUNT;
    const revenue =
      co.ledgerYear[base + Line.Haulage] +
      co.ledgerYear[base + Line.ContractBonus] +
      co.ledgerYear[base + Line.AccessCharged];
    const limit = Math.max(300000, (revenue * balance.creditLimitPct) / 100);
    if (co.debt[c] > limit) onInsolvent(c);
  }
}

/**
 * Generate one contract. design.md §4.4.
 *
 * The rate is struck against the cargo's base price and then adjusted for how
 * far the haul is and how awkward the terrain between the two ends is, so a
 * mountain run pays what a mountain run should. The deadline is generous
 * enough to be met with one vehicle and tight enough that two is better.
 */
export interface ContractSeed {
  cargo: number;
  fromSite: number;
  fromIsTown: boolean;
  toSite: number;
  toIsTown: boolean;
  distanceTiles: number;
  basePrice: number;
}

export function makeContract(
  contracts: ContractTable,
  seed: ContractSeed,
  tick: number,
  rng: Rng,
  balance: { latePenaltyPct: number; contractIntervalDays: number },
): number {
  const id = contracts.alloc();
  contracts.cargo[id] = seed.cargo;
  contracts.fromSite[id] = seed.fromSite;
  contracts.fromIsTown[id] = seed.fromIsTown ? 1 : 0;
  contracts.toSite[id] = seed.toSite;
  contracts.toIsTown[id] = seed.toIsTown ? 1 : 0;

  const volume = 40 + rng.int(9) * 20;
  contracts.volume[id] = volume;

  // Struck against the same carriage curve the spot market pays, plus a
  // premium for committing to a deadline. If the two drifted apart, one of
  // them would simply be the correct answer forever.
  contracts.rate[id] = Math.max(1, Math.round(haulageRate(seed.basePrice, seed.distanceTiles) * 0.55));

  // Deadline scales with distance and volume: roughly the time a single
  // period-appropriate vehicle needs, plus half again.
  const days = Math.max(20, Math.round((seed.distanceTiles * volume) / 26) + 24 + rng.int(20));
  contracts.deadline[id] = tick + days * TICKS_PER_DAY;
  contracts.offeredUntil[id] = tick + balance.contractIntervalDays * TICKS_PER_DAY * 2;
  contracts.penalty[id] = Math.round((volume * contracts.rate[id] * balance.latePenaltyPct) / 100);
  return id;
}

/**
 * What one tonne of a cargo earns over one haul, in pence.
 *
 * Two terms, deliberately. A flat carriage rate that grows with distance, and
 * a small share of what the cargo is worth. Making the whole payment a
 * multiple of the cargo's value — the obvious first move — means a lorry of
 * luxury goods earns thirty times a lorry of coal for the same work, so bulk
 * becomes dead content and the only correct game is a shuttle of the most
 * expensive thing on the map. Real freight is priced mostly by weight and
 * distance, and it turns out that is also the version that plays.
 *
 * The distance term is steep and capped. Carriage costing more than the coal
 * it carried is not an exaggeration for 1860 — it is why railways changed
 * everything, and Act I should feel it.
 */
export function haulageRate(basePrice: number, distanceTiles: number): number {
  const distanceFactor = 24 + Math.min(900, Math.round(distanceTiles * 9));
  return Math.round((HAUL_BASE * distanceFactor) / 100 + basePrice * VALUE_SHARE);
}

/** Pence per tonne of carriage at the reference distance. The single number
 *  that moves every haulage rate in the game, so the sweep starts here. */
export const HAUL_BASE = 200;

/**
 * How much of the cargo's own value the carriage rate picks up. Small on
 * purpose: at 0.3 the value term swamped the distance term for anything
 * expensive, so a lorry of luxury goods over ten tiles beat a train of coal
 * over a hundred and the map stopped mattering.
 */
export const VALUE_SHARE = 0.18;

export function hashEconomy(h: Hasher, co: CompanyTable, contracts: ContractTable, services: ServiceTable): void {
  h.int(co.count).int(contracts.count).int(services.count);
  for (let c = 0; c < co.count; c++) {
    h.big(Math.round(co.cash[c])).big(Math.round(co.debt[c]));
    h.int(co.charter[c]).int(co.bankrupt[c]).int(co.delivered[c]).int(co.missed[c]);
    for (let l = 0; l < LINE_COUNT; l++) h.big(Math.round(co.ledger[c * LINE_COUNT + l]));
  }
  h.array(contracts.state, contracts.count);
  h.array(contracts.delivered, contracts.count);
  h.array(contracts.holder, contracts.count);
  h.array(services.vehicles, services.count);
}

export { AUTHORITY, TICKS_PER_DAY, TICKS_PER_YEAR };
