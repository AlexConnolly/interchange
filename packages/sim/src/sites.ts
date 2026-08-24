/**
 * Industries and towns: what produces cargo, what wants it, and what happens
 * when nobody moves it.
 *
 * design.md §4.3 is the load-bearing part. An industry carries a rolling
 * service-satisfaction rate; below one threshold production falls, below a
 * second it closes, and closure is recoverable inside a grace period. That
 * last clause matters more than it looks — permanent loss for a temporary
 * lapse is punishing rather than tense, and a player who loses a colliery
 * because they were fighting a fire elsewhere stops taking risks.
 */

import { MAX_SITES, MAX_TOWNS, MODE_COUNT, TICKS_PER_DAY, AUTHORITY } from './constants.ts';
import { NONE } from './network.ts';
import type { Hasher } from './hash.ts';

export const SiteState = {
  Thriving: 0,
  Struggling: 1,
  Dead: 2,
  /** Closed but inside the grace period: still recoverable. */
  Mothballed: 3,
} as const;
export type SiteState = (typeof SiteState)[keyof typeof SiteState];

export const STATE_NAMES = ['thriving', 'struggling', 'dead', 'mothballed'] as const;

/**
 * Sites: extraction, processing, utility, terminal and tourism, all one table.
 * They differ by their recipe, which is data, not by their code path.
 */
export class SiteTable {
  count = 0;
  readonly def = new Int32Array(MAX_SITES);
  readonly x = new Int32Array(MAX_SITES);
  readonly y = new Int32Array(MAX_SITES);
  readonly tile = new Int32Array(MAX_SITES);
  readonly owner = new Int16Array(MAX_SITES);
  /**
   * Network node the site loads and unloads at, per mode.
   *
   * Per mode rather than one node, because a colliery with a siding and a road
   * spur is served by both and a rail vehicle cannot use the road one. This is
   * the join that makes the later acts multi-modal without a second code path.
   */
  readonly nodes = new Int32Array(MAX_SITES * MODE_COUNT).fill(NONE);
  readonly state = new Uint8Array(MAX_SITES);
  /** Ticks until the next production cycle completes. */
  readonly cycle = new Int32Array(MAX_SITES);
  /** 0..100, rolling. How much of what this site made got taken away. */
  readonly satisfaction = new Uint8Array(MAX_SITES);
  /** Consecutive days below the decline threshold. */
  readonly starvedDays = new Int32Array(MAX_SITES);
  /** Days since mothballing; past the grace period it is dead for good. */
  readonly mothballedDays = new Int32Array(MAX_SITES);
  /** Deposit richness 0..100 for extraction sites; scales output. */
  readonly richness = new Uint8Array(MAX_SITES);
  /** Production multiplier 0..100 from the three-network requirement. */
  readonly powered = new Uint8Array(MAX_SITES);
  readonly watered = new Uint8Array(MAX_SITES);
  readonly staffed = new Uint8Array(MAX_SITES);
  /** Lifetime tonnes shipped out, for reporting and for the balance sweep. */
  readonly shipped = new Float64Array(MAX_SITES);
  /**
   * Whether anyone has ever collected from this site.
   *
   * Decay is a punishment for neglecting an industry you *serve* — design.md
   * §4.3 is about the rolling service rate of a working supply chain. Applied
   * to a site nobody has ever visited it means something quite different: on a
   * fresh region every industry the player has not reached in the first game
   * year shuts, and by 1862 half the map is derelict through no fault of
   * anyone. So an unserved site stalls at struggling and waits.
   */
  readonly everServed = new Uint8Array(MAX_SITES);
  /** Tonnes produced in the current window and the settled previous one. */
  readonly produced = new Float64Array(MAX_SITES);
  readonly collected = new Float64Array(MAX_SITES);

  /** stock[site * cargoCount + cargo], in tonnes. */
  stock: Int32Array;
  /** How much of each cargo this site will hold before it stops producing. */
  capacity: Int32Array;
  readonly cargoCount: number;

  constructor(cargoCount: number) {
    this.cargoCount = cargoCount;
    this.stock = new Int32Array(MAX_SITES * cargoCount);
    this.capacity = new Int32Array(MAX_SITES * cargoCount);
  }

