/**
 * Seasons, weather, and the things that go wrong. features.md §11 and §15.
 *
 * Two rules govern everything here, and they pull in opposite directions.
 *
 * art-direction.md §13 says weather is *atmospheric only* and must never
 * obscure information the player needs to act on. features.md §15 says snow
 * closes mountain routes. Those are not in conflict, but the line between them
 * has to be drawn deliberately: weather may change what the world *does*, and
 * it may not change what the player can *see*. Snow slows a pass and can shut
 * it; snow does not put a white veil over the screen so you cannot read your
 * own network. So the render side of a season is a palette shift and nothing
 * more, and everything with teeth lives here in the simulation where it is
 * visible in numbers the player can look up.
 *
 * The second rule is about events. D10 lists four pressure systems, and this
 * is not a fifth. Flood, strike, fuel and boom exist to disturb an optimum
 * that has stopped being interesting, not to tax the player at random — so
 * every one of them is announced, bounded in time, and either avoidable or
 * insurable by a decision made earlier. A route that runs along a river is
 * cheaper to build and floods; one over the hill costs more and does not. That
 * is a decision. A bill arriving on a Tuesday is not.
 */

import { TICKS_PER_DAY, DAYS_PER_YEAR } from './constants.ts';
import type { Rng } from './rng.ts';

export const Season = { Spring: 0, Summer: 1, Autumn: 2, Winter: 3 } as const;
export type Season = (typeof Season)[keyof typeof Season];
export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];

export const Weather = {
  Clear: 0, Rain: 1, Fog: 2, Snow: 3, Storm: 4,
} as const;
export type Weather = (typeof Weather)[keyof typeof Weather];
export const WEATHER_NAMES = ['Clear', 'Rain', 'Fog', 'Snow', 'Storm'];

/** Height above which snow lies. Below this, winter is merely cold. */
export const SNOW_LINE = 1500;

/** Speed multiplier, as a percentage, for each weather over open ground. */
const WEATHER_SPEED = [100, 92, 84, 70, 76];

/** And the extra penalty above the snow line, where it actually matters. */
const HIGH_GROUND_SNOW_SPEED = 34;

export const EventKind = {
  Flood: 0, Strike: 1, FuelPrice: 2, Boom: 3,
} as const;
export type EventKind = (typeof EventKind)[keyof typeof EventKind];
export const EVENT_NAMES = ['Flood', 'Strike', 'Fuel price', 'Boom'];

export const MAX_EVENTS = 16;

export class EventTable {
  count = 0;
  readonly kind = new Uint8Array(MAX_EVENTS);
  readonly started = new Int32Array(MAX_EVENTS);
  readonly ends = new Int32Array(MAX_EVENTS);
  /** Whom or what it lands on: a company for a strike, a cargo for a boom,
   *  nothing for the weather ones. */
  readonly subject = new Int32Array(MAX_EVENTS).fill(-1);
  /** How hard, as a percentage. Read differently by each kind. */
  readonly severity = new Int32Array(MAX_EVENTS);
  readonly active = new Uint8Array(MAX_EVENTS);
  text: string[] = [];

  open(kind: number, tick: number, days: number, subject: number, severity: number, text: string): number {
    let id = -1;
    for (let i = 0; i < this.count; i++) if (!this.active[i]) { id = i; break; }
    if (id < 0) {
      if (this.count >= MAX_EVENTS) return -1;
      id = this.count++;
    }
    this.kind[id] = kind;
    this.started[id] = tick;
    this.ends[id] = tick + days * TICKS_PER_DAY;
    this.subject[id] = subject;
    this.severity[id] = severity;
    this.active[id] = 1;
    this.text[id] = text;
    return id;
  }
}

export class Climate {
  weather: Weather = Weather.Clear;
  /** 0..100. A drizzle and a downpour are the same weather and not the same
   *  problem, and the difference belongs in a number rather than in five more
   *  enum members. */
  severity = 0;
  /** Ticks until the next roll. Weather that changed every day would be noise;
   *  a front lasts the better part of a week. */
  private until = 0;

  season(day: number): Season {
    const through = (day % DAYS_PER_YEAR) / DAYS_PER_YEAR;
    return (Math.floor(through * 4) % 4) as Season;
  }

  /**
   * Roll the weather forward. Called once a day.
   *
   * Weighted by season rather than uniform, because a region where it snows as
   * often in July as in January has no seasons, it has a random number
   * generator with a costume on.
   */
  step(tick: number, day: number, rng: Rng): boolean {
    if (tick < this.until) return false;
    const season = this.season(day);
    const roll = rng.int(100);
    let next: Weather = Weather.Clear;
    if (season === Season.Winter) {
      next = roll < 34 ? Weather.Clear : roll < 58 ? Weather.Snow
        : roll < 76 ? Weather.Rain : roll < 90 ? Weather.Fog : Weather.Storm;
    } else if (season === Season.Summer) {
      next = roll < 68 ? Weather.Clear : roll < 88 ? Weather.Rain
        : roll < 95 ? Weather.Fog : Weather.Storm;
    } else {
      next = roll < 48 ? Weather.Clear : roll < 74 ? Weather.Rain
        : roll < 90 ? Weather.Fog : Weather.Storm;
    }
    const changed = next !== this.weather;
    this.weather = next;
    this.severity = next === Weather.Clear ? 0 : 25 + rng.int(75);
    this.until = tick + (3 + rng.int(6)) * TICKS_PER_DAY;
    return changed;
  }

