/**
 * Rates and sizes the whole simulation agrees on.
 *
 * On time: the calendar and vehicle motion are tuned separately and are
 * deliberately not reconciled — see docs/scale.md. Every game in this genre
 * does the same thing, and every attempt to make one consistent with the other
 * produces either a lorry that crawls for four game-months to cross a valley
 * or a calendar that runs at a frame a decade.
 */

export const TICKS_PER_SECOND = 20;

/**
 * Ticks per game day at 1x, and days per month.
 *
 * These two numbers are where the genre's oldest fudge lives, so it is worth
 * being explicit about it. A forty-tile haul takes a horse dray about nine
 * hundred ticks, which is forty-five seconds of real time — the right length
 * for a round trip you can watch. The same nine hundred ticks is nineteen game
 * days, and a dray does not take nineteen days to go a mile and a quarter.
 *
 * There is no setting of these constants that fixes that. Make a day long
 * enough for the haul to be plausible and Act I takes forty-five real hours;
 * make the year short enough for Act I to be an evening and every journey
 * spans a season. Every game in this genre picks the second and says nothing.
 * We pick the second and write it down: see docs/scale.md.
 *
 * A twenty-day month gives a game year of 9.6 real minutes at 1x, so Act I's
 * two decades is a couple of hours at the speeds people actually play at.
 */
export const TICKS_PER_DAY = 48;
export const DAYS_PER_MONTH = 20;
export const MONTHS_PER_YEAR = 12;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;
export const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR;

export const START_YEAR = 1860;
export const END_YEAR = 2100;

/** Speed multipliers the player can select. Index 0 is paused. */
export const SPEED_STEPS = [0, 1, 2, 5, 20] as const;

// ------------------------------------------------------------- the network

/** Traffic cells per tile. Half a tile is 16 m: a vehicle plus a gap. */
export const CELLS_PER_TILE = 2;

/** Cell length in Q16.16 tiles. */
export const CELL_LENGTH = 65536 / CELLS_PER_TILE;

/** How many cells ahead a vehicle looks when deciding whether to slow. Art
 *  direction §12 asks that a vehicle visibly slows before it stops, so a queue
 *  reads as a queue; that is this number being greater than one. */
export const LOOKAHEAD_CELLS = 6;

/** Q16.16 tiles per tick per tick. Deceleration is harder than acceleration,
 *  which is both true and what makes a queue form at the right place. */
export const ACCEL = 220;
export const DECEL = 520;

/** Ticks between a route request being issued and its result being applied.
 *  Fixed, and enforced structurally: the sim has no API that takes a path
 *  result immediately. architecture.md rule 5 / risks.md R2. */
export const PATH_LATENCY_TICKS = 8;

/** Ticks between rolling state hashes. Determinism failures are localised to
 *  this window. architecture.md §8. */
export const HASH_INTERVAL = 256;

// -------------------------------------------------------------- companies

/** Company 0 is the regional authority: it owns everything nobody else does,
 *  its roads are bad, and it is the counterparty for every access charge in
 *  Act I. design.md §3.1. */
export const AUTHORITY = 0;
export const MAX_COMPANIES = 9;

// --------------------------------------------------------------- capacity

export const MAX_VEHICLES = 30000;
export const MAX_LINKS = 200000;
export const MAX_NODES = 100000;
export const MAX_ASSETS = 40000;
export const MAX_SITES = 4000;
export const MAX_TOWNS = 64;
export const MAX_CONTRACTS = 512;
/** A developed region runs a lot of services; 512 was a guess and a player
 *  who exceeds it should be told, not silently ignored. */
export const MAX_ROUTES = 2048;

// ------------------------------------------------------------------ modes