  alloc(def: number, x: number, y: number, tile: number, owner: number): number {
    if (this.count >= MAX_SITES) return NONE;
    const id = this.count++;
    this.def[id] = def;
    this.x[id] = x;
    this.y[id] = y;
    this.tile[id] = tile;
    this.owner[id] = owner;
    this.state[id] = SiteState.Thriving;
    this.satisfaction[id] = 100;
    this.richness[id] = 70;
    this.powered[id] = 100;
    this.watered[id] = 100;
    this.staffed[id] = 100;
    return id;
  }

  /** The node this site is served from on a given mode, or NONE. */
  nodeOf(site: number, mode: number): number {
    return this.nodes[site * MODE_COUNT + mode];
  }

  setNode(site: number, mode: number, node: number): void {
    this.nodes[site * MODE_COUNT + mode] = node;
  }

  /** True if the site can be reached at all, on any mode. */
  connected(site: number): boolean {
    for (let m = 0; m < MODE_COUNT; m++) if (this.nodes[site * MODE_COUNT + m] !== NONE) return true;
    return false;
  }

  stockOf(site: number, cargo: number): number {
    return this.stock[site * this.cargoCount + cargo];
  }

  addStock(site: number, cargo: number, tonnes: number): number {
    const i = site * this.cargoCount + cargo;
    const cap = this.capacity[i];
    const before = this.stock[i];
    const after = Math.max(0, Math.min(cap, before + tonnes));
    this.stock[i] = after;
    return after - before;
  }

  takeStock(site: number, cargo: number, tonnes: number): number {
    const i = site * this.cargoCount + cargo;
    const taken = Math.min(this.stock[i], tonnes);
    this.stock[i] -= taken;
    return taken;
  }
}

export const TownCharacter = ['market', 'industrial', 'port', 'resort', 'dormitory'] as const;

export class TownTable {
  count = 0;
  readonly x = new Int32Array(MAX_TOWNS);
  readonly y = new Int32Array(MAX_TOWNS);
  readonly tile = new Int32Array(MAX_TOWNS);
  readonly population = new Int32Array(MAX_TOWNS);
  readonly character = new Uint8Array(MAX_TOWNS);
  readonly nodes = new Int32Array(MAX_TOWNS * MODE_COUNT).fill(NONE);
  names: string[] = [];
  /** Rolling 0..100 measure of how well the town is served. Drives growth. */
  readonly served = new Uint8Array(MAX_TOWNS);
  /** Jobs within a commute, filled by the labour catchment pass. */
  readonly labourSupplied = new Int32Array(MAX_TOWNS);
  readonly labourDemand = new Int32Array(MAX_TOWNS);
  /** Fractional population growth, accumulated so growth can be sub-integer. */
  readonly growthAcc = new Int32Array(MAX_TOWNS);

  stock: Int32Array;
  demand: Int32Array;
  readonly cargoCount: number;

  constructor(cargoCount: number) {
    this.cargoCount = cargoCount;
    this.stock = new Int32Array(MAX_TOWNS * cargoCount);
    this.demand = new Int32Array(MAX_TOWNS * cargoCount);
  }

  nodeOf(town: number, mode: number): number {
    return this.nodes[town * MODE_COUNT + mode];
  }

  setNode(town: number, mode: number, node: number): void {
    this.nodes[town * MODE_COUNT + mode] = node;
  }

  alloc(x: number, y: number, tile: number, name: string, population: number, character: number): number {
    if (this.count >= MAX_TOWNS) return NONE;
    const id = this.count++;
    this.x[id] = x;
    this.y[id] = y;
    this.tile[id] = tile;
    this.population[id] = population;
    this.character[id] = character;
    this.served[id] = 60;
    this.names[id] = name;
    return id;
  }
}

export interface RecipeTables {
  /** For each industry def: inputs and outputs as flat (cargo, tonnes) pairs. */
  inputs: Int32Array[];
  outputs: Int32Array[];
  period: Int32Array;
  kind: Uint8Array;
  powerNeed: Int32Array;
  waterNeed: Int32Array;
  labourNeed: Int32Array;
  fromEra: Uint8Array;
  /** Era in which each cargo starts existing; outputs before it are dropped. */
  cargoFromEra: Uint8Array;
  /**
   * Era from which the three-network requirement binds.
   *
   * design.md makes the three networks *Act III's* game, and the content gives
   * every industry a power, water and labour figure because they all have one
   * eventually. Applying those from 1860 stops Act I dead: there is no
   * transmission line in the world, so every industry is at zero per cent
   * power, so nothing anywhere produces anything and the map is inert. Before
   * this era the figures are recorded and ignored.
   */
  networkFromEra: number;
}

