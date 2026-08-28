/**
 * The content schema. content-and-balance.md §2: the schema is a hard
 * contract, so generated content cannot break the engine. Worst case it is
 * boring, and boring is caught by review.
 *
 * Everything the balance harness tunes lives behind one of these types, which
 * is what makes a rebalance a JSON edit rather than a rebuild.
 */

import { z } from 'zod';

// ------------------------------------------------------------------ cargo

export const CargoTier = z.enum(['extraction', 'processing', 'terminal', 'passenger', 'networked', 'negative']);

/** How a cargo has to be handled. A vehicle and a terminal must both support
 *  the class or the transfer is refused. */
export const HandlingClass = z.enum(['bulk', 'liquid', 'general', 'refrigerated', 'hazardous', 'container', 'people', 'wired']);

export const CargoDef = z.object({
  id: z.string(),
  name: z.string(),
  tier: CargoTier,
  handling: HandlingClass,
  /** Tonnes per unit volume — drives which vehicles are efficient at it. */
  density: z.number().int().min(1).max(100),
  /** Percent lost per game day in transit. Zero for almost everything. */
  perishability: z.number().min(0).max(100).default(0),
  /** Base price per tonne, in pence. Contract rates are struck against this. */
  basePrice: z.number().int().min(1),
  /** Era in which the cargo first exists at all. */
  fromEra: z.number().int().min(1).max(8).default(1),
  /** Semantic colour for overlays and the cargo-flow ribbons. */
  colour: z.string().regex(/^#[0-9a-f]{6}$/i),
});
export type CargoDef = z.infer<typeof CargoDef>;

// --------------------------------------------------------------- vehicles

export const VehicleClass = z.enum([
  'dray', 'lorry', 'artic', 'tanker', 'tipper', 'van',
  'bus', 'coach', 'tram',
  'loco', 'wagon', 'unit',
  'barge', 'coaster', 'bulker', 'container-ship', 'ferry',
  'light-freight', 'airliner', 'widebody', 'drone',
]);

export const Mode = z.enum(['road', 'rail', 'water', 'air', 'pipe', 'wire', 'conveyor']);

export const VehicleDef = z.object({
  id: z.string(),
  name: z.string(),
  mode: Mode,
  class: VehicleClass,
  era: z.number().int().min(1).max(8),
  /** Year it stops being sold. Existing ones keep running, badly. */
  obsoleteYear: z.number().int().default(9999),
  /** Tonnes, or passengers for a people-carrier. */
  capacity: z.number().int().min(0),
  handling: z.array(HandlingClass).min(1),
  /** Sim speed in Q16.16 tiles per tick. See docs/scale.md — this is tuned
   *  for legibility and is deliberately not derived from displayKph. */
  speed: z.number().int().min(1),
  /** What the UI tells the player. Flavour, not physics. */
  displayKph: z.number().int().min(1),
  /** Purchase price in pence. */
  cost: z.number().int().min(0),
  /** Running cost in pence per game day, whether moving or not. */
  runningCost: z.number().int().min(0),
  /** Cells the vehicle occupies in the traffic model. A rake is longer. */
  cells: z.number().int().min(1).max(24).default(1),
  /** Tonnes of load and unload per tick at a terminal. */
  transferRate: z.number().int().min(1).default(2),
  /** Reliability 0..100. Below 100, breakdowns happen and cost money. */
  reliability: z.number().int().min(1).max(100).default(90),
  /** Model builder id in the art package. */
  model: z.string(),
});
export type VehicleDef = z.infer<typeof VehicleDef>;

// ------------------------------------------------------------------- eras

export const EraDef = z.object({
  n: z.number().int().min(1).max(8),
  name: z.string(),
  from: z.number().int(),
  to: z.number().int(),
  blurb: z.string(),
  /** Ids unlocked when the era opens: vehicles, road classes, industries. */
  unlocks: z.array(z.string()).default([]),
});
export type EraDef = z.infer<typeof EraDef>;

// ------------------------------------------------------------- industries

export const IndustryRecipe = z.object({
  /** Cargo id to tonnes consumed per production cycle. */
  inputs: z.record(z.string(), z.number().int().min(1)).default({}),
  outputs: z.record(z.string(), z.number().int().min(1)).default({}),
  /** Ticks per production cycle at full supply. */
  period: z.number().int().min(1),
});

export const IndustryDef = z.object({
  id: z.string(),
  name: z.string(),
  /** extraction sites sit on a deposit; processing and terminal do not. */
  /*
   * `amenity` is a building with no trade at all: a green, a park, a playing
   * field. It consumes nothing, produces nothing, and exists for its effect on
   * the people living around it — which is why it needs a kind of its own rather
   * than an empty recipe on a terminal. Half the simulation asks "what does this
   * place want" and the honest answer for a park is "nothing", including the road
   * access every trading site needs to operate.
   */
  kind: z.enum(['extraction', 'processing', 'terminal', 'utility', 'tourism', 'amenity']),
  /** Deposit index it must be founded on, if extraction. */
  deposit: z.number().int().min(0).default(0),
  recipe: IndustryRecipe,
  /** Tiles per side of the site footprint. */
  footprint: z.number().int().min(1).max(8).default(2),
  /** Cost to found, in pence. Act III onward. */
  foundCost: z.number().int().min(0).default(0),
  /**
   * Hands back what it was given, rather than turning it into something else.
   *
   * design.md §4 defines a distribution centre as "a business whose output is
   * its input", and that is not expressible as a recipe: a recipe consumes in
   * order to produce. So it is a flag, and the two functions that ask a site
   * what it has spare and who would take it read it. Everything else —
   * contracts, buyers, suppliers, the panel — then works on a depot without
   * containing the word depot anywhere.
   */
  passThrough: z.boolean().optional().default(false),
  /**
   * Sells what it takes in, over a counter, to nobody in particular.
   *
   * The one place that needs no buyer arranged. It cannot be inferred from
   * "makes nothing", which was the first attempt: a concrete plant makes
   * nothing either, and a concrete plant is not a shop — it was cheerfully
   * retailing aggregate to the public.
   */
  retail: z.boolean().optional().default(false),
  /** Three-network requirement, design.md §2.2. Zero means not required yet. */
  powerNeed: z.number().int().min(0).default(0),
  waterNeed: z.number().int().min(0).default(0),
  labourNeed: z.number().int().min(0).default(0),
  /** Amenity penalty and its radius in tiles, design.md §2.3. */
  amenityPenalty: z.number().int().min(0).default(0),
  amenityRadius: z.number().int().min(0).default(0),
  /**
   * What putting one up does to what the parish thinks of you, and how far.
   *
   * Signed: a village shop is welcome, an abattoir is not. Its own number rather
   * than the amenity penalty above, because pollution and unpopularity are
   * different things and the two clearest cases in the district disagree about
   * which is which — a quarry is the worst amenity penalty in the game and sits
   * out in the hills where nobody lives, and a distribution centre has an amenity
   * penalty of 2 and would be the most resented building in the parish.
   *
   * The radius is in tiles and is honest about it. See `approval.ts`.
   */
  approvalImpact: z.number().int().default(0),
  approvalRadius: z.number().int().min(0).default(0),
  /**
   * How well the parish must think of you *at that spot* before you may build it.
   *
   * Zero for anything nobody minds. Set against a resting approval of 30: at rest
   * a player may put up a farm, a shop or a filling station and not a creamery,
   * and the heavy end of the list wants a neighbourhood you have actually improved.
   */
  approvalNeed: z.number().int().min(0).max(100).default(0),
  fromEra: z.number().int().min(1).max(8).default(1),
  /** Kit id in the art package; three visual states come from the same kit. */
  kit: z.string(),
  colour: z.string().regex(/^#[0-9a-f]{6}$/i),
});
export type IndustryDef = z.infer<typeof IndustryDef>;

// ------------------------------------------------------- infrastructure

export const WayClass = z.object({
  id: z.string(),
  name: z.string(),
  mode: Mode,
  era: z.number().int().min(1).max(8),
  /** Speed ceiling in Q16.16 tiles per tick, before condition is applied. */
  speedLimit: z.number().int().min(1),
  lanes: z.number().int().min(1).max(12).default(1),
  /** Pence per tile to build on flat ground. */
  buildCost: z.number().int().min(0),
  /** Pence per tile per game year. */
  upkeep: z.number().int().min(0),
  /** Condition lost per thousand vehicle passes. Drives decay. */
  wear: z.number().int().min(0).default(10),
  /** Default access charge the authority sets, pence per vehicle per tile. */
  publicCharge: z.number().int().min(0).default(0),
  /**
   * Steepest gradient the formation may climb, in height units per tile.
   * This is what makes rail feel different from road: a lorry shrugs at a
   * one-in-ten and a locomotive cannot start on one, so a railway has to find
   * the valley and a road can go over the top.
   */
  maxGradient: z.number().int().min(1).default(60),
  /**
   * Minimum radius, in tiles. Zero means the way turns on the spot, which is
   * true of a road and not of a railway.
   */
  minRadius: z.number().int().min(0).default(0),
  /** Multiplier on build cost when the formation is carried on structure
   *  rather than sitting on the ground, in percent. */
  bridgeCostPct: z.number().int().min(100).default(600),
  tunnelCostPct: z.number().int().min(100).default(1200),
  colour: z.string().regex(/^#[0-9a-f]{6}$/i),
});
export type WayClass = z.infer<typeof WayClass>;

// --------------------------------------------------------------- balance

/**
 * Every number the balance sweep is allowed to move. Keeping them in one
 * object rather than scattered through the systems is what makes an overnight
 * parameter sweep possible at all.
 */
export const Balance = z.object({
  startingCash: z.number().int(),
  /**
   * The cargo the game opens on.
   *
   * Named in the content rather than found by the generator, because the
   * founding image of this game is a milk run from a farm to a dairy and an
   * image that important cannot be left to a seed. `planOpening` prefers a pair
   * trading this and falls back to the nearest workable pair if the district has
   * none, so an odd map still starts sensibly.
   */
  openingCargo: z.string(),
  /** Annual interest on debt, in basis points. */
  interestBps: z.number().int(),
  /** Credit limit as a multiple of trailing annual revenue, in percent. */
  creditLimitPct: z.number().int(),
  /** Contracts on offer at once, and how often a new one appears. */
  contractSlots: z.number().int(),
  contractIntervalDays: z.number().int(),
  /** Penalty as a percent of contract value when a deadline is missed. */
  latePenaltyPct: z.number().int(),
  /** Reliability weighting when a contract is awarded, 0..100. */
  reliabilityWeight: z.number().int(),
  /** Asset valuation: multiple of trailing annual net revenue, in percent.
   *  design.md §3.3 — the second snowball damper. */
  valuationPct: z.number().int(),
  /** What a tonne into a business of your own is worth, against the same tonne
   *  hauled for hire. 150 means half again. */
  ownTradePct: z.number().int(),
  /** And what a tonne collected from your gate by the buyer is worth, against
   *  hauling it there yourself. Under 100: they deduct the cost of the lorry. */
  gateSalePct: z.number().int(),
  /** How sharply traffic abandons an overpriced way. Higher is more elastic.
   *  design.md §3.3 — the first and primary damper. */
  tollElasticity: z.number().int(),
  /** Value of time, pence per tick, used to turn a route's time cost into
   *  money so access charges and journey time compare on one scale. */
  valueOfTime: z.number().int(),
  /** Industry service satisfaction thresholds, percent. design.md §4.3. */
  declineBelowPct: z.number().int(),
  closeBelowPct: z.number().int(),
  declineDays: z.number().int(),
  graceDays: z.number().int(),
  /** Town growth response. */
  townGrowthPerDay: z.number().int(),
  /** Regulation trigger: market share percent that summons the regulator. */
  regulatorSharePct: z.number().int(),
});
export type Balance = z.infer<typeof Balance>;

// ---------------------------------------------------------------- bundle

export const ContentBundle = z.object({
  cargo: z.array(CargoDef),
  vehicles: z.array(VehicleDef),
  /*
   * One era, and the length is checked rather than left open because a bundle
   * with two eras in it would be a half-reverted content cut and should fail
   * loudly rather than quietly gate half the vehicles behind a decade that
   * never arrives. decisions.md D7.
   */
  eras: z.array(EraDef).length(1),
  industries: z.array(IndustryDef),
  ways: z.array(WayClass),
  balance: Balance,
});
export type ContentBundle = z.infer<typeof ContentBundle>;

/**
 * Validate and cross-check. Zod gets the shapes; this gets the references,
 * which is where generated content actually goes wrong — a recipe naming a
 * cargo that was renamed two files away passes every shape check there is.
 */
export function validateBundle(raw: unknown): ContentBundle {
  const b = ContentBundle.parse(raw);
  const cargoIds = new Set(b.cargo.map((c) => c.id));
  const errors: string[] = [];

  const seen = new Set<string>();
  for (const list of [b.cargo, b.vehicles, b.industries, b.ways] as { id: string }[][]) {
    for (const item of list) {
      if (seen.has(item.id)) errors.push(`duplicate id "${item.id}"`);
      seen.add(item.id);
    }
  }
  for (const ind of b.industries) {
    for (const k of Object.keys(ind.recipe.inputs)) {
      if (!cargoIds.has(k)) errors.push(`industry "${ind.id}" consumes unknown cargo "${k}"`);
    }
    for (const k of Object.keys(ind.recipe.outputs)) {
      if (!cargoIds.has(k)) errors.push(`industry "${ind.id}" produces unknown cargo "${k}"`);
    }
  }
  // Numbered from one and contiguous, however many there are. The count is
  // checked by the schema above; this checks there are no gaps, which matters
  // because the sim resolves an era by index.
  const eraNumbers = b.eras.map((e) => e.n).sort((x, y) => x - y);
  for (let i = 0; i < eraNumbers.length; i++) {
    if (eraNumbers[i] !== i + 1) errors.push(`era ${i + 1} is missing`);
  }
  // A cargo nobody produces or nobody consumes is dead content — the balance
  // harness looks for this too, but catching it at load is free.
  const produced = new Set<string>();
  const consumed = new Set<string>();
  for (const ind of b.industries) {
    for (const k of Object.keys(ind.recipe.outputs)) produced.add(k);
    for (const k of Object.keys(ind.recipe.inputs)) consumed.add(k);
  }
  for (const c of b.cargo) {
    if (c.tier === 'networked' || c.tier === 'passenger') continue;
    if (!produced.has(c.id)) errors.push(`cargo "${c.id}" is produced by nothing`);
    if (!consumed.has(c.id) && c.tier !== 'terminal' && c.tier !== 'negative') {
      errors.push(`cargo "${c.id}" is consumed by nothing`);
    }
  }
  if (errors.length) throw new Error('content validation failed:\n  ' + errors.join('\n  '));
  return b;
}
