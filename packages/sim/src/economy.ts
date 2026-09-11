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

import { MAX_COMPANIES, MAX_CONTRACTS, MAX_ROUTES, TICKS_PER_DAY, TICKS_PER_YEAR, AUTHORITY, MONTHS_PER_YEAR, ECONOMY_SCALE } from './constants.ts';
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
  /**
   * Goods moved into a business of your own.
   *
   * Its own line rather than more haulage, because the whole point of it is
   * that it pays *better* than haulage and the player has to be able to see
   * that it does. A ledger that folded the two together would be a ledger in
   * which the reason to own anything was invisible.
   */
  Trading: 12,
} as const;
export type Line = (typeof Line)[keyof typeof Line];
export const LINE_COUNT = 13;
export const LINE_NAMES = [
  'Haulage', 'Contract bonuses', 'Access charges earned', 'Access charges paid',
  'Running costs', 'Construction', 'Vehicle purchase', 'Upkeep', 'Interest',
  'Penalties', 'Asset trading', 'Subsidy', 'Trading',
] as const;
/** Which lines are income; the rest are expenditure. */
export const LINE_IS_INCOME = [true, true, true, false, false, false, false, false, false, false, true, true, true];

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
  /*
   * Consecutive days with no fleet and no way to buy one.
   *
   * A company can reach a state that is not bankruptcy and is not trading: no
   * vehicles, no debt, and less cash than the cheapest lorry costs. It earns
   * nothing, so its cash never rises, so it can never buy a vehicle, and it
   * sits there for the rest of the century — three of four companies were in
   * exactly that state by year fifty, and the region's traffic went to nothing
   * with them. Counted rather than acted on immediately, because a company
   * that has just sold its last lorry to pay a debt is in the same position
   * for a week and is not finished.
   */
  readonly idleDays = new Int32Array(MAX_COMPANIES);
  readonly missed = new Int32Array(MAX_COMPANIES);

  /** ledger[company * LINE_COUNT + line], current month. */
  readonly ledger = new Float64Array(MAX_COMPANIES * LINE_COUNT);
  /**
   * Rolling twelve-month totals, for valuation, the credit limit, and every
   * judgement the AI makes about whether a company is trading.
   *
   * *Rolling* is load-bearing and was, for a long time, a lie: this was a
   * calendar-year accumulator that `closeYear` emptied every first of January.
   * Everything reading it therefore saw a company that had traded superbly for
   * twelve months as having earned nothing at all, for as long as it took the
   * new year to fill up again — and the closer to the boundary, the wronger.
   *
   * That single mistake produced three separate bugs that each looked like
   * something else. The balance harness reported a rent share of exactly zero
   * for the whole project, because it sampled on the boundary tick. And, far
   * worse, the AI's retrenchment rule asks "is this company's income covering
   * its running costs?" — so on the first day of every year the answer was no,
   * for everybody, and every company carrying a loan began selling its fleet.
   * A region that was trading happily in 1914 had no vehicles left in it at
   * all by 1916, and stayed empty for the following two centuries.
   *
   * So it is now genuinely rolling: the last twelve completed months out of
   * `history`, plus whatever the current month has accumulated. It never
   * resets, and there is no year boundary anywhere in it to fall off.
   */
  readonly ledgerYear = new Float64Array(MAX_COMPANIES * LINE_COUNT);
  /**
   * Lifetime totals, which nothing ever resets.
   *
   * The rolling window above answers "how is this company doing?", and it is
   * the wrong instrument for "how much did this company pay between these two
   * moments" — subtract one reading of a rolling sum from another and the
   * months that fell out of the back are in the answer. Measurement wants a
   * quantity that only goes up.
   */
  readonly ledgerTotal = new Float64Array(MAX_COMPANIES * LINE_COUNT);
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

  /**
   * Put a failed company's slot back into use under a new name.
   *
   * Everything that made the old company what it was has to go, or the new
   * operator inherits its reputation, its yearly figures, and — worst — its
   * charter, and arrives able to build roads on its first day.
   */
  revive(id: number, name: string, cash: number): void {
    this.names[id] = name;
    this.cash[id] = cash;
    this.debt[id] = 0;
    this.bankrupt[id] = 0;
    this.charter[id] = Charter.Carrier;
    this.delivered[id] = 0;
    this.missed[id] = 0;
    this.idleDays[id] = 0;
    const base = id * LINE_COUNT;
    for (let l = 0; l < LINE_COUNT; l++) {
      this.ledger[base + l] = 0;
      this.ledgerYear[base + l] = 0;
      this.ledgerTotal[base + l] = 0;
    }
  }

  post(company: number, line: Line, amount: number): void {
    const i = company * LINE_COUNT + line;
    this.ledger[i] += amount;
    this.ledgerYear[i] += amount;
    this.ledgerTotal[i] += amount;
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
      // And recut the twelve-month window from the months that are now in it.
      // Doing this here rather than on a year boundary is the whole point: the
      // window moves by a month every month and is never empty.
      for (let l = 0; l < LINE_COUNT; l++) this.ledgerYear[c * LINE_COUNT + l] = 0;
      const months = Math.min(MONTHS_PER_YEAR, this.historyMonths);
      for (let m = HISTORY_MONTHS - months; m < HISTORY_MONTHS; m++) {
        for (let l = 0; l < LINE_COUNT; l++) {
          this.ledgerYear[c * LINE_COUNT + l] += this.history[base + m * LINE_COUNT + l];
        }
      }
    }
  }
}

