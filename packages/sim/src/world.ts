/**
 * The world: every table, the tick loop, and the command handlers.
 *
 * The tick order is a contract, not an implementation detail. Commands land
 * before anything moves, path results land at their appointed tick before
 * traffic reads them, traffic runs before production so a delivery made this
 * tick is available to the factory this tick, and the daily and monthly passes
 * run last so they see a settled world. Reorder any of it and two machines
 * that disagree about nothing will still diverge.
 */

import {
  ACCEL, AUTHORITY, CELLS_PER_TILE, Control, DIR_BIT, DIR_DX, DIR_DY,
  DIR_OPPOSITE, FLOW_WINDOW, HASH_INTERVAL, MAX_COMPANIES, MAX_VEHICLES,
  MAX_NODES, MODE_COUNT, MODE_NAMES, Mode, PATH_LATENCY_TICKS, SPEED_STEPS, START_YEAR,
  TICKS_PER_DAY, TICKS_PER_YEAR, DAYS_PER_MONTH, DAYS_PER_YEAR, ECONOMY_SCALE, ECOMMERCE_ERA, ECOMMERCE_SHIFT, LOAD_PATIENCE_DAYS, LOAD_PATIENCE_SHARE, CONTAINER_ERA, CONTAINER_TRANSFER_GAIN, PUBLIC_STANDARD, ENTRANT_CAPITAL, DAYS_PER_WEEK,
  ACCESS_SCALE, STALLED_DAYS,
} from './constants.ts';
import { Cmd, CommandQueue, type Command } from './commands.ts';
import {
  CompanyTable, Charter, Line, LINE_COUNT,
  ServiceTable, StopAction, MAX_STOPS, ENTRANT_NAMES, hashEconomy, SITE_PRICE_SCALE, haulageRate, HAUL_ALLOWANCE, RATE_WEIGHT_BY_TIER, CHARTER_REQUIREMENTS, stepFinance,
  JOURNAL, MoneyKind, GATE_WEEKLY_TONNES, GATE_REFERENCE_TILES,
  MARKET_TERMS, MAX_PENDING_SALES, RETAIL_PCT, GOODS_SCALE,
  type MarketOffer,
} from './economy.ts';
import { FX_ONE, fx, fxDiv, fxMul } from './fixed.ts';
import { Hasher } from './hash.ts';
import { ContractBoard, ContractState, offerContracts } from './contracts.ts';
import { InfluenceField, type InfluenceSource } from './influence.ts';
import {
  Facility, FACILITY_COST, MAX_YARDS, YardTable, canBase, facilitiesFor, refusalText,
} from './yards.ts';
import {
  Fitting, FITTING_COST, SNOW_STOPS, snowCover, stoppedBySnow,
} from './fittings.ts';
import { AmenityField, stepAmenity, REMEDIATION_PRICE, REMEDIATION_FROM_ERA } from './amenity.ts';
import {
  AssetTable, Graph, NONE, NO_WAY, WayLayer, hashNetwork, rebuildGraph,
} from './network.ts';
import { Router, type RouteCosts } from './pathfinding.ts';
import { TileRouter } from './tilerouter.ts';
import {
  Crop, GROWING, NEEDS_WORK, arableStage, grassStage, isWood, springSown,
} from './fields.ts';
import { Heap } from './heap.ts';
import {
  APPROVAL_DRIFT_PER_DAY, APPROVAL_PER_LOAD, APPROVAL_REST, PARISH_PER_DAY,
  PLANNING_FROM_VEHICLES,
  WORKS_APPROVAL, Works, levyGain,
} from './planning.ts';
import { Rng } from './rng.ts';
import {
  IndustryKind, SiteState, SiteTable, TownTable, hashSites, stepSiteDecay, ageSites,
  stepSites, stepTowns, type RecipeTables,
} from './sites.ts';
import { DEPOSIT_NAMES, TileFlag, generateTerrain, SEA_LEVEL, type Terrain, type WorldConfig } from './terrain.ts';
import { alignForRadius, layAlignment, planAlignment, removeWayTile, LOCK_LIFT, type Alignment } from './construction.ts';
import {
  VState, VehicleTable, buildNodeGeometry, projectVehicles, stepTraffic,
  type NodeGeometry, type TrafficStats,
} from './traffic.ts';
import type { Content } from '@interchange/data';

/** Links a single vehicle route may hold. Beyond this the route is truncated
 *  and re-requested at the far end, which costs a path request and never a
 *  wrong turn. */
export const ROUTE_STRIDE = 64;

interface PathRequest {
  vehicle: number;
  fromNode: number;
  toNode: number;
  dueTick: number;
  /** Routing is per mode: a lorry cannot use a railway. */
  mode: number;
}

export interface TickReport {
  tick: number;
  traffic: TrafficStats;
  produced: number;
  delivered: number;
  pathRequests: number;
  hash: number | null;
}

/**
 * What share of a widening scheme the haulier who wanted it puts in.
 *
 * A tenth. The full build cost of a sixteen-tile spur is nearly six hundred
 * thousand pounds, which against a district where a good year is thirty-five is
 * not a goal, it is a wall — and it is also not what happens: a parish widens
 * its own lane and the firm that wanted it widened contributes. A tenth puts a
 * scheme at about forty thousand, which is a real decision at the point the
 * board opens.
 */
const WIDEN_SHARE = 0.1;

/**
 * What a track on your own land costs, against the catalogue price.
 *
 * A fifth, where a parish widening is a tenth. The board's share is small
 * because the parish is paying most of it out of the rates and you are only
 * contributing; on your own field there is nobody else to pay, so it costs you
 * more per tile and is still cheap in absolute terms — a track is £340,000 in
 * the catalogue, so eight tiles of it is about £545,000 against a lorry at
 * £18,000. Expensive enough to be a decision, cheap enough to be reachable
 * around the time you buy your first business.
 */
const TRACK_SHARE = 0.2;

/** Shared empty, so the common case allocates nothing. */
const EMPTY_EARNINGS: { x: number; z: number; pence: number }[] = [];

export class World {
  readonly config: WorldConfig;
  readonly content: Content;
  readonly terrain: Terrain;

  readonly layers: WayLayer[] = [];
  readonly graph = new Graph();
  readonly assets = new AssetTable();
  readonly vehicles: VehicleTable;
  readonly sites: SiteTable;
  readonly towns: TownTable;
  readonly companies = new CompanyTable();
  readonly services = new ServiceTable();
  /** Tonnes moved per cargo, per company, for the balance sweep. */
  movedByCargo: Float64Array;
  readonly queue = new CommandQueue();
  readonly rng: Rng;

  readonly router: Router;
  tileRouter: TileRouter;

  tick = 0;
  /** Index into SPEED_STEPS. Zero is paused. Not simulation state — it
   *  controls how many ticks the host runs, never what a tick does. */
  speed = 1;
  /** Which company the local player is. */
  player = 1;

  /** Camera focus, fed in as a command. Used only by the LOD sleep rules. */
  focusX = 0;
  focusY = 0;

  private routePool = new Int32Array(MAX_VEHICLES * ROUTE_STRIDE);
  private pathQueue: PathRequest[] = [];
  private geometry: (NodeGeometry | null)[] = [];
  private geometryVersion = -1;

  /** Cached derived tables so the hot loops never touch strings. */
  private waySpeed = new Int32Array(64);
  private wayUpkeep = new Int32Array(64);
  /** The authority's posted charge per tile, scaled — see ACCESS_SCALE. */
  private wayCharge = new Int32Array(64);
  private wayWear = new Int32Array(64);
  private wayLanes = new Int32Array(64);
  private vehicleSpeed = new Int32Array(256);
  private vehicleCapacity = new Int32Array(256);
  private vehicleTransfer = new Int32Array(256);
  private vehicleRunning = new Float64Array(256);
  /** Which layer each vehicle type runs on. Public because the renderer
   *  needs it to stand a vehicle on its own formation. */
  readonly vehicleMode = new Uint8Array(256);
  private cargoPrice = new Int32Array(64);
  private recipes: RecipeTables;

  /**
   * Work on offer. design.md 2 — this is the interaction, not a route editor.
   *
   * Offers only appear inside the influence area, so the fog and the job board
   * are the same mechanism seen twice: what you can see is what you can take,
   * and there is never an offer you have to be told you cannot have.
   */
  readonly contractBoard = new ContractBoard();

  /** What you can see, and therefore what you can work in. influence.ts. */
  readonly influence: InfluenceField;

  /** Yards you own, and what each one can take. yards.ts. */
  readonly yards = new YardTable();
  /** Which yard each vehicle is based at. */
  readonly vehicleYard = new Int16Array(4096).fill(-1);
  /** What the region is like to be in, and what industry has done to it.
   *  design.md 2.3. */
  readonly amenity: AmenityField;
  /*
   * What each *tile* mostly carries, and how much.
   *
   * Kept per tile rather than per link because a link is not a stable thing:
   * every road the authority lays renumbers them, and the cargo ribbons were
   * wiped several times a decade by construction that had nothing to do with
   * them. A tile is a tile for the whole game.
   */
  readonly tileCargo: Uint8Array;
  readonly tileTonnes: Float32Array;
  private lastEra = 0;
  private entrantDue = 0;
  private airLaid = false;
  private containerised = false;
  private cargoRateWeight = new Float64Array(256).fill(1);
  private townDemandPerThousand: Float64Array;
  private townWant: Record<string, number> = {};
  private townSend: Record<string, number> = {};
  private basketEra = 0;
  /** Character multipliers, flattened to (character, cargo). */
  private appetite = new Float64Array(0);
  private touristCargo = -1;
  private passengerCargo = -1;
  private townProducePerThousand: Float64Array;
  private routeCosts: RouteCosts;

  /** Access tiles, so sites and towns survive a graph rebuild. */
  siteAccessTile: Int32Array;
  /** What each vehicle has fitted. A `Fitting` bitmask. */
  vehicleFittings: Int32Array;
  /**
   * What the parish thinks of you, 0..100. design.md §3's last rung.
   *
   * Not a currency and not a tech tree: a number that gates one kind of action,
   * rises by being useful, and drifts back if you stop. See planning.ts.
   */
  approval = APPROVAL_REST;
  /**
   * Money the player has just been paid, and where the lorry was standing.
   *
   * Drained by the client each frame — see `takeEarnings`. It exists because
   * earning was invisible: the figure in the corner changed, which is a fact
   * rather than an event, and nothing in the game ever said *there you are*.
   */
  private readonly earned: { x: number; z: number; pence: number }[] = [];
  townAccessTile: Int32Array;
  /** Reverse lookups for delivery: node id to site or town. */
  private nodeSiteOf = new Map<number, number>();
  private nodeTownOf = new Map<number, number>();


  /**
   * The last thing each company created, so a command can refer to it without
   * predicting its id.
   *
   * A command that creates something cannot return the id — the log has to be
   * replayable without running the game to find out. Predicting `count` at
   * issue time works right up until two issuers create something on the same
   * tick, at which point both predict the same id and the second one's
   * follow-up commands attach to the first one's object. Four rival companies
   * spent twelve years building services for each other and went bankrupt.
   */
  readonly lastService = new Int32Array(MAX_COMPANIES).fill(NONE);
  readonly lastVehicle = new Int32Array(MAX_COMPANIES).fill(NONE);

  /** Where a vehicle's current load was picked up, for the distance premium. */
  private lapStart = new Int32Array(MAX_VEHICLES);
  private loadOriginX = new Int32Array(MAX_VEHICLES);
  private loadOriginY = new Int32Array(MAX_VEHICLES);

  hashes: { tick: number; hash: number }[] = [];
  stats = {
    delivered: 0,
    tonnesMoved: 0,
    pathRequests: 0,
    pathsResolved: 0,
    lastTickMs: 0,
  };

  constructor(config: WorldConfig, content: Content) {
    this.config = config;
    this.content = content;
    this.rng = new Rng(config.seed);
    this.terrain = generateTerrain(config);
    this.tileRouter = new TileRouter(this.terrain);

    for (let m = 0; m < MODE_COUNT; m++) this.layers.push(new WayLayer(m, config.size));

    this.vehicles = new VehicleTable(MAX_VEHICLES);
    this.sites = new SiteTable(content.cargo.length);
    this.towns = new TownTable(content.cargo.length);
    this.siteAccessTile = new Int32Array(4000).fill(NONE);
    /*
     * Fittings live beside the vehicle table rather than in it.
     *
     * `VehicleTable` is the hot loop's data — position, cell, speed, route —
     * and it is laid out to be walked linearly sixty times a second. A field
     * read once a tick per vehicle by one predicate does not belong in that
     * cache line. Same reasoning as `vehicleYard`.
     */
    this.vehicleFittings = new Int32Array(this.vehicles.x.length);
    this.movedByCargo = new Float64Array(MAX_COMPANIES * content.cargo.length);
    this.townAccessTile = new Int32Array(64).fill(NONE);

    // ---- derived tables -------------------------------------------------
    content.ways.forEach((w, i) => {
      this.waySpeed[i] = w.speedLimit;
      this.wayUpkeep[i] = w.upkeep;
      this.wayCharge[i] = Math.round(w.publicCharge * ACCESS_SCALE);
      this.wayWear[i] = w.wear;
      this.wayLanes[i] = w.lanes;
    });
    content.vehicles.forEach((v, i) => {
      this.vehicleMode[i] = Math.max(0, MODE_NAMES.indexOf(v.mode as never));
      this.vehicleSpeed[i] = v.speed;
      this.vehicleCapacity[i] = v.capacity;
      this.vehicleTransfer[i] = v.transferRate;
      this.vehicleRunning[i] = v.runningCost;
    });
    content.cargo.forEach((c, i) => {
      this.cargoPrice[i] = c.basePrice;
      this.cargoRateWeight[i] = RATE_WEIGHT_BY_TIER[c.tier] ?? 1;
    });

    const n = content.industries.length;
    this.recipes = {
      inputs: [],
      outputs: [],
      period: new Int32Array(n),
      kind: new Uint8Array(n),
      powerNeed: new Int32Array(n),
      waterNeed: new Int32Array(n),
      labourNeed: new Int32Array(n),
      fromEra: new Uint8Array(n),
      cargoFromEra: new Uint8Array(content.cargo.length),
      amenityPenalty: new Int32Array(content.industries.length),
      amenityRadius: new Int32Array(content.industries.length),
      // Era 3 is when transmission lines and treatment works first exist, so
      // it is the earliest era in which the requirement could be met.
      networkFromEra: 3,
    };
    content.cargo.forEach((c, i) => {
      this.recipes.cargoFromEra[i] = c.fromEra;
    });
    content.industries.forEach((ind, i) => {
      const flat = (rec: Record<string, number>): Int32Array => {
        const out: number[] = [];
        // Sorted by cargo index so the iteration order is a property of the
        // content and not of the object literal's key order.
        const pairs = Object.entries(rec)
          .map(([k, v]) => [content.cargoIndex.get(k) ?? 0, v] as [number, number])
          .sort((a, b) => a[0] - b[0]);
        for (const [c, v] of pairs) out.push(c, v);
        return Int32Array.from(out);
      };
      this.recipes.inputs[i] = flat(ind.recipe.inputs);
      this.recipes.outputs[i] = flat(ind.recipe.outputs);
      this.recipes.period[i] = ind.recipe.period * ECONOMY_SCALE;
      this.recipes.kind[i] =
        ind.kind === 'extraction' ? IndustryKind.Extraction
        : ind.kind === 'processing' ? IndustryKind.Processing
        : ind.kind === 'utility' ? IndustryKind.Utility
        : ind.kind === 'tourism' ? IndustryKind.Tourism
        : IndustryKind.Terminal;
      this.recipes.powerNeed[i] = ind.powerNeed;
      this.recipes.waterNeed[i] = ind.waterNeed;
      this.recipes.labourNeed[i] = ind.labourNeed;
      this.recipes.fromEra[i] = ind.fromEra;
      this.recipes.amenityPenalty[i] = ind.amenityPenalty;
      this.recipes.amenityRadius[i] = ind.amenityRadius;
    });

    /*
     * What a thousand townspeople want per day — for the era they live in.
     *
     * The table below is the full modern basket, and applying all of it from
     * 1860 was quietly fatal. A town's satisfaction is met-over-wanted across
     * every cargo it wants, so wanting electronics and petrol in 1860 put a
     * hard ceiling of about seventy per cent on a town nobody could raise, and
     * since a town shrinks below fifty-five, every town in the region shrank
     * from the first day. Smaller towns want less, so the sinks got smaller,
     * so the carriers earned less, and the whole opening was a slow collapse
     * that read as a haulage-rate problem.
     *
     * Gated by the cargo's own era, the basket grows as the century does,
     * which is both correct and the thing that makes town growth a reward for
     * running a *varied* network rather than a big one.
     */
    this.townWant = {
      goods: 6, food: 8, coal: 5, textiles: 2, planks: 2, cement: 2,
      paper: 1, glass: 1, fuel: 2, electronics: 1, luxury: 1, retail: 3,
      /*
       * Beer, which a village wants rather more of than it wants glass.
       *
       * Worth saying that most of the keys above no longer name anything: this
       * basket is inherited from the two-century spec and of its twelve entries
       * only `fuel` still matches a cargo in the trimmed content, so the lookup
       * quietly skips the rest. That is not a bug — an unknown id is meant to be
       * skipped, and the district's economy is deliberately business-to-business
       * with the village shop as its retail end. But it does mean a town's
       * shopping list is currently one line long, and beer is the second.
       */
      beer: 4,
      // Visitors, which a town wants far more of in August than in February.
      // Seasonally scaled where the basket is consumed rather than here, so
      // the number in this table stays a plain annual average.
      tourists: 4,
    };
    this.townSend = { passengers: 9, mail: 2 };
    this.townDemandPerThousand = new Float64Array(content.cargo.length);
    this.townProducePerThousand = new Float64Array(content.cargo.length);
    this.touristCargo = content.cargoIndex.get('tourists') ?? -1;
    this.passengerCargo = content.cargoIndex.get('passengers') ?? -1;
    this.rebuildTownBasket(1);

    this.routeCosts = { speedLimit: this.waySpeed, valueOfTime: content.balance.valueOfTime };
    this.tileCargo = new Uint8Array(this.config.size * this.config.size).fill(255);
    this.tileTonnes = new Float32Array(this.config.size * this.config.size);
    this.amenity = new AmenityField(this.config.size);
    this.router = new Router(MAX_COMPANIES, 100000);
    this.influence = new InfluenceField(this.config.size);
  }

  // ------------------------------------------------------------- calendar

  get day(): number {
    return (this.tick / TICKS_PER_DAY) | 0;
  }

  /**
   * Where in the day the district starts, as a fraction.
   *
   * The clock used to live entirely in the client, which was fine for as long as
   * the time of day was only a thing to *look* at — the sun's angle and when the
   * windows come on. It is not fine now that it decides who is allowed to drive:
   * two clocks, one in the renderer and one in the simulation, drifting apart by
   * whatever offset the client happened to apply, is a bug waiting for someone to
   * ask why the yard is shut at noon.
   *
   * So the world owns it and the client reads it. Set once, at startup.
   */
  dayOffset = 0;