export const IndustryKind = {
  Extraction: 0,
  Processing: 1,
  Terminal: 2,
  Utility: 3,
  Tourism: 4,
} as const;

export interface SiteStepResult {
  producedTonnes: number;
  closures: number;
  reopenings: number;
}

/**
 * One tick of production.
 *
 * A cycle completes only when the recipe's inputs are present *and* the three
 * networks are satisfied. In Act I nothing needs power, water or labour, so
 * those multipliers all sit at 100 and the check is free; from Act III they
 * are the game (design.md §2.2).
 */
export function stepSites(
  sites: SiteTable,
  r: RecipeTables,
  era: number,
  tick: number,
): SiteStepResult {
  const out: SiteStepResult = { producedTonnes: 0, closures: 0, reopenings: 0 };
  const cargoCount = sites.cargoCount;

  for (let s = 0; s < sites.count; s++) {
    const state = sites.state[s];
    if (state === SiteState.Dead) continue;
    if (state === SiteState.Mothballed) continue;

    if (--sites.cycle[s] > 0) continue;
    const def = sites.def[s];
    sites.cycle[s] = r.period[def];

    // Three networks. Each is a percentage; the binding one wins, because a
    // mine with power and no water produces nothing, not two thirds.
    let gate = 100;
    if (era >= r.networkFromEra) {
      if (r.powerNeed[def] > 0) gate = Math.min(gate, sites.powered[s]);
      if (r.waterNeed[def] > 0) gate = Math.min(gate, sites.watered[s]);
      if (r.labourNeed[def] > 0) gate = Math.min(gate, sites.staffed[s]);
    }
    if (gate <= 0) continue;

    // Struggling sites run at reduced output rather than stopping, so the
    // player sees the slide before the closure.
    const health = state === SiteState.Struggling ? 55 : 100;
    const richness = r.kind[def] === IndustryKind.Extraction ? sites.richness[s] : 100;
    const scale = (gate * health * richness) / 1000000;

    // Inputs first: a cycle is all-or-nothing so a half-fed steelworks does
    // not silently eat its coke.
    const ins = r.inputs[def];
    let feasible = 1;
    for (let i = 0; i < ins.length; i += 2) {
      const need = Math.max(1, Math.round(ins[i + 1] * scale));
      if (sites.stockOf(s, ins[i]) < need) {
        feasible = 0;
        break;
      }
    }
    if (!feasible) continue;
    for (let i = 0; i < ins.length; i += 2) {
      sites.takeStock(s, ins[i], Math.max(1, Math.round(ins[i + 1] * scale)));
    }

    const outs = r.outputs[def];
    let made = 0;
    let blocked = 0;
    for (let i = 0; i < outs.length; i += 2) {
      const cargo = outs[i];
      if (r.cargoFromEra[cargo] > era) continue; // the cargo does not exist yet
      const amount = Math.max(1, Math.round(outs[i + 1] * scale));
      const added = sites.addStock(s, cargo, amount);
      made += added;
      if (added < amount) blocked += amount - added;
    }
    sites.produced[s] += made + blocked;
    out.producedTonnes += made;

    // Satisfaction is the share of what the site *could* have made that it was
    // able to make. A full yard means nobody is hauling it away, which is the
    // signal decay is meant to punish.
    if (made + blocked > 0) {
      const rate = (made * 100) / (made + blocked);
      sites.satisfaction[s] = Math.round((sites.satisfaction[s] * 7 + rate) / 8);
    }
  }
  void tick;
  return out;
}

/**
 * Daily decay pass. Split from the tick because thresholds are counted in days
 * and running it every tick would make the numbers depend on the tick rate.
 */