  /**
   * Speed multiplier for a link, as a percentage of the posted limit.
   *
   * Height is the whole point of the snow case. Snow on the coast road is a
   * nuisance; snow on a pass is the reason the pass has a season. A player who
   * routed over the mountain to save eight tiles finds out in January, which
   * is the decision the feature exists to make interesting.
   */
  speedPercent(height: number): number {
    if (this.weather === Weather.Clear) return 100;
    const base = WEATHER_SPEED[this.weather];
    const scaled = 100 - ((100 - base) * this.severity) / 100;
    if (this.weather !== Weather.Snow || height < SNOW_LINE) return Math.round(scaled);
    // Above the snow line it gets much worse, and at the top of the severity
    // range the road is effectively shut.
    const high = 100 - ((100 - HIGH_GROUND_SNOW_SPEED) * this.severity) / 100;
    return Math.max(0, Math.round(high));
  }

  /** Tourists travel in summer and, a little, at Christmas. Nobody takes a
   *  holiday in a wet February, and a tourism business that ignores that is
   *  not modelling tourism. */
  tourismMultiplier(day: number): number {
    const season = this.season(day);
    if (season === Season.Summer) return 2.4;
    if (season === Season.Spring || season === Season.Autumn) return 1;
    return 0.45;
  }
}

export interface EventContext {
  tick: number;
  day: number;
  era: number;
  companyCount: number;
  cargoCount: number;
  /** Cargo ids that exist this era, so a boom cannot be declared in something
   *  nobody can carry yet. */
  liveCargo: number[];
  climate: Climate;
}

/**
 * Consider opening one disruption, and close any that have run their course.
 *
 * Deliberately rare. features.md calls these "disruption events", and a
 * disruption that happens every month is not a disruption, it is the weather.
 */
export function stepEvents(
  events: EventTable, ctx: EventContext, rng: Rng,
): { opened: number[]; closed: number[] } {
  const opened: number[] = [];
  const closed: number[] = [];

  for (let i = 0; i < events.count; i++) {
    if (events.active[i] && ctx.tick >= events.ends[i]) {
      events.active[i] = 0;
      closed.push(i);
    }
  }

  let live = 0;
  for (let i = 0; i < events.count; i++) if (events.active[i]) live++;
  if (live >= 3) return { opened, closed };
  // About one event a year across all four kinds.
  if (!rng.chance(1, Math.round(DAYS_PER_YEAR / 1.4))) return { opened, closed };

  const season = ctx.climate.season(ctx.day);
  const roll = rng.int(100);

  if (roll < 26 && (season === Season.Winter || season === Season.Autumn)) {
    // Floods follow the rain, which is why this is seasonal rather than
    // uniform: a flood in a dry August reads as the game cheating.
    const days = 6 + rng.int(14);
    const id = events.open(
      EventKind.Flood, ctx.tick, days, -1, 30 + rng.int(60),
      'The river is over its banks. Low-lying ways are slow or impassable.',
    );
    if (id >= 0) opened.push(id);
  } else if (roll < 50 && ctx.companyCount > 1) {
    const company = 1 + rng.int(ctx.companyCount - 1);
    const days = 4 + rng.int(10);
    const id = events.open(
      EventKind.Strike, ctx.tick, days, company, 40 + rng.int(60),
      'The drivers are out. Vehicles are running at a fraction of normal.',
    );
    if (id >= 0) opened.push(id);
  } else if (roll < 76) {
    const days = 40 + rng.int(120);
    const up = rng.chance(3, 5);
    const id = events.open(
      EventKind.FuelPrice, ctx.tick, days, -1,
      up ? 120 + rng.int(90) : 55 + rng.int(30),
      up ? 'Fuel and fodder are dear. Running costs are up across the region.'
        : 'Fuel and fodder are cheap. Running costs are down across the region.',
    );
    if (id >= 0) opened.push(id);
  } else if (ctx.liveCargo.length > 0) {
    const cargo = ctx.liveCargo[rng.int(ctx.liveCargo.length)];
    const days = 60 + rng.int(180);
    const id = events.open(
      EventKind.Boom, ctx.tick, days, cargo, 130 + rng.int(110),
      'Demand has run ahead of supply. Carriage is paying above the odds.',
    );
    if (id >= 0) opened.push(id);
  }
  return { opened, closed };
}

/** Running-cost multiplier from any live fuel event, as a percentage. */
export function runningCostPercent(events: EventTable): number {
  for (let i = 0; i < events.count; i++) {
    if (events.active[i] && events.kind[i] === EventKind.FuelPrice) return events.severity[i];
  }
  return 100;
}

/** Haulage-rate multiplier for one cargo, as a percentage. */
export function ratePercent(events: EventTable, cargo: number): number {
  for (let i = 0; i < events.count; i++) {
    if (events.active[i] && events.kind[i] === EventKind.Boom && events.subject[i] === cargo) {
      return events.severity[i];
    }
  }
  return 100;
}

/** Is this company's workforce out? */
export function strikePercent(events: EventTable, company: number): number {
  for (let i = 0; i < events.count; i++) {
    if (events.active[i] && events.kind[i] === EventKind.Strike && events.subject[i] === company) {
      return Math.max(10, 100 - events.severity[i]);
    }
  }
  return 100;
}

/** Is a flood running, and how bad? Zero when there is none. */
export function floodSeverity(events: EventTable): number {
  for (let i = 0; i < events.count; i++) {
    if (events.active[i] && events.kind[i] === EventKind.Flood) return events.severity[i];
  }
  return 0;
}

/** How far above the sea a way has to be to stay dry in a flood. */
export const FLOOD_LINE = 120;