/**
 * What each charter asks for, in one place.
 *
 * The simulation checked these and the charter panel drew them, from two
 * separate copies of the numbers. They drifted the moment the thresholds were
 * calibrated against the sweep, so the game awarded a charter at two contracts
 * while the panel told the player they needed six — the worst kind of bug,
 * because everything works and the interface lies about it.
 *
 * The figures themselves are measured rather than guessed. Across ten
 * forty-year runs they sit near the upper quartile of what a company that is
 * actually trading well reaches, so a good operator earns a charter and a
 * mediocre one does not.
 */
export const CHARTER_REQUIREMENTS = {
  /*
   * Carrier -> Construction: you may lay your own way.
   *
   * Contracts used to be part of this and are not any more, and the reason is
   * measured rather than felt. Across thirty-two company-runs of a hundred
   * years, eighteen reached the net worth, eleven reached the revenue, and
   * four completed two contracts — so a single one of the three conditions
   * was deciding the gate on its own, and Act II stayed shut against
   * companies that were plainly substantial operators.
   *
   * That is also the right answer on its own terms. A charter is granted to
   * somebody who has built a real business; the contract board is one way to
   * do that and hauling on the spot market is another, and the authority does
   * not care which. A contract record still counts, through the reliability
   * weighting that decides who wins the next one.
   */
  construction: { contracts: 0, revenue: 250000, cash: 300000 },
  /** Construction -> Extraction: you may found industry. */
  extraction: { revenue: 900000, assets: 3 },
  /** Extraction -> Land: you may deal in land itself. */
  land: { revenue: 2500000, sites: 2 },
} as const;

/** Names for operators that set up after somebody else has failed. The region
 *  does not run out of people willing to try. */