export function stepSiteDecay(
  sites: SiteTable,
  balance: { declineBelowPct: number; closeBelowPct: number; declineDays: number; graceDays: number },
): SiteStepResult {
  const out: SiteStepResult = { producedTonnes: 0, closures: 0, reopenings: 0 };
  for (let s = 0; s < sites.count; s++) {
    const state = sites.state[s];
    if (state === SiteState.Dead) continue;

    if (state === SiteState.Mothballed) {
      sites.mothballedDays[s]++;
      // Recovery: somebody started collecting again inside the grace period.
      if (sites.satisfaction[s] >= balance.declineBelowPct) {
        sites.state[s] = SiteState.Struggling;
        sites.mothballedDays[s] = 0;
        sites.starvedDays[s] = 0;
        out.reopenings++;
      } else if (sites.mothballedDays[s] > balance.graceDays) {
        sites.state[s] = SiteState.Dead;
      }
      continue;
    }

    const sat = sites.satisfaction[s];
    if (!sites.everServed[s]) {
      // Never served: production has already stopped because the yard is full,
      // which is punishment enough. It stays available for someone to pick up.
      sites.state[s] = sat < balance.declineBelowPct ? SiteState.Struggling : SiteState.Thriving;
      continue;
    }
    if (sat < balance.closeBelowPct) {
      sites.starvedDays[s]++;
      if (sites.starvedDays[s] > balance.declineDays) {
        sites.state[s] = SiteState.Mothballed;
        sites.mothballedDays[s] = 0;
        out.closures++;
      } else {
        sites.state[s] = SiteState.Struggling;
      }
    } else if (sat < balance.declineBelowPct) {
      sites.starvedDays[s]++;
      sites.state[s] = SiteState.Struggling;
    } else {
      sites.starvedDays[s] = Math.max(0, sites.starvedDays[s] - 2);
      if (sites.starvedDays[s] === 0) sites.state[s] = SiteState.Thriving;
    }
  }
  return out;
}

/**
 * Town demand and growth.
 *
 * A town's appetite scales with its population, and it grows when it is fed
 * and shrinks when it is not — design.md §4.3. Growth is accumulated in
 * hundredths so a small town can grow by less than a person a day without the
 * integer rounding pinning it in place forever.
 */
export function stepTowns(
  towns: TownTable,
  demandPerThousand: Int32Array,
  producePerThousand: Int32Array,
  growthPerDay: number,
): void {
  const cargoCount = towns.cargoCount;
  for (let t = 0; t < towns.count; t++) {
    const pop = towns.population[t];

    /*
     * Towns make people, post and holidays.
     *
     * "You bring people" was thin in the first draft (features.md's own
     * review), and this is where it stops being thin: passengers are produced
     * by a town in proportion to its size and *wanted* by every other town, so
     * a commuter flow is a real cargo with a real origin and destination
     * rather than a number attached to a bus. The stock is capped at a few
     * days of departures, because people who cannot get a bus do not queue
     * indefinitely — they stay at home, and the town notices.
     */
    for (let c = 0; c < cargoCount; c++) {
      const per = producePerThousand[c];
      if (per === 0) continue;
      const made = Math.max(1, Math.round((per * pop) / 1000));
      const i = t * cargoCount + c;
      const cap = made * 5;
      towns.stock[i] = Math.min(cap, towns.stock[i] + made);
    }
    let wanted = 0;
    let met = 0;
    for (let c = 0; c < cargoCount; c++) {
      const per = demandPerThousand[c];
      if (per === 0) continue;
      const need = Math.max(1, Math.round((per * pop) / 1000));
      towns.demand[t * cargoCount + c] = need;
      wanted += need;
      const have = towns.stock[t * cargoCount + c];
      const used = Math.min(have, need);
      towns.stock[t * cargoCount + c] = have - used;
      met += used;
    }
    const rate = wanted > 0 ? Math.round((met * 100) / wanted) : 100;
    towns.served[t] = Math.round((towns.served[t] * 9 + rate) / 10);

    // Above sixty a town grows, below forty it shrinks, between the two it
    // holds. The dead band is what stops a town oscillating around a
    // threshold and the population reading as noise.
    const served = towns.served[t];
    let delta = 0;
    if (served > 60) delta = ((served - 60) * growthPerDay) / 40;
    else if (served < 40) delta = -((40 - served) * growthPerDay) / 40;
    towns.growthAcc[t] += Math.round(delta * 100);
    const whole = (towns.growthAcc[t] / 100) | 0;
    if (whole !== 0) {
      towns.growthAcc[t] -= whole * 100;
      towns.population[t] = Math.max(60, towns.population[t] + whole);
    }
  }
}

export function hashSites(h: Hasher, sites: SiteTable, towns: TownTable): void {
  h.int(sites.count).int(towns.count);
  h.array(sites.state, sites.count);
  h.array(sites.satisfaction, sites.count);
  h.array(sites.cycle, sites.count);
  h.array(sites.stock, sites.count * sites.cargoCount);
  h.array(towns.population, towns.count);
  h.array(towns.served, towns.count);
  h.array(towns.stock, towns.count * towns.cargoCount);
}

export { AUTHORITY, TICKS_PER_DAY };
