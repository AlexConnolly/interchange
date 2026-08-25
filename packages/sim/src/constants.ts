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
/*
 * The calendar, and the one honest thing to say about it.
 *
 * Any transport game has a contradiction between two clocks. A vehicle has to
 * take tens of seconds to make a journey you can watch, and the calendar has
 * to advance fast enough for progression. At realistic road speeds those are
 * incompatible by two orders of magnitude, and no setting of these numbers
 * fixes it. The old draft picked one and wrote a whole document apologising.
 *
 * The answer here is to stop showing the player a unit they can do arithmetic
 * with. The player-facing unit is the **week**; accounts are monthly; there is
 * no day in the interface at all. A day exists below here purely as the bucket
 * that per-day rates are charged against, and because nothing displays it,
 * nobody can notice that a lorry covers more ground in one than it should.
 *
 * A six-day week is therefore not a claim about anything. It is the divisor
 * that makes a week a round number of ticks, and it is invisible.
 *
 * Three runs a week is a real pattern for a dedicated haulage contract, so the
 * numbers the player *can* see are not absurd. Speeds are shown in mph as
 * flavour and never beside a duration.
 */
/*
 * Four times what it was, and the *reason* it is this number and not the tick
 * rate is the whole point.
 *
 * "The days need to be about four times as long as how they are now — things
 * need to feel a lot longer." The obvious lever is the clock: run fewer ticks a
 * second. But a tick is also how far a lorry moves, so slowing the clock slows
 * the traffic, and slowing the traffic divides the money earned per real minute
 * by four — undoing a balance pass done an hour earlier.
 *
 * Lengthening the *day* instead leaves ticks a second alone. Vehicles keep
 * their speed and their earnings per real minute; everything expressed per day
 * — production, upkeep, loading waits, the contract board — scales with the day
 * and so is unchanged per tick. All that actually changes is how much of a day
 * a journey is, which is exactly what was asked for: a haul used to be most of a
 * day and is now an hour or two of one.
 *
 * A day is a little over four real minutes at thirteen ticks a second.
 */
export const TICKS_PER_DAY = 3200;
export const DAYS_PER_WEEK = 6;
export const WEEKS_PER_MONTH = 4;
export const DAYS_PER_MONTH = DAYS_PER_WEEK * WEEKS_PER_MONTH;
export const MONTHS_PER_YEAR = 12;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;
export const TICKS_PER_WEEK = TICKS_PER_DAY * DAYS_PER_WEEK;
export const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR;

/*
 * One era, 1985 to 1995. decisions.md D7.
 *
 * The old span was 1860 to 2100 across eight eras, and it was the single
 * largest source of difficulty in the project: it multiplied content eightfold
 * and produced a class of bug nothing else could - era-gated baskets, rates
 * flat against tenfold cost growth, starting capital frozen at 1860 levels.
 * What it was buying was a sense of advancement, and that job belongs to the
 * purchase ladder instead.
 *
 * The mid-eighties for one non-aesthetic reason: privatisation. Buying
 * infrastructure off the state is a real transaction of that decade and would
 * be fiction in almost any other.
 */
export const START_YEAR = 1985;
export const END_YEAR = 1995;

/** Speed multipliers the player can select. Index 0 is paused. */
/*
 * Speed multipliers. Index 0 is paused, and there is deliberately no 20x.
 *
 * At twenty times a game day passes in two seconds, which is not a day and a
 * night, it is a strobe — so the sun had to be given its own clock and the
 * light stopped agreeing with the calendar. At five times a day is a hundred
 * and sixty seconds, which is a cycle you can watch, so the sun can run on the
 * game clock at every speed the player can select.
 *
 * The campaign is ten years and about six hours at five times, which does not
 * need a fourth gear.
 */
export const SPEED_STEPS = [0, 1, 2, 5] as const;

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

/** The era the box arrives. design.md's era table puts containerisation at the
 *  head of era five, with the deep-water ports it needed. */
export const CONTAINER_ERA = 5;

/**
 * How much faster a container-capable vehicle loads afterwards.
 *
 * Containerisation was not a speed improvement, it was a *handling*
 * improvement, and the historical figure is closer to a hundredfold than to
 * three. Three is what the game can absorb: this multiplies straight into the
 * round trip of every container fleet, and a hundred would make everything
 * else in the region irrelevant overnight rather than merely obsolete.
 */
export const CONTAINER_TRANSFER_GAIN = 3;

/**
 * The condition the authority keeps its own ways at.
 *
 * Deliberately mediocre. A public road is passable and no better, and the gap
 * between it and what a private owner who is spending money maintains is one
 * of the quieter reasons to want to own one.
 */
export const PUBLIC_STANDARD = 150;

/**
 * How much the posted charge for crossing somebody's way is multiplied by.
 *
 * The whole design is that owning the road somebody drives on turns their cost
 * into your income, and that only means anything if the cost is worth having.
 * It was not. Access charges came to about three per cent of a haulier's
 * outgoings, so a road could never pay back what it cost to buy: across three
 * seeds, every chartered company in the region valued every one of eighty-odd
 * available ways at zero or less, and the ownership spine — the thing this
 * game is about — simply never started.
 *
 * The immediate cause is a number I moved and did not follow through. Early
 * balancing raised HAUL_BASE from two hundred to five hundred and sixty to
 * make carriage pay at all, and left the charges in the content where they
 * were, so passage got cheaper against carriage by a factor of nearly three
 * on top of a ratio that was already too low.
 *
 * Applied here rather than by editing every publicCharge in the JSON, because
 * the figures there are readable as pence per tile and should stay that way;
 * this is one number that says what a mile of somebody else's road is worth
 * against a mile of carriage, and it belongs beside HAUL_BASE conceptually
 * even though it lives here.
 */
export const ACCESS_SCALE = 3;

/** Days a company may sit with no fleet and no means of getting one before the
 *  region stops pretending it is still trading. Three years. */
export const STALLED_DAYS = DAYS_PER_YEAR * 3;

/** The era the parcel arrives at the door rather than the shop. design.md's
 *  era table puts e-commerce at the head of era six, with the logistics. */
export const ECOMMERCE_ERA = 6;

/**
 * How much of a town's shopping moves from the shop to the doorstep.
 *
 * Large enough that a network built for pallets to a few retail parks is
 * visibly the wrong shape for parcels to every town, which is what features.md
 * means by the freight pattern inverting. Not total, because the high street
 * did not disappear either.
 */
export const ECOMMERCE_SHIFT = 0.55;

/**
 * How far a works has to be from a town before the town stops being an
 * industrial one. towncharacter.ts.
 *
 * Sight rather than catchment: what makes a place industrial is the chimney
 * you can see from the high street, not the one twenty miles off that happens
 * to employ people who live there.
 */
export const INDUSTRY_SIGHT = 9;

/** How many characters a town can have. sites.ts TownCharacter. */
export const CHARACTER_COUNT = 5;

/**
 * What a new operator starts with, as a multiple of the cheapest vehicle they
 * could buy that year.
 *
 * Enough for one vehicle and most of a second, which is deliberately thin: a
 * carrier who can buy three lorries on their first morning has no decision to
 * make about which route to open. It is also the figure that stops the region
 * emptying, so it is a floor rather than a target — see world.startingCapital.
 */
export const ENTRANT_CAPITAL = 1.8;