export const ENTRANT_NAMES = [
  'Garrow & Peel',
  'The Vale Carrying Company',
  'Hesketh Brothers',
  'Ravensworth Transport',
  'Linmoor Haulage',
  'Sable & Co.',
  'The Fell Line',
  'Duncastle Freight',
];
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
  /** Tick the service was created, so it can be given time to prove itself
   *  before anybody judges its returns. */
  readonly created = new Int32Array(MAX_ROUTES);
  /*
   * Tonnage as it stood when the route was last reviewed, and when that was.
   *
   * Cumulative tonnage cannot tell a route that is working from one that
   * worked once. A run into a works that has since filled up and stopped
   * accepting keeps its lifetime figure forever while the lorry circles the
   * triangle empty and the fodder bill runs; the operator's books showed
   * twenty-nine tonnes carried and a loss growing every year for two decades.
   * A mark and a date turn that into the only question worth asking, which is
   * whether the route has carried anything lately.
   */
  readonly tonnesMark = new Float64Array(MAX_ROUTES);
  readonly markTick = new Int32Array(MAX_ROUTES);
  /*
   * The pile at the origin when the fleet was last reviewed, and when that
   * was.
   *
   * Buying decisions need to know whether the pile is *growing*, which is a
   * different question from how big it is. A single reading cannot tell them
   * apart: a colliery with nine tonnes at the pithead looks the same whether
   * it is filling up because nobody is collecting or emptying because four
   * drays already are. Reading it once was how a company went from three
   * vehicles to eight in a year and watched its haulage fall from six hundred
   * and seventy-eight pounds to ninety-eight.
   */
  readonly stockMark = new Float64Array(MAX_ROUTES);
  readonly stockMarkTick = new Int32Array(MAX_ROUTES);

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
  alloc(company: number, name: string, tick = 0): number {
    if (this.free.length === 0 && this.count >= MAX_ROUTES) return NONE;
    const id = this.free.length > 0 ? this.free.pop()! : this.count++;
    this.created[id] = tick;
    this.markTick[id] = tick;
    this.tonnesMark[id] = 0;
    this.stockMark[id] = 0;
    this.stockMarkTick[id] = tick;
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
    // The floor matters as much as the multiple. A company with no trading
    // history still has to be able to buy its first few vehicles and run them
    // long enough to deliver something, and a floor below the price of two
    // lorries makes the opening move fatal.
    const limit = Math.max(900000, (revenue * balance.creditLimitPct) / 100);
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
export function haulageRate(
  basePrice: number, distanceTiles: number, weight = 1, era = 1,
): number {
  const distanceFactor = 24 + Math.min(900, Math.round(distanceTiles * 9));
  const base = ((HAUL_BASE * distanceFactor) / 100) * weight + basePrice * VALUE_SHARE;
  return Math.round(base * eraRate(era));
}

/**
 * What a tonne-mile is worth in each era, in the money of the day.
 *
 * The rate was flat across two hundred and forty years while everything it
 * pays for was not. A horse dray costs a hundred and sixty pounds and eats
 * twenty-eight pence a day; a nineteen-sixties lorry costs nineteen hundred
 * and burns two hundred and ninety. Vehicle prices rise roughly tenfold over
 * the period and running costs with them, so a carrier earning 1860 rates in
 * 1960 cannot replace a single lorry — and did not. Fleets peaked around
 * twenty-five vehicles in the first forty years and were gone entirely by the
 * eightieth, every region in the sweep, because the generation that wore out
 * could not be afforded.
 *
 * This is nominal prices rather than a difficulty knob: freight rates in
 * pounds went up a great deal between 1860 and 2100, and a game that quotes
 * both in pounds has to say so somewhere. Compounding is gentler than the cost
 * curve on purpose, so later eras are a little leaner and a carrier has to be
 * better at it — which is the pressure design.md 2.4 wants from an era
 * transition.
 */
export function eraRate(era: number): number {
  return Math.pow(ERA_RATE_GROWTH, Math.max(0, era - 1));
}

/** Per era. Eight eras, so a rate at the end about ten times the start. */
export const ERA_RATE_GROWTH = 1.42;

/**
 * What a unit of this cargo is worth carrying, against a tonne of freight.
 *
 * A bus is quoted at thirty-four and a commuter train at a hundred and eighty,
 * and those are people, not tonnes — the content means seats. The tariff is
 * per tonne, so paying seats at the tonne rate made an omnibus six times the
 * business of a dray for less money, and the sweep came back with passengers
 * at eighty-nine per cent of everything moved in the region and companies
 * ending the century on a million and a half pounds. About ten people weigh a
 * tonne, and the fare reflects it. The cargo's own value term is untouched:
 * that part is priced per unit and always was.
 */
export const RATE_WEIGHT_BY_TIER: Record<string, number> = { passenger: 0.11 };

/** Pence per tonne of carriage at the reference distance. The single number
 *  that moves every haulage rate in the game, so the sweep starts here. */
/*
 * The tariff, and it is set from the pace of the game rather than from any real
 * rate card.
 *
 * The target is that one truck on one contract earns enough to buy a second in
 * a couple of months of play - fast enough that the loop turns over, slow enough
 * that the purchase is a decision. At 560 a 7.5-tonne load over twenty-six tiles
 * paid a hundred and seventeen pounds, which was about half of what that needs.
 *
 * Raised from 15,750 when the roads were slowed to half speed. That was a change
 * to the *look* of the district and it had no business being a change to the
 * economy - but halving how fast a lorry moves halves how many loads it carries
 * in an afternoon, and the probe said so immediately: the first five minutes fell
 * from three thousand pounds to sixteen hundred and the second van slipped from
 * twelve minutes to sixteen.
 *
 * Twenty-four thousand puts the second van back at twelve minutes exactly, which
 * is the rung that matters - it is the first decision the game asks for, and the
 * minute it arrives at is the one thing about the opening that has been tuned by
 * playing it. The five-minute figure lands a little lower than before because
 * halving the speed changes the *shape* of the curve as well as its height: fewer
 * deliveries, each worth more, so the cash arrives in bigger steps. One dial
 * cannot hold both, and the rung is the one worth holding.
 *
 * Raised again, to 36,000, when the fleet stopped working nights. Same argument
 * as the speed change and the same measurement: parking every lorry between eight
 * at night and six in the morning removes two fifths of the running time, and the
 * probe put the first five minutes at £1,668 against £2,506 and the second van at
 * sixteen minutes against twelve. Two thirds of the earnings for two thirds of the
 * day, which is exactly what it should be and exactly why the rate has to move —
 * the change was made because a district that never sleeps looks wrong at three in
 * the morning, and that is an argument about the *look* of the place with no
 * business being an argument about what a load is worth.
 *
 * A rate that pays for a fourteen-hour day rather than a twenty-four-hour one is
 * the same rate in every sense the player can see. They do not count loads; they
 * watch the money and decide when to buy. The rung is what is being held.
 */
export const HAUL_BASE = 36000;

/**
 * How much dearer a business is than its build cost.
 *
 * Raised alongside HAUL_BASE and for the same reason: the two numbers only mean
 * anything against each other. Measured, the first five game days of a milk run
 * earned nine hundred pounds — "I've made one k in about five minutes of playing
 * and there's no incentive" — so the rate went up nearly fourfold. Left alone,
 * that would have made the pivot of the whole game, buying your first farm,
 * affordable in two days.
 *
 * Eight puts a dairy farm at about fifty thousand: two months of milk runs, and
 * a decision rather than a formality. The ladder keeps its shape because both
 * ends of it moved.
 */
export const SITE_PRICE_SCALE = 8;


/**
 * How much further than the direct line a haul may be paid for.
 *
 * Carriage is charged on the miles actually run, up to this multiple of the
 * crow-flies distance. Past it the detour is the haulier's problem, which is
 * what keeps a straighter road worth building; short of it, a road that
 * wanders is still paid for, which is what keeps the opening survivable on a
 * network nobody has improved yet. Generated roads wander at about twice the
 * direct line, so 1.8 covers most of a bad network without covering a stupid
 * one. Railway companies called it constructive mileage.
 */
export const HAUL_ALLOWANCE = 1.8;

/** How far a generated road actually wanders relative to the direct line.
 *  Measured off the world generator, not guessed: routes come out at very
 *  close to twice the crow-flies distance. Used to quote deadlines a vehicle
 *  can really meet. */
export const ROAD_WANDER = 2.0;

/**
 * How much of the cargo's own value the carriage rate picks up. Small on
 * purpose: at 0.3 the value term swamped the distance term for anything
 * expensive, so a lorry of luxury goods over ten tiles beat a train of coal
 * over a hundred and the map stopped mattering.
 */
export const VALUE_SHARE = 0.18;

export function hashEconomy(h: Hasher, co: CompanyTable, services: ServiceTable): void {
  h.int(co.count).int(services.count);
  for (let c = 0; c < co.count; c++) {
    h.big(Math.round(co.cash[c])).big(Math.round(co.debt[c]));
    h.int(co.charter[c]).int(co.bankrupt[c]).int(co.delivered[c]).int(co.missed[c]);
    for (let l = 0; l < LINE_COUNT; l++) h.big(Math.round(co.ledger[c * LINE_COUNT + l]));
  }
  h.array(services.vehicles, services.count);
}

export { AUTHORITY, TICKS_PER_DAY, TICKS_PER_YEAR };

/**
 * How many money events the journal remembers, across the whole district.
 *
 * A record for reading rather than a source of truth: cash is authoritative and
 * the ledger totals are permanent, so the oldest rows falling out of the window
 * loses nothing the accounts depend on. Two thousand is a few weeks for a
 * reasonably busy fleet and about sixteen kilobytes.
 */
export const JOURNAL = 2000;

/**
 * What a money event *was*, which is the half a ledger line cannot carry.
 *
 * "An explanation of WHAT the transaction was." A total under `Trading` tells
 * you the trading went well; it cannot tell you that the creamery cost more to
 * buy than it has yet brought in, and that is the question somebody looking at a
 * business actually has.
 */
export const MoneyKind = {
  /** Bought the place. */
  Bought: 0,
  /** Sold the place. */
  Sold: 1,
  /** A load brought into a place of yours: the trading premium. */
  Traded: 2,
  /** A load carried into somebody else's place, on their contract. */
  Delivered: 3,
  /**
   * A standing order collected from a place of yours by whoever bought it.
   *
   * The passive one, and the reason it exists: owning a farm earned nothing at
   * all unless you personally drove its output somewhere. A farm with a creamery
   * down the lane has a customer whether or not you fancy the drive, and that
   * customer sends its own lorry and deducts the cost of doing so. Which is
   * exactly why it pays less than hauling it yourself — see `gateSalePct`.
   */
  Gate: 4,
  /**
   * Moved between two places you both own: a shunt, at no charge.
   *
   * Recorded rather than skipped so a shop filling from your own farm does not
   * have blank accounts, which reads as a bug rather than as a transfer.
   */
  Moved: 5,
  /** Sold on the market, when the term came due. */
  Market: 6,
  /** Sold over a shop's counter, which needs nobody's agreement. */
  Counter: 7,
  /** Land bought. Not tied to a place, because it *is* the place. */
  Land: 8,
  /**
   * A week of keeping the doors open on somewhere you own.
   *
   * Tied to the place, because the whole point of it is that the player can see
   * *which* one is costing them — a lump under Upkeep in the ledger says the
   * estate costs money, and a row against the creamery says the creamery does.
   */
  Upkeep: 9,
} as const;
export type MoneyKind = (typeof MoneyKind)[keyof typeof MoneyKind];

/**
 * How much a buyer will collect from your gate in a week.
 *
 * One small van's work, and that figure is measured rather than chosen: a
 * two-tonne van completes two round trips a day, so twenty-four tonnes is a week
 * of one vehicle. It is the limit that makes a standing order a *trade* rather
 * than a tap — without it the order was the buyer's whole weekly appetite, which
 * for a creamery is more than three lorries could carry, and owning eight
 * producers paid a million and a half a month with no lorry anywhere in it.
 */
export const GATE_WEEKLY_TONNES = 24;

/**
 * The haul a farm-gate price is quoted against.
 *
 * A gate price is a price for goods, not for a journey — so it needs a distance
 * to be computed from, and that distance must be a *constant*, or the buyer being
 * far away makes you richer. How far they actually have to come is then a
 * deduction; see `settleStandingOrders`.
 *
 * Twenty tiles because that is a typical run in this district and the figure it
 * produces is one anybody can check: a tonne of milk at twenty tiles is £735,
 * which is exactly what the opening contract pays for the same tonne. So a gate
 * price is legibly "what the load is worth, less what carrying it costs".
 *
 * The first attempt used eight, on the reasoning that "at the gate" means next
 * door. It measured at eighteen hundred a week against a fifty-two thousand pound
 * farm — a twenty-eight week payback, which is four hours of play to break even
 * on the first business anybody buys, and turns a purchase into a penance.
 */
export const GATE_REFERENCE_TILES = 20;

/**
 * The market: how a haulier turns a shed full of goods into money.
 *
 * The problem it solves is one the player found before the design did. Owning a
 * producer left you with stock and no way to realise it: hauling it into another
 * place of your own is a shunt and pays nothing, and hauling it to somebody
 * else's works pays a *fare* rather than a price — so a farm's output piled up
 * and the only question the game could answer about it was "which lorry".
 *
 * A market answers "what is this worth, and when do you want the money". You
 * sell from stock wherever it sits, no lorry involved, and the offers differ in
 * one axis only: **patience**. Sell today and take a poor price; wait a month and
 * take a good one. That is the whole mechanic, and it is deliberately the one
 * thing a haulage game can offer that is not a lorry.
 *
 * The rates are set against each other rather than against anything real. What
 * matters is the order: dumping stock is worse than delivering it yourself, which
 * is worse than owning the shop that sells it. If that order ever inverts, the
 * game starts advising the player not to buy lorries.
 */
export interface MarketOffer {
  /** How many days until it settles. Zero is cash today. */
  days: number;
  /** Per tonne, in pence. */
  pence: number;
}

/**
 * The three ways to sell, as multiples of a cargo's own value.
 *
 * Wide apart on purpose: a factor of three between the worst and the best is
 * enough that waiting is a real decision rather than an obviously correct one,
 * because thirty days is a long time to be owed money when a lorry costs six
 * thousand pounds.
 *
 * The best term is *exactly* the value and not a penny more. The panel prints
 * what a tonne is worth beside what each term pays, and a thirty-day price above
 * the stated worth makes that line a lie — full value for full patience is both
 * the tidier rule and the one a reader can check.
 */
export const MARKET_TERMS: { days: number; multiple: number }[] = [
  { days: 0, multiple: 34 },
  { days: 10, multiple: 62 },
  { days: 30, multiple: 100 },
];

/** How many sales can be outstanding at once. A queue, not a portfolio. */
export const MAX_PENDING_SALES = 24;

/**
 * What a shop keeps on what it sells, against the goods' own value.
 *
 * Above the market's best term on purpose. Owning the shop that sells a crate
 * has to beat selling the same crate wholesale, or there is no reason to own a
 * shop — and the difference is the retailer's margin, which is exactly what it
 * is.
 */
export const RETAIL_PCT = 260;

/**
 * How many people it takes to keep one counter busy.
 *
 * The fix for the plainest exploit the game had, and the number that makes it a
 * model rather than an arithmetic. Retail throughput used to be a property of the
 * *building*: a pub got through nine tonnes of beer a day whatever was around it,
 * in a district of 2,512 people — seven pints a head, daily, from one pub — and
 * the answer to "how do I sell more" was "build another pub", for ever.
 *
 * The honest derivation says a village of fourteen hundred drinks about a quarter
 * of a tonne of beer a day, which is a fortieth of what the recipe can get
 * through. Using that directly would leave every counter in the game running at
 * one per cent and reading as permanently starved, because the recipes were
 * authored against a world with no ceiling. Retuning all of them is a separate
 * job and a bigger one.
 *
 * So the share is against the **catchment that saturates one counter** instead.
 * Twelve hundred people keep a shop or a pub fully busy; fewer, and it is
 * proportionately quieter. That is a stated model rather than a measured fact and
 * it is worth knowing which — but it gives the three properties that were wanted
 * and it gives them from one constant:
 *
 *   A second counter selling the same thing to the same people **halves both**,
 *   so stacking is pointless and spreading out is the move.
 *
 *   A pub in a village of fourteen hundred outsells one in a village of four
 *   hundred by three to one, so **housing pays into retail**.
 *
 *   And a counter with nobody near it sells nothing.
 */
export const TRADE_CATCHMENT = 1200;

/**
 * How much a second counter takes off the first, and why it is not half.
 *
 * The first version of the catchment split a village's trade evenly between
 * whatever was selling into it, which conserves the total and therefore says
 * **two pubs are worse than one** — the second is pure cannibalisation and the
 * only sensible number of them is one. That is a rule, not a decision, and it is
 * also wrong about villages: a place with two pubs genuinely drinks more than a
 * place with one, because there is somewhere to go when the other is full and
 * going out is a thing people do more of when there is more of it to do.
 *
 * So demand *grows* with what is there and tops out. With `n` counters the
 * village supports `pull * n / (n + RIVALRY)` between them, so each gets
 * `pull / (n + RIVALRY)`:
 *
 *   one pub    half the village's pull, all to itself
 *   two pubs   two thirds of it, a third each
 *   three      three quarters, a quarter each
 *   many       the whole pull, and nothing more
 *
 * Every counter you add earns *something* and each one earns less than the last,
 * which makes the second pub a judgement against its own upkeep rather than an
 * obvious mistake. One, because it puts the halfway point at a single rival: the
 * first competitor is the one that matters most, as it should be.
 */
export const TRADE_RIVALRY = 1;

/**
 * What a place is like, and therefore what it buys more of.
 *
 * `cut.md` has settlement character down as cut and cheap to restore — *"flavour
 * on a demand basket… genuinely nice; not load-bearing"* — and the scaffolding
 * survived the cut: `towns.character` is assigned at worldgen from the terrain
 * (coastal makes a port, high ground a resort, every third a working town) and
 * has been read by nothing but the determinism hash ever since.
 *
 * This is the table it was assigned for. Multipliers against the baseline, and a
 * market town *is* the baseline, so it has no entries at all — a reference that
 * needs tuning is not a reference.
 *
 * The point of it is that a district stops being uniform. A pub in a working
 * town is worth half again what the same pub is worth in a commuter village, so
 * *where* you build is a decision before *what* is, and two identical creameries
 * in two different places are genuinely different businesses.
 */
export const TOWN_TASTE: Record<string, Record<string, number>> = {
  // A working town drinks, eats meat, and has less time for anything fancy.
  industrial: { beer: 1.55, meat: 1.2, fuel: 1.15, produce: 0.9, dairy: 0.95 },
  // A port runs on fuel and freight, and its pubs are never empty.
  port: { beer: 1.3, fuel: 1.35, parcels: 1.25, meat: 1.05 },
  // Visitors eat out and drive in, and somebody has to feed them.
  resort: { produce: 1.4, dairy: 1.3, beer: 1.2, fuel: 1.2, meat: 1.15 },
  // People who work elsewhere buy their lives by post and drink at home.
  dormitory: { parcels: 1.5, produce: 1.2, dairy: 1.1, beer: 0.75, fuel: 0.9 },
};

/**
 * And how much two towns of the same sort still differ.
 *
 * Character alone would make every market town identical, which is a district
 * built from four rubber stamps. A fifth either way, fixed per town and cargo
 * from the seed, is enough that the player learns *this* village rather than
 * *this kind of village* — and small enough that character is still the thing
 * doing the work.
 */
export const TASTE_JITTER = 0.2;

/**
 * How much more of a cargo this town wants than the average.
 *
 * Deterministic from the town and the cargo, so a village that likes its beer
 * likes it for the whole game and still likes it after a reload. Hashed rather
 * than drawn from the world's rng, which would make the answer depend on how
 * many other things had asked a question first.
 */
export function tasteOf(
  character: string, cargo: string, town: number, seed: number,
): number {
  const base = TOWN_TASTE[character]?.[cargo] ?? 1;
  let h = (town * 2654435761 + seed * 40503 + cargo.length * 97) | 0;
  for (let i = 0; i < cargo.length; i++) h = (h * 31 + cargo.charCodeAt(i)) | 0;
  const unit = ((h >>> 8) & 0xffff) / 0xffff;
  return Math.max(0.1, base * (1 - TASTE_JITTER + unit * TASTE_JITTER * 2));
}

/**
 * How far people will go to a shop, in tiles.
 *
 * Twenty tiles is about six hundred metres at this scale — a village's own walk.
 * Wide enough that a shop on the edge of a settlement still serves it, narrow
 * enough that a second village is a second catchment rather than more of the
 * same one. That is the whole of "spread out demand": trade is somewhere rather
 * than something, so the way to sell more is to reach more people.
 */
export const RETAIL_REACH = 20;

/**
 * What a tonne of goods is worth, against the `basePrice` the content quotes.
 *
 * The content's prices are not on the same scale as anything else in the game and
 * never were. `basePrice` enters the haulage rate at eighteen per cent, so it was
 * only ever a small kicker on a fare: a tonne of produce contributes ninety pence
 * to a seven-hundred-pound fare. Read as a *price* it is off by roughly fifty,
 * which is invisible for as long as nothing sells goods — and the moment
 * something does, milk is worth three pounds forty a tonne against a fare of
 * seven hundred and thirty-five, so the market is a rounding error and nobody
 * would ever use it.
 *
 * Fifty-one, chosen against the one figure in the game everybody already knows:
 * it puts a tonne of milk sold on the best terms at about a quarter of what
 * carrying that same tonne pays. So raw goods are worth *hauling* and processed
 * goods are worth *selling*, which is the shape a haulage game wants — a farm's
 * milk goes on a lorry, and a creamery's dairy is worth six times as much because
 * six milk went into four dairy.
 *
 * Here rather than in the content because it is a relationship between two of the
 * game's systems, not a property of milk.
 */
export const GOODS_SCALE = 51;

/**
 * Who buys things, for the market screen.
 *
 * Invented merchants rather than places on the map, and English rather than
 * generic, because the list's whole job is to make a price feel like a
 * transaction with somebody. "Hollins & Sons" wanting forty tonnes is a
 * different thing to read than "Offer 3".
 */
export const BUYER_NAMES = [
  'Hollins & Sons',
  'Pethick Wholesale',
  'The Co-operative',
  'Ashby Brothers',
  'Marchford Provisions',
  'Netherby Trading',
  'Wraycroft & Co',
  'Lindley Merchants',
  'Barrowclough Ltd',
  'Sowerby Supply',
] as const;