  /** How far through the day it is. Zero is six in the morning, as `HOUR` has it. */
  get dayFraction(): number {
    const t = (this.tick + TICKS_PER_DAY * this.dayOffset) % TICKS_PER_DAY;
    return ((t % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY / TICKS_PER_DAY;
  }

  /** The hour on the clock, 0 to 24. */
  get hourOfDay(): number {
    return (this.dayFraction * 24 + 6) % 24;
  }

  /**
   * Is the fleet parked for the night?
   *
   * Haulage is a day job. Lorries ran through the small hours because nothing
   * had ever said they should not, and it made the night pointless: the one
   * stretch of the day where the district is supposed to be still had the entire
   * fleet grinding round it with headlamps on.
   *
   * Six to eight, which is a long day and meant to be — this is 1985, before
   * tachograph enforcement got serious, and a fourteen-hour day was ordinary.
   * It is also most of the daylight, so what the player watches is a district
   * that wakes up, works, and goes quiet, rather than one that never stops.
   *
   * The cost is real: it removes about two fifths of the running time, and the
   * haulage rate is raised to match — see `HAUL_BASE`. A rate that pays for a
   * fourteen-hour day rather than a twenty-four-hour one is the *same* rate in
   * every sense the player can see, and the ladder is measured in minutes of
   * play rather than in loads.
   */
  get fleetParked(): boolean {
    const h = this.hourOfDay;
    return h < 6 || h >= 20;
  }

  get year(): number {
    return START_YEAR + ((this.tick / TICKS_PER_YEAR) | 0);
  }

  get month(): number {
    return ((this.day % DAYS_PER_YEAR) / DAYS_PER_MONTH) | 0;
  }

  get dayOfMonth(): number {
    return this.day % DAYS_PER_MONTH;
  }

  /** The week of the month, 0..3. The only sub-monthly unit the player sees. */
  get weekOfMonth(): number {
    return ((this.day % DAYS_PER_MONTH) / DAYS_PER_WEEK) | 0;
  }

  /**
   * Rebuild the town basket for an era. Cheap, and called only when the era
   * turns over, so the cost is a handful of times in a whole game.
   */
  private rebuildTownBasket(era: number): void {
    if (this.basketEra === era) return;
    this.basketEra = era;
    this.townDemandPerThousand.fill(0);
    this.townProducePerThousand.fill(0);
    for (const [id, v] of Object.entries(this.townWant)) {
      const i = this.content.cargoIndex.get(id);
      if (i === undefined || this.content.cargo[i].fromEra > era) continue;
      /*
       * Last-mile, from era six. features.md 6: "demand shifts from shops to
       * doorsteps; freight pattern inverts."
       *
       * The inversion is the point and it is why this is a shift in the
       * *basket* rather than a new cargo. Retail stock is what a shop takes in
       * by the pallet, so serving it is a few large deliveries to a few places
       * — and a carrier who has spent forty years building for that finds the
       * same tonnage arriving as goods wanted at every town instead. The
       * network that was right for one is the wrong shape for the other.
       */
      let want = v;
      if (era >= ECOMMERCE_ERA) {
        if (id === 'retail') want = v * (1 - ECOMMERCE_SHIFT);
        if (id === 'goods') want = v * (1 + ECOMMERCE_SHIFT);
      }
      this.townDemandPerThousand[i] = want / ECONOMY_SCALE;
    }
    // And what a town sends out. Passengers are wanted by other towns as well
    // as produced, so they appear in both tables — which is what makes a
    // commuter service a round trip that pays in both directions rather than a
    // full run out and an empty run back.
    for (const [id, v] of Object.entries(this.townSend)) {
      const i = this.content.cargoIndex.get(id);
      if (i === undefined || this.content.cargo[i].fromEra > era) continue;
      this.townProducePerThousand[i] = v / ECONOMY_SCALE;
      this.townDemandPerThousand[i] = Math.max(this.townDemandPerThousand[i], (v * 0.8) / ECONOMY_SCALE);
    }
  }




  /**
   * Money in and out, place by place, with a reason attached.
   *
   * "I really want to see financials... it shows all outbound and inbound money
   * and the time and an explanation of WHAT the transaction was." The ledger
   * already had totals per line per company, which answers "how am I doing" and
   * cannot answer "was buying that creamery a mistake" — for that you need the
   * events, attributed to the place they happened at.
   *
   * A ring buffer, because this is a record for *reading* rather than a source of
   * truth: cash is authoritative, and if a busy fleet pushes the oldest rows out
   * of the window nothing is lost that the accounts depend on. Sized so a
   * reasonably busy district holds a few weeks.
   *
   * Deliberately *not* in the hash and not in the save. It is derived from things
   * that are both, so replaying a log reproduces it, and putting it in the
   * determinism hash would make a display convenience a correctness constraint.
   */
  private readonly journalTick = new Int32Array(JOURNAL);
  private readonly journalSite = new Int32Array(JOURNAL).fill(NONE);
  private readonly journalPence = new Float64Array(JOURNAL);
  private readonly journalKind = new Uint8Array(JOURNAL);
  private readonly journalCargo = new Int32Array(JOURNAL).fill(NONE);
  private readonly journalTonnes = new Float64Array(JOURNAL);
  private journalHead = 0;
  private journalCount = 0;

  /**
   * Write one line into it. `pence` signed: out is negative, in is positive.
   *
   * Signed rather than a separate in/out flag so the panel can sum a column
   * without knowing what any of the kinds mean.
   */
  private note(
    site: number, kind: MoneyKind, pence: number, cargo = NONE, tonnes = 0,
  ): void {
    const i = this.journalHead;
    this.journalTick[i] = this.tick;
    this.journalSite[i] = site;
    this.journalPence[i] = pence;
    this.journalKind[i] = kind;
    this.journalCargo[i] = cargo;
    this.journalTonnes[i] = tonnes;
    this.journalHead = (i + 1) % JOURNAL;
    if (this.journalCount < JOURNAL) this.journalCount++;
  }

  /**
   * What happened at this place, newest first.
   *
   * Walked backwards from the write head so the caller gets recent history
   * without sorting, and capped because a panel showing four hundred rows is a
   * panel nobody reads.
   */
  moneyAt(site: number, max = 40): {
    tick: number; pence: number; kind: MoneyKind; cargo: number; tonnes: number;
  }[] {
    const out: {
      tick: number; pence: number; kind: MoneyKind; cargo: number; tonnes: number;
    }[] = [];
    for (let n = 0; n < this.journalCount && out.length < max; n++) {
      const i = (this.journalHead - 1 - n + JOURNAL * 2) % JOURNAL;
      if (this.journalSite[i] !== site) continue;
      out.push({
        tick: this.journalTick[i],
        pence: this.journalPence[i],
        kind: this.journalKind[i] as MoneyKind,
        cargo: this.journalCargo[i],
        tonnes: this.journalTonnes[i],
      });
    }
    return out;
  }

  /** In and out since the beginning, for the summary line above the list. */
  moneyTotals(site: number): { in: number; out: number } {
    let inn = 0;
    let out = 0;
    for (let n = 0; n < this.journalCount; n++) {
      const i = (this.journalHead - 1 - n + JOURNAL * 2) % JOURNAL;
      if (this.journalSite[i] !== site) continue;
      if (this.journalPence[i] >= 0) inn += this.journalPence[i];
      else out -= this.journalPence[i];
    }
    return { in: inn, out };
  }

  get era(): number {
    const y = this.year;
    for (let i = this.content.eras.length - 1; i >= 0; i--) {
      if (y >= this.content.eras[i].from) return this.content.eras[i].n;
    }
    return 1;
  }

  /**
   * The date, as the player is allowed to see it.
   *
   * Weeks and months, never a day. constants.md has the reasoning: a day is a
   * rate bucket rather than a unit, and the moment one is printed next to a
   * speed the arithmetic stops working. "Week 2, Mar 1985" is legible, is what
   * a haulage office would actually say, and cannot be divided into anything
   * that contradicts a lorry.
   */
  /**
   * A tick, as a date somebody could read on a docket.
   *
   * Week, month and the clock — and no day number, for the reason `dateString`
   * gives below: a day is a rate bucket in this game rather than a unit, and a
   * transaction list is not a good enough reason to break a rule that holds
   * everywhere else. Week plus time of day orders a morning's work in sequence,
   * which is what a ledger column is actually for.
   */
  stampOf(tick: number): string {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = Math.floor(tick / TICKS_PER_DAY);
    const year = 1985 + Math.floor(day / DAYS_PER_YEAR);
    const month = Math.floor((day % DAYS_PER_YEAR) / DAYS_PER_MONTH);
    const week = Math.floor((day % DAYS_PER_MONTH) / 6) + 1;
    // Six in the morning is zero on the dial — see HOUR in evening.ts.
    const mins = Math.floor(((tick % TICKS_PER_DAY) / TICKS_PER_DAY) * 1440 + 6 * 60) % 1440;
    const hh = Math.floor(mins / 60);
    const mm = String(mins % 60).padStart(2, '0');
    return `Wk ${week}, ${months[month]} ${year} · ${hh}:${mm}`;
  }

  dateString(): string {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `Week ${this.weekOfMonth + 1}, ${months[this.month]} ${this.year}`;
  }

  // ------------------------------------------------------------ the graph

  /** Retrace the network and re-attach everything that points into it. */
  rebuild(): void {
    // Anything cached off the road network or the fleet dies here. See
    // `contractPerHour`: it is an A* the interface asks for dozens of times a
    // second, and it is only valid until one of those two changes.
    this.perHourCache.clear();
    // Anywhere a service can stop has to be a graph node on every mode that
    // reaches it, or a siding laid past a colliery is traced straight through
    // and the colliery is invisible to the railway.
    for (let s = 0; s < this.sites.count; s++) {
      const tile = this.siteAccessTile[s];
      if (tile === NONE) continue;
      for (const layer of this.layers) if (layer.cls[tile] !== NO_WAY) layer.terminal[tile] = 1;
    }
    for (let t = 0; t < this.towns.count; t++) {
      const tile = this.townAccessTile[t];
      if (tile === NONE) continue;
      for (const layer of this.layers) if (layer.cls[tile] !== NO_WAY) layer.terminal[tile] = 1;
    }
    rebuildGraph(this.graph, this.layers, this.assets, this.wayLanes);
    this.geometryVersion = -1;
    this.router.clear();
    this.nodeSiteOf.clear();
    this.nodeTownOf.clear();
    for (let s = 0; s < this.sites.count; s++) {
      const tile = this.siteAccessTile[s];
      for (let m = 0; m < MODE_COUNT; m++) {
        const node = tile === NONE ? NONE : this.graph.nodeAt(m, tile);
        this.sites.setNode(s, m, node);
        if (node !== NONE) {
          this.nodeSiteOf.set(node, s);
          this.graph.nodeSite[node] = s;
        }
      }
    }
    for (let t = 0; t < this.towns.count; t++) {
      const tile = this.townAccessTile[t];
      for (let m = 0; m < MODE_COUNT; m++) {
        const node = tile === NONE ? NONE : this.graph.nodeAt(m, tile);
        this.towns.setNode(t, m, node);
        if (node !== NONE) this.nodeTownOf.set(node, t);
      }
    }

    // Any vehicle on the network has lost its link. Park it at the nearest
    // node and let it re-plan; teleporting it a few tiles once per build is
    // far better than the alternatives, and it is deterministic.
    for (let id = 0; id < this.vehicles.count; id++) {
      if (!this.vehicles.alive[id]) continue;
      if (this.vehicles.state[id] === VState.Travelling || this.vehicles.state[id] === VState.Queued) {
        this.vehicles.link[id] = NONE;
        this.vehicles.speed[id] = 0;
        this.vehicles.routeLen[id] = 0;
        this.vehicles.state[id] = VState.Idle;
      }
    }
  }

  private ensureGeometry(): void {
    if (this.geometryVersion === this.graph.version) return;
    this.geometry = new Array(this.graph.nodeCount).fill(null);
    for (let n = 0; n < this.graph.nodeCount; n++) {
      const outs = this.graph.nodeOutStart[n + 1] - this.graph.nodeOutStart[n];
      if (outs >= 2) this.geometry[n] = buildNodeGeometry(this.graph, n, this.config.size);
    }
    this.geometryVersion = this.graph.version;
  }

  // ------------------------------------------------------------- the tick

  step(): TickReport {
    const t0 = Date.now();
    this.tick++;
    const report: TickReport = {
      tick: this.tick, traffic: { moving: 0, queued: 0, crossings: 0, admitted: 0, blocked: 0 },
      produced: 0, delivered: 0, pathRequests: 0, hash: null,
    };

    // 1. commands
    for (const c of this.queue.drain(this.tick)) this.apply(c);

    // 2. path results, at their appointed tick and never on arrival
    this.resolvePaths();

    // 3. stops: loading, unloading, and deciding where to go next
    report.delivered = this.stepStops();

    // 4. traffic
    this.ensureGeometry();
    report.traffic = stepTraffic(
      this.graph, this.assets, this.vehicles, this.routePool,
      this.vehicleSpeed, this.waySpeed, this.tick, this.config.size, this.geometry,
      (v, node) => this.onArrive(v, node),
      (v, link) => this.onEnterLink(v, link),
      (link, vehicle) => this.linkConditions(link, vehicle),
    );

    // 5. production
    report.produced = stepSites(this.sites, this.recipes, this.era, this.tick).producedTonnes;

    // 6. daily
    if (this.tick % TICKS_PER_DAY === 0) this.stepDay();

    // 7. flow window
    if (this.tick % FLOW_WINDOW === 0) {
      this.assets.rollWindow();
      for (let l = 0; l < this.graph.linkCount; l++) {
        this.graph.linkFlowPrev[l] = this.graph.linkFlow[l];
        this.graph.linkFlow[l] = 0;
        this.graph.linkTonnesPrev[l] = this.graph.linkTonnes[l];
        this.graph.linkTonnes[l] = 0;
        // Decay rather than reset, so the dominant cargo on a link is what has
        // been going along it lately rather than whatever passed most recently.
        this.graph.linkCargoTonnes[l] *= 0.6;
      }
      // A charge is only meaningful against settled traffic, so this is where
      // routing gets told the cost graph may have moved.
      this.router.invalidate();
    }

    // 8. determinism hash
    if (this.tick % HASH_INTERVAL === 0) {
      const h = this.hash();
      report.hash = h;
      this.hashes.push({ tick: this.tick, hash: h });
      if (this.hashes.length > 4096) this.hashes.shift();
    }

    report.pathRequests = this.pathQueue.length;
    this.stats.lastTickMs = Date.now() - t0;
    return report;
  }

  /**
   * Standing orders, settled once a week.
   *
   * The hole this fills: owning a producer earned nothing at all unless you
   * personally drove its output somewhere. "If you own the arable farm and
   * there's a dependency from the local shop, I shouldn't have to have a lorry
   * going to them — that should just be a thing." Quite: a farm with a creamery
   * down the lane has a customer whether or not you fancy the drive. The customer
   * sends its own lorry and takes the cost of doing so out of what it pays you,
   * which is the whole of why this is worth less than hauling it yourself.
   *
   * That gives ownership three rates instead of one, and they are a ladder the
   * player can climb without being told about it:
   *
   *   **45%** — they collect. Money for nothing, and the least of it.
   *   **100%** — you carry it to somebody else. The ordinary fare.
   *   **150%** — you carry it into a place of your own. See `ownTradePct`.
   *
   * So the reward for buying a lorry is not that the goods start moving; it is
   * that you stop paying somebody else to move them. Which is the argument the
   * game has been trying to make since the beginning, finally attached to a
   * number.
   *
   * The goods really move. Stock leaves your shed and arrives in theirs, which is
   * what keeps this honest — a weekly cheque with no lorry behind it would be an
   * invented income, and this is a trade that would have happened anyway.
   *
   * Weekly rather than daily because the player has to be able to *see* it: one
   * line in the Money tab saying where a week's output went beats a dribble of
   * pence every four minutes.
   */
  private settleStandingOrders(): void {
    const cargoCount = this.content.cargo.length;
    const pct = this.content.balance.gateSalePct / 100;
    for (let s = 0; s < this.sites.count; s++) {
      if (this.sites.owner[s] !== this.player) continue;
      const tile = this.siteAccessTile[s];
      if (tile === NONE || !this.influence.usable(tile)) continue;
      const outs = this.recipes.outputs[this.sites.def[s]];
      for (let i = 0; i < outs.length; i += 2) {
        const cargo = outs[i];
        const have = this.sites.stockOf(s, cargo);
        if (have <= 0) continue;

        const buyer = this.buyerFor(cargo, s);
        if (buyer === NONE) continue;
        /*
         * How much they take, which is the smallest of three things: what you
         * have, what they can hold, and what they can get through in a week.
         *
         * The last is the one that makes this a supply chain rather than a tap.
         * A shop that eats thirteen tonnes a week does not order forty however
         * much you have standing about, so a farm outgrowing its local customer
         * is a real situation the player can find themselves in — and the answer
         * to it is a lorry and a further buyer.
         */
        const ins = this.recipes.inputs[this.sites.def[buyer]];
        let eats = 0;
        for (let k = 0; k < ins.length; k += 2) {
          if (ins[k] !== cargo) continue;
          eats = (ins[k + 1] * TICKS_PER_DAY * DAYS_PER_WEEK)
            / Math.max(1, this.recipes.period[this.sites.def[buyer]]);
        }
        if (eats <= 0) continue;
        const room = this.sites.capacity[buyer * cargoCount + cargo]
          - this.sites.stockOf(buyer, cargo);
        /*
         * And a fourth limit, which is the one that keeps this from breaking the
         * game: *somebody still has to drive it*.
         *
         * Without it the order was the buyer's entire weekly appetite, and a
         * creamery gets through more in a week than three lorries can carry — so
         * owning eight producers paid a million and a half a month for nothing,
         * measured, against an opening balance of eleven thousand. Free money
         * that scaled with businesses owned and had no lorry anywhere in it.
         *
         * A buyer collecting from you sends *one van, once*. Twenty-four tonnes is
         * exactly what one small van moves in a week — measured: two round trips
         * a day at two tonnes — so a standing order is worth about half of what
         * your own lorry would earn on the same route, and the whole of the
         * argument for buying the lorry survives.
         */
        const tonnes = Math.floor(Math.min(have, room, eats, GATE_WEEKLY_TONNES));
        if (tonnes <= 0) continue;

        const dx = this.sites.x[buyer] - this.sites.x[s];
        const dy = this.sites.y[buyer] - this.sites.y[s];
        const distance = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)));
        /*
         * A farm-gate price, and it does *not* rise with distance.
         *
         * The first version paid a fraction of the haulage rate over the actual
         * distance, which is backwards and expensively so: the fare rises steeply
         * with the length of the run, `buyerFor` picks whoever has the most room
         * rather than whoever is nearest, and the result was that a *distant*
         * customer paid you more for sitting still. Measured: one dairy farm
         * earned thirty thousand a week and paid for itself in a fortnight,
         * against an opening balance of eleven and a half thousand.
         *
         * A gate price is a price for *goods*. The transport is the buyer's
         * problem and they take it out of what they hand over, so distance can
         * only ever make this worse — hence a short reference haul for the value
         * and a deduction, up to half, for how far they have to come. Which also
         * means owning a producer next to its customer is worth more than owning
         * one across the district, and that is a fact about the map the player can
         * act on.
         */
        const rate = haulageRate(
          this.cargoPrice[cargo], GATE_REFERENCE_TILES, this.cargoRateWeight[cargo],
        );
        const carriage = 1 - Math.min(0.5, distance / 60);
        const pence = Math.round(rate * tonnes * pct * carriage);

        this.sites.takeStock(s, cargo, tonnes);
        this.sites.addStock(buyer, cargo, tonnes);
        this.companies.post(this.player, Line.Trading, pence);
        this.note(s, MoneyKind.Gate, pence, cargo, tonnes);
      }
    }
  }

  /**
   * What a tonne of something is worth, before anybody haggles.
   *
   * Derived from the content rather than authored, and the derivation is the
   * point: a thing is worth what went into it. A cargo with no recipe behind it —
   * milk out of a cow, stone out of a hole — is worth its own `basePrice`, and
   * anything made from other things is worth the sum of what it consumes plus a
   * margin for the making. So dairy is dearer than milk because it took six milk
   * to make four dairy, and nobody had to type that in.
   *
   * This is also the "what did it cost me to produce" figure the market shows,
   * seen from the other side: the value of a thing's inputs *is* what it cost to
   * make, in a game where the inputs are the only cost.
   */
  valueOf(cargo: number): number {
    if (cargo < 0 || cargo >= this.valueCache.length) return 0;
    if (this.valueCache[cargo] > 0) return this.valueCache[cargo];
    const base = (this.content.cargo[cargo]?.basePrice ?? 0) * GOODS_SCALE;
    // Set before recursing, so a recipe that consumes what it makes terminates
    // instead of eating the stack. No content should do that; content is data.
    this.valueCache[cargo] = base;
    let best = base;
    for (const ind of this.content.industries) {
      const made = ind.recipe.outputs[this.content.cargo[cargo].id];
      if (!made || made <= 0) continue;
      let inputs = 0;
      for (const [id, amount] of Object.entries(ind.recipe.inputs)) {
        const ci = this.content.cargoIndex.get(id);
        if (ci === undefined || ci === cargo) continue;
        inputs += this.valueOf(ci) * amount;
      }
      // A quarter on top for the making, which is the only thing in the game
      // that says processing is worth doing at all.
      const worth = Math.round((inputs / made) * 1.25) + base;
      if (worth > best) best = worth;
    }
    this.valueCache[cargo] = best;
    return best;
  }

  private readonly valueCache = new Float64Array(64);

  /** What the market will pay for a tonne, on each of the three terms. */
  marketOffers(cargo: number): MarketOffer[] {
    const value = this.valueOf(cargo);
    return MARKET_TERMS.map((t) => ({
      days: t.days,
      pence: Math.max(1, Math.round((value * t.multiple) / 100)),
    }));
  }

  /**
   * Everything you hold, cargo by cargo, wherever it is standing.
   *
   * Aggregated across places because that is the question the market asks — "how
   * much milk have you got" — and the answer does not depend on which shed it is
   * in. Where it is matters to a lorry and not to a buyer.
   */
  stockHeld(): { cargo: number; tonnes: number; value: number }[] {
    const cargoCount = this.content.cargo.length;
    const total = new Int32Array(cargoCount);
    for (let s = 0; s < this.sites.count; s++) {
      if (this.sites.owner[s] !== this.player) continue;
      for (let c = 0; c < cargoCount; c++) total[c] += this.sites.stockOf(s, c);
    }
    const out: { cargo: number; tonnes: number; value: number }[] = [];
    for (let c = 0; c < cargoCount; c++) {
      if (total[c] > 0) out.push({ cargo: c, tonnes: total[c], value: this.valueOf(c) });
    }
    out.sort((a, b) => b.tonnes * b.value - a.tonnes * a.value);
    return out;
  }

  /**
   * Sell from stock. The goods go now; the money comes when it comes.
   *
   * Taken from the fullest shed first, which is both the obvious reading of "sell
   * forty tonnes of milk" and the useful one: it clears the place most likely to
   * be blocking its own production for want of room.
   */
  sellOnMarket(cargo: number, tonnes: number, term: number): boolean {
    if (term < 0 || term >= MARKET_TERMS.length) return false;
    if (tonnes <= 0) return false;
    if (this.pending.length >= MAX_PENDING_SALES) return false;

    const holders: { site: number; have: number }[] = [];
    for (let s = 0; s < this.sites.count; s++) {
      if (this.sites.owner[s] !== this.player) continue;
      const have = this.sites.stockOf(s, cargo);
      if (have > 0) holders.push({ site: s, have });
    }
    holders.sort((a, b) => b.have - a.have);
    const held = holders.reduce((n, h) => n + h.have, 0);
    let left = Math.min(tonnes, held);
    if (left <= 0) return false;
    const sold = left;
    for (const h of holders) {
      if (left <= 0) break;
      const take = Math.min(left, h.have);
      this.sites.takeStock(h.site, cargo, take);
      left -= take;
    }

    const offer = this.marketOffers(cargo)[term];
    this.pending.push({
      cargo,
      tonnes: sold,
      pence: offer.pence * sold,
      dueTick: this.tick + offer.days * TICKS_PER_DAY,
    });
    return true;
  }

  /** Sales agreed and not yet paid, soonest first. */
  pendingSales(): { cargo: number; tonnes: number; pence: number; dueTick: number }[] {
    return [...this.pending].sort((a, b) => a.dueTick - b.dueTick);
  }

  private readonly pending: {
    cargo: number; tonnes: number; pence: number; dueTick: number;
  }[] = [];

  /**
   * Pay out whatever has come due, and empty the shop tills.
   *
   * Both are money that arrives without a lorry, which is why they settle
   * together: a till and a buyer's cheque are the two incomes in this game that
   * do not depend on where a vehicle is.
   */
  private settleSales(): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const sale = this.pending[i];
      if (sale.dueTick > this.tick) continue;
      this.companies.post(this.player, Line.Trading, sale.pence);
      this.note(NONE, MoneyKind.Market, sale.pence, sale.cargo, sale.tonnes);
      this.pending.splice(i, 1);
    }
    this.sellOverTheCounter();
  }

  /**
   * A shop's till, emptied.
   *
   * The one place that needs no sale arranged: whatever reaches its shelves goes
   * out of the door on its own, because it faces the public and the public turns
   * up. That is what makes a shop the cheapest thing worth owning and the natural
   * first business — everything else in the district needs a customer found for
   * it.
   *
   * Priced at the goods own value rather than at a fare, because this is a sale
   * and not a journey. Retail beats the market's best term, which is the whole
   * reason to own the shop rather than to sell the same crate wholesale.
   */
  private sellOverTheCounter(): void {
    const cargoCount = this.content.cargo.length;
    for (let s = 0; s < this.sites.count; s++) {
      if (this.sites.owner[s] !== this.player) continue;
      /*
       * Only a place that actually faces the public.
       *
       * The first version took "makes nothing" to mean "is a shop", which a
       * concrete plant also satisfies — so it sold aggregate over a counter to
       * passers-by. There is no rule of thumb here that works; a shop is a shop
       * because the content says it is.
       */
      if (!this.content.industries[this.sites.def[s]]?.retail) continue;
      for (let c = 0; c < cargoCount; c++) {
        const i = s * cargoCount + c;
        const sold = this.sites.counter[i];
        if (sold <= 0) continue;
        this.sites.counter[i] = 0;
        const pence = Math.round((this.valueOf(c) * sold * RETAIL_PCT) / 100);
        this.companies.post(this.player, Line.Trading, pence);
        this.note(s, MoneyKind.Counter, pence, c, sold);
      }
    }
  }

  private stepDay(): void {
    // The farming year, once a day. The season step is usually a no-op; the
    // catch-up brings on whatever no tractor has got round to.
    this.stepSeason();
    this.catchUpFields();

    // Standing orders, on the day the week turns.
    if (this.day % DAYS_PER_WEEK === 0) this.settleStandingOrders();
    // And the money that needs no lorry: the tills and the market.
    this.settleSales();

    /*
     * Approval drifts back toward indifference.
     *
     * Without it the number is a ratchet — every delivery ever made counts for
     * ever, so by the second year it is pinned at a hundred and has stopped
     * being a constraint at all. Drifting means standing still costs you
     * slowly, which is what keeps the rung worth climbing.
     */
    if (this.approval > APPROVAL_REST) {
      this.approval = Math.max(APPROVAL_REST, this.approval - APPROVAL_DRIFT_PER_DAY);
    } else if (this.approval < APPROVAL_REST) {
      this.approval = Math.min(APPROVAL_REST, this.approval + APPROVAL_DRIFT_PER_DAY);
    }

    /*
     * And keeping the village supplied counts for something.
     *
     * Owning a shop is a different relationship with the parish from hauling
     * through it. A haulier delivers and leaves; whoever owns the shop is the
     * reason there is milk in the village at all, and that is precisely the kind
     * of standing `planning.ts` says money cannot buy — you can buy the shop, but
     * the approval comes from *running* it, and only while it has something on
     * the shelves.
     *
     * Which is the test: a place you own that consumes and makes nothing is
     * serving the people who live there, and it earns while it is trading. Buy
     * the shop and let it run dry and it earns you nothing, because a shop with
     * empty shelves is not serving anybody. Worth about a load and a half a day
     * at full shelves — enough that owning the village shop is a real step
     * toward the planning board and nowhere near enough to be a shortcut to it.
     */
    const cargoCount = this.content.cargo.length;
    for (let s = 0; s < this.sites.count; s++) {
      if (this.sites.owner[s] !== this.player) continue;
      const def = this.sites.def[s];
      if (this.recipes.outputs[def].length > 0) continue;
      const ins = this.recipes.inputs[def];
      if (ins.length === 0) continue;
      /*
       * How well supplied it is, measured on its best-stocked line rather than
       * averaged across all of them.
       *
       * Averaging was the obvious version and it punished exactly the player
       * this is for. A village shop lists milk, dairy and beer; someone eight
       * minutes into their first game can supply milk and nothing else, so the
       * average was a third however hard they worked at it — less than the daily
       * drift, which meant owning the shop moved the number by four hundredths
       * of a point a month and the whole thing may as well not have been there.
       *
       * The best line, then: keeping *something* on the shelves is what being
       * the village's supplier means, and filling all three is a matter of
       * having a bigger business, which the game rewards elsewhere.
       */
      let stocked = 0;
      for (let i = 0; i < ins.length; i += 2) {
        const cap = this.sites.capacity[s * cargoCount + ins[i]];
        if (cap > 0) stocked = Math.max(stocked, Math.min(1, this.sites.stockOf(s, ins[i]) / cap));
      }
      this.approval = Math.min(100, this.approval + PARISH_PER_DAY * stocked);
    }

    const b = this.content.balance;

    // running costs, breakdowns, and obsolescence
    const year = this.year;
    const fuelPct = 100;
    for (let id = 0; id < this.vehicles.count; id++) {
      if (!this.vehicles.alive[id]) continue;
      const type = this.vehicles.type[id];
      // Fuel and fodder go up and down, and a running cost that never moves is
      // a running cost the player stops thinking about.
      const cost = (this.vehicleRunning[type] * fuelPct) / 100;
      this.companies.post(this.vehicles.company[id], Line.RunningCosts, cost);
      this.vehicles.costs[id] += cost;
      const svc = this.vehicles.service[id];
      if (svc !== NONE) this.services.costs[svc] += cost;

      if (this.vehicles.state[id] === VState.Broken) {
        if (--this.vehicles.dwell[id] <= 0) {
          this.vehicles.dwell[id] = 0;
          // Back to what it was doing. A vehicle that broke down mid-route
          // still has its link, its cell and its route, and returning it to
          // Idle instead of Travelling strands it there with the cell still
          // occupied — which blocks the road behind it permanently and looks
          // exactly like a pathfinding bug.
          this.vehicles.state[id] =
            this.vehicles.link[id] !== NONE ? VState.Travelling : VState.Idle;
        }
        continue;
      }

      /*
       * Obsolescence with teeth. design.md §2.4: eras retire your vehicles and,
       * more importantly, your assumptions — and standing still is a losing
       * move. A vehicle past its production year does not stop; it becomes
       * unreliable, and unreliability is a breakdown that blocks the cell it is
       * standing in, which jams the road behind it. That is a far better
       * teacher than a number going down in a panel.
       */
      const def = this.content.vehicles[type];
      const yearsPast = Math.max(0, year - def.obsoleteYear);
      const reliability = Math.max(25, def.reliability - yearsPast * 3);
      if (this.rng.chance(100 - reliability, 6000)) {
        this.vehicles.state[id] = VState.Broken;
        this.vehicles.speed[id] = 0;
        // Days off the road, and a bill. Both scale with how old it is.
        this.vehicles.dwell[id] = 2 + this.rng.int(3) + Math.min(6, (yearsPast / 4) | 0);
        this.companies.post(this.vehicles.company[id], Line.RunningCosts, Math.round(def.cost * 0.02));
        if (this.vehicles.company[id] === this.player) {
          this.onEvent?.('breakdown', `A ${def.name.toLowerCase()} has broken down.`);
        }
      }
    }

    // upkeep and wear
    for (let a = 0; a < this.assets.count; a++) {
      const owner = this.assets.owner[a];
      const upkeep = (this.wayUpkeep[this.assets.cls[a]] * this.assets.tiles[a]) / DAYS_PER_YEAR;
      if (owner !== AUTHORITY) this.companies.post(owner, Line.Upkeep, upkeep);
      // Decay: wear per thousand passes, scaled by how much it is used. An
      // asset nobody drives on still ages, slowly.
      const wear = this.wayWear[this.assets.cls[a]];
      const load = this.assets.passes[a] / 1000;
      const drop = (wear * load) / 4 + wear / 900;
      if (drop >= 1) this.assets.condition[a] = Math.max(0, this.assets.condition[a] - Math.round(drop));
      else if (this.rng.chance(Math.round(drop * 100), 100)) {
        this.assets.condition[a] = Math.max(0, this.assets.condition[a] - 1);
      }

      /*
       * And somebody mends it, which nobody was doing.
       *
       * Wear had no counterpart, so every way in the region ground down to
       * nothing: an unused dirt track loses about a fortieth of its condition
       * a year from age alone, so the entire authority network was derelict by
       * about 1880 — permanently slower for everybody, and, since a worn asset
       * values at nothing, free for anybody to buy. A player could acquire the
       * region's roads for no money at all.
       *
       * The authority maintains its own ways to a serviceable standard, which
       * is what the public charge on them is for. It is not a good standard —
       * public roads sit noticeably below what an owner who is spending money
       * keeps theirs at, and that gap is a reason to own one.
       */
      if (owner === AUTHORITY) {
        if (this.assets.condition[a] < PUBLIC_STANDARD && this.rng.chance(1, 3)) {
          this.assets.condition[a]++;
        }
      } else if (this.companies.cash[owner] > upkeep * 40 && this.assets.condition[a] < 250) {
        // A private owner keeps their way up while they can afford to, and the
        // bill is the upkeep they are already paying. An owner with no money
        // watches it degrade, which is the intended pressure.
        if (this.rng.chance(1, 2)) this.assets.condition[a]++;
      }
    }

    stepSiteDecay(this.sites, b);
    this.rebuildTownBasket(this.era);
    stepTowns(
      this.towns, this.townDemandPerThousand, this.townProducePerThousand, b.townGrowthPerDay,
    );
    stepFinance(this.companies, b, (c) => this.declareBankrupt(c));

    if (this.dayOfMonth === 0 && this.day > 0) this.companies.closeMonth();
    this.syncCargoRibbons();
    if (this.dayOfMonth === 0) this.stepAmenityField();
    if (this.day % DAYS_PER_WEEK === 0) this.stepContractBoard();
  }


  /**
   * Tonnes a day this site makes of a cargo, which is the only figure that says
   * whether owning it is worth anything.
   *
   * Public because the interface needs it and had no way to ask. A business
   * showed the player its *stock* — twelve tonnes of milk standing in the yard —
   * and nothing at all about the rate, so "is this worth buying" could only be
   * answered by buying it and watching. Stock is a level; production is a flow,
   * and the flow is the thing you are actually purchasing.
   */
  outputPerDay(site: number, cargo: number): number {
    return this.siteOutputRate(site, cargo);
  }

  /** Units per day a site can supply of a networked cargo. */
  private siteOutputRate(site: number, cargo: number): number {
    const def = this.sites.def[site];
    if (this.sites.state[site] === SiteState.Dead || this.sites.state[site] === SiteState.Mothballed) return 0;
    const outs = this.recipes.outputs[def];
    for (let i = 0; i < outs.length; i += 2) {
      if (outs[i] !== cargo) continue;
      const perCycle = outs[i + 1];
      const cyclesPerDay = TICKS_PER_DAY / Math.max(1, this.recipes.period[def]);
      const health = this.sites.state[site] === SiteState.Struggling ? 0.55 : 1;
      return perCycle * cyclesPerDay * health;
    }
    return 0;
  }

  /** How much of the catchment one job actually needs, after everyone else
   *  has taken theirs. Recomputed daily from the demand across the region. */
  private labourShare = 1;

  // ----------------------------------------------------------- pathfinding

  /**
   * Request a route. The result cannot be delivered now — the sim exposes no
   * API that would let it. It lands at `tick + PATH_LATENCY_TICKS`, the same
   * tick on every machine whether the search took two milliseconds or forty.
   * risks.md R2.
   */
  requestPath(vehicle: number, fromNode: number, toNode: number, mode: number = Mode.Road): void {
    if (fromNode === NONE || toNode === NONE) return;
    this.vehicles.pathDueTick[vehicle] = this.tick + PATH_LATENCY_TICKS;
    this.pathQueue.push({ vehicle, fromNode, toNode, mode, dueTick: this.tick + PATH_LATENCY_TICKS });
    this.stats.pathRequests++;
  }

  private resolvePaths(): void {
    if (this.pathQueue.length === 0) return;
    let write = 0;
    for (let i = 0; i < this.pathQueue.length; i++) {
      const req = this.pathQueue[i];
      if (req.dueTick > this.tick) {
        this.pathQueue[write++] = req;
        continue;
      }
      const v = req.vehicle;
      this.vehicles.pathDueTick[v] = NONE;
      if (!this.vehicles.alive[v]) continue;
      const route = this.router.find(
        this.graph, this.assets, this.routeCosts,
        req.fromNode, req.toNode, this.vehicles.company[v], this.config.size, req.mode,
      );
      this.stats.pathsResolved++;
      if (!route || route.links.length === 0) {
        // No way through. The vehicle idles and tries again later rather than
        // vanishing, because "unreachable" is usually temporary — a road is
        // being rebuilt, or the player has not connected it yet.
        this.vehicles.state[v] = VState.Idle;
        this.vehicles.dwell[v] = TICKS_PER_DAY * 2;
        continue;
      }
      const start = v * ROUTE_STRIDE;
      const len = Math.min(ROUTE_STRIDE, route.links.length);
      for (let k = 0; k < len; k++) this.routePool[start + k] = route.links[k];
      this.vehicles.routeStart[v] = start;
      this.vehicles.routeLen[v] = len;
      this.vehicles.routeCursor[v] = 0;
      this.vehicles.state[v] = VState.Queued;
    }
    this.pathQueue.length = write;
  }

  /** A queued vehicle enters the network when the first cell of its first
   *  link is free. */
  private admitQueued(): void {
    for (let id = 0; id < this.vehicles.count; id++) {
      if (!this.vehicles.alive[id] || this.vehicles.state[id] !== VState.Queued) continue;
      const link = this.routePool[this.vehicles.routeStart[id]];
      const cell = this.graph.linkCellStart[link];
      if (this.graph.cells[cell] !== NONE) continue;
      if (this.graph.linkOccupancy[link] >= this.graph.linkCapacity[link]) continue;
      this.graph.cells[cell] = id;
      this.graph.linkOccupancy[link]++;
      this.vehicles.link[id] = link;
      this.vehicles.cell[id] = 0;
      this.vehicles.pos[id] = 0;
      this.vehicles.speed[id] = 0;
      this.vehicles.routeCursor[id] = 0;
      this.vehicles.state[id] = VState.Travelling;
      this.graph.linkFlow[link]++;
      this.onEnterLink(id, link);
    }
  }

  // ------------------------------------------------------ access charges

  /**
   * The spine, design.md §3.1. Using someone else's infrastructure costs you
   * money; owning it means you stop paying and everyone else starts paying
   * you. In Act I the owner is always the authority and the player can only
   * pay — which is the ache the construction charter is a reward for.
   */
  private onEnterLink(vehicle: number, link: number): void {
    /*
     * What is going along here, for the cargo ribbons overlay.
     *
     * Before the ownership check, not after: what a link carries is a fact
     * about the link, and a stretch of way that happens to belong to nobody
     * carries cargo exactly as much as one that does.
     */
    const load = this.vehicles.load[vehicle];
    if (load > 0) {
      const cargo = this.vehicles.cargo[vehicle];
      this.graph.linkTonnes[link] += load;
      if (this.graph.linkCargo[link] === cargo) {
        this.graph.linkCargoTonnes[link] += load;
      } else if (load > this.graph.linkCargoTonnes[link]) {
        this.graph.linkCargo[link] = cargo;
        this.graph.linkCargoTonnes[link] = load;
      }
    }

    const asset = this.graph.linkAsset[link];
    if (asset === NONE) return;
    const owner = this.assets.owner[asset];
    const payer = this.vehicles.company[vehicle];
    this.assets.passes[asset]++;
    if (payer >= 0 && payer < 16) this.assets.users[asset] |= 1 << payer;
    if (owner === payer) return;
    this.assets.foreignPasses[asset]++;
    const tiles = this.graph.linkChainLen[link] - 1;
    const charge = this.assets.charge[asset] * tiles;
    if (charge <= 0) return;
    this.companies.post(payer, Line.AccessPaid, charge);
    this.assets.revenue[asset] += charge;
    if (owner !== AUTHORITY) this.companies.post(owner, Line.AccessCharged, charge);
    const svc = this.vehicles.service[vehicle];
    if (svc !== NONE) this.services.costs[svc] += charge;
    this.vehicles.costs[vehicle] += charge;
  }

  // ------------------------------------------------------------ the stops

  private onArrive(vehicle: number, node: number): void {
    this.vehicles.state[vehicle] = VState.Idle;
    this.vehicles.dwell[vehicle] = 0;
    this.vehicles.targetNode[vehicle] = node;
  }

  /** Loading, unloading, and choosing the next stop. Returns tonnes delivered. */
  private stepStops(): number {
    let delivered = 0;
    const v = this.vehicles;
    const svcT = this.services;

    for (let id = 0; id < v.count; id++) {
      if (!v.alive[id]) continue;
      const state = v.state[id];
      if (state === VState.Travelling || state === VState.Queued) continue;
      // A broken vehicle is not idle: it is sitting in the road with its
      // bonnet up, and the daily pass owns its recovery countdown.
      if (state === VState.Broken) continue;
      if (v.pathDueTick[id] !== NONE) continue;
      if (v.dwell[id] > 0) {
        v.dwell[id]--;
        continue;
      }
      /*
       * And nobody sets off after eight at night.
       *
       * Held here, at the point where a vehicle standing at a stop decides on its
       * next leg, which is the only place in this loop where a journey actually
       * begins. Everything already travelling has gone past the top of the loop,
       * so a lorry is never frozen in the middle of a road — it finishes the leg
       * it is on, arrives, and stays there until six.
       *
       * Before the load checks rather than after, and that matters: those are what
       * accumulate `waited` and eventually lose you the contract for being too
       * slow to shift anything. A night parked at a depot is not a vehicle failing
       * to find a load, and charging it as one would make the whole fleet look
       * unreliable by morning.
       */
      if (this.fleetParked) continue;

      const svc = v.service[id];
      if (svc === NONE || !svcT.active[svc] || svcT.stopCount[svc] === 0) {
        v.state[id] = VState.Idle;
        continue;
      }

      const stopIdx = v.orderIndex[id] % svcT.stopCount[svc];
      const si = svc * MAX_STOPS + stopIdx;
      const kind = svcT.stopKind[si];
      const isTown = kind === 1;
      const target = svcT.stopTarget[si];
      const mode = this.vehicleMode[v.type[id]];
      const stopNode = kind === 2 ? target
        : isTown ? this.towns.nodeOf(target, mode)
        : this.sites.nodeOf(target, mode);
      if (stopNode === NONE) {
        v.dwell[id] = TICKS_PER_DAY;
        continue;
      }

      if (v.targetNode[id] !== stopNode) {
        // Not there yet. Plan the leg.
        const from = v.targetNode[id] === NONE ? stopNode : v.targetNode[id];
        if (from === stopNode) {
          v.targetNode[id] = stopNode;
        } else {
          v.state[id] = VState.Idle;
          this.requestPath(id, from, stopNode, mode);
          continue;
        }
      }

      // A bare waypoint has nothing to load or unload; move straight on.
      if (kind === 2) {
        v.orderIndex[id] = (stopIdx + 1) % svcT.stopCount[svc];
        const ns = svc * MAX_STOPS + v.orderIndex[id];
        const nn = svcT.stopKind[ns] === 2 ? svcT.stopTarget[ns]
          : svcT.stopKind[ns] === 1 ? this.towns.nodeOf(svcT.stopTarget[ns], mode)
          : this.sites.nodeOf(svcT.stopTarget[ns], mode);
        if (nn === NONE || nn === v.targetNode[id]) {
          v.dwell[id] = TICKS_PER_DAY / 2;
        } else {
          v.state[id] = VState.Idle;
          this.requestPath(id, v.targetNode[id], nn, mode);
        }
        continue;
      }

      // At the stop. Do the work, one tick's worth.
      const action = svcT.stopAction[si];
      const cargoWanted = svcT.stopCargo[si];
      const rate = this.vehicleTransfer[v.type[id]];
      let busy = false;

      /*
       * An Exchange stop drops what it brought and picks up what is waiting,
       * and the two must not be the same tonnes. Without this guard the tick
       * after a pickup saw a loaded vehicle at an unloading stop, put the
       * cargo straight back where it came from, and *paid the carriage on it* —
       * then picked it up again next tick. A stationary dray earned its own
       * price in coal every fortnight; four AI companies moved five and a half
       * million tonnes in thirty years without one of them leaving the yard.
       */
      const justLoadedHere = v.loadedAt[id] === si;
      if (!justLoadedHere && (action === StopAction.Unload || action === StopAction.Exchange)) {
        if (v.load[id] > 0) {
          const cargo = v.cargo[id];
          const amount = Math.min(v.load[id], rate);
          const accepted = isTown
            ? this.deliverToTown(target, cargo, amount)
            : this.sites.addStock(target, cargo, amount);
          if (accepted > 0) {
            v.load[id] -= accepted;
            delivered += accepted;
            this.payForDelivery(id, cargo, accepted, isTown, target);
            busy = true;
          } else if (this.accepts(isTown, target, cargo)) {
            /*
             * The destination takes this cargo but has no room right now: a
             * full yard is the signal decay is measured from, so wait — but
             * again, not forever. A works starved of its *other* input never
             * empties its yard, and a vehicle that treats that as a queue to
             * join simply stops being a vehicle. Three drays spent twenty
             * years parked at a glassworks that had coal and no sand.
             */
            const lap = svcT.roundTrip[svc];
            const patience = lap > 0
              ? Math.max(TICKS_PER_DAY * 2, lap * LOAD_PATIENCE_SHARE)
              : LOAD_PATIENCE_DAYS * TICKS_PER_DAY;
            if (v.waited[id] >= patience) {
              busy = false;
            } else {
              v.dwell[id] = TICKS_PER_DAY / 2;
              v.waited[id] += TICKS_PER_DAY / 2;
              busy = true;
            }
          } else {
            // The destination will never take it. Waiting is a deadlock, so
            // the load is written off and the service keeps running. It should
            // be unreachable now that loading looks ahead, but a service the
            // player edits mid-journey can still produce it.
            this.companies.post(this.vehicles.company[id], Line.Penalties, v.load[id] * this.cargoPrice[cargo]);
            v.load[id] = 0;
            v.cargo[id] = 255;
            this.onEvent?.('refused', `A load of ${this.content.cargo[cargo].name.toLowerCase()} was refused and written off.`);
          }
          if (v.load[id] === 0) v.cargo[id] = 255;
        }
      }

      if (!busy && (action === StopAction.Load || action === StopAction.Exchange || action === StopAction.LoadFull)) {
        const cargo = cargoWanted === 255 ? this.bestCargoAt(id, isTown, target, svc) : cargoWanted;
        if (cargo !== 255 && (v.cargo[id] === 255 || v.cargo[id] === cargo)) {
          const capacity = this.vehicleCapacity[v.type[id]];
          const room = capacity - v.load[id];
          if (room > 0) {
            const want = Math.min(room, rate);
            const got = isTown
              ? this.takeFromTown(target, cargo, want)
              : this.sites.takeStock(target, cargo, want);
            if (got > 0) {
              if (v.load[id] === 0) {
                this.loadOriginX[id] = isTown ? this.towns.x[target] : this.sites.x[target];
                this.loadOriginY[id] = isTown ? this.towns.y[target] : this.sites.y[target];
                v.haulDistance[id] = 0;
              }
              v.cargo[id] = cargo;
              v.load[id] += got;
              v.loadedAt[id] = si;
              if (!isTown) {
                this.sites.collected[target] += got;
                this.sites.everServed[target] = 1;
              }
              busy = true;
            }
          }
          if (action === StopAction.LoadFull && v.load[id] < capacity) {
            // Wait for a full load. This is the decision the act is about:
            // a full load out and an empty load back is half a business. But
            // only for so long — see LOAD_PATIENCE_DAYS.
            const lap = svcT.roundTrip[svc];
            const patience = lap > 0
              ? Math.max(TICKS_PER_DAY * 2, lap * LOAD_PATIENCE_SHARE)
              : LOAD_PATIENCE_DAYS * TICKS_PER_DAY;
            if (v.load[id] > 0 && v.waited[id] >= patience) {
              busy = false;
            } else {
              if (!busy) {
                v.dwell[id] = TICKS_PER_DAY / 3;
                v.waited[id] += TICKS_PER_DAY / 3;
              }
              busy = true;
            }
          }
        }
      }

      if (busy) {
        v.state[id] = action === StopAction.Unload ? VState.Unloading : VState.Loading;
        continue;
      }

      // Done here. Move to the next stop.
      v.loadedAt[id] = -1;
      v.waited[id] = 0;
      v.orderIndex[id] = (stopIdx + 1) % svcT.stopCount[svc];
      if (v.orderIndex[id] === 0) {
        // Back to the first stop: one full cycle. Rolled rather than replaced,
        // so one unlucky trip does not rewrite the figure the player reads.
        const lap = this.tick - this.lapStart[id];
        if (lap > 0 && lap < TICKS_PER_YEAR) {
          svcT.roundTrip[svc] = svcT.roundTrip[svc] === 0 ? lap : Math.round((svcT.roundTrip[svc] * 3 + lap) / 4);
        }
        this.lapStart[id] = this.tick;
      }
      const nextSi = svc * MAX_STOPS + v.orderIndex[id];
      const nextKind = svcT.stopKind[nextSi];
      const nextTarget = svcT.stopTarget[nextSi];
      const nextNode = nextKind === 2 ? nextTarget
        : nextKind === 1 ? this.towns.nodeOf(nextTarget, mode)
        : this.sites.nodeOf(nextTarget, mode);
      if (nextNode === NONE || nextNode === v.targetNode[id]) {
        v.dwell[id] = TICKS_PER_DAY / 2;
        continue;
      }
      this.requestPath(id, v.targetNode[id], nextNode, mode);
    }

    this.admitQueued();
    return delivered;
  }

  /**
   * What to pick up here, when the stop did not name a cargo.
   *
   * Two rules, both learned the hard way. An industry sells what it *makes*,
   * not what it is holding — a coking plant with a yard full of coal and no
   * coke yet will happily let you cart the coal away, and then the steelworks
   * refuses it because a steelworks does not take coal, and the vehicle sits
   * at the gate loaded forever. And the choice has to look ahead to where the
   * service is actually going next, because a cargo the destination will not
   * accept is worse than no cargo at all.
   */
  /** Tonnes of a cargo a destination could take right now. */
  private roomFor(isTown: boolean, target: number, cargo: number): number {
    const cargoCount = this.content.cargo.length;
    if (isTown) {
      const i = target * cargoCount + cargo;
      return Math.max(0, Math.max(20, this.towns.demand[i] * 6) - this.towns.stock[i]);
    }
    return this.sites.roomFor(target, cargo);
  }

  private bestCargoAt(vehicle: number, isTown: boolean, target: number, service: number): number {
    const handling = this.content.vehicles[this.vehicles.type[vehicle]].handling;
    const cargoCount = this.content.cargo.length;
    const dest = this.nextUnloadStop(service, this.vehicles.orderIndex[vehicle]);

    let best = 255;
    let bestValue = 0;
    for (let c = 0; c < cargoCount; c++) {
      const have = isTown
        ? this.towns.stock[target * cargoCount + c]
        : this.sites.stockOf(target, c);
      if (have <= 0) continue;
      if (!handling.includes(this.content.cargo[c].handling as never)) continue;
      if (!isTown && !this.produces(this.sites.def[target], c)) continue;
      if (dest && !this.accepts(dest.isTown, dest.target, c)) continue;
      // And has somewhere to put it. A works whose input yard is already full
      // takes nothing, so loading for it is loading for a closed gate — the
      // vehicle arrives, waits, and never leaves.
      if (dest && this.roomFor(dest.isTown, dest.target, c) <= 0) continue;
      const value = have * this.cargoPrice[c];
      if (value > bestValue) {
        bestValue = value;
        best = c;
      }
    }
    return best;
  }

  private produces(def: number, cargo: number): boolean {
    const outs = this.recipes.outputs[def];
    for (let i = 0; i < outs.length; i += 2) if (outs[i] === cargo) return true;
    return false;
  }

  /** Will this destination take the cargo at all? */
  accepts(isTown: boolean, target: number, cargo: number): boolean {
    const cargoCount = this.content.cargo.length;
    if (isTown) return this.townDemandPerThousand[cargo] > 0;
    return this.sites.capacity[target * cargoCount + cargo] > 0;
  }

  /** The next stop in the service that will take a load off. */
  private nextUnloadStop(service: number, fromIndex: number): { isTown: boolean; target: number } | null {
    if (service === NONE) return null;
    const n = this.services.stopCount[service];
    for (let k = 1; k <= n; k++) {
      const idx = (fromIndex + k) % n;
      const si = service * MAX_STOPS + idx;
      const action = this.services.stopAction[si];
      if (this.services.stopKind[si] === 2) continue;
      if (action === StopAction.Unload || action === StopAction.Exchange) {
        return { isTown: this.services.stopKind[si] === 1, target: this.services.stopTarget[si] };
      }
    }
    return null;
  }

  private deliverToTown(town: number, cargo: number, amount: number): number {
    const cargoCount = this.content.cargo.length;
    const i = town * cargoCount + cargo;
    const demand = this.towns.demand[i];
    // A town will hold a few days of demand and no more; beyond that it stops
    // accepting, which is what stops a single service oversupplying a town
    // forever and printing money.
    const cap = Math.max(20, demand * 6);
    const room = cap - this.towns.stock[i];
    const taken = Math.max(0, Math.min(amount, room));
    this.towns.stock[i] += taken;
    return taken;
  }

  private takeFromTown(town: number, cargo: number, amount: number): number {
    const i = town * this.content.cargo.length + cargo;
    const taken = Math.min(this.towns.stock[i], amount);
    this.towns.stock[i] -= taken;
    return taken;
  }

  /**
   * The haulage payment.
   *
   * Rate rises with distance so the map's geography is worth something, and
   * falls if the destination is already swimming in the stuff. Contracts are
   * settled separately, as a premium on completion, so the two systems do not
   * double-pay for the same tonne.
   */
  private payForDelivery(
    vehicle: number, cargo: number, tonnes: number, isTown: boolean, target: number,
  ): void {
    const company = this.vehicles.company[vehicle];
    const tx = isTown ? this.towns.x[target] : this.sites.x[target];
    const ty = isTown ? this.towns.y[target] : this.sites.y[target];
    const dx = tx - this.loadOriginX[vehicle];
    const dy = ty - this.loadOriginY[vehicle];
    const direct = Math.sqrt(dx * dx + dy * dy);
    /*
     * Paid for the miles run, not the miles as the crow flies — capped.
     *
     * The running cost accrues per day of driving, so it is charged against
     * the road distance whatever the rate says. Paying the rate on the direct
     * line meant revenue and cost were quoted in different units, and since
     * the generated road network wanders at about twice the direct line, every
     * haul in the game lost money: a dray on a fifty-seven tile run earned
     * thirty-two pounds against forty-six of fodder. Companies went bankrupt
     * on their first route and the sweep read it as a content problem.
     *
     * The cap is the other half. Without it a winding road pays better than a
     * straight one and there is no reason to ever build the straight one,
     * which inverts the point of the game. With it, carriage is paid up to a
     * reasonable allowance for terrain and no further — so a detour beyond
     * that is carried at the haulier's own expense, and shortening it is worth
     * money twice over: a better rate until the cap, and less time after it.
     * Railway tariffs called this constructive mileage and did it for the same
     * reason.
     */
    const dist = Math.max(direct, Math.min(this.vehicles.haulDistance[vehicle], direct * HAUL_ALLOWANCE));
    const rate = haulageRate(this.cargoPrice[cargo], dist, this.cargoRateWeight[cargo]);
    /*
     * You are paid when goods *leave* you, and not when they arrive.
     *
     * This was the wrong way round and it took two reports to see how wrong.
     * Delivering into a place of your own paid half again the fare, on the
     * reasoning that owning a business should beat hauling for hire. It does — but
     * not like this: "I brought in two tons of milk and I made two point five
     * grand", and "I shouldn't get paid to take my own stuff, I should get paid
     * for the stuff itself." Both are the same objection and both are right.
     * Bringing milk into your own creamery is *buying stock*. Nothing has been
     * sold, nobody has been served, and no money has been made.
     *
     * So arriving somewhere you own pays nothing at all — whether the load came
     * off your own farm (a shunt) or somebody else's (a purchase). Which leaves
     * three ways to be paid, and every one of them is a sale:
     *
     *   **The full fare**, for a load into somebody else's place. You carried it
     *   and they took it: that is the haulage business.
     *   **The gate price**, when somebody collects from a place of yours. A sale
     *   with the carriage deducted — see `settleStandingOrders`.
     *   **The counter**, when a shop of yours sells what is on its shelves. See
     *   `sellOverTheCounter`, which is what makes owning a consumer worth
     *   anything at all.
     *
     * And that finally makes vertical integration mean the right thing. Owning
     * the farm *and* the shop is not free freight; it is keeping the margin at
     * every step instead of paying it away — the farm's output does not have to be
     * sold at the gate, and the shop's shelves do not have to be bought in.
     */
    const own = !isTown && target >= 0 && target < this.sites.count
      && this.sites.owner[target] === company;
    const pence = own ? 0 : Math.round(rate * tonnes);
    if (!own) this.companies.post(company, Line.Haulage, pence);
    if (company === this.player && !isTown && target >= 0) {
      /*
       * Arrivals are journalled even at nothing.
       *
       * A shop whose shelves fill from your own farm and whose accounts stay
       * blank reads as a bug; a row saying two tonnes arrived and cost nothing
       * answers the question the blank would raise.
       */
      this.note(
        target, own ? MoneyKind.Moved : MoneyKind.Delivered, pence, cargo, tonnes,
      );
    }
    /*
     * And say so, if it was the player's.
     *
     * A queue rather than a callback, drained by whoever is drawing: the
     * simulation must not know an interface exists, and a callback would make
     * the client's frame rate a term in the economy. Bounded and dropped on
     * overflow, because these are for showing and a missed one is invisible.
     */
    if (company === this.player) {
      /*
       * Serving the place is what earns standing.
       *
       * Per *load*, not per pound, and deliberately: a haulier who runs milk to
       * the village every day for a year is part of the parish, and one who
       * moved a single enormously valuable load is not. Paying it on tonnage or
       * on revenue would make approval a second name for money, which is the
       * thing planning.ts exists to avoid.
       */
      this.approval = Math.min(100, this.approval + APPROVAL_PER_LOAD);
    }
    if (company === this.player && this.earned.length < 32) {
      this.earned.push({
        x: this.vehicles.x[vehicle] / 65536,
        z: this.vehicles.y[vehicle] / 65536,
        pence,
      });
    }
    this.movedByCargo[company * this.content.cargo.length + cargo] += tonnes;
    this.vehicles.revenue[vehicle] += pence;
    this.stats.tonnesMoved += tonnes;
    this.stats.delivered++;
    const svc = this.vehicles.service[vehicle];
    if (svc !== NONE) {
      this.services.revenue[svc] += pence;
      this.services.tonnes[svc] += tonnes;
    }
    if (!isTown) this.sites.shipped[target] += tonnes;
    if (this.vehicles.load[vehicle] <= 0) this.vehicles.haulDistance[vehicle] = 0;

  }


  /**
   * Choose an origin that has stock piling up and a destination that wants it.
   * Contracts generated at random over the cargo table produce a board full of
   * things nobody can do, which reads as the game being broken rather than as
   * the player being bad at it.
   */
  private pickContractSeed(): {
    cargo: number; fromSite: number; fromIsTown: boolean;
    toSite: number; toIsTown: boolean; distanceTiles: number; basePrice: number;
  } | null {
    const cargoCount = this.content.cargo.length;
    for (let attempt = 0; attempt < 60; attempt++) {
      const from = this.rng.int(this.sites.count);
      if (this.sites.state[from] === SiteState.Dead) continue;
      const outs = this.recipes.outputs[this.sites.def[from]];
      if (outs.length === 0) continue;
      const cargo = outs[this.rng.int(outs.length >> 1) * 2];
      if (this.recipes.cargoFromEra[cargo] > this.era) continue;

      // Destinations: a site that consumes it, or a town that wants it.
      const wantsTown = this.townDemandPerThousand[cargo] > 0 && this.rng.chance(1, 2);
      if (wantsTown && this.towns.count > 0) {
        const to = this.rng.int(this.towns.count);
        const d = Math.hypot(this.towns.x[to] - this.sites.x[from], this.towns.y[to] - this.sites.y[from]);
        if (!this.plausibleHaul(d)) continue;
        return {
          cargo, fromSite: from, fromIsTown: false, toSite: to, toIsTown: true,
          distanceTiles: Math.round(d), basePrice: this.cargoPrice[cargo],
        };
      }
      const candidates: number[] = [];
      for (let s = 0; s < this.sites.count; s++) {
        if (s === from || this.sites.state[s] === SiteState.Dead) continue;
        const ins = this.recipes.inputs[this.sites.def[s]];
        for (let i = 0; i < ins.length; i += 2) {
          if (ins[i] === cargo) {
            candidates.push(s);
            break;
          }
        }
      }
      if (candidates.length === 0) continue;
      const to = candidates[this.rng.int(candidates.length)];
      const d = Math.hypot(this.sites.x[to] - this.sites.x[from], this.sites.y[to] - this.sites.y[from]);
      if (!this.plausibleHaul(d)) continue;
      return {
        cargo, fromSite: from, fromIsTown: false, toSite: to, toIsTown: false,
        distanceTiles: Math.round(d), basePrice: this.cargoPrice[cargo],
      };
    }
    return null;
  }

  /**
   * Is this a haul the current era's vehicles could actually run?
   *
   * A board full of two-hundred-tile contracts in 1861 reads as the game being
   * broken rather than as the player being bad at it, because a horse dray
   * physically cannot make the deadline. The ceiling rises with the era, which
   * is also how the map opens up as the roster improves.
   */
  private plausibleHaul(tiles: number): boolean {
    if (tiles < 6) return false;
    const ceiling = 34 + this.era * 26;
    if (tiles <= ceiling) return true;
    // Beyond the ceiling, offered occasionally — a stretch contract is a fine
    // thing to have on the board, just not the whole board.
    return this.rng.chance(1, 4) && tiles < ceiling * 2.2;
  }




  /**
   * Whether rivals may buy and price infrastructure.
   *
   * Not whether they exist. A rival buying roads out from under a player who
   * cannot buy anything is a tax rather than a challenge, so the *ownership*
   * half of their decision list waits for Act II — but they haul from the
   * first day, because a region where nobody else is trading is not a region.
   *
   * Gating the whole AI on this was worth thirty years of nothing happening in
   * the balance sweep.
   */
  get rivalOwnershipEnabled(): boolean {
    return this.era >= 2 || this.companies.charter[this.player] >= Charter.Construction;
  }

  // ------------------------------------------------------------ objectives



  // -------------------------------------------------------------- charters

  /**
   * Charter progression, design.md §1. Each is a licence to do a category of
   * thing you could previously only pay someone else to do — so the gate is
   * that you have run a real business at the current level, not that a
   * timer expired.
   */


  /**
   * What the region is like to be in, once a month.
   *
   * Monthly rather than daily because the fastest thing in the field moves
   * eighteen points a year, so a daily pass would spend real time computing a
   * number that had not changed. The site copy at the end is what lets a
   * resort read its own surroundings without every production cycle walking a
   * grid.
   */
  private stepAmenityField(): void {
    stepAmenity(this.amenity, this.sites, {
      size: this.config.size,
      penaltyOf: (def) => this.recipes.amenityPenalty[def],
      radiusOf: (def) => this.recipes.amenityRadius[def],
      trafficAt: (tile) => {
        const link = this.layers[Mode.Road].link[tile];
        if (link === NONE || link === undefined) return 0;
        const cap = Math.max(1, this.graph.linkCellCount[link] * 4);
        return Math.min(1, this.graph.linkFlowPrev[link] / cap);
      },
      yearFraction: DAYS_PER_MONTH / DAYS_PER_YEAR,
    });
    for (let s = 0; s < this.sites.count; s++) {
      this.sites.amenity[s] = this.amenity.at(this.sites.x[s], this.sites.y[s]);
    }
  }

  /**
   * Copy what each link carries onto its tiles, once a day.
   *
   * Daily rather than per pass because the ribbons are a picture of a trade
   * route rather than of a lorry, and because doing it on every link entry
   * would walk a hundred-tile chain each time. The tonnage fades rather than
   * resetting, so a corridor that stops being used dims over a season instead
   * of vanishing between one day and the next.
   */
  private syncCargoRibbons(): void {
    const g = this.graph;
    for (let i = 0; i < this.tileTonnes.length; i++) this.tileTonnes[i] *= 0.995;
    for (let l = 0; l < g.linkCount; l += 2) {
      const cargo = g.linkCargo[l];
      if (cargo === 255) continue;
      const moved = g.linkTonnes[l] + g.linkTonnesPrev[l];
      if (moved <= 0) continue;
      const start = g.linkChainStart[l];
      const len = g.linkChainLen[l];
      for (let i = 0; i < len; i++) {
        const tile = g.chain[start + i];
        this.tileCargo[tile] = cargo;
        this.tileTonnes[tile] = Math.max(this.tileTonnes[tile], moved);
      }
    }
  }


  /**
   * What today is doing to this link, as a percentage of the posted limit.
   *
   * Everything that slows a vehicle without being traffic ends up here: the
   * weather over the ground the link crosses, a river out of its banks, and
   * the drivers being on strike. Kept as one function so the interactions are
   * visible rather than three separate multipliers applied in three files.
   *
   * The height term is what makes snow a *route* decision rather than a
   * seasonal tax. A player who took the pass to save eight tiles finds out in
   * January; one who went round the long way does not.
   */
  private linkConditions(link: number, vehicle: number): number {
    /*
     * The winter, and it is the only thing on this hook.
     *
     * The hook was kept through the events cut on the grounds that the *shape*
     * of "this link is slower than its posted limit for a reason" would be
     * wanted again. This is that, and it turned out to want the vehicle rather
     * than the company: winter tyres are fitted to a lorry.
     *
     * Zero, not a fraction. A vehicle that is not fitted for snow stops where
     * it is — see fittings.ts for why stopping is worth more than slowing. It
     * keeps its route and its load and resumes at the thaw, or when you buy it
     * some tyres, which is the point.
     */
    void link;
    if (stoppedBySnow(this.vehicleFittings[vehicle], this.snow)) return 0;
    return 100;
  }

  /**
   * Where the game begins.
   *
   * Not "the biggest town", which is what it was, and which made the whole
   * opening a matter of worldgen luck: on seed 1985 the largest settlement had a
   * quarry, a livestock farm, a sawmill and a concrete plant around it and no
   * dairy anywhere in sight. So the first thing the game offered was aggregate
   * out of a quarry, needing a tipper nobody could afford, and there was no
   * second offer because nothing else within reach had anything spare.
   *
   * The founding image of this game is a milk run from a farm to a dairy — it is
   * in the first line of design.md and it is what the whole ladder is built on
   * top of. An image that important cannot be left to a seed.
   *
   * So the opening is *constructed*: find the closest pair of places where one
   * makes something the other wants, prefer a pair whose cargo the cheapest
   * vehicle in the game can carry, and start the player between them. Everything
   * else about the opening — where the camera looks, where the influence is
   * seeded, where the yard goes — follows from that one pair.
   */
  planOpening(): { x: number; y: number; from: number; to: number; cargo: number } {
    let bestFrom = NONE;
    let bestTo = NONE;
    let bestCargo = NONE;
    let bestScore = Infinity;
    /** 0 for the cargo `balance.json` asks to open on, 1 for anything else. */
    let bestRank = 2;

    for (let a = 0; a < this.sites.count; a++) {
      const ta = this.siteAccessTile[a];
      if (ta === NONE) continue;
      const outs = this.recipes.outputs[this.sites.def[a]];
      // Only somewhere with nothing to buy in first. A place that needs
      // supplying cannot be the start of a chain, and the start of the chain is
      // where the player has to begin.
      if (this.recipes.inputs[this.sites.def[a]].length > 0) continue;

      for (let i = 0; i < outs.length; i += 2) {
        const cargo = outs[i];
        const handling = this.content.cargo[cargo]?.handling;
        if (handling === undefined) continue;
        /*
         * Weighted, not filtered. A pair whose cargo the small van can carry is
         * strongly preferred, but a district with no such pair should still get
         * a sensible opening rather than none — the alternative is a hard
         * failure on an unlucky seed, which is the same fragility one layer
         * further down.
         */
        const easy = this.content.vehicles.some(
          (v) => v.cost <= this.cheapestVehicleCost * 1.8
            && (v.handling as readonly string[]).includes(handling),
        );
        // And the content gets to name the one it wants. See balance.json.
        const wanted = this.content.cargo[cargo]?.id === this.content.balance.openingCargo;
        for (let b = 0; b < this.sites.count; b++) {
          if (b === a) continue;
          const tb = this.siteAccessTile[b];
          if (tb === NONE) continue;
          const ins = this.recipes.inputs[this.sites.def[b]];
          let wants = false;
          for (let k = 0; k < ins.length; k += 2) if (ins[k] === cargo) { wants = true; break; }
          if (!wants) continue;
          const dx = this.sites.x[b] - this.sites.x[a];
          const dy = this.sites.y[b] - this.sites.y[a];
          const d = Math.sqrt(dx * dx + dy * dy);
          // Not on top of each other: the opening job has to be a drive.
          if (d < 5) continue;
          /*
           * The named cargo wins outright, and then distance decides among them.
           *
           * It used to be a multiplier — a fifth of the score — which distance
           * could and did outvote: a dairy farm forty tiles from its creamery
           * scored worse than a forestry ten tiles from its sawmill, so the
           * district opened on timber instead of milk. That matters more than it
           * sounds. `openingCargo` is named in `balance.json` because the whole
           * economy is tuned around that one job, and timber is carried by a
           * cheap flatbed while milk needs a refrigerated van: measured, the
           * timber opening put a second vehicle within reach in four minutes
           * against the twelve the ladder is built on. A tuning anchor that any
           * unlucky map layout can slide off is not an anchor.
           *
           * Still a preference and not a filter: a district with no dairy pair
           * at all falls through to the ordinary scoring below, which is the
           * point the original note was making and is still true.
           */
          const rank = wanted ? 0 : 1;
          const score = d * (easy ? 1 : 4);
          if (rank < bestRank || (rank === bestRank && score < bestScore)) {
            bestRank = rank;
            bestScore = score;
            bestFrom = a;
            bestTo = b;
            bestCargo = cargo;
          }
        }
      }
    }

    if (bestFrom === NONE) {
      // No chain anywhere. Fall back to the largest settlement.
      let big = 0;
      for (let t = 1; t < this.towns.count; t++) {
        if (this.towns.population[t] > this.towns.population[big]) big = t;
      }
      return {
        x: this.towns.x[big] ?? this.config.size / 2,
        y: this.towns.y[big] ?? this.config.size / 2,
        from: NONE,
        to: NONE,
        cargo: NONE,
      };
    }

    /*
     * The yard goes nearer the producer than the customer.
     *
     * A third of the way along rather than halfway, because the empty run out to
     * the pickup is the part that earns nothing — so a haulier setting up to run
     * one farm's milk puts the yard by the farm. It also means the very first
     * route the player is shown has a short empty leg and a long loaded one,
     * which is the shape they should be learning to want.
     */
    return {
      x: this.sites.x[bestFrom] + (this.sites.x[bestTo] - this.sites.x[bestFrom]) * 0.34,
      y: this.sites.y[bestFrom] + (this.sites.y[bestTo] - this.sites.y[bestFrom]) * 0.34,
      from: bestFrom,
      to: bestTo,
      cargo: bestCargo,
    };
  }

  /**
   * The vehicle to start with, given the opening job.
   *
   * Derived from the pair rather than named, and that is the whole fix. The
   * opening was a Rigid 7.5t handed out regardless of what work existed, so on a
   * district whose nearest job was aggregate the player owned a box lorry, was
   * offered a tipper job, and could afford neither the tipper nor to wait. Choose
   * the work first and the vehicle follows it, and the two cannot disagree on
   * any seed.
   *
   * The cheapest suitable one, because the opening should be the smallest
   * possible version of the game: one small van, a few tonnes at a time, many
   * short runs. That texture — a round rather than a haulage contract — is what
   * the first ten minutes should feel like.
   */
  openingVehicle(cargo: number): number {
    const handling = this.content.cargo[cargo]?.handling;
    let best = NONE;
    let cheapest = Infinity;
    for (let i = 0; i < this.content.vehicles.length; i++) {
      const v = this.content.vehicles[i];
      if (handling !== undefined
        && !(v.handling as readonly string[]).includes(handling)) continue;
      if (v.cost < cheapest) { cheapest = v.cost; best = i; }
    }
    return best;
  }

  /**
   * Put something in the sheds of every place that needs nothing.
   *
   * A district where every store is empty on day one is a district that offers
   * no work for the first week, because the board only offers what a place
   * actually has spare — so the opening screen was a pretty valley with nothing
   * to do in it while the player waited for a farm to fill a churn.
   *
   * Only places with no inputs, and that distinction is the game's: a farm has
   * been milking cows since before you arrived, and a creamery that has never
   * been supplied has nothing in it and should not pretend otherwise. Empty
   * shelves at the next rung up are the whole reason to climb.
   */
  primeStock(fill = 0.45): void {
    for (let s = 0; s < this.sites.count; s++) {
      const def = this.sites.def[s];
      if (this.recipes.inputs[def].length > 0) continue;
      const outs = this.recipes.outputs[def];
      for (let i = 0; i < outs.length; i += 2) {
        const cargo = outs[i];
        const room = this.sites.roomFor(s, cargo);
        if (room > 0) this.sites.addStock(s, cargo, Math.floor(room * fill));
      }
    }
  }

  /** The cheapest vehicle in the catalogue, for judging what counts as easy. */
  private get cheapestVehicleCost(): number {
    if (this.cheapestCache === 0) {
      this.cheapestCache = Math.min(...this.content.vehicles.map((v) => v.cost));
    }
    return this.cheapestCache;
  }

  private cheapestCache = 0;

  /**
   * Take everything earned since the last call, and forget it.
   *
   * Drained rather than read so nothing accumulates when nobody is looking: a
   * headless run has no interface and must not grow a list for ever.
   */
  takeEarnings(): { x: number; z: number; pence: number }[] {
    if (this.earned.length === 0) return EMPTY_EARNINGS;
    return this.earned.splice(0, this.earned.length);
  }

  /**
   * How deep the snow is, 0..1. The renderer paints it and the traffic obeys
   * it, so there is exactly one source for both.
   *
   * Cached per day rather than recomputed per vehicle per tick: `linkConditions`
   * is called for every moving vehicle on every tick, and a cosine and a
   * smoothstep in that loop is real work for a number that changes once a day.
   */
  get snow(): number {
    const d = this.day;
    if (d !== this.snowDay) {
      this.snowDay = d;
      this.snowCached = snowCover(d);
    }
    return this.snowCached;
  }

  private snowDay = -1;
  private snowCached = 0;

  /**
   * Fit something to a vehicle.
   *
   * Permanent, and one purchase. There is deliberately no un-fitting and no
   * seasonal swap: the decision worth making is which of your lorries you can
   * afford to keep running through the winter, not clicking twice a year on all
   * of them.
   */
  fitVehicle(vehicle: number, fitting: number): { ok: boolean; reason: string } {
    if (vehicle < 0 || vehicle >= this.vehicles.count || !this.vehicles.alive[vehicle]) {
      return { ok: false, reason: 'No such vehicle.' };
    }
    if (this.vehicles.company[vehicle] !== this.player) {
      return { ok: false, reason: 'Not yours.' };
    }
    if ((this.vehicleFittings[vehicle] & fitting) !== 0) {
      return { ok: false, reason: 'Already fitted.' };
    }
    const cost = FITTING_COST[fitting] ?? 0;
    if (this.companies.cash[this.player] < cost) {
      return { ok: false, reason: 'Not enough in the bank.' };
    }
    this.companies.post(this.player, Line.AssetTrade, cost);
    this.vehicleFittings[vehicle] |= fitting;
    return { ok: true, reason: '' };
  }

  /**
   * Which of your vehicles cannot do its job, and why.
   *
   * One list, because a badge over a stopped lorry is how this rule is
   * communicated and the client needs to know where to put them. Returning the
   * reason as a sentence rather than a code keeps the wording in the simulation
   * beside the rule that causes it — the yard refusals are done the same way,
   * and it is why they read as English rather than as error states.
   */
  blockedVehicles(): { vehicle: number; x: number; z: number; reason: string }[] {
    const out: { vehicle: number; x: number; z: number; reason: string }[] = [];
    const snow = this.snow;
    if (snow < SNOW_STOPS) return out;
    for (let v = 0; v < this.vehicles.count; v++) {
      if (!this.vehicles.alive[v]) continue;
      if (this.vehicles.company[v] !== this.player) continue;
      if (!stoppedBySnow(this.vehicleFittings[v], snow)) continue;
      /*
       * A parked lorry has no position.
       *
       * `projectVehicles` only writes x and y for vehicles on a link, so one
       * sitting in its yard between jobs is at the origin — and the badge for it
       * went to the top corner of the district, which is to say nowhere. Falling
       * back to its yard is not a patch: a lorry that is not on the road *is* at
       * its yard, and that is where the player will look for it.
       */
      let x = this.vehicles.x[v] / 65536;
      let z = this.vehicles.y[v] / 65536;
      const yard = this.vehicleYard[v] ?? NONE;
      if (this.vehicles.link[v] === NONE && yard !== NONE && yard >= 0) {
        x = this.yards.x[yard] + 0.5;
        z = this.yards.y[yard] + 0.5;
      }
      out.push({ vehicle: v, x, z, reason: 'No winter tyres' });
    }
    return out;
  }


  /**
   * Lay a way for the authority.
   *
   * Separate from buildWay because the authority is not a company: it has no
   * charter to check, no cash to run out of, and no ledger to post the cost
   * to. It also does not stop for a gradient it does not like — a public
   * scheme that quietly fails to build because the survey was awkward would
   * read to the player as the threat having been a bluff.
   */
  private layPublicWay(
    mode: number, cls: number, path: ArrayLike<number>, charge: number, buildCost: number,
  ): boolean {
    const plan = this.planWay(mode, cls, path, AUTHORITY);
    if (plan.tiles.length < 2) return false;
    const asset = this.assets.alloc(mode, cls, AUTHORITY, charge, this.tick);
    if (asset === NONE) return false;
    const laid = layAlignment(this.layers[mode], this.config.size, plan, cls, asset);
    this.assets.tiles[asset] = laid;
    this.assets.buildCost[asset] = buildCost * laid;
    if (laid === 0) {
      this.assets.count--;
      return false;
    }
    /*
     * Every way laid, anywhere, bumps the revision.
     *
     * Here rather than at the call sites because this is the one place a road
     * comes into existence, and the client's copy of the road map is built once
     * at startup — so anything that lays a road without saying so is a road that
     * never gets drawn. That was already true of the parish widening a lane: it
     * changed the simulation, the lorries used it, and the picture never moved.
     */
    this.landRevision++;
    this.rebuild();
    this.router.invalidate();
    return true;
  }



  /** Does the region already make what this works takes, or take what it
   *  makes? Either way it has somebody to trade with. */
  private completesAChain(defIndex: number): boolean {
    const recipe = this.content.industries[defIndex].recipe;
    const wants = Object.keys(recipe.inputs);
    const gives = Object.keys(recipe.outputs);
    for (let s = 0; s < this.sites.count; s++) {
      if (this.sites.state[s] === SiteState.Dead) continue;
      const other = this.content.industries[this.sites.def[s]].recipe;
      for (const id of wants) if (other.outputs[id] !== undefined) return true;
      for (const id of gives) if (other.inputs[id] !== undefined) return true;
    }
    for (const id of gives) {
      const ci = this.content.cargoIndex.get(id);
      if (ci !== undefined && this.townDemandFor(ci) > 0) return true;
    }
    return false;
  }

  /** Somewhere an industry of this kind could actually stand. */
  private pickSiteFor(defIndex: number): number {
    const def = this.content.industries[defIndex];
    const size = this.config.size;
    for (let attempt = 0; attempt < 220; attempt++) {
      let tile: number;
      if (def.deposit > 0) {
        /*
         * Deposit-bound, so go to the deposits.
         *
         * This threw random tiles at the map hoping to land on the right
         * ground. There are five oil deposits in a region of a hundred and
         * fifty thousand tiles, so two hundred attempts found one about once
         * in a hundred and fifty games: the oil rig, and with it crude oil and
         * everything downstream of it, effectively did not exist. The terrain
         * already keeps the list.
         */
        const seams: number[] = [];
        for (const d of this.terrain.deposits) {
          if (d.kind === def.deposit) seams.push(d.y * size + d.x);
        }
        if (seams.length === 0) return NONE;
        tile = seams[this.rng.int(seams.length)];
      } else {
        /*
         * Everything else wants to be near a town — that is where the labour
         * is, and computeLabour will otherwise leave it permanently unstaffed
         * and it will decay without ever having produced anything.
         */
        const t = this.rng.int(Math.max(1, this.towns.count));
        const r = 6 + this.rng.int(26);
        const x = this.towns.x[t] + this.rng.int(r * 2 + 1) - r;
        const y = this.towns.y[t] + this.rng.int(r * 2 + 1) - r;
        if (x < 2 || y < 2 || x >= size - 2 || y >= size - 2) continue;
        tile = y * size + x;
      }
      if (this.canFound(AUTHORITY, defIndex, tile)) continue;
      // Not on top of something else.
      let clash = false;
      for (let s = 0; s < this.sites.count; s++) {
        const dx = this.sites.x[s] - (tile % size);
        const dy = this.sites.y[s] - ((tile / size) | 0);
        if (dx * dx + dy * dy < 36) { clash = true; break; }
      }
      if (clash) continue;
      return tile;
    }
    return NONE;
  }

  /** Found without the charter and cash checks a company faces. The region
   *  developing is not a company expanding. */
  private foundIndustryAsAuthority(defIndex: number, tile: number): number {
    const site = this.foundIndustry(AUTHORITY, defIndex, tile);
    // It needs a road, or nobody can reach it and it will decay to nothing
    // without ever having produced a tonne.
    if (site !== NONE) this.connectSiteToRoad(site);
    return site;
  }

  /**
   * A spur from a new site to the nearest road.
   *
   * Without one the works stands in a field: not connected, so no service can
   * collect from it, so it never sells a tonne and decays to nothing having
   * never produced anything. Worldgen does this for every site it places and
   * the same has to be true of every site placed later.
   */
  private connectSiteToRoad(site: number): void {
    const layer = this.layers[Mode.Road];
    const tile = this.sites.tile[site];
    if (layer.cls[tile] !== 255) {
      layer.terminal[tile] = 1;
      this.rebuild();
      return;
    }
    const size = this.config.size;
    let nearest = NONE;
    let nearestD = Infinity;
    const sx = tile % size;
    const sy = (tile / size) | 0;
    // The nearest existing road tile within a reasonable haul. Scanned rather
    // than searched outward because this happens a handful of times a century.
    for (let t = 0; t < layer.cls.length; t++) {
      if (layer.cls[t] === 255) continue;
      const dx = (t % size) - sx;
      const dy = ((t / size) | 0) - sy;
      const d = dx * dx + dy * dy;
      if (d < nearestD) { nearestD = d; nearest = t; }
    }
    if (nearest === NONE || nearestD > 120 * 120) return;
    const path = this.tileRouter.route(tile, nearest);
    if (!path || path.length < 2) return;
    const cls = this.publicRoadClass();
    if (cls < 0) return;
    const way = this.content.ways[cls];
    this.layPublicWay(Mode.Road, cls, path, this.wayCharge[cls], way.buildCost);
    layer.terminal[tile] = 1;
    this.rebuild();
  }

  /**
   * The road the authority would lay to reach a new works.
   *
   * A *lane*, or the nearest thing to one the era has — not the best road in the
   * catalogue, which is what this used to return. Every spur laid at runtime
   * came out as a dual carriageway: four lanes to a dairy farm, sixteen tiles of
   * motorway scattered through a district of hedgerows, and it defeated the
   * planning board's widening proposals too, because there was nothing left to
   * widen.
   *
   * A farm is on a lane. If the player wants it on a road, that is what the
   * parish is for.
   */
  private publicRoadClass(): number {
    const lane = this.content.ways.findIndex(
      (w) => w.mode === 'road' && w.era <= this.era && w.lanes <= 1,
    );
    if (lane >= 0) return lane;
    return this.bestRoadClassLegacy();
  }

  /** The best road the era can build. Kept for the callers that want the trunk. */
  private bestRoadClassLegacy(): number {
    let best = -1;
    let bestCost = -1;
    for (let i = 0; i < this.content.ways.length; i++) {
      const w = this.content.ways[i];
      if (w.mode !== 'road' || w.era > this.era || w.buildCost === 0) continue;
      if (w.buildCost > bestCost) { bestCost = w.buildCost; best = i; }
    }
    return best;
  }

  /** The two ends of an asset, in tiles, for surveying a scheme against it. */
  private assetEndpoints(asset: number): { from: number; to: number } | null {
    let from = NONE;
    let to = NONE;
    for (let l = 0; l < this.graph.linkCount; l += 2) {
      if (this.graph.linkAsset[l] !== asset) continue;
      const start = this.graph.linkChainStart[l];
      const len = this.graph.linkChainLen[l];
      if (from === NONE) from = this.graph.chain[start];
      to = this.graph.chain[start + len - 1];
    }
    if (from === NONE || to === NONE || from === to) return null;
    return { from, to };
  }


  private checkCharters(): void {
    for (let c = 1; c < this.companies.count; c++) {
      if (this.companies.bankrupt[c]) continue;
      const have = this.companies.charter[c];
      if (have >= Charter.Land) continue;
      const base = c * LINE_COUNT;
      const revenue =
        this.companies.ledgerYear[base + Line.Haulage] +
        this.companies.ledgerYear[base + Line.ContractBonus] +
        this.companies.ledgerYear[base + Line.AccessCharged];
      const delivered = this.companies.delivered[c];
      const cash = this.netWorth(c);
      /*
       * Thresholds measured against the game, not guessed at.
       *
       * The first set asked for six completed contracts, nine thousand a year
       * of revenue and four thousand in the bank. A sweep of eight thirty-year
       * runs put the best surviving company in the region at three contracts
       * and thirty-six hundred a year, so the first gate of the first act was
       * out of reach by a factor of three and Act II could not be entered by
       * anybody, ever. These sit near the upper quartile of what a company
       * that is actually doing well reaches: a good operator gets there, a
       * mediocre one does not, which is the only thing a gate is for.
       */
      const req = CHARTER_REQUIREMENTS;
      let earned = false;
      if (have === Charter.Carrier) {
        earned = delivered >= req.construction.contracts
          && revenue >= req.construction.revenue
          && cash >= req.construction.cash;
      } else if (have === Charter.Construction) {
        earned = revenue >= req.extraction.revenue && this.ownedAssets(c) >= req.extraction.assets;
      }
      if (earned) {
        this.companies.charter[c] = have + 1;
        this.onCharter?.(c, have + 1);
      }
    }
  }

  onCharter: ((company: number, charter: number) => void) | null = null;
  onEvent: ((kind: string, text: string) => void) | null = null;

  /**
   * What a company is actually worth: cash, less debt, plus what it owns.
   *
   * The charter used to ask for cash in hand, and a growing carrier does not
   * hold cash — it holds lorries. Across eight forty-year runs the median
   * surviving company had nothing in the bank and a working fleet, so a gate
   * written in cash was a gate that punished the exact behaviour it was meant
   * to reward, and Act II stayed shut against companies that had plainly
   * earned it.
   *
   * Vehicles are counted at what they would fetch, which is roughly half of
   * new and falling with age — the same figure a sale actually pays, so the
   * books cannot be flattered by owning something rather than selling it.
   */
  netWorth(company: number): number {
    let worth = this.companies.cash[company] - this.companies.debt[company];
    for (let v = 0; v < this.vehicles.count; v++) {
      if (!this.vehicles.alive[v] || this.vehicles.company[v] !== company) continue;
      const def = this.content.vehicles[this.vehicles.type[v]];
      const ageYears = (this.tick - this.vehicles.boughtTick[v]) / TICKS_PER_YEAR;
      worth += Math.max(def.cost * 0.15, def.cost * 0.55 * Math.pow(0.88, ageYears));
    }
    for (let a = 0; a < this.assets.count; a++) {
      if (this.assets.owner[a] !== company) continue;
      worth += this.assets.valuation(a, this.content.balance.valuationPct);
    }
    return worth;
  }

  ownedAssets(company: number): number {
    let n = 0;
    for (let a = 0; a < this.assets.count; a++) if (this.assets.owner[a] === company) n++;
    return n;
  }


  /**
   * A company that has stopped being a company.
   *
   * Not bankrupt — it owes nothing — and not trading either: no vehicles, and
   * less in hand than the cheapest lorry costs. There is no path out of that
   * on its own, because earning requires a vehicle and a vehicle requires
   * earning, so it would sit there until 2100. By year fifty, three of the
   * four operators in a region were in that state and the traffic had gone
   * with them.
   *
   * Calling it what it is puts it through the ordinary insolvency path, which
   * puts whatever it owns on the market and brings a new operator to the
   * region a few years later. design.md 3.8 says insolvency is an event in
   * the world rather than a game-over screen, and that has to be as true of
   * the quiet failures as of the loud ones.
   *
   * Three years of it before anybody says so. An earlier version acted at
   * once and killed companies that had merely sold their last lorry to clear a
   * debt and were about to buy another — bankruptcies went from 0.6 a run to
   * 2.7.
   */
  /**
   * The cheapest vehicle anybody can actually put on the road this year.
   *
   * *On the road* is the point. Asking for the cheapest vehicle of any mode
   * answers "a canal barge, fifty-six thousand pounds" for the whole of the
   * game, and a company with no canal cannot buy one — so a firm with no fleet
   * and eighty thousand pounds looked solvent, was not, and sat in the region
   * doing nothing for a hundred and fifty years because nothing ever wound it
   * up and nothing ever replaced it. Road is the mode every company can always
   * reach, because the authority's roads go everywhere, so it is the honest
   * measure of whether somebody can trade at all.
   */
  private cheapestStart(): number {
    let cheapest = Infinity;
    for (const v of this.content.vehicles) {
      if (this.vehicleMode[this.content.vehicleIndex.get(v.id) as number] !== Mode.Road) continue;
      if (v.era <= this.era && this.year < v.obsoleteYear && v.cost < cheapest) cheapest = v.cost;
    }
    return cheapest;
  }

  /**
   * What a new operator sets up with.
   *
   * A fixed sum was right in 1860 and absurd by 1960. Vehicle prices rise
   * roughly fortyfold across the eras — a dray is twenty-four thousand pounds
   * and a modern artic is eight hundred and sixty — while starting capital sat
   * at the 1860 figure for ever. So every entrant after about era three
   * arrived unable to buy a single vehicle of any kind, could not trade, and
   * could not fail either, because the test for a failed company also used
   * 1860 numbers. Four companies sat in the region with a hundred and thirty
   * thousand pounds each and no vehicles, for a hundred and fifty years.
   *
   * Tying it to the price of the cheapest thing they could buy makes it
   * self-tuning against the content rather than a second ladder to keep in
   * step with the first: enough for a vehicle and something to run it with.
   */
  private startingCapital(): number {
    const cheapest = this.cheapestStart();
    const floor = this.content.balance.startingCash;
    if (cheapest === Infinity) return floor;
    return Math.max(floor, Math.round(cheapest * ENTRANT_CAPITAL));
  }

  private checkStalled(): void {
    const cheapest = this.cheapestStart();
    if (cheapest === Infinity) return;
    const fleet = new Int32Array(this.companies.count);
    for (let v = 0; v < this.vehicles.count; v++) {
      if (this.vehicles.alive[v]) fleet[this.vehicles.company[v]]++;
    }
    for (let c = 1; c < this.companies.count; c++) {
      if (this.companies.bankrupt[c]) continue;
      /*
       * Debt is not part of the test, and leaving it out was the second half
       * of this fix. A company with no fleet and nothing to buy one with is
       * finished whether it owes money or not — and the version that required
       * no debt simply moved the problem, because such a company then sat on
       * a couple of thousand pounds of borrowings accruing six per cent until
       * it reached the credit limit, which takes fifty years.
       */
      const stalled = fleet[c] === 0 && this.companies.cash[c] < cheapest;
      if (!stalled) {
        this.companies.idleDays[c] = 0;
        continue;
      }
      if (++this.companies.idleDays[c] >= STALLED_DAYS) this.declareBankrupt(c);
    }
  }

  /**
   * design.md §3.8: insolvency is an event in the world, not a game-over
   * screen. The assets go on the market and everybody else gets to respond.
   */
  private declareBankrupt(company: number): void {
    if (this.companies.bankrupt[company]) return;
    this.companies.bankrupt[company] = 1;
    for (let a = 0; a < this.assets.count; a++) {
      if (this.assets.owner[a] === company) this.assets.forSale[a] = 1;
    }
    for (let id = 0; id < this.vehicles.count; id++) {
      if (this.vehicles.alive[id] && this.vehicles.company[id] === company) this.sellVehicle(id, false);
    }
    this.onEvent?.('bankruptcy', `${this.companies.names[company]} has gone into administration. Its assets are for sale.`);
    // Somebody will take the yard on. See newEntrant below.
    this.entrantDue = this.tick + (2 + this.rng.int(4)) * TICKS_PER_YEAR;
  }


  // ------------------------------------------------------------- commands

  apply(c: Command): void {
    switch (c.kind) {
      case Cmd.SetSpeed:
        this.speed = Math.max(0, Math.min(SPEED_STEPS.length - 1, c.a));
        break;
      case Cmd.Focus:
        this.focusX = c.a;
        this.focusY = c.b;
        break;
      case Cmd.BuyVehicle: {
        const id = this.buyVehicle(c.issuer, c.a, c.b);
        if (id !== NONE) this.lastVehicle[c.issuer] = id;
        break;
      }
      case Cmd.SellVehicle:
        this.sellVehicle(c.a, true);
        break;
      case Cmd.CreateService: {
        const id = this.services.alloc(c.issuer, typeof c.data === 'string' ? c.data : `Service ${this.services.count + 1}`, this.tick);
        if (id !== NONE) this.lastService[c.issuer] = id;
        break;
      }
      case Cmd.DeleteService:
        this.deleteService(c.a);
        break;
      case Cmd.AddStop: {
        // `c` packs the stop kind in the low two bits and the cargo in the
        // rest, so the command still fits four integers. 255 means "whatever
        // pays best". A service of -1 means "the one I just created".
        const svc = c.a < 0 ? this.lastService[c.issuer] : c.a;
        if (svc !== NONE && this.services.company[svc] === c.issuer) {
          this.services.addStop(svc, c.b, c.c & 3, c.d as StopAction, c.c >> 2);
        }
        break;
      }
      case Cmd.RemoveStop:
        this.removeStop(c.a, c.b, c.issuer);
        break;
      case Cmd.SetServiceActive:
        if (this.services.company[c.a] === c.issuer) this.services.active[c.a] = c.b ? 1 : 0;
        break;
      case Cmd.AssignVehicle:
        this.assignVehicle(
          c.a < 0 ? this.lastVehicle[c.issuer] : c.a,
          c.b < 0 ? this.lastService[c.issuer] : c.b,
          c.issuer,
        );
        break;
      case Cmd.UnassignVehicle:
        if (this.vehicles.company[c.a] === c.issuer) {
          this.vehicles.service[c.a] = NONE;
          this.vehicles.state[c.a] = VState.Idle;
        }
        break;
      case Cmd.SetCharge:
        this.setCharge(c.a, c.b, c.issuer);
        break;
      case Cmd.BuyAsset:
        this.buyAsset(c.a, c.issuer);
        break;
      case Cmd.ListAsset:
        if (this.assets.owner[c.a] === c.issuer) this.assets.forSale[c.a] = c.b ? 1 : 0;
        break;
      case Cmd.Modernise:
        this.modernise(c.issuer, c.a);
        break;
      case Cmd.BuildWay:
        // Tile list in `data`, because a route is the one payload that will
        // not fit in four integers. Still a few hundred bytes in the log.
        if (Array.isArray(c.data)) this.buildWay(c.issuer, c.a, c.b, c.data);
        break;
      case Cmd.DemolishWay:
        if (Array.isArray(c.data)) this.demolishWay(c.issuer, c.a, c.data);
        break;
      case Cmd.FoundIndustry:
        this.foundIndustry(c.issuer, c.a, c.b);
        break;
      case Cmd.DemolishSite:
        this.demolishSite(c.issuer, c.a);
        break;
      case Cmd.SellAsset:
        this.sellAsset(c.a, c.issuer);
        break;
      case Cmd.SetNodeControl:
        if (c.a < this.graph.nodeCount) this.graph.nodeControl[c.a] = c.b;
        break;
      case Cmd.DeclareBankrupt:
        // Only about yourself. A command that could bankrupt a rival would be
        // the shortest griefing route in a shared world.
        if (c.a === c.issuer) this.declareBankrupt(c.issuer);
        break;
      case Cmd.GrantCharter:
        this.companies.charter[c.a] = c.b;
        break;
      default:
        // Later acts register their handlers by extending this switch; an
        // unknown command must be ignored rather than throwing, so that an
        // old client replaying a newer log degrades instead of dying.
        this.applyExtended?.(c);
        break;
    }
  }

  /** Phase 2 and later attach here rather than editing the switch above. */
  applyExtended: ((c: Command) => void) | null = null;

  // ---------------------------------------------------------- construction

  /**
   * The route a way would take between two tiles, as tile indices.
   *
   * The same hierarchical search the region generator uses, so the road the
   * player is shown is the road the authority would have built — which means
   * an alignment that looks sensible *is* sensible, and the player is not
   * fighting a router with different opinions from their own.
   */
  proposeRoute(fromTile: number, toTile: number, cls = -1): Int32Array | null {
    const path = this.tileRouter.route(fromTile, toTile);
    if (!path) return null;
    const minRadius = cls >= 0 ? (this.content.ways[cls]?.minRadius ?? 0) : 0;
    return minRadius > 0 ? alignForRadius(path, minRadius, this.config.size) : path;
  }

  /** Plan an alignment without committing it: the estimate the player sees. */
  planWay(mode: number, cls: number, path: ArrayLike<number>, company = this.player): Alignment {
    const way = this.content.ways[cls];
    return planAlignment(
      this.terrain, this.layers[mode], path, cls,
      {
        buildCost: way.buildCost,
        maxGradient: way.maxGradient,
        // Only water locks. A road that cannot climb a hill goes round it; a
        // canal builds a staircase, and that difference is most of what makes
        // a canal a canal.
        locking: way.mode === 'water' ? LOCK_LIFT : 0,
        minRadius: way.minRadius,
        bridgeCostPct: way.bridgeCostPct,
        tunnelCostPct: way.tunnelCostPct,
      },
      company,
      (asset) => this.assets.owner[asset],
    );
  }

  /**
   * Lay a way. design.md §3.5: from Act II you can build, therefore own,
   * therefore charge — so this is also where the first asset a company owns
   * comes from, and where the rent line in the income statement starts.
   */
  /**
   * Rebuild a works to current practice. features.md §4.
   *
   * The answer to ageing, and deliberately an expensive one: a works that has
   * fallen behind is still producing, so this is a choice about capital rather
   * than a repair somebody has to make. Priced against what it would cost to
   * found the thing today and scaled by how far behind it has fallen, so
   * modernising something recently built is nearly free and nearly pointless,
   * and rescuing a century-old works costs most of a new one.
   */
  modernisePrice(site: number): number {
    if (site < 0 || site >= this.sites.count) return 0;
    const def = this.content.industries[this.sites.def[site]];
    const behind = Math.max(0, 100 - this.sites.modernity[site]) / 100;
    return Math.round(def.foundCost * 0.75 * behind);
  }

  modernise(company: number, site: number): boolean {
    if (site < 0 || site >= this.sites.count) return false;
    if (this.sites.owner[site] !== company) {
      this.onEvent?.('refused', 'That is not yours to rebuild.');
      return false;
    }
    if (this.sites.modernity[site] >= 96) {
      this.onEvent?.('refused', 'There is nothing out of date about it.');
      return false;
    }
    const price = this.modernisePrice(site);
    if (company !== AUTHORITY && this.companies.cash[company] < price) {
      this.onEvent?.('refused', `Rebuilding that would cost ${Math.round(price / 100)}.`);
      return false;
    }
    if (company !== AUTHORITY) this.companies.post(company, Line.Construction, price);
    this.sites.built[site] = this.year;
    this.sites.modernity[site] = 100;
    if (company === this.player) {
      this.onEvent?.('founded', `${this.content.industries[this.sites.def[site]].name} rebuilt to current practice.`);
    }
    return true;
  }




  buildWay(company: number, mode: number, cls: number, path: ArrayLike<number>): boolean {
    const way = this.content.ways[cls];
    if (!way) return false;
    if (this.companies.charter[company] < Charter.Construction) {
      this.onEvent?.('refused', 'You have no construction charter. The authority builds the roads.');
      return false;
    }
    if (way.era > this.era) return false;
    const plan = this.planWay(mode, cls, path, company);
    if (!plan.ok) {
      this.onEvent?.('refused', plan.problem);
      return false;
    }
    if (this.companies.cash[company] < plan.totalCost) {
      this.onEvent?.('refused', `Not enough cash: that alignment costs ${Math.round(plan.totalCost / 100)}.`);
      return false;
    }

    const asset = this.assets.alloc(mode, cls, company, this.wayCharge[cls], this.tick);
    if (asset === NONE) return false;
    const laid = layAlignment(this.layers[mode], this.config.size, plan, cls, asset);
    this.assets.tiles[asset] = laid;
    this.assets.buildCost[asset] = plan.totalCost;
    if (laid === 0) {
      // Entirely over existing formation: no new asset, just an upgrade.
      this.assets.count--;
    }
    this.companies.post(company, Line.Construction, plan.totalCost);
    this.rebuild();
    this.router.invalidate();
    return true;
  }

  // ------------------------------------------------------------- industry

  /**
   * Found an industry. The extraction charter, design.md §1's Act III.
   *
   * Returns a reason rather than a boolean, because every refusal here is
   * something the player needs to be told: the wrong ground, the wrong era,
   * the wrong charter, or simply not enough money.
   */
  canFound(company: number, defIndex: number, tile: number): string {
    const def = this.content.industries[defIndex];
    if (!def) return 'No such industry.';
    if (def.fromEra > this.era) return `${def.name} does not exist until era ${def.fromEra}.`;
    const needed = def.kind === 'extraction' || def.kind === 'processing' || def.kind === 'utility'
      ? Charter.Extraction
      : Charter.Land;
    // The authority is the region. It does not hold a charter from itself,
    // and requiring one meant the region could never gain an industry after
    // 1860: a game run to 2100 had exactly the same works in it as a game run
    // to 1861, and half the cargo table had nothing anywhere that made it.
    if (company !== AUTHORITY && this.companies.charter[company] < needed) {
      return needed === Charter.Extraction
        ? 'You have no extraction charter. You may haul and you may build, but you may not dig.'
        : 'You have no land charter.';
    }
    const x = tile % this.config.size;
    const y = (tile / this.config.size) | 0;
    /*
     * Water is a refusal unless the ground you need is under it.
     *
     * An oil rig wants an oil deposit, every oil deposit the generator places
     * is on the sea bed, and this line refused every one of them — so the rig
     * could not be founded anywhere in any region, and crude oil, refined fuel
     * and chemicals were unreachable content for the whole project. The
     * deposit rules already decide where an industry belongs; this check is
     * about not building a colliery in the sea, which they also decide.
     */
    const wantsWater = def.deposit > 0 && this.terrain.deposit[tile] === def.deposit;
    if (!wantsWater && !this.terrain.isLand(x, y)) return 'That is water.';
    if (!wantsWater && (this.terrain.flags[tile] & TileFlag.Buildable) === 0) {
      return 'The ground is too steep.';
    }
    if (def.deposit > 0 && this.terrain.deposit[tile] !== def.deposit) {
      const names = DEPOSIT_NAMES[def.deposit] ?? 'the right ground';
      return `A ${def.name.toLowerCase()} needs ${names}. There is none here.`;
    }
    for (let s = 0; s < this.sites.count; s++) {
      const dx = this.sites.x[s] - x;
      const dy = this.sites.y[s] - y;
      if (dx * dx + dy * dy < 25) return 'Too close to another site.';
    }
    // The authority does not buy land from itself either.
    if (company !== AUTHORITY && this.companies.cash[company] < def.foundCost) {
      return `Not enough cash: ${def.name} costs ${Math.round(def.foundCost / 100)}.`;
    }
    return '';
  }

  foundIndustry(company: number, defIndex: number, tile: number): number {
    const problem = this.canFound(company, defIndex, tile);
    if (problem) {
      this.onEvent?.('refused', problem);
      return NONE;
    }
    const def = this.content.industries[defIndex];
    const x = tile % this.config.size;
    const y = (tile / this.config.size) | 0;
    const site = this.sites.alloc(defIndex, x, y, tile, company);
    if (site === NONE) return NONE;
    // Founding one claims its ground, the same as buying one does.
    if (company === this.player) this.landRevision++;
    this.sites.extraction[site] = def.kind === 'extraction' ? 1 : 0;
    this.sites.built[site] = this.year;
    this.sites.modernity[site] = 100;
    this.sites.richness[site] = 40 + (this.terrain.deposit[tile] > 0 ? 40 : 20);
    this.sites.cycle[site] = def.recipe.period;
    const cargoCount = this.content.cargo.length;
    for (const [id, amount] of Object.entries(def.recipe.inputs)) {
      const ci = this.content.cargoIndex.get(id);
      if (ci !== undefined) this.sites.capacity[site * cargoCount + ci] = amount * 30;
    }
    for (const [id, amount] of Object.entries(def.recipe.outputs)) {
      const ci = this.content.cargoIndex.get(id);
      if (ci !== undefined) this.sites.capacity[site * cargoCount + ci] = amount * 40;
    }
    this.siteAccessTile[site] = tile;
    if (company !== AUTHORITY) this.companies.post(company, Line.Construction, def.foundCost);
    this.rebuild();
    this.onEvent?.('founded', `${def.name} founded.`);
    return site;
  }

  /** Take a way up again. Only your own, and you get nothing back for it —
   *  the earth stays moved and the materials are scrap. */
  demolishWay(company: number, mode: number, tiles: ArrayLike<number>): number {
    const layer = this.layers[mode];
    let removed = 0;
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      const asset = layer.asset[tile];
      if (asset !== NONE && this.assets.owner[asset] !== company) continue;
      if (removeWayTile(layer, this.config.size, tile)) {
        removed++;
        if (asset !== NONE) this.assets.tiles[asset]--;
      }
    }
    if (removed > 0) {
      this.landRevision++;
      this.rebuild();
      this.router.invalidate();
    }
    return removed;
  }

  /** Two bare-node waypoints. Only the performance and balance harnesses use
   *  this; it exists so they do not need an industry at every junction. */
  stressNodeStops(service: number, a: number, b: number): void {
    this.services.addStop(service, a, 2, StopAction.Exchange, 255);
    this.services.addStop(service, b, 2, StopAction.Exchange, 255);
  }

  buyVehicle(company: number, typeIndex: number, atSite: number): number {
    const def = this.content.vehicles[typeIndex];
    if (!def) return NONE;
    if (this.companies.cash[company] < def.cost && this.companies.debt[company] > 0) return NONE;
    const id = this.vehicles.alloc();
    this.vehicles.company[id] = company;
    this.vehicles.type[id] = typeIndex;
    this.vehicles.length[id] = def.cells;
    this.vehicles.boughtTick[id] = this.tick;
    this.vehicles.state[id] = VState.Idle;
    const node = atSite >= 0 && atSite < this.sites.count
      ? this.sites.nodeOf(atSite, this.vehicleMode[typeIndex])
      : NONE;
    this.vehicles.targetNode[id] = node;
    this.companies.post(company, Line.VehiclePurchase, def.cost);
    return id;
  }

  sellVehicle(id: number, refund: boolean): void {
    if (!this.vehicles.alive[id]) return;
    const link = this.vehicles.link[id];
    if (link !== NONE) {
      this.graph.cells[this.graph.linkCellStart[link] + this.vehicles.cell[id]] = NONE;
      if (this.graph.linkOccupancy[link] > 0) this.graph.linkOccupancy[link]--;
    }
    if (refund) {
      // Depreciated: half the list price, falling with age.
      const def = this.content.vehicles[this.vehicles.type[id]];
      const ageYears = (this.tick - this.vehicles.boughtTick[id]) / TICKS_PER_YEAR;
      const value = Math.max(def.cost * 0.15, def.cost * 0.55 * Math.pow(0.88, ageYears));
      this.companies.post(this.vehicles.company[id], Line.AssetTrade, Math.round(value));
    }
    const svc = this.vehicles.service[id];
    if (svc !== NONE) this.services.vehicles[svc]--;
    this.vehicles.release(id);
  }

  assignVehicle(vehicle: number, service: number, issuer: number): void {
    if (vehicle === NONE || service === NONE) return;
    if (!this.vehicles.alive[vehicle] || this.vehicles.company[vehicle] !== issuer) return;
    if (service < 0 || service >= this.services.count) return;
    if (this.services.company[service] !== issuer) return;
    const old = this.vehicles.service[vehicle];
    if (old !== NONE) this.services.vehicles[old]--;
    this.vehicles.service[vehicle] = service;
    this.vehicles.orderIndex[vehicle] = 0;
    this.vehicles.state[vehicle] = VState.Idle;
    this.services.vehicles[service]++;
  }

  private deleteService(id: number): void {
    for (let v = 0; v < this.vehicles.count; v++) {
      if (this.vehicles.alive[v] && this.vehicles.service[v] === id) {
        this.vehicles.service[v] = NONE;
        this.vehicles.state[v] = VState.Idle;
      }
    }
    this.services.release(id);
  }

  private removeStop(service: number, index: number, issuer: number): void {
    if (this.services.company[service] !== issuer) return;
    const n = this.services.stopCount[service];
    if (index < 0 || index >= n) return;
    for (let i = index; i < n - 1; i++) {
      const a = service * MAX_STOPS + i;
      const b = a + 1;
      this.services.stopTarget[a] = this.services.stopTarget[b];
      this.services.stopKind[a] = this.services.stopKind[b];
      this.services.stopAction[a] = this.services.stopAction[b];
      this.services.stopCargo[a] = this.services.stopCargo[b];
    }
    this.services.stopCount[service] = n - 1;
  }

  /**
   * Setting a charge is the moment the toll curve becomes real, so it also has
   * to invalidate routing. A rival dropping their toll must pull traffic back
   * onto their road within a few ticks, or the primary snowball damper does
   * not exist (architecture.md §6, risks.md R6).
   */
  setCharge(asset: number, charge: number, issuer: number): void {
    if (asset < 0 || asset >= this.assets.count) return;
    if (this.assets.owner[asset] !== issuer) return;
    this.assets.charge[asset] = Math.max(0, Math.min(400, charge));
    this.recomputeLinkCharges();
    this.router.invalidate();
  }

  private recomputeLinkCharges(): void {
    for (let l = 0; l < this.graph.linkCount; l += 2) {
      const start = this.graph.linkChainStart[l];
      const len = this.graph.linkChainLen[l];
      const layer = this.layers[this.graph.linkMode[l]];
      let charge = 0;
      for (let i = 0; i < len; i++) {
        const a = layer.asset[this.graph.chain[start + i]];
        if (a !== NONE) charge += this.assets.charge[a];
      }
      this.graph.linkCharge[l] = charge;
      this.graph.linkCharge[l + 1] = charge;
    }
  }

  /** Close an industry you own. The ground stays spoiled; that is what
   *  remediation is for, in era 7. */
  demolishSite(company: number, site: number): boolean {
    if (site < 0 || site >= this.sites.count) return false;
    if (this.sites.owner[site] !== company) return false;
    this.sites.state[site] = SiteState.Dead;
    this.sites.everServed[site] = 1;
    return true;
  }

  /**
   * Sell an asset back to the authority.
   *
   * At the same valuation a buyer would pay, less a discount — the authority
   * is a buyer of last resort and prices like one. This exists mainly so a
   * player who overbuilt has a way out that is not insolvency.
   */
  sellAsset(asset: number, seller: number): boolean {
    if (asset < 0 || asset >= this.assets.count) return false;
    if (this.assets.owner[asset] !== seller) return false;
    const price = Math.round(this.assets.valuation(asset, this.content.balance.valuationPct) * 0.7);
    this.assets.owner[asset] = AUTHORITY;
    this.assets.charge[asset] = this.wayCharge[this.assets.cls[asset]];
    this.assets.forSale[asset] = 0;
    this.companies.post(seller, Line.AssetTrade, price);
    this.recomputeLinkCharges();
    this.router.invalidate();
    return true;
  }

  /** design.md §3.2: buy flips a cost into an income and hands you the rate. */
  buyAsset(asset: number, buyer: number): boolean {
    if (asset < 0 || asset >= this.assets.count) return false;
    const owner = this.assets.owner[asset];
    if (owner === buyer) return false;
    if (owner !== AUTHORITY && !this.assets.forSale[asset] && !this.companies.bankrupt[owner]) return false;
    const price = this.assets.valuation(asset, this.content.balance.valuationPct);
    if (this.companies.cash[buyer] < price) return false;
    // A purchase is an expenditure for the buyer and income for the seller.
    // `post` on the AssetTrade line is signed as income, so the buyer's side
    // is posted through Construction — the money has to leave, and it has to
    // leave on a line that reads as capital rather than as trading.
    this.companies.post(buyer, Line.Construction, price);
    if (owner !== AUTHORITY) this.companies.post(owner, Line.AssetTrade, price);
    this.assets.owner[asset] = buyer;
    this.assets.forSale[asset] = 0;
    this.router.invalidate();
    this.onEvent?.('purchase', `${this.companies.names[buyer]} has bought ${this.content.ways[this.assets.cls[asset]].name.toLowerCase()} for ${(price / 100).toFixed(0)}.`);
    return true;
  }

  // --------------------------------------------------------------- yards

  /** How many vehicles are based at a yard right now. */
  basedAt(yard: number): number {
    let n = 0;
    for (let v = 0; v < this.vehicles.count; v++) {
      if (this.vehicles.alive[v] && this.vehicleYard[v] === yard) n++;
    }
    return n;
  }

  /**
   * Where could this vehicle go, and if nowhere, why not?
   *
   * Answers for the whole fleet at once because that is the question the
   * Vehicles screen asks: not "can yard three take a tanker" but "can I buy a
   * tanker at all, and if not, what is stopping me". The answer is a yard or a
   * sentence.
   */
  yardFor(typeIndex: number): { yard: number; reason: string } {
    const def = this.content.vehicles[typeIndex];
    if (!def) return { yard: NONE, reason: 'No such vehicle.' };
    const needs = { handling: def.handling as readonly string[], cls: def.class };
    let firstReason = 'You have no yard.';
    for (let y = 0; y < this.yards.count; y++) {
      if (this.yards.owner[y] !== this.player) continue;
      const verdict = canBase(this.yards, y, needs, this.basedAt(y));
      if (verdict.ok) return { yard: y, reason: '' };
      const text = refusalText(this.yards, y, verdict);
      if (firstReason === 'You have no yard.') firstReason = text;
    }
    return { yard: NONE, reason: firstReason };
  }

  /**
   * Buy a vehicle, at a yard that can take it.
   *
   * The whole point of the facilities rule lives in the return value: NONE plus
   * a reason, rather than a silent refusal. A purchase that fails without saying
   * why is the difference between a constraint and a bug.
   */
  buyVehicleAtYard(
    typeIndex: number, into = NONE,
  ): { vehicle: number; reason: string } {
    const def = this.content.vehicles[typeIndex];
    if (!def) return { vehicle: NONE, reason: 'No such vehicle.' };
    if (this.companies.cash[this.player] < def.cost) {
      return { vehicle: NONE, reason: 'Not enough in the bank.' };
    }
    /*
     * Into a named yard when the caller says which, and that is the normal case
     * now.
     *
     * Buying used to be a catalogue screen that found *a* yard which could take
     * the vehicle, which quietly made "where does it live" the game's decision
     * rather than the player's. Buying happens at a yard's empty bay instead:
     * you are filling a specific space in a specific place, which is what makes
     * a yard's capacity and its facilities mean something. The search is kept for
     * the opening, which has one yard and no interface yet.
     */
    let yard = into;
    if (yard === NONE) {
      const found = this.yardFor(typeIndex);
      if (found.yard === NONE) return { vehicle: NONE, reason: found.reason };
      yard = found.yard;
    } else {
      if (yard < 0 || yard >= this.yards.count) {
        return { vehicle: NONE, reason: 'No such yard.' };
      }
      if (this.yards.owner[yard] !== this.player) {
        return { vehicle: NONE, reason: 'Not your yard.' };
      }
      const verdict = canBase(this.yards, yard, {
        handling: def.handling as readonly string[], cls: def.class,
      }, this.basedAt(yard));
      if (!verdict.ok) {
        return { vehicle: NONE, reason: refusalText(this.yards, yard, verdict) };
      }
    }

    // Park it at the nearest site to the yard, because a vehicle has to start
    // somewhere on the network and the yard is not a graph node yet.
    let nearest = NONE;
    let best = Infinity;
    for (let s = 0; s < this.sites.count; s++) {
      if (this.siteAccessTile[s] === NONE) continue;
      const dx = this.sites.x[s] - this.yards.x[yard];
      const dy = this.sites.y[s] - this.yards.y[yard];
      const d = dx * dx + dy * dy;
      if (d < best) { best = d; nearest = s; }
    }
    const id = this.buyVehicle(this.player, typeIndex, nearest);
    if (id === NONE) return { vehicle: NONE, reason: 'Could not put it on the road.' };
    this.vehicleYard[id] = yard;
    return { vehicle: id, reason: '' };
  }

  /** Put a facility into a yard. */
  addFacility(yard: number, facility: number): boolean {
    if (yard < 0 || yard >= this.yards.count) return false;
    if (this.yards.owner[yard] !== this.player) return false;
    if (this.yards.has(yard, facility)) return false;
    const cost = FACILITY_COST[facility] ?? 0;
    if (this.companies.cash[this.player] < cost) return false;
    this.companies.post(this.player, Line.Construction, cost);
    this.yards.add(yard, facility);
    return true;
  }

  /** Found the starting yard. Called once, at the beginning. */
  foundYard(x: number, y: number, name: string): number {
    const tile = y * this.config.size + x;
    const id = this.yards.alloc(x, y, tile, this.player, name);
    if (id !== NONE) {
      // A yard owns its ground like a business does.
      this.landRevision++;
      this.refreshInfluence();
    }
    return id;
  }

  // ------------------------------------------------------- buying a place

  /**
   * What a place costs.
   *
   * Its build cost, plus a premium for being near a town — which is the
   * land-value gradient from design.md as one line rather than as a system. A
   * farm out in the hills is cheap; the same farm on the edge of the market
   * town is not, and that is what stops the player buying their way into the
   * middle of the district on the first afternoon.
   */
  priceOf(site: number): number {
    const def = this.content.industries[this.sites.def[site]];
    let nearest = 1e9;
    for (let t = 0; t < this.towns.count; t++) {
      const dx = this.towns.x[t] - this.sites.x[site];
      const dy = this.towns.y[t] - this.sites.y[site];
      const d = Math.sqrt(dx * dx + dy * dy);
      const weighted = d / Math.max(1, Math.sqrt(this.towns.population[t] / 400));
      if (weighted < nearest) nearest = weighted;
    }
    // Doubles at the town gate, falls away to nothing by about thirty tiles.
    const premium = 1 + Math.max(0, 1 - nearest / 30);
    /*
     * And what it is currently worth as a going concern.
     *
     * A works nobody supplies is not worth what a works with lorries queuing
     * outside is worth, and pricing them the same made the whole of ownership a
     * question of how much cash you had. Half price when it is completely
     * starved, full price when it is fed.
     *
     * This is the lever that replaces the rule it used to have. You no longer
     * need to own a producer of every input before you may buy a place — that
     * demanded millions of pounds of chain to climb one rung, and it was
     * pretending to be a brake it was not, because an owned works you do not
     * haul to makes nothing anyway. Instead the market prices the risk: the
     * cheap businesses are the ones that need what you are good at, and buying
     * the biggest thing you cannot feed is a bad deal you can see the shape of
     * before you make it.
     */
    const going = 0.5 + (this.sites.fed[site] / 100) * 0.5;
    return Math.round(def.foundCost * premium * going * SITE_PRICE_SCALE);
  }

  /**
   * Who could supply this place, input by input.
   *
   * The mirror of `buyersFor`, and the same observation read the other way: a
   * supplier is a place with an output, which is a contract seen from the near
   * end. Neither needs a new table.
   *
   * Grouped **by input cargo** rather than returned as one flat list, because
   * the rule below is per-cargo: a village shop wants meat *and* dairy, and
   * owning two abattoirs does not get you the dairy. Several places can supply
   * the same input and any one of them counts, which is what makes the ladder a
   * choice rather than a corridor.
   *
   * `visible` is the influence test. A supplier you cannot see must not be
   * named — the interface shows it as an unknown, because telling the player
   * "you need the creamery at Ashcombe" while Ashcombe is under fog hands them
   * the map for free and empties the influence area of its whole purpose.
   */
  suppliersFor(site: number): {
    cargo: number;
    owned: boolean;
    candidates: { site: number; distance: number; visible: boolean }[];
    /** How many exist in the district but cannot be seen yet. */
    hidden: number;
  }[] {
    const out: {
      cargo: number; owned: boolean;
      candidates: { site: number; distance: number; visible: boolean }[];
      hidden: number;
    }[] = [];
    if (site < 0 || site >= this.sites.count) return out;
    const ins = this.recipes.inputs[this.sites.def[site]];
    for (let i = 0; i < ins.length; i += 2) {
      const cargo = ins[i];
      const candidates: { site: number; distance: number; visible: boolean }[] = [];
      let owned = false;
      let hidden = 0;
      for (let b = 0; b < this.sites.count; b++) {
        if (b === site) continue;
        const outs = this.recipes.outputs[this.sites.def[b]];
        let makes = false;
        for (let k = 0; k < outs.length; k += 2) if (outs[k] === cargo) { makes = true; break; }
        if (!makes) continue;
        const tile = this.siteAccessTile[b];
        const visible = tile !== NONE && this.influence.usable(tile);
        if (this.sites.owner[b] === this.player) owned = true;
        if (!visible) { hidden++; continue; }
        const dx = this.sites.x[b] - this.sites.x[site];
        const dy = this.sites.y[b] - this.sites.y[site];
        candidates.push({
          site: b,
          distance: Math.round(Math.sqrt(dx * dx + dy * dy)),
          visible,
        });
      }
      candidates.sort((a, b) => a.distance - b.distance);
      out.push({ cargo, owned, candidates, hidden });
    }
    return out;
  }

  /**
   * Can this place be bought?
   *
   * Anything inside your influence that you can afford. That is the whole rule
   * now, and it used to be much more than that.
   *
   * The old rule was **you must already own a supplier for every input**: no
   * creamery until you owned something making milk, no shop until you owned the
   * creamery. It was written to stop the player saving up and buying the most
   * valuable thing in sight, which skips the middle of the game — a real
   * concern, and it turned out to be the wrong instrument for two reasons.
   *
   * It did not work. Follow the chain up and the entry price becomes millions,
   * so the middle of the game is a long grind at the end of which you can afford
   * the top of the chain and swallow the rest of it in an afternoon. The shape it
   * produced was exactly the shape it was meant to prevent, arriving later.
   *
   * And it was guarding something that guards itself. Nobody in this district
   * hauls but the player — measured: in a four-company world there is not one
   * vehicle that is not yours — so a works you own and do not supply produces
   * *nothing at all*. The economics already force you to build the chain from
   * the bottom. The rule was not adding a constraint, it was adding a queue in
   * front of one.
   *
   * So the constraint is now the fleet, which is honest about itself: every place
   * you own needs a lorry, or a share of one, for as long as you own it. You may
   * buy the distribution centre the day you can afford it and find it wants
   * seven vehicles you have not got — a wall you can see coming and work toward,
   * rather than a locked door. `priceOf` does the other half: a starved works is
   * half price, so the cheap businesses are the ones that need what you are good
   * at.
   *
   * There was briefly one survivor of the old rule, for shops: you had to have
   * run a load in before the parish would sell you the counter. It was a nice
   * idea — "are you the one whose van pulls up outside" is a question about
   * hauling rather than owning — and it was *unsatisfiable*, which is worse than
   * wrong. Measured: fifty contract offers across three seeds and not one of them
   * had a shop as its destination, so there was no way to deliver a load to a
   * shop and therefore no way to ever buy one. A condition with no path to
   * meeting it is a locked door with a sign on it.
   */
  canBuySite(site: number): { ok: boolean; reason: string; needs: number[] } {
    const needs: number[] = [];
    if (site < 0 || site >= this.sites.count) {
      return { ok: false, reason: 'No such place.', needs };
    }
    if (this.sites.owner[site] === this.player) {
      return { ok: false, reason: 'Already yours.', needs };
    }
    const tile = this.siteAccessTile[site];
    if (tile === NONE || !this.influence.usable(tile)) {
      return { ok: false, reason: 'Too far out. You have no standing there yet.', needs };
    }
    /*
     * And whether you can pay for it, which nothing checked.
     *
     * There was no affordability test anywhere in this function — the price was
     * computed in `buySite` and then posted, so with the ownership gate gone the
     * only remaining condition on buying anything at all was that you could see
     * it. Together with the sign error above, a player could buy every business
     * in the district on day one and be paid for the privilege.
     */
    const price = this.priceOf(site);
    if (this.companies.cash[this.player] < price) {
      return { ok: false, reason: 'Not enough in the bank.', needs };
    }

    /*
     * `needs` is still filled in, and still means the same thing — which inputs
     * you have no supplier of. It is no longer a refusal; the interface reads it
     * to say what you will have to arrange, which is the useful half of what the
     * old rule was doing.
     */
    for (const group of this.suppliersFor(site)) {
      if (!group.owned) needs.push(group.cargo);
    }
    if (this.companies.cash[this.player] < this.priceOf(site)) {
      return { ok: false, reason: 'Not enough in the bank.', needs };
    }
    return { ok: true, reason: '', needs };
  }

  /**
   * Buy a place.
   *
   * This is the pivot of the whole game (design.md §3, rung 2). Taking a
   * contract is somebody telling you A to B. Owning a farm inverts it: you have
   * output and nobody has asked for it, so you have to go and find buyers.
   *
   * It is also a beachhead — `refreshInfluence` reads site ownership, so buying
   * a place opens the map around it. That is what makes "buy the far shop" and
   * "buy the near farm" genuinely different decisions rather than two sizes of
   * the same one.
   */
  buySite(site: number): { ok: boolean; reason: string } {
    // Every condition lives in `canBuySite`, so the button's greyed-out reason
    // and the actual refusal cannot drift apart — which is the commonest way a
    // rule like this ends up lying to the player.
    const verdict = this.canBuySite(site);
    if (!verdict.ok) return { ok: false, reason: verdict.reason };
    const price = this.priceOf(site);
    /*
     * Negative, because buying a business is not a way of earning money.
     *
     * `Line.AssetTrade` is an income line, and `post` adds an income line to
     * cash — so posting the price to it paid the player the price of the thing
     * they were buying. Buying the district made you rich, which is a
     * sufficiently good deal that nobody would ever have done anything else.
     *
     * A negative on the same line rather than a new debit line, because asset
     * trading is genuinely a net figure: what you paid for places and what you
     * got for them belong in one row, and reading it as a net is how any set of
     * accounts would present it.
     */
    this.companies.post(this.player, Line.AssetTrade, -price);
    this.note(site, MoneyKind.Bought, -price);
    this.sites.owner[site] = this.player;
    this.absorbContracts(site);
    // The land it stands on is yours now too, and the ground is drawn from this.
    this.landRevision++;
    this.refreshInfluence();
    // New standing means new work in view.
    this.offerWorkNow();
    return { ok: true, reason: '' };
  }

  /**
   * Who would take what this place of yours makes.
   *
   * The other half of the inversion: a buyer is a place with a requirement,
   * which is a contract seen from the far end. So this needs no new system —
   * only a different way of asking the same tables.
   *
   * Pays better than hauling for somebody else, because you are selling the
   * goods as well as moving them. That difference is the reward for the rung.
   */
  buyersFor(site: number): {
    site: number; cargo: number; distance: number; pay: number;
  }[] {
    const out: { site: number; cargo: number; distance: number; pay: number }[] = [];
    if (this.sites.owner[site] !== this.player) return out;
    const cargoCount = this.content.cargo.length;
    for (const cargo of this.offersOf(site)) {
      for (let b = 0; b < this.sites.count; b++) {
        if (b === site) continue;
        const tile = this.siteAccessTile[b];
        if (tile === NONE || !this.influence.usable(tile)) continue;
        const ins = this.recipes.inputs[this.sites.def[b]];
        let takes = false;
        for (let k = 0; k < ins.length; k += 2) if (ins[k] === cargo) { takes = true; break; }
        if (!takes) continue;
        const dx = this.sites.x[b] - this.sites.x[site];
        const dy = this.sites.y[b] - this.sites.y[site];
        const distance = Math.round(Math.sqrt(dx * dx + dy * dy));
        if (distance < 2) continue;
        void cargoCount;
        // The haulage rate plus the value of the goods, because they are yours.
        const haul = haulageRate(this.cargoPrice[cargo], distance, this.cargoRateWeight[cargo]);
        const goods = Math.round(this.cargoPrice[cargo] * 0.55);
        out.push({ site: b, cargo, distance, pay: haul + goods });
      }
    }
    out.sort((a, b) => b.pay - a.pay);
    return out;
  }

  /**
   * Build a distribution centre.
   *
   * The last rung but one, and it needed almost no new machinery — which is the
   * point. A depot is a *place* like any other, so it goes on the map as a site
   * with a spur to the road, and it is a *yard* as well, so lorries live in it.
   * Two records for one building is not elegant, but the alternative is teaching
   * the site tables about bays or the yard tables about stock, and each of those
   * is a second implementation of something that already works.
   *
   * Eight bays and a long bay from the start, because the whole reason to have
   * one is to break bulk: an artic brings twenty-four tonnes in, and three small
   * vans take it out to the villages an artic cannot reach. A depot that could
   * not house the artic would be a shed.
   */
  foundDepot(x: number, y: number, name: string): { site: number; reason: string } {
    const defIndex = this.content.industries.findIndex((i) => i.passThrough);
    if (defIndex < 0) return { site: NONE, reason: 'No depot in the content.' };
    const size = this.config.size;
    if (x < 1 || y < 1 || x >= size - 1 || y >= size - 1) {
      return { site: NONE, reason: 'Off the map.' };
    }
    const tile = y * size + x;
    if (this.terrain.height[tile] <= 0) return { site: NONE, reason: 'That is water.' };
    if (!this.influence.usable(tile)) {
      return { site: NONE, reason: 'You have no standing out there yet.' };
    }
    if (this.yards.count >= MAX_YARDS) {
      return { site: NONE, reason: 'You have as many yards as you can run.' };
    }
    const cost = this.content.industries[defIndex].foundCost * SITE_PRICE_SCALE;
    if (this.companies.cash[this.player] < cost) {
      return { site: NONE, reason: 'Not enough in the bank.' };
    }
    // Not on top of something else. Six tiles, the same clearance worldgen uses.
    for (let s = 0; s < this.sites.count; s++) {
      const dx = this.sites.x[s] - x;
      const dy = this.sites.y[s] - y;
      if (dx * dx + dy * dy < 36) return { site: NONE, reason: 'Too close to something.' };
    }
    /*
     * Ask why *before* trying, and hand the reason on.
     *
     * `foundIndustry` returns NONE for a dozen different reasons and the first
     * version of this reported "Could not build there" for all of them — which
     * cost twenty minutes of guessing at a refusal the code already knew the
     * answer to. The player deserves the same courtesy the yard rule gets: a
     * refusal is a sentence.
     */
    const problem = this.canFound(this.player, defIndex, tile);
    if (problem !== '') return { site: NONE, reason: problem };
    const site = this.foundIndustry(this.player, defIndex, tile);
    if (site === NONE) return { site: NONE, reason: 'Could not build there.' };
    this.connectSiteToRoad(site);
    const yard = this.yards.alloc(x, y, tile, this.player, name);
    if (yard !== NONE) {
      this.yards.add(yard, Facility.Hardstanding | Facility.LongBay | Facility.Weighbridge);
      this.yards.bays[yard] = 8;
    }
    this.refreshInfluence();
    this.offerWorkNow();
    return { site, reason: '' };
  }

  /**
   * What a contract is worth an hour, run by a given vehicle.
   *
   * "Rather than showing you the money, just show how much you're gonna make an
   * hour, because that's the thing that's most important — is it worth it for an
   * hour" — and that is exactly right, because a rate per tonne is not
   * comparable between two offers. A short run in a small van and a long run in
   * an artic can pay the same per tonne and differ fourfold in what they are
   * worth to you, and nothing on the row said so.
   *
   * The sum is: a full load, there and back, at the speed the roads allow. The
   * *return* leg matters and is the part a player would forget — a lorry that
   * has delivered is at the wrong end and earns nothing coming home, so a
   * fifty-tile run is a hundred tiles of driving for one load's pay.
   *
   * Returns 0 when nothing suitable is available, and the caller shows a dash:
   * an hourly rate for a lorry you do not own is a number about a hypothesis.
   */
  contractPerHour(contract: number, vehicle: number): number {
    const b = this.contractBoard;
    if (contract < 0 || contract >= b.count) return 0;
    if (vehicle < 0 || vehicle >= this.vehicles.count) return 0;
    /*
     * Cached, and it is not an optimisation — it is the difference between the
     * game running and not.
     *
     * This walks a road route, which is an A* over about a thousand tiles. The
     * panel asks it for every offer times every suitable lorry, and the panel
     * re-renders whenever the camera moves. That is dozens of searches a second,
     * and it locked the renderer solid the moment the figure went on the row.
     *
     * The answer only changes when the roads change or the fleet changes, both
     * of which end in `rebuild`, so the cache is cleared there. Anything the
     * interface asks repeatedly and that depends on the network belongs behind
     * one of these.
     */
    const key = contract * 65536 + vehicle;
    const had = this.perHourCache.get(key);
    if (had !== undefined) return had;
    const answer = this.computePerHour(contract, vehicle);
    this.perHourCache.set(key, answer);
    return answer;
  }

  private readonly perHourCache = new Map<number, number>();

  private computePerHour(contract: number, vehicle: number): number {
    const b = this.contractBoard;
    const def = this.content.vehicles[this.vehicles.type[vehicle]];
    if (!def) return 0;
    const from = b.from[contract];
    const to = b.to[contract];
    if (from < 0 || to < 0) return 0;

    const there = this.roadRoute(this.siteAccessTile[from], this.siteAccessTile[to]);
    if (there.length < 2) return 0;
    // Tiles per tick, from the way classes actually on the route: a lane and a
    // trunk road are not the same journey, and the whole point of the widening
    // proposals is that this number moves when the road improves.
    const layer = this.layers[Mode.Road];
    let ticks = 0;
    const own = this.vehicleSpeed[this.vehicles.type[vehicle]];
    for (const t of there) {
      const cls = layer.cls[t];
      const limit = Math.min(own, cls === NO_WAY ? own : this.waySpeed[cls]);
      // `speed` is Q16.16 tiles per tick, so a tile takes FX_ONE / speed ticks.
      ticks += FX_ONE / Math.max(1, limit);
    }
    // There and back, plus a little standing at each end for loading.
    const round = ticks * 2 + TICKS_PER_DAY * 0.06;
    if (round <= 0) return 0;
    const perLoad = b.pay[contract] * def.capacity;
    // An hour is a twenty-fourth of a day, in ticks.
    return Math.round(perLoad * ((TICKS_PER_DAY / 24) / round));
  }

  /**
   * Take a lorry off whatever it is doing.
   *
   * The reason the vehicle panel can be opened at all: a lorry you cannot
   * reassign is a lorry you have lost, and until now there was no way to get one
   * back off a job it should not have been given.
   *
   * The contract goes back on the board rather than closing, because the work
   * still exists — somebody wanted that milk moved and still does. Which also
   * means taking the wrong lorry off and putting the right one on is one
   * decision rather than a lost contract.
   */
  dropVehicle(vehicle: number): boolean {
    if (vehicle < 0 || vehicle >= this.vehicles.count) return false;
    if (!this.vehicles.alive[vehicle]) return false;
    if (this.vehicles.company[vehicle] !== this.player) return false;
    const svc = this.vehicles.service[vehicle];
    if (svc === NONE) return false;

    // Off the service, and back to idle where it stands. The mirror of
    // `assignVehicle`, written out here rather than as a method because it is
    // three lines and this is its only caller.
    this.services.vehicles[svc] = Math.max(0, this.services.vehicles[svc] - 1);
    this.vehicles.service[vehicle] = NONE;
    this.vehicles.orderIndex[vehicle] = 0;
    this.vehicles.state[vehicle] = VState.Idle;

    // Is anything else still running it? If not, the work is on offer again.
    let others = 0;
    for (let v = 0; v < this.vehicles.count; v++) {
      if (v !== vehicle && this.vehicles.alive[v] && this.vehicles.service[v] === svc) others++;
    }
    if (others === 0) {
      const b = this.contractBoard;
      for (let i = 0; i < b.count; i++) {
        if (b.service[i] !== svc) continue;
        b.state[i] = ContractState.Offered;
        b.service[i] = NONE;
        b.offeredTick[i] = this.tick;
      }
      this.services.active[svc] = 0;
    }
    this.rebuild();
    return true;
  }

  /**
   * Move every field on to the stage the calendar says it should be at.
   *
   * Rewrites `terrain.fields.crop` in place and bumps `seasonRevision` when
   * anything actually changed, so the renderer knows to rebuild the chunks it
   * has cached. It is called once a day and usually changes nothing: stages turn
   * over about eight times a year, so eight rebuilds a year against sixteen
   * hours of play is not a cost worth avoiding.
   *
   * The *base* crop is kept alongside, because a stage is a function of the base
   * and the month and cannot be derived from the current appearance — you cannot
   * tell a ploughed arable field from a ploughed one that is really pasture, and
   * without the base the whole district would drift into wheat.
   */
  stepSeason(): void {
    const fields = this.terrain.fields;
    if (this.cropBase === null) {
      this.cropBase = new Uint8Array(fields.crop);
      this.cropWant = new Uint8Array(fields.crop);
    }
    const month = this.month;
    if (month === this.seasonMonth) return;
    this.seasonMonth = month;
    this.daysWorking = 0;

    const size = this.config.size;
    const want = this.cropWant as Uint8Array;
    for (let t = 0; t < size * size; t++) {
      const p2 = fields.parcel[t];
      if (p2 < 0) continue;
      const base = this.cropBase[t] as Crop;
      // A wood is not in the rotation. It is the same wood in February as it is
      // in August, and running it through `grassStage` would have it cut for hay.
      if (isWood(base)) continue;
      // A month either way, from the parcel id, so a valley does not turn gold
      // in one frame.
      const offset = ((p2 * 2654435761) >>> 0) % 3;
      const stage = base === Crop.Wheat || base === Crop.WheatRipe || base === Crop.Plough
        ? arableStage(month, offset, springSown(p2))
        : grassStage(month, offset, base);
      want[t] = stage;
      /*
       * Growth needs nobody, so it happens the moment the calendar says so.
       *
       * The distinction this draws is the whole of the feature: a crop coming up
       * green, or turning gold, is the weather doing it and there is no reason
       * to wait. Ploughing, drilling, cutting and clearing are *work*, and work
       * wants a tractor - so those stages are only written by `workField`
       * below, or by the days-later catch-up for the fields nobody got round
       * to.
       */
      if (!NEEDS_WORK.has(stage) && fields.crop[t] !== stage) {
        fields.crop[t] = stage;
        this.fieldTouched(t);
      }
    }
  }

  /**
   * A tractor has worked over this tile. Show it.
   *
   * "If they run over a ground that's not been ploughed, then the ground below
   * them should be ploughed... and then if they're going over it when it's
   * ploughed, it should turn into a drilled field." Exactly that, with the
   * calendar deciding which of those jobs is the job of the month: in October a
   * field wants ploughing and a pass turns it over, in August it wants cutting
   * and a pass leaves stubble behind.
   *
   * Which means a tractor is not decoration any more. It is the thing that
   * changes the district, one tile at a time, in the order a farm would do it.
   */
  workField(tile: number): void {
    const want = this.cropWant;
    if (!want) return;
    const fields = this.terrain.fields;
    if (tile < 0 || tile >= fields.crop.length) return;
    if (fields.parcel[tile] < 0) return;
    const stage = want[tile] as Crop;
    if (fields.crop[tile] === stage) return;
    if (!NEEDS_WORK.has(stage)) return;
    fields.crop[tile] = stage;
    this.fieldTouched(tile);
  }

  /**
   * Which machine the job on this tile calls for.
   *
   * The reason this belongs in the simulation rather than in the renderer is that
   * it is a fact about farming, not about drawing: a field that wants turning over
   * wants a plough behind a tractor, and one standing ripe wants a combine, and
   * that is true whether or not anybody is looking. The client's only job is to
   * know which model has a combine in it.
   *
   * `spray` is the answer when there is nothing to do, and it is not a fudge. A
   * crop between drilling and harvest still has somebody out in it every few
   * weeks, and those are exactly the months — April to July — when no stage turns
   * over and the district would otherwise stand still. A sprayer working a green
   * field is what is actually happening out there in June.
   */
  fieldJob(tile: number): 'plough' | 'drill' | 'combine' | 'mow' | 'spray' | 'none' {
    const want = this.cropWant;
    const fields = this.terrain.fields;
    if (!want || tile < 0 || tile >= fields.crop.length) return 'none';
    if (fields.parcel[tile] < 0) return 'none';
    // Nobody drives a tractor through a wood. Belt and braces — the client also
    // keeps woodland off the list of workable fields — but this is the answer to
    // the question rather than a filter somebody has to remember to apply.
    if (isWood(fields.crop[tile])) return 'none';
    const stage = want[tile] as Crop;
    if (fields.crop[tile] === stage || !NEEDS_WORK.has(stage)) {
      /*
       * Nothing to do. Whether that means a sprayer or nothing at all depends on
       * whether there is a crop standing in it.
       *
       * "A field is being sprayed that doesn't even have ploughing" — quite
       * right, and it was nonsense: you spray a growing crop, not bare earth or a
       * ploughed field. Ground with nothing on it has nobody in it, and a machine
       * sent there would be a machine doing something that does not happen.
       */
      return GROWING.has(fields.crop[tile] as Crop) ? 'spray' : 'none';
    }
    if (stage === Crop.Plough || stage === Crop.Bare) return 'plough';
    if (stage === Crop.Drilled) return 'drill';
    /*
     * Cutting, and what does the cutting depends on what is standing there.
     *
     * A combine for a cereal; a mower behind a tractor for grass. It is the one
     * place the *previous* stage decides the machine rather than the next one,
     * because "stubble" is where a wheat field and a hay meadow arrive by
     * completely different means.
     */
    const now = fields.crop[tile] as Crop;
    if (now === Crop.Wheat || now === Crop.WheatRipe) return 'combine';
    return 'mow';
  }

  /**
   * Is there anything for a tractor to do on this tile?
   *
   * Used to choose which field to send one to, so the tractors of a district are
   * where the work is. Without it they potter about in finished fields while the
   * one that needs cutting stands ripe for a fortnight.
   */
  fieldNeedsWork(tile: number): boolean {
    const want = this.cropWant;
    const fields = this.terrain.fields;
    if (!want || tile < 0 || tile >= fields.crop.length) return false;
    if (fields.parcel[tile] < 0) return false;
    const stage = want[tile] as Crop;
    return NEEDS_WORK.has(stage) && fields.crop[tile] !== stage;
  }

  /**
   * The rest of the district, worked off screen.
   *
   * Seven tractors cannot plough forty fields, and a field that sat in stubble
   * until Christmas because no tractor was sent to it would be a bug you could
   * see from the air. So each day a growing share of every unfinished field
   * comes up to its stage anyway - as if a farmer you were not watching had been
   * out on it, which is exactly what has happened.
   *
   * A share rather than the lot, because the intermediate state is the best
   * thing about it: a field half turned over, the line between the ploughed part
   * and the stubble sitting wherever the day left it, is what farmland actually
   * looks like in October.
   */
  private catchUpFields(): void {
    const want = this.cropWant;
    if (!want) return;
    this.daysWorking++;
    /*
     * Two days' grace, then twelve days to finish a field unaided.
     *
     * The first figures gave no grace and six days, which meant a sixth of every
     * field changed colour on the first day of the month whether a tractor went
     * near it or not — so by the time the player looked, most of the work had
     * already done itself and the tractor was following behind its own result.
     * The grace period is the important half: for the first two days of a job,
     * the only thing that changes a field is a tractor driving over it.
     */
    const share = Math.max(0, Math.min(1, (this.daysWorking - 2) / 12));
    if (share <= 0) return;
    const fields = this.terrain.fields;
    const size = this.config.size;
    for (let t = 0; t < size * size; t++) {
      if (fields.parcel[t] < 0) continue;
      const stage = want[t] as Crop;
      if (fields.crop[t] === stage || !NEEDS_WORK.has(stage)) continue;
      // Deterministic per tile and stable from day to day, so the worked part of
      // a field grows rather than flickering about inside it.
      const h = ((t * 2246822519) ^ (this.seasonMonth * 3266489917)) >>> 0;
      if ((h & 0xffff) / 0x10000 > share) continue;
      fields.crop[t] = stage;
      this.fieldTouched(t);
    }
  }

  /**
   * One tile has changed colour. Remember it, so the renderer can rebuild the
   * piece of ground it is in rather than the whole district.
   */
  private fieldTouched(tile: number): void {
    this.seasonRevision++;
    // Bounded: past a few thousand it is cheaper to rebuild everything than to
    // carry the list, and the client falls back to exactly that.
    if (this.dirtyFields.size < 4096) this.dirtyFields.add(tile);
  }

  /** Bumped whenever the fields change appearance. The renderer watches it. */
  seasonRevision = 0;
  /**
   * Tiles whose colour has changed and whose ground has not been rebuilt yet.
   *
   * The client drains it every frame. Tiles rather than chunks because the sim
   * has no business knowing how the ground is cut up for drawing.
   */
  readonly dirtyFields = new Set<number>();
  private seasonMonth = -1;
  private daysWorking = 0;
  private cropBase: Uint8Array | null = null;
  private cropWant: Uint8Array | null = null;

  /** Is this place one of yours, and a depot? For the panel's wording. */
  isDepot(site: number): boolean {
    return this.content.industries[this.sites.def[site]]?.passThrough === true;
  }

  // ------------------------------------------------- the planning board

  /**
   * Is the board even a thing yet?
   *
   * design.md is emphatic that "nobody cares about your approval rating until
   * the further along you get", so there is no approval anywhere in the
   * interface until the player is a presence — measured in vehicles, because a
   * vehicle is this game's unit of measurement. Showing it on day one would make
   * the first ten minutes a game about a bar filling up, which is the opposite
   * of a milk round.
   */
  planningOpen(): boolean {
    return this.fleetSize() >= PLANNING_FROM_VEHICLES;
  }

  fleetSize(): number {
    let n = 0;
    for (let v = 0; v < this.vehicles.count; v++) {
      if (this.vehicles.alive[v] && this.vehicles.company[v] === this.player) n++;
    }
    return n;
  }

  /**
   * Put money into the parish, and get a little goodwill for it.
   *
   * Diminishing, hard — see `levyGain`. Money can carry you part of the way to
   * standing and never all of it, so the last rung cannot be bought outright.
   */
  fundParish(pence: number): { ok: boolean; reason: string; gained: number } {
    if (pence <= 0) return { ok: false, reason: 'Nothing to give.', gained: 0 };
    if (this.companies.cash[this.player] < pence) {
      return { ok: false, reason: 'Not enough in the bank.', gained: 0 };
    }
    const gained = levyGain(this.approval, pence);
    // Not construction and not an asset: money that leaves and buys nothing you
    // own. `Penalties` is the existing line for exactly that shape of outgoing.
    this.companies.post(this.player, Line.Penalties, pence);
    this.approval = Math.min(100, this.approval + gained);
    return { ok: true, reason: '', gained };
  }

  /**
   * What the board would hear from you today.
   *
   * Built from what you actually own, so the list is short and every entry is
   * about a road you personally drive. A generic "build a road" tool would be a
   * level editor; a list of the four roads between your own places that could be
   * better is a decision.
   */
  proposals(): {
    works: number; from: number; to: number; label: string;
    cost: number; approval: number; ok: boolean; reason: string;
  }[] {
    const out: {
      works: number; from: number; to: number; label: string;
      cost: number; approval: number; ok: boolean; reason: string;
    }[] = [];
    if (!this.planningOpen()) return out;

    /*
     * The lane up to your own gate, not the trunk road between two of them.
     *
     * The first version offered to widen the route between each pair of places
     * you own, and found nothing on any seed — because `roadRoute` weights by
     * class and therefore already routes along the best road available. It was
     * asking "is the best road bad", and the answer is no by construction.
     *
     * The real case is the *spur*: your dairy is up a track, the track meets a
     * proper road half a mile away, and what you want is the track made up.
     * That is a request a haulier would actually make, it is always available
     * while any of your places is on a lane, and the reward is legible — the
     * lane your lorries have been grinding along becomes a road, they go faster
     * on it, and the district looks different afterwards.
     */
    const layer = this.layers[Mode.Road];
    const best = this.bestRoadClass();
    const size = this.config.size;

    const handles: number[] = [];
    for (let s2 = 0; s2 < this.sites.count; s2++) {
      if (this.sites.owner[s2] === this.player) handles.push(s2);
    }
    for (let y = 0; y < this.yards.count; y++) {
      if (this.yards.owner[y] === this.player) handles.push(-1 - y);
    }

    const seen = new Set<number>();
    for (const h of handles) {
      const from = h >= 0 ? this.siteAccessTile[h] : this.yards.tile[-1 - h];
      if (from === undefined || from < 0) continue;
      const spur = this.spurToTrunk(from, best);
      if (spur.length < 2) continue;
      // Two places sharing a spur — a depot is a site *and* a yard at one tile —
      // must not offer the same works twice.
      if (seen.has(spur[spur.length - 1] * size + spur[0])) continue;
      seen.add(spur[spur.length - 1] * size + spur[0]);

      const name = h >= 0
        ? this.content.industries[this.sites.def[h]].name
        : this.yards.names[-1 - h];
      const cost = Math.round(spur.length * this.content.ways[best].buildCost * WIDEN_SHARE);
      const need = WORKS_APPROVAL[Works.Widen];
      const affordable = this.companies.cash[this.player] >= cost;
      out.push({
        works: Works.Widen,
        from: h,
        to: NONE,
        label: `the lane to ${name}`,
        cost,
        approval: need,
        ok: this.approval >= need && affordable,
        reason: this.approval < need
          ? `The board wants ${Math.ceil(need)} approval. You have ${Math.floor(this.approval)}.`
          : affordable ? '' : 'Not enough in the bank.',
      });
    }
    out.sort((a, b) => a.cost - b.cost);

    // And the one that is not a road at all.
    const standingNeed = WORKS_APPROVAL[Works.Standing];
    const standingCost = 900_000 * (this.standing + 1);
    out.push({
      works: Works.Standing,
      from: NONE,
      to: NONE,
      label: 'Ask to be counted',
      cost: standingCost,
      approval: standingNeed,
      ok: this.approval >= standingNeed
        && this.companies.cash[this.player] >= standingCost,
      reason: this.approval < standingNeed
        ? `The board wants ${Math.ceil(standingNeed)} approval. You have ${Math.floor(this.approval)}.`
        : this.companies.cash[this.player] >= standingCost ? '' : 'Not enough in the bank.',
    });
    void layer;
    return out.slice(0, 5);
  }

  /**
   * The run of sub-standard road between a place and the nearest proper one.
   *
   * A breadth-first walk outwards over road tiles, stopping at the first tile of
   * the best class. Returns the tiles that would need making up, nearest place
   * first — so its length is both the cost and the thing being widened.
   *
   * Breadth-first rather than the A* used for routing, because the question is
   * "how far to the nearest good road in any direction", which is a flood and
   * not a path. Bounded at forty tiles: beyond that the place is not on a spur,
   * it is in the wilderness, and what it wants is a new road rather than a
   * better one.
   */
  private spurToTrunk(from: number, best: number): number[] {
    const layer = this.layers[Mode.Road];
    const size = this.config.size;
    if (layer.cls[from] === best) return [];
    const cameFrom = new Map<number, number>();
    const queue: number[] = [from];
    cameFrom.set(from, NONE);
    let head = 0;
    let hit = NONE;
    while (head < queue.length && head < 400) {
      const cur = queue[head++];
      if (layer.cls[cur] === best) { hit = cur; break; }
      const x = cur % size;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIR_DX[d];
        const ny = ((cur / size) | 0) + DIR_DY[d];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const nt = ny * size + nx;
        if (layer.cls[nt] === NO_WAY || cameFrom.has(nt)) continue;
        cameFrom.set(nt, cur);
        queue.push(nt);
      }
    }
    if (hit === NONE) return [];
    // Walk back, dropping the trunk tile itself: it is already good.
    const out: number[] = [];
    for (let t = cameFrom.get(hit) ?? NONE; t !== NONE; t = cameFrom.get(t) ?? NONE) {
      out.push(t);
      if (out.length > 40) return [];
    }
    return out;
  }

  /**
   * Put a proposal to the board.
   *
   * Widening actually lays the way, so the district visibly changes: the lane
   * your lorries have been grinding along becomes a proper road, they go faster
   * on it, and the frame looks different afterwards. That last part is the whole
   * reward — the earlier rungs change what you *own*, and this is the first one
   * that changes what the place *is*.
   *
   * Standing spends approval rather than earning it, which is why it is the
   * dearest: it converts a reputation into reach, and then you have to build the
   * reputation again.
   */
  propose(works: number, from: number, to: number): { ok: boolean; reason: string } {
    if (!this.planningOpen()) {
      return { ok: false, reason: 'The board does not know who you are yet.' };
    }
    const need = WORKS_APPROVAL[works] ?? 100;
    if (this.approval < need) {
      return {
        ok: false,
        reason: `The board wants ${Math.ceil(need)} approval. You have ${Math.floor(this.approval)}.`,
      };
    }

    if (works === Works.Standing) {
      // Dearer every time. The first is the parish agreeing you belong; the
      // fourth is asking them to rearrange the county for you.
      const cost = 900_000 * (this.standing + 1);
      if (this.companies.cash[this.player] < cost) {
        return { ok: false, reason: 'Not enough in the bank.' };
      }
      this.companies.post(this.player, Line.Penalties, cost);
      // Reach, bought with reputation. Spent, not kept: the number goes back
      // down and has to be earned again for the next one.
      this.standing += 1;
      this.approval = Math.max(APPROVAL_REST, this.approval - 22);
      this.refreshInfluence();
      return { ok: true, reason: '' };
    }

    void to;
    const a = from >= 0 ? this.siteAccessTile[from] : this.yards.tile[-1 - from];
    if (a === undefined || a < 0) return { ok: false, reason: 'Nowhere to build.' };
    const best = this.bestRoadClass();
    const spur = this.spurToTrunk(a, best);
    if (spur.length < 2) return { ok: false, reason: 'That lane is already made up.' };
    const cost = Math.round(spur.length * this.content.ways[best].buildCost * WIDEN_SHARE);
    if (this.companies.cash[this.player] < cost) {
      return { ok: false, reason: 'Not enough in the bank.' };
    }
    this.companies.post(this.player, Line.Construction, cost);
    this.layPublicWay(Mode.Road, best, spur, this.wayCharge[best], 0);
    this.rebuild();
    // A road the parish agreed to is a road the parish is pleased about, but
    // building it also spends the goodwill that got it agreed.
    this.approval = Math.max(APPROVAL_REST, this.approval - 8);
    return { ok: true, reason: '' };
  }

  /** How many times the board has agreed you belong here. Widens influence. */
  standing = 0;

  // ----------------------------------------------------------------- your land

  /**
   * The parcels a company owns, by owning what stands on them.
   *
   * "I think we need businesses to also have a set bit of LAND they own. Like
   * the area around them. Because I might want to build a road that makes it
   * easier. We should allow road building on your OWN land." Which is the right
   * shape for a reason the design already half states: the planning board is
   * rung *seven*, gated on approval and on owning four vehicles, so between
   * buying your first business and earning the parish's ear there is nothing you
   * can do about access at all. This is that missing agency, and it needs no new
   * permission system because the answer is simply that it is your land.
   *
   * A *parcel*, not a radius. The district is already divided into fields with
   * hard edges and hedges drawn along them — so "your land" arrives with a
   * visual language it did not have to invent, and the boundary is somewhere the
   * player can already see. A radius would have been a soft circle nobody could
   * point at.
   *
   * The parcel the business stands in, and the ones its own tile touches, which
   * for a farm in the corner of a field is usually two or three. Enough to lay a
   * track across; not enough to reroute the district.
   */
  ownedParcels(company: number): Set<number> {
    const out = new Set<number>();
    const parcel = this.terrain.fields.parcel;
    const size = this.config.size;
    const claim = (tile: number): void => {
      if (tile < 0 || tile >= parcel.length) return;
      const x = tile % size;
      const y = (tile / size) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const p = parcel[ny * size + nx];
          if (p >= 0) out.add(p);
        }
      }
    };
    for (let s2 = 0; s2 < this.sites.count; s2++) {
      if (this.sites.owner[s2] !== company) continue;
      claim(this.sites.tile[s2]);
    }
    for (let y2 = 0; y2 < this.yards.count; y2++) {
      if (this.yards.owner[y2] !== company) continue;
      claim(this.yards.tile[y2]);
    }
    return out;
  }

  /**
   * Can this company lay a way across this tile?
   *
   * Land, road or nothing. A tile already carrying a road is allowed because a
   * track has to *join* the network to be worth anything, and the joining tile
   * belongs to the parish rather than to you — laying nothing on it and simply
   * connecting is not a trespass.
   */
  canBuildOn(company: number, tile: number, owned?: Set<number>): boolean {
    if (tile < 0 || tile >= this.terrain.fields.parcel.length) return false;
    if (this.terrain.height[tile] <= 0) return false;
    if (this.layers[Mode.Road].cls[tile] !== NO_WAY) return true;
    const parcels = owned ?? this.ownedParcels(company);
    return parcels.has(this.terrain.fields.parcel[tile]);
  }

  /**
   * Lay a farm track along a run of tiles you own.
   *
   * No board, no approval, no standing: this is the whole point of the feature.
   * What it costs is money and the tiles have to be yours, and that is the
   * entire rule — which is why it can sit below rung seven without competing
   * with it. The parish decides what happens on the parish's roads; you decide
   * what happens in your own field.
   *
   * A track rather than a lane, and deliberately the cheapest thing in the
   * catalogue. Being able to lay a *road* on your own land would make the
   * planning board pointless, and the board is the top of the ladder. A track
   * gets a lorry off a bad approach and no further.
   */
  layTrack(company: number, tiles: readonly number[]): { ok: boolean; reason: string } {
    if (tiles.length < 2) return { ok: false, reason: 'Too short to be a track.' };
    const owned = this.ownedParcels(company);
    const layer = this.layers[Mode.Road];
    let fresh = 0;
    let joins = false;
    for (const t of tiles) {
      if (!this.canBuildOn(company, t, owned)) {
        return { ok: false, reason: 'That crosses land you do not own.' };
      }
      if (layer.cls[t] === NO_WAY) fresh++;
      else joins = true;
    }
    if (fresh === 0) return { ok: false, reason: 'There is already a way along there.' };
    /*
     * It has to meet the network. A track from one corner of your field to
     * another is a thing you can build in life and is of no use whatever to a
     * lorry, and letting it be built would leave the player with an orphan road
     * and no explanation.
     */
    if (!joins) {
      for (const t of tiles) {
        for (const d of [1, -1, this.config.size, -this.config.size]) {
          if (layer.cls[t + d] !== NO_WAY) { joins = true; break; }
        }
        if (joins) break;
      }
    }
    if (!joins) return { ok: false, reason: 'It has to meet a road somewhere.' };

    const cls = this.trackClass();
    if (cls < 0) return { ok: false, reason: 'Nothing to build it with.' };
    const cost = Math.round(fresh * this.content.ways[cls].buildCost * TRACK_SHARE);
    if (this.companies.cash[company] < cost) {
      return { ok: false, reason: 'Not enough in the bank.' };
    }
    this.companies.post(company, Line.Construction, cost);
    this.layPublicWay(Mode.Road, cls, tiles, this.wayCharge[cls], this.content.ways[cls].buildCost);
    this.rebuild();
    this.landRevision++;
    return { ok: true, reason: '' };
  }

  /** Bumped whenever the ground you own, or what is on it, changes. */
  landRevision = 0;

  /**
   * What a lorry is doing, in one word the interface can print.
   *
   * "If a vehicle is resting, it still says working." It did, because the only
   * question anything asked was whether it had a service on it — which was the
   * whole truth right up until the fleet started knocking off at eight. A lorry
   * with a job, parked in the dark, is not working, and telling the player it is
   * makes the one number on the status bar a lie for ten hours a day.
   *
   * Four states, and the order is the order of precedence: a lorry with no job
   * is idle whatever the hour, one stopped by the snow is stopped whatever the
   * hour, and only then does the clock get a say. Answered here rather than in
   * the interface because three panels ask it and they must not disagree.
   */
  vehicleActivity(v: number): 'idle' | 'stopped' | 'sleeping' | 'working' {
    if (!this.vehicles.alive[v] || this.vehicles.service[v] === NONE) return 'idle';
    if (stoppedBySnow(this.vehicleFittings[v], this.snow)) return 'stopped';
    if (this.fleetParked) return 'sleeping';
    return 'working';
  }

  /**
   * Can a track go on this tile, and if not, why not?
   *
   * The refusals are the interface. A build tool that simply does nothing when
   * you click is a build tool the player has to reverse-engineer, and the whole
   * point of showing where you *can* build is that the answer is visible before
   * the click — so this is written to be asked of every tile in view, and it is
   * cheap enough for that.
   *
   * Extending from an existing road rather than placing anywhere is what keeps
   * the result usable: a track has to reach the network to be worth laying, and
   * growing it outward tile by tile means it always does, with no route-finding
   * and no way to draw something orphaned.
   */
  trackHere(
    company: number, tile: number, owned?: Set<number>,
  ): { ok: boolean; reason: string } {
    const size = this.config.size;
    if (tile < size || tile >= size * (size - 1)) {
      return { ok: false, reason: 'Off the map.' };
    }
    if (this.terrain.height[tile] <= 0) return { ok: false, reason: 'That is water.' };
    const layer = this.layers[Mode.Road];
    if (layer.cls[tile] !== NO_WAY) return { ok: false, reason: 'Already a road.' };
    // Not through a building. A business or a yard stands on its own tile, and
    // the track that reaches it is drawn up to the yard rather than under it.
    for (let s2 = 0; s2 < this.sites.count; s2++) {
      if (this.sites.tile[s2] === tile) return { ok: false, reason: 'A building is there.' };
    }
    for (let y2 = 0; y2 < this.yards.count; y2++) {
      if (this.yards.tile[y2] === tile) return { ok: false, reason: 'A building is there.' };
    }
    const parcels = owned ?? this.ownedParcels(company);
    if (!parcels.has(this.terrain.fields.parcel[tile])) {
      return { ok: false, reason: 'Not your land.' };
    }
    // It has to touch something that already goes somewhere.
    for (const d of [1, -1, size, -size]) {
      if (layer.cls[tile + d] !== NO_WAY) return { ok: true, reason: '' };
    }
    return { ok: false, reason: 'It has to join a road.' };
  }

  /**
   * Lay one tile of farm track.
   *
   * Free, for now, and that is a deliberate stage rather than an oversight: the
   * question this answers is whether being able to shape your own approach is
   * *fun*, and putting a price on it before knowing that would only measure
   * whether the price was right. `TRACK_SHARE` is still there for when it is.
   *
   * Laid as a two-tile run from the neighbour it joins, because the alignment
   * planner wants a run rather than a point — and that is also the honest model:
   * you are extending a road, not dropping a paving slab.
   */
  layTrackAt(company: number, tile: number): { ok: boolean; reason: string } {
    const verdict = this.trackHere(company, tile);
    if (!verdict.ok) return verdict;
    const size = this.config.size;
    const layer = this.layers[Mode.Road];
    let from = -1;
    for (const d of [1, -1, size, -size]) {
      if (layer.cls[tile + d] !== NO_WAY) { from = tile + d; break; }
    }
    if (from < 0) return { ok: false, reason: 'It has to join a road.' };
    const cls = this.trackClass();
    if (cls < 0) return { ok: false, reason: 'Nothing to build it with.' };
    if (!this.layPublicWay(Mode.Road, cls, [from, tile], this.wayCharge[cls], 0)) {
      return { ok: false, reason: 'It would not go in there.' };
    }
    this.rebuild();
    this.landRevision++;
    return { ok: true, reason: '' };
  }

  /**
   * Can this tile of road come up? The mirror of `trackHere`, and asked the same
   * way: of every tile in view, to decide what to mark.
   */
  liftHere(
    company: number, tile: number, owned?: Set<number>,
  ): { ok: boolean; reason: string } {
    const layer = this.layers[Mode.Road];
    if (tile < 0 || tile >= layer.cls.length) return { ok: false, reason: 'Off the map.' };
    if (layer.cls[tile] === NO_WAY) return { ok: false, reason: 'No road there.' };
    const parcels = owned ?? this.ownedParcels(company);
    if (!parcels.has(this.terrain.fields.parcel[tile])) {
      return { ok: false, reason: 'Not your land.' };
    }
    for (let s2 = 0; s2 < this.sites.count; s2++) {
      if (this.siteAccessTile[s2] === tile) {
        return { ok: false, reason: 'Something needs that to get out.' };
      }
    }
    for (let y2 = 0; y2 < this.yards.count; y2++) {
      if (this.yards.tile[y2] === tile) {
        return { ok: false, reason: 'Something needs that to get out.' };
      }
    }
    return { ok: true, reason: '' };
  }

  /**
   * Take one tile of road up again.
   *
   * Only on your own land, which is the same rule as building and for the same
   * reason — and it keeps the player from unpicking the parish's lane through
   * the village, which would be both rude and a good way to strand every
   * business on it.
   *
   * A tile something needs is refused. `siteAccessTile` is a *road* tile by
   * construction, so lifting it would leave a business with no way in and
   * nothing on screen to explain why its lorries had stopped coming.
   */
  liftTrackAt(company: number, tile: number): { ok: boolean; reason: string } {
    const verdict = this.liftHere(company, tile);
    if (!verdict.ok) return verdict;
    const layer = this.layers[Mode.Road];
    const asset = layer.asset[tile];
    if (!removeWayTile(layer, this.config.size, tile)) {
      return { ok: false, reason: 'It would not come up.' };
    }
    if (asset !== NONE) this.assets.tiles[asset]--;
    this.rebuild();
    this.router.invalidate();
    this.landRevision++;
    return { ok: true, reason: '' };
  }

  /** The cheapest road in the catalogue: a farm track. */
  private trackClass(): number {
    let best = -1;
    let cheapest = Infinity;
    for (let i = 0; i < this.content.ways.length; i++) {
      const w = this.content.ways[i];
      if (w.mode !== 'road' || w.era > this.era) continue;
      if (w.buildCost < cheapest) { cheapest = w.buildCost; best = i; }
    }
    return best;
  }

  /**
   * What the board would widen a country lane *to*.
   *
   * A proper two-lane road, and explicitly not the best thing in the catalogue.
   * Targeting the outright best made the target a dual carriageway, and then
   * `spurToTrunk` searched for a dual carriageway tile to stop at, found none
   * anywhere in a rural district, and returned nothing — so the widening
   * proposal never appeared. Aiming at what a parish would actually build makes
   * the mechanic work and makes the result look right.
   */
  private bestRoadClass(): number {
    let best = 0;
    let bestSpeed = -1;
    for (let i = 0; i < this.content.ways.length; i++) {
      const w = this.content.ways[i];
      if (w.mode !== 'road' || w.era > this.era) continue;
      if (w.lanes > 2) continue;
      if (this.waySpeed[i] > bestSpeed) { bestSpeed = this.waySpeed[i]; best = i; }
    }
    return best;
  }

  /**
   * Set up a standing run between two places, one of which is yours.
   *
   * Deliberately the same two-stop service a contract makes, so owning
   * production adds a *reason* rather than a mechanism. The player has learned
   * one interaction by now and this is it again, pointing the other way.
   *
   * Either end may be the one you own, and that is new. It used to insist you
   * owned the *origin*, which only covered selling what you make — and left the
   * more pressing half with no mechanism at all. Nobody in this district
   * delivers: buy a shop and the goods on its shelves are your problem, so the
   * run you most need to set up is the one *into* a place you own. Same service,
   * same two stops, pointing inward.
   */
  supply(from: number, to: number, cargo: number, vehicle = NONE): boolean {
    const outbound = this.sites.owner[from] === this.player;
    const inbound = this.sites.owner[to] === this.player;
    if (!outbound && !inbound) return false;
    // Named for the place it serves, which for an inbound run is the far end.
    const svc = this.services.alloc(
      this.player,
      this.content.industries[this.sites.def[outbound ? from : to]].name,
    );
    if (svc === NONE) return false;
    this.services.addStop(svc, from, 0, StopAction.LoadFull, cargo);
    this.services.addStop(svc, to, 0, StopAction.Unload, cargo);
    this.services.active[svc] = 1;
    /*
     * The lorry the player picked, or the first one going spare.
     *
     * It used to take the first free vehicle without asking, which is fine when
     * there is one and wrong as soon as there are several — the whole decision
     * in a run is *which* lorry, because that is where it will be for the next
     * hour and what it will not be doing instead.
     */
    if (vehicle !== NONE
      && this.vehicles.alive[vehicle]
      && this.vehicles.company[vehicle] === this.player
      && this.vehicles.service[vehicle] === NONE) {
      this.assignVehicle(vehicle, svc, this.player);
    } else if (vehicle === NONE) {
      for (let v = 0; v < this.vehicles.count; v++) {
        if (!this.vehicles.alive[v]) continue;
        if (this.vehicles.company[v] !== this.player) continue;
        if (this.vehicles.service[v] !== NONE) continue;
        this.assignVehicle(v, svc, this.player);
        break;
      }
    }
    this.rebuild();
    return true;
  }

  // ----------------------------------------------------------- contracts

  /**
   * What a site has spare, and who would want it.
   *
   * A contract exists because somebody has something and cannot move it. So
   * "surplus" is the site's largest pile of anything it produces, and a buyer is
   * anywhere that lists that cargo as an input. Both are one loop over tables
   * that already exist — the point of the contract model is that it needs no new
   * simulation, only a different way of asking.
   */
  /**
   * Everything a place has spare, biggest heap first.
   *
   * It used to return the single fullest shed, which is fine for a works that
   * makes one thing and silently wrong for anything that makes two. An arable
   * farm grows grain *and* produce; grain is always the bigger heap; so produce
   * was never offered anywhere in the district on any seed, and the village shop
   * that eats it could not be supplied by contract at all. That reads as missing
   * content and was a `>` in a loop.
   *
   * Sorted because the board takes what it can fit and stops: the fullest shed is
   * still the most urgent thing to shift, it is simply no longer the only thing.
   */
  private surplusesAt(site: number): { cargo: number; tonnes: number }[] {
    const out: { cargo: number; tonnes: number }[] = [];
    for (const cargo of this.offersOf(site)) {
      const have = this.sites.stockOf(site, cargo);
      if (have > 0) out.push({ cargo, tonnes: have });
    }
    out.sort((a, b) => b.tonnes - a.tonnes);
    return out;
  }

  /**
   * What a place has to offer the world.
   *
   * Its recipe outputs, normally. For a **pass-through** place — a distribution
   * centre — everything it can hold, because it hands back what it was given
   * rather than turning it into something else (design.md §4).
   *
   * One function, read by `surplusAt` and `buyersFor`, so a depot appears on the
   * contract board and in the supply panel without either of them containing the
   * word depot. That is the whole reason a distribution centre needed no new
   * mechanic: it is the two-noun model doing its job.
   */
  private offersOf(site: number): number[] {
    const def = this.sites.def[site];
    if (this.content.industries[def]?.passThrough) {
      const cargoCount = this.content.cargo.length;
      const out: number[] = [];
      for (let c = 0; c < cargoCount; c++) {
        // What it *has*, not what it could hold. A depot standing empty offers
        // nothing, and listing five cargoes it has none of would fill the panel
        // with work that does not exist.
        if (this.sites.stockOf(site, c) > 0) out.push(c);
      }
      return out;
    }
    const outs = this.recipes.outputs[def];
    const out: number[] = [];
    for (let i = 0; i < outs.length; i += 2) out.push(outs[i]);
    return out;
  }

  /**
   * Contracts into a place you have just bought are not contracts any more.
   *
   * You cannot be hired to deliver to yourself. A contract is a third party
   * paying you to move something; the moment you own the far end there is no
   * third party, and leaving the paperwork in place paid a completion bonus for
   * carrying your own goods to your own shed on top of the trading premium the
   * same load already earns.
   *
   * The *run* survives, and that is the whole point of doing it this way rather
   * than cancelling. The lorry keeps driving the route it was driving; it simply
   * stops being a job somebody gave you and becomes a job you are doing for
   * yourself. Releasing the board slot leaves the service and its vehicle
   * untouched — see `ContractBoard.release` — so nothing is stranded and the
   * player does not have to notice that anything happened.
   */
  private absorbContracts(site: number): void {
    const b = this.contractBoard;
    for (let i = 0; i < b.count; i++) {
      if (b.state[i] === ContractState.Closed) continue;
      if (b.to[i] !== site) continue;
      const svc = b.service[i];
      // A running job keeps running, as a standing supply run of your own.
      if (svc !== NONE) this.services.active[svc] = 1;
      b.release(i);
    }
  }

  private buyerFor(cargo: number, notSite: number): number {
    let best = NONE;
    let room = 0;
    const cargoCount = this.content.cargo.length;
    for (let s = 0; s < this.sites.count; s++) {
      if (s === notSite) continue;
      const ins = this.recipes.inputs[this.sites.def[s]];
      let takes = false;
      for (let i = 0; i < ins.length; i += 2) {
        if (ins[i] === cargo) { takes = true; break; }
      }
      if (!takes) continue;
      /*
       * And not a place of your own.
       *
       * The board's whole premise is that somebody else wants something moved,
       * so an offer to deliver into your own business is a contradiction — and
       * an expensive one, since it paid a haulage rate and a completion bonus
       * for a load that already earns the trading premium. Excluded at the point
       * that *chooses* the buyer rather than filtered afterwards, for the same
       * reason as the influence test below.
       */
      if (this.sites.owner[s] === this.player) continue;
      /*
       * Only somewhere you can see, and this was a real bug.
       *
       * Without the influence test this returned whichever buyer in the whole
       * district had the most room — which was routinely one under fog — and the
       * contract board, which requires both ends to be visible, then threw the
       * whole pairing away and moved on. So a forestry with ninety tonnes of
       * timber and a sawmill twenty tiles down the lane produced no offer at
       * all, because a *different* sawmill on the far side of the map had a
       * slightly emptier shed.
       *
       * The rule was already written down — a contract must be inside your
       * influence — it just was not applied at the point that chooses. Choosing
       * from the wrong set and filtering afterwards is not the same thing as
       * choosing from the right set.
       */
      const tile = this.siteAccessTile[s];
      if (tile === NONE || !this.influence.usable(tile)) continue;
      const spare = this.sites.capacity[s * cargoCount + cargo] - this.sites.stockOf(s, cargo);
      if (spare > room) {
        room = spare;
        best = s;
      }
    }
    return best;
  }

  /**
   * Put work on the board now.
   *
   * Public because the game must not open with an empty board: the first thing
   * a player sees has to be something to do, and waiting for the first week
   * boundary means the opening screen is a pretty field and no game.
   */
  offerWorkNow(): void {
    this.stepContractBoard();
  }

  /**
   * Can anything in the player's fleet carry this cargo?
   *
   * Asked of the *fleet* and not of the catalogue, because the point is what you
   * can do today. A cargo nothing you own can lift is work for later, and the
   * board is told to lead with the other kind.
   */
  fleetCanCarry(cargo: number): boolean {
    const handling = this.content.cargo[cargo]?.handling;
    if (handling === undefined) return false;
    for (let v = 0; v < this.vehicles.count; v++) {
      if (!this.vehicles.alive[v]) continue;
      if (this.vehicles.company[v] !== this.player) continue;
      const def = this.content.vehicles[this.vehicles.type[v]];
      if (def && (def.handling as readonly string[]).includes(handling)) return true;
    }
    return false;
  }

  private stepContractBoard(): void {
    offerContracts(this.contractBoard, {
      tick: this.tick,
      siteCount: this.sites.count,
      siteTile: (s) => this.siteAccessTile[s],
      siteX: (s) => this.sites.x[s],
      siteY: (s) => this.sites.y[s],
      usable: (tile) => tile !== NONE && this.influence.usable(tile),
      surpluses: (s) => this.surplusesAt(s),
      buyerFor: (cargo, not) => this.buyerFor(cargo, not),
      rate: (cargo, distance) =>
        haulageRate(this.cargoPrice[cargo], distance, this.cargoRateWeight[cargo]),
      canCarry: (cargo) => this.fleetCanCarry(cargo),
    }, 5);
  }

  /**
   * Take a contract on.
   *
   * Makes an ordinary two-stop service under the hood, because that is what a
   * contract is, and assigns a vehicle if one is free. The player never sees the
   * word service: they see a truck put on a job.
   */
  /**
   * Which of your vehicles could take a job, and from where.
   *
   * Answered per vehicle rather than as a yes/no, because with more than one
   * yard *which* lorry goes is the decision — a tanker at the far yard and a
   * tanker at the near one are not the same offer. So the chooser shows the
   * yard each one lives at and how far it is from the pickup, and the player
   * picks.
   */
  driversFor(contract: number): {
    vehicle: number; yard: number; deadTiles: number; suitable: boolean;
  }[] {
    const b = this.contractBoard;
    if (contract < 0 || contract >= b.count) return [];
    return this.driversForRun(b.from[contract], b.cargo[contract]);
  }

  /**
   * Which of your lorries could run a load out of a given place.
   *
   * The same question `driversFor` asks, without a contract to ask it about.
   * Fetching a business's own supplies is not a job anybody offered you — nobody
   * in this district delivers — so the picker that chooses the lorry cannot be
   * keyed to a piece of paperwork that does not exist. Both callers want the
   * identical list in the identical order, so there is one of it.
   */
  driversForRun(from: number, cargo: number): {
    vehicle: number; yard: number; deadTiles: number; suitable: boolean;
  }[] {
    const out: { vehicle: number; yard: number; deadTiles: number; suitable: boolean }[] = [];
    if (from === NONE || from < 0 || from >= this.sites.count) return out;
    const handling = this.content.cargo[cargo]?.handling;

    for (let v = 0; v < this.vehicles.count; v++) {
      if (!this.vehicles.alive[v]) continue;
      if (this.vehicles.company[v] !== this.player) continue;
      if (this.vehicles.service[v] !== NONE) continue;
      const def = this.content.vehicles[this.vehicles.type[v]];
      const yard = this.vehicleYard[v];
      // Empty running from the yard to the pickup, which is the cost of using a
      // lorry that lives in the wrong place.
      let dead = 0;
      if (yard >= 0) {
        const dx = this.yards.x[yard] - this.sites.x[from];
        const dy = this.yards.y[yard] - this.sites.y[from];
        dead = Math.round(Math.sqrt(dx * dx + dy * dy));
      }
      out.push({
        vehicle: v,
        yard,
        deadTiles: dead,
        suitable: handling !== undefined
          && (def.handling as readonly string[]).includes(handling),
      });
    }
    // Suitable first, then nearest, because that is the order a player wants to
    // read them in.
    out.sort((a, c) => (Number(c.suitable) - Number(a.suitable)) || (a.deadTiles - c.deadTiles));
    return out;
  }

  /** The tiles a run would cover, for drawing it before it is agreed. */
  previewRoute(fromSite: number, toSite: number): number[] {
    if (fromSite < 0 || toSite < 0) return [];
    const a = this.siteAccessTile[fromSite];
    const b = this.siteAccessTile[toSite];
    if (a === NONE || b === NONE) return [];
    return this.roadRoute(a, b);
  }

  /**
   * A route between two tiles, **along the roads**.
   *
   * This replaces a straightforward and badly wrong reuse of `tileRouter`. That
   * class is the *way-building* planner: it costs terrain — gradient squared,
   * water, slope — to answer "where would a new road go if we laid one". Asking
   * it for a route produced a line straight over the hills between two places,
   * ignoring every road in the district, which is exactly what it was built to
   * do and not remotely what a route preview means.
   *
   * The two questions look alike and are opposites. One is about ground that
   * has no road on it. The other is only allowed to touch ground that does.
   *
   * Plain A* over road tiles, four-connected. The whole district has on the
   * order of a thousand road tiles, so this is a search over a thousand nodes
   * with a Manhattan heuristic — well under a millisecond, which matters because
   * it runs on hover.
   */
  roadRoute(from: number, to: number): number[] {
    const size = this.config.size;
    const n = size * size;
    if (from < 0 || to < 0 || from >= n || to >= n) return [];
    const layer = this.layers[Mode.Road];
    const isRoad = (t: number): boolean => layer.cls[t] !== NO_WAY;
    // Snap to the network. An access tile is normally on it by construction,
    // but a site whose lane was never laid would otherwise fail silently and
    // draw nothing, which reads as a bug in the preview rather than in the map.
    const start = isRoad(from) ? from : this.nearestRoadTile(from);
    const goal = isRoad(to) ? to : this.nearestRoadTile(to);
    if (start === NONE || goal === NONE) return [];
    if (start === goal) return [start];

    if (this.routeCameFrom.length < n) {
      this.routeCameFrom = new Int32Array(n);
      this.routeCost = new Float64Array(n);
      this.routeSeen = new Int32Array(n);
    }
    const cameFrom = this.routeCameFrom;
    const cost = this.routeCost;
    const seen = this.routeSeen;
    const stamp = ++this.routeStamp;

    const gx = goal % size;
    const gy = (goal / size) | 0;
    const heuristic = (t: number): number =>
      Math.abs((t % size) - gx) + Math.abs(((t / size) | 0) - gy);

    const open = new Heap(1024);
    cost[start] = 0;
    seen[start] = stamp;
    cameFrom[start] = NONE;
    open.push(heuristic(start), start);

    let found = false;
    while (open.size > 0) {
      const cur = open.pop();
      if (cur === goal) { found = true; break; }
      const cx = cur % size;
      const cy = (cur / size) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DIR_DX[d];
        const ny = cy + DIR_DY[d];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const nt = ny * size + nx;
        if (!isRoad(nt)) continue;
        /*
         * A bigger road is cheaper per tile, so the line prefers the spine.
         *
         * Not for realism — because the drawn route should look like the route a
         * driver would take, and a shortest-tile-count path happily threads a
         * farm track through three fields to save one tile. Weighting by class
         * makes the preview follow the A-road, which is both what happens and
         * what reads as sensible.
         */
        const step = 1 + (layer.cls[nt] === NO_WAY ? 0 : this.classDetour[layer.cls[nt]] ?? 0);
        const g = cost[cur] + step;
        if (seen[nt] === stamp && g >= cost[nt]) continue;
        seen[nt] = stamp;
        cost[nt] = g;
        cameFrom[nt] = cur;
        open.push(g + heuristic(nt), nt);
      }
    }
    if (!found) return [];

    const out: number[] = [];
    for (let t = goal; t !== NONE; t = cameFrom[t]) out.push(t);
    out.reverse();
    return out;
  }

  private nearestRoadTile(from: number): number {
    const size = this.config.size;
    const layer = this.layers[Mode.Road];
    const fx = from % size;
    const fy = (from / size) | 0;
    // A short ring search. An access tile is at most a tile or two off the
    // network, so six is generous and bounded.
    for (let r = 1; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = fx + dx;
          const y = fy + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const t = y * size + x;
          if (layer.cls[t] !== NO_WAY) return t;
        }
      }
    }
    return NONE;
  }

  /**
   * Per-tile detour cost by way class, so the preview prefers the better road.
   *
   * Built from the content's own speed figures rather than named: a way that is
   * half the speed costs twice as much to go along, which is the same statement
   * the vehicle router makes and cannot drift from it.
   */
  private get classDetour(): number[] {
    if (this.detourCache === null) {
      const fastest = Math.max(1, ...Array.from(this.waySpeed));
      this.detourCache = Array.from(this.waySpeed, (v) => fastest / Math.max(1, v) - 1);
    }
    return this.detourCache;
  }

  private detourCache: number[] | null = null;
  private routeCameFrom = new Int32Array(0);
  private routeCost = new Float64Array(0);
  private routeSeen = new Int32Array(0);
  private routeStamp = 0;

  /**
   * The empty run: from a yard out to the pickup.
   *
   * A separate call from the loaded run because they are separate journeys and
   * the player is choosing between them — a lorry at the far yard does the same
   * paid work as one at the near yard and a great deal more unpaid driving to
   * get to it.
   *
   * The yard is not itself on the graph, so this routes from the nearest place
   * that is. Close enough to draw, and the alternative is putting a node under
   * every yard for the sake of a preview line.
   */
  routeFromYard(yard: number, toSite: number): number[] {
    if (yard < 0 || yard >= this.yards.count || toSite < 0) return [];
    let nearest = NONE;
    let best = Infinity;
    for (let s = 0; s < this.sites.count; s++) {
      if (this.siteAccessTile[s] === NONE) continue;
      const dx = this.sites.x[s] - this.yards.x[yard];
      const dy = this.sites.y[s] - this.yards.y[yard];
      const d = dx * dx + dy * dy;
      if (d < best) { best = d; nearest = s; }
    }
    if (nearest === NONE || nearest === toSite) return [];
    return this.previewRoute(nearest, toSite);
  }

  acceptContract(id: number, company: number, vehicle = NONE): boolean {
    const b = this.contractBoard;
    if (id < 0 || id >= b.count || b.state[id] !== ContractState.Offered) return false;
    const from = b.from[id];
    const to = b.to[id];
    if (from === NONE || to === NONE) return false;

    const svc = this.services.alloc(company, this.content.industries[this.sites.def[from]].name);
    if (svc === NONE) return false;
    this.services.addStop(svc, from, 0, StopAction.LoadFull, b.cargo[id]);
    this.services.addStop(svc, to, 0, StopAction.Unload, b.cargo[id]);
    this.services.active[svc] = 1;
    b.service[id] = svc;
    b.state[id] = ContractState.Idle;

    /*
     * The named vehicle if the player chose one, otherwise the first idle
     * truck.
     *
     * A default matters: the first contract of a new game should be one click,
     * and asking a player who owns exactly one lorry which lorry to use is a
     * question with one answer.
     */
    if (vehicle !== NONE && this.vehicles.alive[vehicle]
      && this.vehicles.company[vehicle] === company
      && this.vehicles.service[vehicle] === NONE) {
      this.assignVehicle(vehicle, svc, company);
      b.state[id] = ContractState.Running;
    } else {
      for (let v = 0; v < this.vehicles.count; v++) {
        if (!this.vehicles.alive[v]) continue;
        if (this.vehicles.company[v] !== company) continue;
        if (this.vehicles.service[v] !== NONE) continue;
        this.assignVehicle(v, svc, company);
        b.state[id] = ContractState.Running;
        break;
      }
    }
    this.rebuild();
    return true;
  }

  /**
   * The standing run bringing a cargo into a place of yours, if there is one.
   *
   * Asked by the panel so it can show a line that is already covered as covered,
   * rather than offering to arrange it again. Matched on the *stops* rather than
   * on a stored link, because a run is nothing but its stops — a two-stop service
   * of yours that unloads this cargo here *is* the supply run, however it came to
   * exist, which means a contract absorbed into a sourcing run is recognised
   * without anything having to remember that is what happened to it.
   */
  runInto(site: number, cargo: number): { service: number; vehicle: number } | null {
    for (let svc = 0; svc < this.services.count; svc++) {
      if (!this.services.active[svc]) continue;
      if (this.services.company[svc] !== this.player) continue;
      const n = this.services.stopCount[svc];
      let unloadsHere = false;
      for (let k = 0; k < n; k++) {
        const si = svc * MAX_STOPS + k;
        if (this.services.stopKind[si] !== 0) continue;
        if (this.services.stopTarget[si] !== site) continue;
        if (this.services.stopCargo[si] !== cargo) continue;
        if (this.services.stopAction[si] === StopAction.Unload
          || this.services.stopAction[si] === StopAction.Exchange) {
          unloadsHere = true;
          break;
        }
      }
      if (!unloadsHere) continue;
      let vehicle = NONE;
      for (let v = 0; v < this.vehicles.count; v++) {
        if (this.vehicles.alive[v] && this.vehicles.service[v] === svc) { vehicle = v; break; }
      }
      return { service: svc, vehicle };
    }
    return null;
  }

  /**
   * End a run. The lorry comes off it and goes back to the yard list.
   *
   * The counterpart of `supply`, and the reason the panel can be a toggle: a line
   * with a run on it offers to take it off, and a line without one offers to put
   * one on. Nothing else in the game can end a standing run of your own — the
   * only way to free a lorry was to give up a *contract*, which a sourcing run is
   * not.
   */
  endRun(service: number): boolean {
    if (service < 0 || service >= this.services.count) return false;
    if (this.services.company[service] !== this.player) return false;
    for (let v = 0; v < this.vehicles.count; v++) {
      if (this.vehicles.alive[v] && this.vehicles.service[v] === service) {
        this.vehicles.service[v] = NONE;
        this.vehicles.state[v] = VState.Idle;
      }
    }
    this.services.active[service] = 0;
    this.rebuild();
    return true;
  }

  /** Give a contract up. The truck comes off it and it goes back on the board. */
  dropContract(id: number, company: number): boolean {
    const b = this.contractBoard;
    if (id < 0 || id >= b.count) return false;
    const svc = b.service[id];
    if (svc === NONE || this.services.company[svc] !== company) return false;
    for (let v = 0; v < this.vehicles.count; v++) {
      if (this.vehicles.alive[v] && this.vehicles.service[v] === svc) {
        this.vehicles.service[v] = NONE;
        this.vehicles.state[v] = VState.Idle;
      }
    }
    this.services.active[svc] = 0;
    b.release(id);
    return true;
  }

  /** Rebuild the influence area from the yards and places you hold. */
  refreshInfluence(extra: InfluenceSource[] = []): void {
    const sources: InfluenceSource[] = [...extra];
    // A yard is a presence: it is where your lorries sleep and your name is
    // known, so it reaches further than a works you merely own.
    /*
     * How far your name carries, and three things add to it.
     *
     * A yard is a presence: it is where your lorries sleep and your name is
     * known, so it reaches further than a works you merely own. The lorries
     * themselves count — a yard with eight vehicles running out of it is known
     * further afield than one with one, which is the same "a vehicle is the unit
     * of measurement" rule as everywhere else. And `standing` is what the
     * planning board has agreed to, which is the whole point of the last rung:
     * reputation converted into reach.
     */
    const carry = 1 + this.standing * 0.22;
    for (let y = 0; y < this.yards.count; y++) {
      if (this.yards.owner[y] !== this.player) continue;
      let fleet = 0;
      for (let v = 0; v < this.vehicles.count; v++) {
        if (this.vehicles.alive[v] && this.vehicleYard[v] === y) fleet++;
      }
      sources.push({
        x: this.yards.x[y],
        y: this.yards.y[y],
        strength: (2.4 + Math.min(1.2, fleet * 0.16)) * carry,
      });
    }
    for (let s = 0; s < this.sites.count; s++) {
      if (this.sites.owner[s] !== this.player) continue;
      sources.push({ x: this.sites.x[s], y: this.sites.y[s], strength: 1.5 * carry });
    }
    this.influence.rebuild(sources);
  }

  // ------------------------------------------------------------- hashing

  hash(): number {
    const h = new Hasher();
    h.int(this.tick);
    h.array(this.rng.getState());
    hashNetwork(h, this.graph, this.assets);
    hashSites(h, this.sites, this.towns);
    hashEconomy(h, this.companies, this.services);
    h.int(this.vehicles.count);
    for (let i = 0; i < this.vehicles.count; i++) {
      if (!this.vehicles.alive[i]) {
        h.int(0);
        continue;
      }
      h.int(this.vehicles.link[i]).int(this.vehicles.cell[i]).int(this.vehicles.pos[i]);
      h.int(this.vehicles.speed[i]).int(this.vehicles.state[i]).int(this.vehicles.load[i]);
      h.int(this.vehicles.cargo[i]).int(this.vehicles.orderIndex[i]);
    }
    return h.value();
  }

  /**
   * What a unit of the best-paying cargo with this handling class is worth
   * against a tonne of freight. Lets a buyer compare a lorry with a bus
   * without pretending a seat is a tonne.
   */
  rateWeightFor(handling: string): number {
    let best = 0;
    for (let c = 0; c < this.content.cargo.length; c++) {
      if (this.content.cargo[c].handling !== handling) continue;
      if (this.cargoRateWeight[c] > best) best = this.cargoRateWeight[c];
    }
    return best > 0 ? best : 1;
  }

  /** Does a town make this cargo? Passengers and post, in practice. */
  townProduces(cargo: number): boolean {
    return (this.townProducePerThousand[cargo] ?? 0) > 0;
  }

  /** Daily tonnes of a cargo a thousand townspeople want. Exposed so the
   *  rival AI can tell an unconditional sink from a conditional one. */
  townDemandFor(cargo: number): number {
    return this.townDemandPerThousand[cargo] ?? 0;
  }

  /** Positions for the renderer. Never called by the tick. */
  project(): void {
    projectVehicles(this.graph, this.vehicles, this.config.size);
  }
}