export const Mode = {
  Road: 0,
  Rail: 1,
  Water: 2,
  Air: 3,
  Pipe: 4,
  Wire: 5,
  Conveyor: 6,
} as const;
export type Mode = (typeof Mode)[keyof typeof Mode];
export const MODE_NAMES = ['road', 'rail', 'water', 'air', 'pipe', 'wire', 'conveyor'] as const;
export const MODE_COUNT = 7;

/** Direction bits on a way tile. The order is north, east, south, west and is
 *  a contract: the traffic model, the graph tracer and the renderer all index
 *  by it. */
export const DIR_N = 1;
export const DIR_E = 2;
export const DIR_S = 4;
export const DIR_W = 8;
export const DIR_DX = [0, 1, 0, -1];
export const DIR_DY = [-1, 0, 1, 0];
export const DIR_BIT = [DIR_N, DIR_E, DIR_S, DIR_W];
export const DIR_OPPOSITE = [2, 3, 0, 1];

// ------------------------------------------------------------- junctions

export const Control = {
  /** Whoever arrives first, with the busier approach winning ties. */
  Priority: 0,
  /** Fixed-cycle signals. */
  Signals: 1,
  /** Circulating traffic has priority. */
  Roundabout: 2,
  /** Everyone stops; strict round-robin. */
  AllWayStop: 3,
  /** No conflict — a plain continuation or a terminal. */
  None: 4,
} as const;
export type Control = (typeof Control)[keyof typeof Control];

/** Ticks per signal phase at the default cycle. */
export const SIGNAL_PHASE_TICKS = 24;

// --------------------------------------------------------------- ownership

/** Access charges are quoted per vehicle per tile, in pence. A journey's
 *  charge is therefore proportional to how much of somebody's road you used,
 *  which is what makes a bypass a real answer rather than a gesture. */
export const CHARGE_UNIT = 1;

/** Ticks over which link flow is averaged for congestion and valuation. */
export const FLOW_WINDOW = TICKS_PER_DAY * 30;

/**
 * How much slower the economy runs than the calendar.
 *
 * scale.md is honest that vehicle speed is tuned for legibility and the
 * calendar for progression, and that the two are not reconciled: a horse dray
 * crosses forty tiles in nineteen game days. What that document does not
 * follow through is the consequence for everything quoted *per day*. A
 * gasworks burning four tonnes of coal a day is a perfectly reasonable
 * gasworks, and a dray managing one round trip a fortnight is a perfectly
 * reasonable dray, but together they say the works needs sixty drays and the
 * game is unplayable — which is exactly what the balance sweep found: four
 * companies moving a thousand tonnes between them in thirty years against a
 * regional demand of three hundred thousand, all four bankrupt.
 *
 * So production and consumption are quoted in the same document-legible
 * numbers and then divided by this, once, here. It is the bridge between the
 * two scales scale.md keeps apart, and it belongs next to them rather than
 * smeared through the content as artificially long recipe periods that would
 * read as mistakes to anybody editing the JSON.
 */
export const ECONOMY_SCALE = 24;

/**
 * How long a vehicle holds out for a full load, as a share of its round trip.
 *
 * "Wait for a full load" is the right default and a terrible absolute rule: a
 * colliery produces a fifth of a tonne a day, so drays holding out for three
 * tonnes each can sit at the pithead for a season with the fodder bill
 * running. But a fixed few days is just as wrong in the other direction. A
 * dray that waits five days on a route that takes seventy leaves with one
 * tonne of three, earns a third of what the journey costs, and every company
 * in the region goes bankrupt — which is precisely what the sweep reported.
 *
 * Relative to the round trip it is self-tuning, and it is also the calculation
 * a carrier actually makes: a day at the wharf is cheap when the voyage is a
 * month and ruinous when it is an afternoon. It wants no re-tuning per era,
 * per vehicle size, or per cargo, which a figure in days needs constantly.
 */
export const LOAD_PATIENCE_SHARE = 0.35;

/** Patience before a round trip has been measured, in days. */
export const LOAD_PATIENCE_DAYS = 12;
