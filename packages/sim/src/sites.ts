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
  /**
   * Shut on purpose, by the owner.
   *
   * Its own state rather than a flag on `Mothballed`, because the two are
   * opposite things that happen to stop the same machinery. Mothballed is a
   * business *failing* — it got there because nobody was taking what it made,
   * and it dies after the grace period. Paused is a business being *managed*: it
   * stops buying stock in, stops making, costs less to hold, and waits
   * indefinitely because somebody decided it should.
   *
   * Sharing one state would mean either a deliberate pause quietly dying after
   * sixty days or a failing works living for ever, and both are worse than a
   * fifth entry in an enum.
   */
  Paused: 4,
} as const;
export type SiteState = (typeof SiteState)[keyof typeof SiteState];

export const STATE_NAMES = ['thriving', 'struggling', 'dead', 'mothballed', 'paused'] as const;

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
  /**
   * 0..100, rolling. How often this site had what it needed to run.
   *
   * The input-side counterpart of `satisfaction`, and its absence was a real
   * hole. Satisfaction is only recomputed *when a cycle completes*, so a works
   * with nothing in its sheds never touched it: measured, a creamery cut off
   * from milk sat at a hundred per cent, state Thriving, having made nothing for
   * ninety days. Every decay rule in the game reads satisfaction, so a place
   * starved of supply was in perfect health by every number the simulation had.
   *
   * A place with no inputs — a farm, a quarry — is always fed, which is what the
   * initial value means. Nothing else has to special-case them.
   */
  readonly fed = new Uint8Array(MAX_SITES).fill(100);
  /**
   * 1 if there is no road this site can be reached from.
   *
   * A business needs road access to *work*, not to be built — you may put a
   * creamery in the middle of your own field and it will stand there doing
   * nothing until you lay a track to it, which is a decision the game should let
   * you get wrong. So this is a gate on production rather than a rule about
   * placement, and it sits beside `powered` and `watered` because it is the same
   * kind of fact: a thing the site needs from the world around it.
   *
   * Recomputed by `World.rebuild`, which is called whenever the road network
   * changes — so laying the track starts the works, and lifting it stops them,
   * with nothing having to remember to ask.
   */
  readonly stranded = new Uint8Array(MAX_SITES);
  /** Consecutive days below the decline threshold. */
  readonly starvedDays = new Int32Array(MAX_SITES);
  /** Days since mothballing; past the grace period it is dead for good. */
  readonly mothballedDays = new Int32Array(MAX_SITES);
  /** Deposit richness 0..100 for extraction sites; scales output. */
  readonly richness = new Uint8Array(MAX_SITES);
  /**
   * Sold over the counter since anybody last collected the figure, per cargo.
   *
   * A queue rather than a running total, and drained by `sellOverTheCounter` in
   * the world. Sites are stepped in a module that deliberately knows nothing
   * about companies or money — it deals in stock and cycles — so the fact that
   * something sold is recorded here and *priced* somewhere that knows what a
   * pound is.
   */
  readonly counter: Int32Array;

  /** Production multiplier 0..100 from the three-network requirement. */
  readonly powered = new Uint8Array(MAX_SITES);
  readonly watered = new Uint8Array(MAX_SITES);
  readonly staffed = new Uint8Array(MAX_SITES);
  /**
   * How much of the local trade this counter actually gets, as a share of what
   * its recipe could get through. 1.0 is "as much as it can handle".
   *
   * Only a retail site reads it, and it is the fix for the plainest exploit the
   * game had: throughput was a property of the *building*. Measured before this
   * existed, one pub drank **nine tonnes of beer a day** in a district of 2,512
   * people — seven pints each, every day, for everybody — and nothing stopped
   * you building ten more and selling ninety. A village shop was the same, at
   * thirteen tonnes of produce a day.
   *
   * Demand comes from people, and there are only so many of them. See
   * `refreshTrade`.
   */
  readonly trade = new Float32Array(MAX_SITES).fill(1);

  /** What the surroundings are like, 0..100. Only tourism reads it, but every
   *  site carries it so the inspector can show the player what their pit has
   *  done to the valley. */
  readonly amenity = new Uint8Array(MAX_SITES).fill(100);
  /** Set from the recipe kind at alloc, so the hot paths do not have to reach
   *  into the content to ask. */
  readonly extraction = new Uint8Array(MAX_SITES);
  /*
   * The year the works was built or last rebuilt.
   *
   * features.md 4 asks for industry ageing and modernisation, and the point of
   * it is that a region cannot be finished. A works laid down in 1870 is still
   * a works in 1970 and it is not a *competitive* works, so somewhere along
   * the way its output falls away and either somebody spends money on it or
   * the trade moves to whoever did.
   */
  readonly built = new Int32Array(MAX_SITES);
  /**
   * 1 if the player put it up themselves, rather than finding it there or buying
   * it.
   *
   * Which is the difference between changing the district and changing hands.
   * Approval answers for what you *build*: buying the abattoir on the edge of the
   * village does not make the village any worse off — it was there and it already
   * smelt — whereas putting a new one up is a thing you did to them. Without this
   * column, buying a going concern would tank your standing for somebody else's
   * decision.
   */
  readonly raised = new Uint8Array(MAX_SITES);
  /** How modern it is, 0..100, recomputed from its age and its era. */
  readonly modernity = new Uint8Array(MAX_SITES).fill(100);
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
    this.counter = new Int32Array(MAX_SITES * cargoCount);
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
    this.fed[id] = 100;
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

  /** Does this site dig its output out of the ground, or make it from
   *  something somebody has to deliver? The difference decides whether a route
   *  to it keeps working when nobody else is doing anything. */
  isExtraction(site: number): boolean {
    return this.extraction[site] === 1;
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

  /** Tonnes of a cargo this site could still take. */
  roomFor(site: number, cargo: number): number {
    const i = site * this.cargoCount + cargo;
    return Math.max(0, this.capacity[i] - this.stock[i]);
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
  /*
   * Five columns went from here, each named after a file that does not exist:
   * `transitQuality` (transit.ts), `characterDrift` and `characterToward`
   * (towncharacter.ts), and `labourSupplied` / `labourDemand` for a labour
   * catchment pass. `cut.md` records the last of those as cut and probably right
   * to stay cut — *"a third network for an effect the growth model already
   * approximates"*. Nothing read any of them; two were fed to the hash, which is
   * how five dead columns stayed live-looking for so long.
   */
  /** Fractional population growth, accumulated so growth can be sub-integer. */
  readonly growthAcc = new Int32Array(MAX_TOWNS);
  /**
   * How many people the town has room for.
   *
   * Seeded from what it started at and raised by every house the player releases
   * land for. Which is the whole of the housing loop: haulage makes a town *want*
   * to grow and only houses let it, so a district doing well runs out of room and
   * the answer is on the land market.
   *
   * Not a hard ceiling — see `crowding`. A town over its capacity is crowded and
   * unhappy, not full. People do double up, and a rule that simply stopped the
   * number would be a wall with no explanation attached to it.
   */
  readonly capacity = new Int32Array(MAX_TOWNS);

  stock: Int32Array;
  demand: Int32Array;
  /*
   * Tonnes are whole numbers everywhere in this simulation, and a town's
   * appetite is not. A town of thirteen hundred people wants about a third of
   * a tonne of post a day; stored in the integer tables above that is zero,
   * every day, forever — which is why passengers and mail never moved a single
   * tonne in any balance sweep, and why an omnibus could be bought, crewed and
   * routed and still find nothing at the stop. These carry the fraction over
   * from one day to the next so whole tonnes come out at the right rate.
   */
  produceAcc: Float64Array;
  demandAcc: Float64Array;
  readonly cargoCount: number;

  constructor(cargoCount: number) {
    this.cargoCount = cargoCount;
    this.stock = new Int32Array(MAX_TOWNS * cargoCount);
    this.demand = new Int32Array(MAX_TOWNS * cargoCount);
    this.produceAcc = new Float64Array(MAX_TOWNS * cargoCount);
    this.demandAcc = new Float64Array(MAX_TOWNS * cargoCount);
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
    /*
     * Room for the size the town would reach on its own, and a little over.
     *
     * A multiple of the *starting* population cannot work, and both attempts at
     * one failed for the same reason: a town below `LOCAL_SUPPLY_POP` is fed by
     * its own fields whatever anybody hauls, so it grows with no player in the
     * game at all — and it grows toward a figure that has nothing to do with
     * where it started. Measured with a fifth of headroom, Oxwell went 647 to
     * 1009 in six months and Kirholm 455 to 1.38 times capacity, each earning
     * most of an eighteen-point approval penalty for doing nothing.
     *
     * So the ceiling is derived from the growth model instead of guessed at.
     * Growth stops when `served` falls through sixty, and for an unhauled town
     * `served` is `100 * LOCAL_SUPPLY_POP / pop` — so it settles at
     * `LOCAL_SUPPLY_POP / 0.6`, about 1270 people, whether it began at four
     * hundred or nine. That is the district's natural carrying capacity and it is
     * what a town has room for before anybody does anything.
     *
     * A tenth on top so arriving there is not itself a penalty. Everything past
     * it is the player's doing: a town already larger than that is *not*
     * self-supplying — its service rate sits in the dead band — so it holds still
     * until somebody hauls food in, and every person over capacity from then on
     * is growth you caused and room you have to find.
     */
    this.capacity[id] = Math.round(Math.max(population, NATURAL_POP) * 1.1);
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
  /** Amenity penalty a site emits, and how far it carries. design.md 2.3. */
  amenityPenalty: Int32Array;
  amenityRadius: Int32Array;
  /** Signed approval impact per industry def, its radius in tiles, and the local
   *  approval needed to put one up. See `approval.ts`. */
  approvalImpact: Int32Array;
  approvalRadius: Int32Array;
  approvalNeed: Int32Array;
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
  /**
   * A green, a park, a playing field: no trade of any kind.
   *
   * Its own kind rather than a terminal with an empty recipe, because half the
   * simulation asks a site what it wants and the honest answer here is "nothing".
   * That includes the road access every trading place needs before it can operate
   * — a park with no road to it is a park, not a stranded works.
   */
  Amenity: 5,
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
    /*
     * A paused works buys nothing in and makes nothing, which is the whole of
     * what pausing is for. Before the cycle counter, so it does not quietly
     * advance while shut and then produce a free batch the moment it reopens.
     */
    if (state === SiteState.Paused) continue;

    if (--sites.cycle[s] > 0) continue;
    const def = sites.def[s];
    sites.cycle[s] = r.period[def];

    /*
     * No road, no work. Before the three networks, because it is not a matter of
     * degree: a works nobody can drive to does not run at reduced output, it
     * stands idle. The cycle above has already been reset, so a site that gets
     * its track laid resumes on the next full cycle rather than instantly, which
     * is the right way round — building the road is the work, and the work takes
     * a moment to pay off.
     */
    if (sites.stranded[s]) continue;

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
    /*
     * And, for a resort, what the place is actually like.
     *
     * design.md 2.3 says tourism earns against local amenity, and this is the
     * line that makes that true: open a bauxite pit above a lake valley and
     * the resort down the shore stops filling its rooms. Nobody is told that
     * industrialising has a cost — they read it in their own accounts, having
     * built both.
     */
    const amenity = r.kind[def] === IndustryKind.Tourism ? sites.amenity[s] : 100;
    // And how old the plant is. An 1870 works still standing in 1970 does not
    // make what a 1970 works makes.
    const modern = Math.max(MIN_MODERNITY, sites.modernity[s]);
    const scale = (gate * health * richness * amenity * modern) / 10000000000;

    const ins = r.inputs[def];
    const outs = r.outputs[def];

    /*
     * Inputs, and whether they are needed *together*.
     *
     * A works that makes something is all-or-nothing: a creamery turns milk into
     * dairy, and a half-fed one must not silently eat its milk and produce
     * nothing. That is the rule this started as.
     *
     * A place that makes *nothing* is a different animal, and treating it the
     * same way was a bug with real consequences. A village shop takes milk,
     * dairy and beer; it is not assembling them into anything, it is selling
     * them over a counter, and there is no sense in which a crate of milk cannot
     * be sold because the beer has not arrived. Under the old rule it could not
     * sell anything at all until all three were in stock — so the shop filled up
     * with the one cargo you could supply, stopped having room, stopped
     * appearing as a buyer, and quietly left the game. The distribution centre,
     * which lists five inputs, was worse: it needed all five at once and in
     * practice never ran.
     *
     * So: a sink consumes each input independently, and a works consumes them
     * together. The distinction the code needed was already in the data.
     */
    const together = outs.length > 0;
    if (together) {
      let feasible = 1;
      for (let i = 0; i < ins.length; i += 2) {
        const need = Math.max(1, Math.round(ins[i + 1] * scale));
        if (sites.stockOf(s, ins[i]) < need) {
          feasible = 0;
          break;
        }
      }
      // Every cycle it wanted to run counts, whether it ran or not. This is the
      // one line that lets the rest of the game know a place is starving.
      if (ins.length > 0) {
        sites.fed[s] = Math.round((sites.fed[s] * 7 + (feasible ? 100 : 0)) / 8);
      }
      if (!feasible) continue;
      for (let i = 0; i < ins.length; i += 2) {
        sites.takeStock(s, ins[i], Math.max(1, Math.round(ins[i + 1] * scale)));
      }
    } else {
      let sold = 0;
      for (let i = 0; i < ins.length; i += 2) {
        /*
         * What a counter sells is capped by the people it can reach, split with
         * whatever else is selling the same thing to the same people.
         *
         * Without this, trade was a property of the building and the answer to
         * every question was another building. The floor is zero rather than one:
         * a shop with no catchment genuinely sells nothing, and rounding it up to
         * a tonne is how a hundred shops in an empty valley made a hundred tonnes
         * a day appear out of the ground.
         */
        const want = Math.max(0, Math.round(ins[i + 1] * scale * sites.trade[s]));
        if (want <= 0) continue;
        const have = sites.stockOf(s, ins[i]);
        if (have <= 0) continue;
        const took = Math.min(want, have);
        sites.takeStock(s, ins[i], took);
        sold += took;
        /*
         * And it goes over a counter, which is what makes a shop a shop.
         *
         * "The village shop is the only place where whatever you give to it, as
         * long as it's a thing, it always sells." Everything else in the district
         * needs a buyer arranged — a lorry to somebody's works, or a sale on the
         * market. A shop needs nobody: it faces the public, and the public turns
         * up on its own.
         *
         * Recorded per cargo rather than as a lump so the owner's accounts can say
         * what actually sold, and left for the world to price: this table knows
         * about stock and cycles and has no business knowing about money.
         */
        sites.counter[s * cargoCount + ins[i]] += took;
      }
      /*
       * Trade, counted. `produced` is what the place has turned over, and for a
       * shop that is what it sold: without this a shop's satisfaction and the
       * per-day figures in the panel would read zero however busy it was, and
       * the decay pass would eventually mothball a thriving shop for producing
       * nothing.
       */
      sites.produced[s] += sold;
      if (sold > 0) {
        sites.satisfaction[s] = Math.round((sites.satisfaction[s] * 7 + 100) / 8);
      }
      sites.fed[s] = Math.round((sites.fed[s] * 7 + (sold > 0 ? 100 : 0)) / 8);
      continue;
    }

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
    /*
     * A paused works does not decay, and does not die.
     *
     * Decay measures a business failing at its job; one that has been switched
     * off is not failing at anything. Leaving it in the pass would count every
     * day it was deliberately shut as a day nobody collected from it, so a
     * player who shut a creamery for a winter would come back to a ruin — which
     * would make the button a trap rather than a tool.
     */
    if (state === SiteState.Paused) continue;

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

    /*
     * Starving shows, and it does not kill.
     *
     * The distinction is deliberate and it is the whole of how `fed` is used.
     * *Nobody takes what you make* is a business with no customers, and that is
     * fatal — it mothballs, which is what the rules below do. *Nobody brings what
     * you need* is a business with no supplier, and that must not be fatal here:
     * one haulier cannot keep fifteen works supplied, so a district that closed
     * every unsupplied place would shut down around a player who was doing
     * nothing wrong. The works keeps its skeleton staff and waits.
     *
     * What it does instead is *show* — the place reads as struggling, which puts
     * it in front of the player as somewhere in trouble, and makes it cheap
     * (see `priceOf`). Buying a starved works and feeding it is meant to be the
     * profitable move, and it cannot be if the game hides which ones are starved.
     */
    if (sites.fed[s] < balance.declineBelowPct && sites.state[s] !== SiteState.Struggling) {
      sites.state[s] = SiteState.Struggling;
      continue;
    }

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
/**
 * How many people a town's own hinterland can supply, unaided.
 *
 * Deliberately an absolute number of people rather than a share of demand.
 * A share would make every town self-sufficient at every size, so towns would
 * grow forever whether or not anybody hauled anything — which is what the
 * first version of this did, taking the region from fifteen thousand to a
 * hundred and seventy-six thousand in thirty years with the carriers bankrupt
 * throughout.
 *
 * As a fixed capacity it does the opposite, and does the job the design needs:
 * a small town feeds itself, a large one cannot, and the gap between what a
 * town wants and what its own fields and pits can make is exactly the cargo
 * somebody has to carry. Equilibrium population is therefore a direct function
 * of tonnage delivered, which is the sentence the whole growth model is
 * supposed to mean. Set so that a starting town of eleven or twelve hundred
 * sits just under the decline threshold: left alone it slowly fades, and it
 * takes real haulage to turn that around.
 */
export const LOCAL_SUPPLY_POP = 760;

/**
 * The size a town reaches on its own, with nothing hauled to it.
 *
 * Not a tuning knob — it falls out of the two numbers above it. Growth turns off
 * when `served` drops through sixty, and an unhauled town's service rate is
 * `100 * LOCAL_SUPPLY_POP / pop` because what it wants and what its hinterland
 * supplies are linear in the same per-thousand weight and cancel. Set the one
 * equal to the other and the town settles here.
 *
 * It exists so `capacity` can be seeded from it. See `TownTable.alloc`.
 */
export const NATURAL_POP = Math.round(LOCAL_SUPPLY_POP / 0.6);

/** Years before a works is noticeably behind the times. */
export const MODERN_LIFE_YEARS = 45;

/** However old it gets, a works never falls below this share of its output —
 *  it is obsolete, not derelict, and derelict is what decay is for. */
export const MIN_MODERNITY = 42;

/**
 * Age every works by a year.
 *
 * Separate from decay, which is about being unserved: a works nobody collects
 * from is failing at its job, and a works built in 1870 is doing its job
 * perfectly well by 1870 standards. They deserve different curves and
 * different remedies — one wants a lorry, the other wants capital.
 */
export function ageSites(sites: SiteTable, year: number): void {
  for (let s = 0; s < sites.count; s++) {
    if (sites.state[s] === SiteState.Dead) continue;
    const age = Math.max(0, year - sites.built[s]);
    const wear = Math.min(100 - MIN_MODERNITY, Math.round((age / MODERN_LIFE_YEARS) * (100 - MIN_MODERNITY)));
    sites.modernity[s] = 100 - wear;
  }
}

/**
 * How crowded a town is, as a share of its capacity. 1.0 is exactly full.
 *
 * A ratio rather than a stored number, because it is a division of two figures the
 * town already carries and a third copy could disagree with them.
 */
export function crowding(towns: TownTable, t: number): number {
  const cap = towns.capacity[t];
  if (cap <= 0) return 1;
  return towns.population[t] / cap;
}

/**
 * What is left of a town's growth as it approaches its capacity: 1 with room to
 * spare, nothing once it is half again over.
 *
 * Linear from full, so the last of the growth goes gradually. Past 1.5 the town
 * has as many people as it can hold and then some, and the only thing that moves
 * it is somewhere for them to live.
 */
export function roomLeft(towns: TownTable, t: number): number {
  return Math.max(0, Math.min(1, (1.5 - crowding(towns, t)) / 0.5));
}

export function stepTowns(
  towns: TownTable,
  demandPerThousand: Float64Array,
  producePerThousand: Float64Array,
  growthPerDay: number,
  /**
   * How much more of a cargo *this* town wants than the average.
   *
   * Passed in rather than computed here, because what a place is like is a fact
   * about the world and this table knows only about tonnes. Defaults to flat, so
   * a caller that does not care gets the old uniform district.
   */
  taste: (town: number, cargo: number) => number = () => 1,
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
      /*
       * People choose. features.md 2: they will not take a slow miserable
       * route — they stay home, or from era four they drive. So a town does
       * not produce passengers for whoever happens to turn up; it produces
       * the ones a service is good enough to win.
       */
      const made = (per * pop) / 1000;
      const i = t * cargoCount + c;
      // People will wait for a bus, but not indefinitely: a few days of
      // departures and then they walk, and the town notices.
      const cap = Math.max(12, Math.round(made * 20));
      towns.produceAcc[i] += made;
      const whole = Math.floor(towns.produceAcc[i]);
      if (whole > 0) {
        towns.produceAcc[i] -= whole;
        towns.stock[i] = Math.min(cap, towns.stock[i] + whole);
      }
    }
    let wanted = 0;
    let met = 0;
    for (let c = 0; c < cargoCount; c++) {
      if (demandPerThousand[c] === 0) continue;
      /*
       * Taste multiplies what the town wants *and* what its own fields supply,
       * because `LOCAL_SUPPLY_POP` is a number of people rather than a number of
       * tonnes — a village that drinks half again as much beer does not grow half
       * again as much of it. Applying it to one side only would quietly turn a
       * preference into a permanent shortfall and make every working town
       * unservable.
       */
      const per = demandPerThousand[c] * taste(t, c);
      // Fractional on purpose. Rounding each cargo up to a whole tonne a day
      // put a floor under a small town's basket that was larger than the
      // basket, so every town wanted a dozen tonnes a day whatever its size.
      const need = (per * pop) / 1000;
      const i = t * cargoCount + c;
      towns.demand[i] = Math.max(1, Math.ceil(need));
      wanted += need;
      // What the hinterland makes of this cargo, which it can only do up to
      // the size of hinterland there is.
      const local = Math.min(need, (per * LOCAL_SUPPLY_POP) / 1000);
      const shortfall = Math.max(0, need - local);
      // Satisfaction is measured against what is available today, not against
      // the whole tonnes drawn below: a town short of half a tonne is half a
      // tonne short, and rounding that to nothing or to one would make the
      // growth curve a staircase.
      met += local + Math.min(shortfall, towns.stock[i]);
      towns.demandAcc[i] += shortfall;
      const draw = Math.floor(towns.demandAcc[i]);
      if (draw > 0) {
        towns.demandAcc[i] -= draw;
        towns.stock[i] = Math.max(0, towns.stock[i] - draw);
      }
    }
    /*
     * Local supply, and why a town is not starving on day one.
     *
     * A region of fifteen thousand people in 1860 already eats. It has a
     * market, a carrier's cart, a coal merchant — everything a town needs to
     * subsist without a single one of the player's lorries. Counting only
     * hauled tonnes against the whole basket said otherwise: every town in the
     * region opened at sixty per cent served, fell to twenty-three inside a
     * year, and the population collapsed from fifteen thousand to eight
     * hundred by the fifth. The carriers were then hauling to towns too small
     * to want anything, which is why the opening looked like a haulage-rate
     * problem when it was a demand-model problem.
     *
     * So the baseline is what the town does for itself, and haulage is the
     * increment on top. Set just under the decline threshold: a town nobody
     * serves slowly shrinks, and it takes real tonnage to make one grow.
     */
    const rate = wanted > 0 ? Math.min(100, Math.round((met * 100) / wanted)) : 100;
    towns.served[t] = Math.round((towns.served[t] * 9 + rate) / 10);

    // Above sixty a town grows, below forty it shrinks, between the two it
    // holds. The dead band is what stops a town oscillating around a
    // threshold and the population reading as noise.
    const served = towns.served[t];
    let delta = 0;
    if (served > 60) delta = ((served - 60) * growthPerDay) / 40;
    else if (served < 40) delta = -((40 - served) * growthPerDay) / 40;
    /*
     * And growth slows as the town fills up.
     *
     * Tapered rather than capped, and it is the difference between a mechanic and
     * a wall. A hard ceiling would stop the number dead with nothing on screen to
     * say why; a taper means a town at capacity still creeps, still wants its
     * deliveries, and the *reason* it has stopped moving is a crowded parish that
     * the player can read off the approval panel and fix with a field.
     *
     * Shrinking is never tapered. A town losing people is not short of room.
     */
    if (delta > 0) delta *= roomLeft(towns, t);
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
  // Character is a slow variable that changes what a town wants, so a client
  // that disagreed about it would diverge on trade a decade later rather than
  // on the tick it went wrong. It goes in the hash for the same reason
  // population does.
  h.array(towns.character, towns.count);
  // Capacity is slow and it gates growth, so a client that disagreed about it
  // would diverge on population a decade later rather than on the tick it went
  // wrong. Same argument as `character`.
  h.array(towns.capacity, towns.count);
  h.array(towns.stock, towns.count * towns.cargoCount);
}

export { AUTHORITY, TICKS_PER_DAY };
