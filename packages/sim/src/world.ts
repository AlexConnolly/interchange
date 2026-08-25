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
  TICKS_PER_DAY, TICKS_PER_YEAR, DAYS_PER_MONTH, DAYS_PER_YEAR, ECONOMY_SCALE, LOAD_PATIENCE_DAYS, LOAD_PATIENCE_SHARE,
} from './constants.ts';
import { Cmd, CommandQueue, type Command } from './commands.ts';
import {
  CompanyTable, ContractState, ContractTable, Charter, Line, LINE_COUNT,
  ServiceTable, StopAction, MAX_STOPS, ENTRANT_NAMES, hashEconomy, haulageRate, HAUL_ALLOWANCE, RATE_WEIGHT_BY_TIER, CHARTER_REQUIREMENTS, makeContract, stepFinance,
} from './economy.ts';
import { FX_ONE, fx, fxDiv, fxMul } from './fixed.ts';
import { Hasher } from './hash.ts';
import { generateAirCorridors } from './seaair.ts';
import {
  Climate, EventTable, stepEvents, floodSeverity, strikePercent,
  runningCostPercent, ratePercent, FLOOD_LINE, EVENT_NAMES, EventKind, WEATHER_NAMES, Weather,
} from './weather.ts';
import { AmenityField, stepAmenity, REMEDIATION_PRICE, REMEDIATION_FROM_ERA } from './amenity.ts';
import { SchemeTable, stepPublicWorks, SchemeState } from './publicworks.ts';
import { RegulatorTable, stepRegulator, accessChargeFor, Intervention, INTERVENTION_NAMES } from './regulation.ts';
import {
  AssetTable, Graph, NONE, NO_WAY, WayLayer, hashNetwork, rebuildGraph,
} from './network.ts';
import { Router, type RouteCosts } from './pathfinding.ts';
import { TileRouter } from './tilerouter.ts';
import { Rng } from './rng.ts';
import {
  IndustryKind, SiteState, SiteTable, TownTable, hashSites, stepSiteDecay,
  stepSites, stepTowns, type RecipeTables,
} from './sites.ts';
import { DEPOSIT_NAMES, TileFlag, generateTerrain, SEA_LEVEL, type Terrain, type WorldConfig } from './terrain.ts';
import { ObjectiveTable, checkObjectives, generateObjective, type ObjectiveContext } from './objectives.ts';
import { THINK_DAYS, stepRival } from './rivals.ts';
import { alignForRadius, layAlignment, planAlignment, removeWayTile, LOCK_LIFT, type Alignment } from './construction.ts';
import { balanceGrids, buildGrids, computeLabour, emptyUtilityState } from './utilities.ts';
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
  readonly contracts = new ContractTable();
  readonly services = new ServiceTable();
  readonly objectives = new ObjectiveTable();
  /** Tonnes moved per cargo, per company, for objectives and the sweep. */
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
  private wayWear = new Int32Array(64);
  private wayLanes = new Int32Array(64);
  private vehicleSpeed = new Int32Array(256);
  private vehicleCapacity = new Int32Array(256);
  private vehicleTransfer = new Int32Array(256);
  private vehicleRunning = new Float64Array(256);
  private vehicleMode = new Uint8Array(256);
  private cargoPrice = new Int32Array(64);
  private recipes: RecipeTables;
  /** The authority's competition powers, and how far it has had to use them
   *  against each company. design.md 3.7. */
  readonly regulator = new RegulatorTable();
  /** The sky, and the things that go wrong under it. features.md 11 and 15. */
  /** What the region is like to be in, and what industry has done to it.
   *  design.md 2.3. */
  readonly amenity: AmenityField;
  /** Public road schemes the authority has in hand against dear private
   *  ways. features.md 12. */
  readonly schemes = new SchemeTable();
  readonly climate = new Climate();
  readonly events = new EventTable();
  private lastEra = 0;
  private entrantDue = 0;
  private airLaid = false;
  private cargoRateWeight = new Float64Array(256).fill(1);
  private townDemandPerThousand: Float64Array;
  private townWant: Record<string, number> = {};
  private townSend: Record<string, number> = {};
  private basketEra = 0;
  private touristCargo = -1;
  private townProducePerThousand: Float64Array;
  private routeCosts: RouteCosts;

  /** Access tiles, so sites and towns survive a graph rebuild. */
  siteAccessTile: Int32Array;
  townAccessTile: Int32Array;
  /** Reverse lookups for delivery: node id to site or town. */
  private nodeSiteOf = new Map<number, number>();
  private nodeTownOf = new Map<number, number>();

  /** The three networks. design.md §2.2. */
  readonly power = emptyUtilityState(MAX_NODES);
  readonly water = emptyUtilityState(MAX_NODES);
  readonly conveyorGrid = emptyUtilityState(MAX_NODES);
  /** People who can reach each node inside a commute. */
  labourAt = new Float64Array(MAX_NODES);

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
    this.movedByCargo = new Float64Array(MAX_COMPANIES * content.cargo.length);
    this.townAccessTile = new Int32Array(64).fill(NONE);

    // ---- derived tables -------------------------------------------------
    content.ways.forEach((w, i) => {
      this.waySpeed[i] = w.speedLimit;
      this.wayUpkeep[i] = w.upkeep;
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
      // Visitors, which a town wants far more of in August than in February.
      // Seasonally scaled where the basket is consumed rather than here, so
      // the number in this table stays a plain annual average.
      tourists: 4,
    };
    this.townSend = { passengers: 9, mail: 2 };
    this.townDemandPerThousand = new Float64Array(content.cargo.length);
    this.townProducePerThousand = new Float64Array(content.cargo.length);
    this.touristCargo = content.cargoIndex.get('tourists') ?? -1;
    this.rebuildTownBasket(1);

    this.routeCosts = { speedLimit: this.waySpeed, valueOfTime: content.balance.valueOfTime };
    this.amenity = new AmenityField(this.config.size);
    this.router = new Router(MAX_COMPANIES, 100000);
  }

  // ------------------------------------------------------------- calendar

  get day(): number {
    return (this.tick / TICKS_PER_DAY) | 0;
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
      this.townDemandPerThousand[i] = v / ECONOMY_SCALE;
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

  get era(): number {
    const y = this.year;
    for (let i = this.content.eras.length - 1; i >= 0; i--) {
      if (y >= this.content.eras[i].from) return this.content.eras[i].n;
    }
    return 1;
  }

  dateString(): string {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${this.dayOfMonth + 1} ${months[this.month]} ${this.year}`;
  }

  // ------------------------------------------------------------ the graph

  /** Retrace the network and re-attach everything that points into it. */
  rebuild(): void {
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
    buildGrids(this.graph, this.assets, Mode.Wire, this.power);
    buildGrids(this.graph, this.assets, Mode.Pipe, this.water);
    buildGrids(this.graph, this.assets, Mode.Conveyor, this.conveyorGrid);

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
      (link, company) => this.linkConditions(link, company),
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

  private stepDay(): void {
    const b = this.content.balance;
    this.checkEraTurn();

    // running costs, breakdowns, and obsolescence
    const year = this.year;
    const fuelPct = runningCostPercent(this.events);
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
    }

    this.stepUtilities();
    stepSiteDecay(this.sites, b);
    this.rebuildTownBasket(this.era);
    stepTowns(
      this.towns, this.townDemandPerThousand, this.townProducePerThousand, b.townGrowthPerDay,
      { cargo: this.touristCargo, multiplier: this.climate.tourismMultiplier(this.day) },
    );
    this.stepConveyors();
    this.stepContracts();
    this.stepRivals();
    stepFinance(this.companies, b, (c) => this.declareBankrupt(c));

    if (this.day % b.contractIntervalDays === 0) this.offerContract();
    this.stepObjectives();
    if (this.dayOfMonth === 0 && this.day > 0) this.companies.closeMonth();
    if (this.tick % TICKS_PER_YEAR === 0 && this.tick > 0) this.companies.closeYear();
    this.stepWeather();
    if (this.dayOfMonth === 0) this.stepAmenityField();
    this.stepRegulation();
    if (this.day % DAYS_PER_YEAR === 0 && this.day > 0) this.stepPublicWorks();
    this.stepEntrants();
    this.checkCharters();
  }

  /**
   * The three networks, once a day.
   *
   * Daily rather than per tick because none of it changes faster than that: a
   * grid does not re-balance twenty times a second, and running it per tick
   * would be the most expensive thing in the simulation for no perceivable
   * difference.
   */
  private stepUtilities(): void {
    const c = this.content;
    const electricity = c.cargoIndex.get('electricity') ?? 0;
    const waterCargo = c.cargoIndex.get('water') ?? 0;

    const ledger = {
      charge: (payer: number, payee: number, amount: number, asset: number): void => {
        if (amount <= 0) return;
        this.companies.post(payer, Line.AccessPaid, amount);
        if (payee !== AUTHORITY) this.companies.post(payee, Line.AccessCharged, amount);
        if (asset !== NONE) this.assets.revenue[asset] += amount;
      },
    };

    balanceGrids(
      this.power, this.sites, Mode.Wire,
      (s) => this.recipes.powerNeed[this.sites.def[s]],
      (s) => this.siteOutputRate(s, electricity),
      (s, pct) => { this.sites.powered[s] = pct; },
      this.assets, ledger, this.cargoPrice[electricity],
    );
    balanceGrids(
      this.water, this.sites, Mode.Pipe,
      (s) => this.recipes.waterNeed[this.sites.def[s]],
      (s) => this.siteOutputRate(s, waterCargo),
      (s, pct) => { this.sites.watered[s] = pct; },
      this.assets, ledger, this.cargoPrice[waterCargo],
    );

    // Total labour demand, so the catchment can be shared rather than counted
    // once per site. Without this, twenty mines beside one town are each
    // "fully staffed" and labour is not a constraint at all.
    let totalNeed = 0;
    for (let s = 0; s < this.sites.count; s++) {
      if (this.sites.state[s] === SiteState.Dead) continue;
      totalNeed += this.recipes.labourNeed[this.sites.def[s]];
    }
    let totalPeople = 0;
    for (let t = 0; t < this.towns.count; t++) totalPeople += this.towns.population[t];
    // One person in ten works in the industries the player is running; the
    // rest are children, shopkeepers, and everybody else a town contains.
    this.labourShare = totalNeed > 0 ? Math.max(1, totalNeed / Math.max(1, totalPeople * 0.1)) : 1;

    // Recomputed on a slower cadence than the grids, because towns grow by
    // single people and the catchment is a smooth function of that.
    if (this.day % 10 === 0) {
      computeLabour(this.graph, this.towns, (link) => this.waySpeed[this.graph.linkCls[link]], this.labourAt);
    }
    for (let s = 0; s < this.sites.count; s++) {
      const need = this.recipes.labourNeed[this.sites.def[s]];
      if (need <= 0) {
        this.sites.staffed[s] = 100;
        continue;
      }
      const node = this.sites.nodeOf(s, Mode.Road);
      const available = node === NONE ? 0 : this.labourAt[node];
      this.sites.staffed[s] = Math.max(0, Math.min(100,
        Math.round((available * 0.1) / Math.max(1, need * this.labourShare) * 100)));
    }
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
    const asset = this.graph.linkAsset[link];
    if (asset === NONE) return;
    const owner = this.assets.owner[asset];
    const payer = this.vehicles.company[vehicle];
    this.assets.passes[asset]++;
    if (owner === payer) return;
    const tiles = this.graph.linkChainLen[link] - 1;
    const charge = accessChargeFor(this.regulator, this.assets, asset) * tiles;
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
    const boom = ratePercent(this.events, cargo);
    const pence = Math.round(
      (haulageRate(this.cargoPrice[cargo], dist, this.cargoRateWeight[cargo]) * tonnes * boom) / 100,
    );
    this.companies.post(company, Line.Haulage, pence);
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

    // Credit any contract this delivery satisfies.
    for (let k = 0; k < this.contracts.count; k++) {
      if (this.contracts.state[k] !== ContractState.Active) continue;
      if (this.contracts.holder[k] !== company) continue;
      if (this.contracts.cargo[k] !== cargo) continue;
      if ((this.contracts.toIsTown[k] === 1) !== isTown) continue;
      if (this.contracts.toSite[k] !== target) continue;
      this.contracts.delivered[k] += tonnes;
      if (this.contracts.delivered[k] >= this.contracts.volume[k]) {
        this.contracts.state[k] = ContractState.Complete;
        const bonus = this.contracts.value(k);
        this.companies.post(company, Line.ContractBonus, bonus);
        this.companies.delivered[company]++;
      }
      break;
    }
  }

  // ------------------------------------------------------------ contracts

  private offerContract(): void {
    const b = this.content.balance;
    let offered = 0;
    for (let k = 0; k < this.contracts.count; k++) {
      if (this.contracts.state[k] === ContractState.Offered) offered++;
    }
    if (offered >= b.contractSlots) return;
    const seed = this.pickContractSeed();
    if (!seed) return;
    makeContract(this.contracts, seed, this.tick, this.rng, b, this.eraHaulier());
  }

  /**
   * The road vehicle a contract is written against: the biggest one on sale
   * this era. Contracts are quoted in its loads and its speed, so what the
   * board asks for stays a few weeks of work from 1860 to 2100.
   */
  private eraHaulier(): { capacity: number; tilesPerDay: number } {
    let capacity = 3;
    let speed = 2949;
    const era = this.era;
    for (let i = 0; i < this.content.vehicles.length; i++) {
      const v = this.content.vehicles[i];
      if (v.mode !== 'road' || v.era > era || v.obsoleteYear < this.year) continue;
      if (v.capacity > capacity) {
        capacity = v.capacity;
        speed = v.speed;
      }
    }
    return { capacity, tilesPerDay: (speed / 65536) * TICKS_PER_DAY };
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
   * Award and expire. design.md §4.4: awarded on price weighted by reliability
   * history, so being cheap and late stops working.
   */
  private stepContracts(): void {
    const b = this.content.balance;
    for (let k = 0; k < this.contracts.count; k++) {
      const state = this.contracts.state[k];
      if (state === ContractState.Offered && this.tick >= this.contracts.offeredUntil[k]) {
        let bestCompany = NONE;
        let bestScore = -Infinity;
        for (let c = 0; c < this.companies.count; c++) {
          const bid = this.contracts.bids[k * MAX_COMPANIES + c];
          if (bid <= 0) continue;
          // Lower price is better; higher reliability is better. The weight is
          // data so the sweep can find the point where reputation stops
          // mattering and the board becomes a pure price auction.
          const price = -bid;
          const rel = this.companies.reliability(c);
          const score = price * (100 - b.reliabilityWeight) + rel * b.reliabilityWeight * 20;
          if (score > bestScore) {
            bestScore = score;
            bestCompany = c;
          }
        }
        if (bestCompany === NONE) {
          this.contracts.release(k);
        } else {
          this.contracts.state[k] = ContractState.Active;
          this.contracts.holder[k] = bestCompany;
          this.contracts.rate[k] = this.contracts.bids[k * MAX_COMPANIES + bestCompany];
        }
        continue;
      }
      if (state === ContractState.Active && this.tick >= this.contracts.deadline[k]) {
        this.contracts.state[k] = ContractState.Failed;
        const holder = this.contracts.holder[k];
        if (holder !== NONE) {
          // Partial delivery reduces the penalty; abandoning entirely does not.
          const shortfall = 1 - this.contracts.delivered[k] / Math.max(1, this.contracts.volume[k]);
          this.companies.post(holder, Line.Penalties, Math.round(this.contracts.penalty[k] * shortfall));
          this.companies.missed[holder]++;
        }
        this.contracts.release(k);
      }
      if (state === ContractState.Complete) this.contracts.release(k);
    }
  }

  /**
   * Conveyors: a transport mode with no vehicles.
   *
   * Mine to processing, quarry to wharf — short hauls where a fleet is
   * ridiculous and a belt is obvious. Everything on one conveyor network moves
   * cargo to whoever on that network wants it, at a fixed rate, and the owner
   * of the belt charges for it exactly as a road owner charges a lorry.
   */
  private stepConveyors(): void {
    const conveyor = this.layers[Mode.Conveyor];
    if (conveyor.tileCount === 0) return;
    const cargoCount = this.content.cargo.length;
    const RATE = 26;

    // Sites on each conveyor component, producers and consumers alike.
    const members = new Map<number, number[]>();
    for (let s = 0; s < this.sites.count; s++) {
      const node = this.sites.nodeOf(s, Mode.Conveyor);
      if (node === NONE) continue;
      const gi = this.conveyorGrid.gridOfNode[node];
      if (gi < 0) continue;
      const list = members.get(gi) ?? [];
      list.push(s);
      members.set(gi, list);
    }

    // Iterated by grid index rather than by Map order, because Map iteration
    // order is not a contract the simulation may rely on (rule 4).
    const gridIds = [...members.keys()].sort((a, b) => a - b);
    for (const gi of gridIds) {
      const list = members.get(gi) as number[];
      list.sort((a, b) => a - b);
      for (const from of list) {
        const outs = this.recipes.outputs[this.sites.def[from]];
        for (let i = 0; i < outs.length; i += 2) {
          const cargo = outs[i];
          let available = this.sites.stockOf(from, cargo);
          if (available <= 0) continue;
          for (const to of list) {
            if (to === from || available <= 0) continue;
            const room = this.sites.capacity[to * cargoCount + cargo] - this.sites.stockOf(to, cargo);
            if (room <= 0) continue;
            const moved = Math.min(available, room, RATE);
            if (moved <= 0) continue;
            this.sites.takeStock(from, cargo, moved);
            this.sites.addStock(to, cargo, moved);
            this.sites.everServed[from] = 1;
            this.sites.shipped[from] += moved;
            available -= moved;

            // The belt charges, like every other piece of infrastructure.
            const owner = this.sites.owner[to];
            for (const asset of this.conveyorGrid.grids[gi].assets) {
              const lineOwner = this.assets.owner[asset];
              if (lineOwner === owner) continue;
              const fee = Math.round((moved * accessChargeFor(this.regulator, this.assets, asset)) / 4);
              if (fee <= 0) continue;
              this.companies.post(owner, Line.AccessPaid, fee);
              if (lineOwner !== AUTHORITY) this.companies.post(lineOwner, Line.AccessCharged, fee);
              this.assets.revenue[asset] += fee;
            }
          }
        }
      }
    }
  }

  /**
   * Rivals think, one at a time, on a rota.
   *
   * Staggered rather than all on the same day so the contract board is not
   * hit by four simultaneous bids every sixth morning — and because a company
   * that reviews its strategy the same day as everybody else is a company in
   * a simulation rather than a company.
   */
  private stepRivals(): void {
    for (let company = 1; company < this.companies.count; company++) {
      if (!this.companies.isAi[company]) continue;
      if (this.companies.bankrupt[company]) continue;
      if ((this.day + company * 2) % THINK_DAYS !== 0) continue;
      stepRival(this, company, this.rng);
    }
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

  private objectiveContext(company: number): ObjectiveContext {
    const cargoCount = this.content.cargo.length;
    const base = company * LINE_COUNT;
    const liveCargo: number[] = [];
    for (let c = 0; c < cargoCount; c++) {
      if (this.recipes.cargoFromEra[c] > this.era) continue;
      if (this.content.cargo[c].tier === 'networked') continue;
      liveCargo.push(c);
    }
    return {
      tick: this.tick,
      era: this.era,
      cargoName: (i) => this.content.cargo[i]?.name ?? '',
      townName: (i) => this.towns.names[i] ?? '',
      movedByCargo: this.movedByCargo.subarray(company * cargoCount, (company + 1) * cargoCount),
      townCount: this.towns.count,
      townServed: (t) => this.towns.served[t],
      annualRevenue:
        this.companies.ledgerYear[base + Line.Haulage] +
        this.companies.ledgerYear[base + Line.ContractBonus] +
        this.companies.ledgerYear[base + Line.AccessCharged],
      ownedAssets: this.ownedAssets(company),
      ownedSites: this.ownedSites(company),
      liveCargo,
    };
  }

  private stepObjectives(): void {
    for (let company = 1; company < this.companies.count; company++) {
      if (this.companies.bankrupt[company]) continue;
      const ctx = this.objectiveContext(company);
      const { met, expired } = checkObjectives(this.objectives, ctx);
      for (const id of met) {
        if (this.objectives.company[id] !== company) continue;
        this.companies.post(company, Line.Subsidy, this.objectives.reward[id]);
        if (company === this.player) {
          this.onEvent?.('objective', `${this.objectives.text[id]} — done. ${Math.round(this.objectives.reward[id] / 100).toLocaleString('en-GB')} paid.`);
        }
        this.objectives.release(id);
      }
      for (const id of expired) {
        if (this.objectives.company[id] === this.player) {
          this.onEvent?.('objective-missed', `Missed: ${this.objectives.text[id]}.`);
        }
        this.objectives.release(id);
      }
      // Two open at a time. More than that and the board stops being a
      // prompt and becomes a checklist, which is the opposite of the point.
      const open = this.objectives.openFor(company).length;
      if (open < 2 && this.day % 15 === 0) {
        generateObjective(this.objectives, company, ctx, this.rng);
      }
    }
  }

  // -------------------------------------------------------------- charters

  /**
   * Charter progression, design.md §1. Each is a licence to do a category of
   * thing you could previously only pay someone else to do — so the gate is
   * that you have run a real business at the current level, not that a
   * timer expired.
   */
  /**
   * Things that happen once, when the century turns a page.
   *
   * Air is the clearest case. There is no sky to build, only aerodromes, so
   * the corridors between them cannot be laid at worldgen — in 1860 there is
   * nowhere for them to go — and they cannot be laid by the player either,
   * because nobody builds a flight path. They come into existence when the
   * era does, between the places big enough to have an aerodrome, which is
   * the same argument seaair.ts makes about the sea and for the same reason.
   */
  private checkEraTurn(): void {
    const era = this.era;
    if (era === this.lastEra) return;
    const was = this.lastEra;
    this.lastEra = era;
    if (was === 0) return;

    this.openNewIndustries(era);

    const airCls = this.content.wayIndex.get('airway');
    if (airCls !== undefined && this.content.ways[airCls].era <= era && !this.airLaid) {
      // The four largest towns get an aerodrome. Fewer and there is no network;
      // more and every village in the region has an airport, which is silly and
      // also makes the air graph enormous for no gain.
      const order = Array.from({ length: this.towns.count }, (_, i) => i)
        .sort((a, b) => this.towns.population[b] - this.towns.population[a]);
      const airports = order.slice(0, 4).map((t) => this.towns.tile[t]);
      if (airports.length >= 2) {
        const laid = generateAirCorridors(
          this.terrain, this.layers[Mode.Air], this.assets, airCls, airports, this.tick,
        );
        if (laid > 0) {
          this.airLaid = true;
          this.rebuild();
          this.onEvent?.('era', 'Aerodromes have opened at the four largest towns, and the corridors between them are open to anybody with an aeroplane.');
        }
      }
    }
  }

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
   * The sky, once a day.
   *
   * Both halves are announced. A player whose lorries have slowed by a third
   * and who has not been told why will look for the bug, and they are right
   * to: an unexplained number is indistinguishable from a broken one.
   */
  private stepWeather(): void {
    /*
     * Only the weather that changes a decision is worth a line.
     *
     * Announcing every front produced ten notices a year, at which point the
     * player stops reading the log — and the log is also where the regulator
     * writes, so the cost of the noise is not the noise. Rain and fog are
     * atmosphere and belong in the palette; snow and a storm can shut a pass,
     * which is news.
     */
    const changed = this.climate.step(this.tick, this.day, this.rng);
    const notable = this.climate.weather === Weather.Snow || this.climate.weather === Weather.Storm;
    if (changed && notable && this.climate.severity > 62) {
      this.onEvent?.('weather', `${WEATHER_NAMES[this.climate.weather]} has set in across the region.`);
    }
    const live: number[] = [];
    for (let c = 0; c < this.content.cargo.length; c++) {
      // Electricity and water travel down a wire and a pipe. A boom in them
      // is not a boom in carriage, and announcing one is a promise of work
      // that does not exist.
      if (this.content.cargo[c].tier === 'networked') continue;
      if (this.recipes.cargoFromEra[c] <= this.era) live.push(c);
    }
    const { opened, closed } = stepEvents(this.events, {
      tick: this.tick, day: this.day, era: this.era,
      companyCount: this.companies.count, cargoCount: this.content.cargo.length,
      liveCargo: live, climate: this.climate,
    }, this.rng);
    for (const i of opened) {
      const subject = this.events.kind[i] === EventKind.Boom
        ? ` (${this.content.cargo[this.events.subject[i]].name.toLowerCase()})`
        : this.events.kind[i] === EventKind.Strike
          ? ` (${this.companies.names[this.events.subject[i]]})`
          : '';
      this.onEvent?.('disruption', `${EVENT_NAMES[this.events.kind[i]]}${subject}: ${this.events.text[i]}`);
    }
    for (const i of closed) {
      this.onEvent?.('disruption', `${EVENT_NAMES[this.events.kind[i]]} is over.`);
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
  private linkConditions(link: number, company: number): number {
    // The midpoint of the link, which is the honest place to sample: a pass
    // is defined by its summit, not by the valley floor it starts in.
    const start = this.graph.linkChainStart[link];
    const len = this.graph.linkChainLen[link];
    const tile = this.graph.chain[start + (len >> 1)];
    const height = this.terrain.height[tile] ?? 0;
    let pct = this.climate.speedPercent(height);

    const flood = floodSeverity(this.events);
    if (flood > 0 && height < FLOOD_LINE) {
      pct = Math.min(pct, Math.max(0, 100 - flood));
    }
    const strike = strikePercent(this.events, company);
    if (strike < 100) pct = (pct * strike) / 100;
    return pct;
  }

  /**
   * The authority's own capital programme, once a year.
   *
   * The frightening one, and deliberately so: unlike the regulator it does
   * not care how dominant you are, only that a corridor matters and that
   * using it is dear — which are precisely the two things that made the asset
   * worth owning. Announced, slow, and withdrawn if the case goes away, so a
   * player who does not fancy the competition has six years to drop the
   * charge and make the scheme not worth building.
   */
  private stepPublicWorks(): void {
    const report = stepPublicWorks(
      this.schemes, this.assets, this.era, this.tick, TICKS_PER_YEAR,
      (asset) => this.assetEndpoints(asset),
    );

    for (const i of report.proposed) {
      const owner = this.assets.owner[this.schemes.against[i]];
      if (owner !== this.player) continue;
      this.onEvent?.(
        'publicworks',
        'The authority is consulting on a public road beside one of yours. '
        + 'It says the passage is dear. Lower the charge and the case for it goes away.',
      );
    }
    for (const i of report.withdrawn) {
      const owner = this.assets.owner[this.schemes.against[i]];
      if (owner !== this.player) continue;
      this.onEvent?.('publicworks', 'The authority has dropped its road scheme. The case for it went away.');
    }
    for (const i of report.build) {
      const path = this.tileRouter.route(this.schemes.fromTile[i], this.schemes.toTile[i]);
      if (!path || path.length < 2) continue;
      const cls = this.publicRoadClass();
      if (cls < 0) continue;
      const way = this.content.ways[cls];
      const laid = this.layPublicWay(Mode.Road, cls, path, way.publicCharge, way.buildCost);
      if (!laid) continue;
      const owner = this.assets.owner[this.schemes.against[i]];
      this.onEvent?.(
        'publicworks',
        owner === this.player
          ? 'The public road has opened alongside yours. Traffic has somewhere else to go.'
          : 'The authority has opened a new public road.',
      );
    }
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
    this.rebuild();
    this.router.invalidate();
    return true;
  }

  /**
   * The region gains industry as the century turns.
   *
   * Worldgen places the extraction sites the 1860s had and nothing else, and
   * nothing ever added to them — so a game run to 2100 had exactly the same
   * industries in it as a game run to 1861. A refinery, an aluminium smelter,
   * a resort: all in the content, all reachable in principle by a player with
   * an extraction charter, and in practice never present anywhere. Half the
   * cargo table could not move because nothing in the region made it.
   *
   * These are founded by the authority rather than by anybody, which is the
   * right reading of what they are: the region developing, not a competitor
   * expanding. They are a thing to serve, and whoever serves them first has
   * found the opportunity the new era opened. That is the era transition
   * doing what design.md 2.4 says it should — inverting the optimum — rather
   * than merely retiring some lorries.
   */
  private openNewIndustries(era: number): void {
    /*
     * Each of this era's new industries first, then anything older that now
     * has somebody to trade with.
     *
     * Drawing at random until a quota filled meant an era's rarer works
     * simply never happened: era three brings the oil rig, the smelter and
     * the refinery, and a quota of four filled with refineries — which are
     * easy to site — before an oil rig was ever drawn. Crude oil existed in
     * the content, had a producer and a consumer, and was never once made
     * anywhere. An era ought to visibly bring the things it is the era of.
     */
    let founded = 0;
    for (let defIndex = 0; defIndex < this.content.industries.length; defIndex++) {
      if (this.content.industries[defIndex].fromEra !== era) continue;
      const copies = 1 + this.rng.int(2);
      for (let n = 0; n < copies; n++) {
        const tile = this.pickSiteFor(defIndex);
        if (tile === NONE) break;
        if (this.foundIndustryAsAuthority(defIndex, tile) !== NONE) founded++;
      }
    }

    // And the backlog: anything from an earlier era that this one has finally
    // given a partner. A retail park is no use until something makes retail
    // stock, and the thing that makes it arrives an era later than it does.
    const backlog = 2 + this.rng.int(3);
    let filled = 0;
    for (let attempt = 0; attempt < 300 && filled < backlog; attempt++) {
      const defIndex = this.rng.int(this.content.industries.length);
      const def = this.content.industries[defIndex];
      if (def.fromEra >= era) continue;
      if (!this.completesAChain(defIndex)) continue;
      const tile = this.pickSiteFor(defIndex);
      if (tile === NONE) continue;
      if (this.foundIndustryAsAuthority(defIndex, tile) !== NONE) { founded++; filled++; }
    }

    if (founded > 0) {
      this.onEvent?.('era', `New industry has come to the region: ${founded} works opened this decade.`);
    }
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
    this.layPublicWay(Mode.Road, cls, path, way.publicCharge, way.buildCost);
    layer.terminal[tile] = 1;
    this.rebuild();
  }

  /** The best road the authority would build this era. */
  private publicRoadClass(): number {
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

  /**
   * The regulator, once a day.
   *
   * Everything it decides is announced, because an intervention the player
   * only discovers by noticing their tolls have stopped earning is a bug they
   * will report rather than an antagonist they will respect.
   */
  private stepRegulation(): void {
    const report = stepRegulator(
      this.regulator, this.assets, this.companies, this.era, this.tick,
      this.content.balance.valuationPct,
      (asset, from, price) => {
        this.assets.owner[asset] = AUTHORITY;
        this.assets.forSale[asset] = 0;
        this.assets.charge[asset] = this.content.ways[this.assets.cls[asset]].publicCharge;
        this.companies.post(from, Line.AssetTrade, price);
        this.router.invalidate();
        if (from === this.player) {
          this.onEvent?.('regulator', 'The authority has compulsorily purchased one of your ways for public benefit. You have been paid the market valuation.');
        }
      },
    );
    for (const c of report.changed) {
      if (c.company !== this.player) continue;
      this.onEvent?.(
        'regulator',
        c.up
          ? `The authority has escalated to: ${INTERVENTION_NAMES[c.level]}.`
          : c.level === Intervention.None
            ? 'The authority has closed its case against you.'
            : `The authority has stepped back to: ${INTERVENTION_NAMES[c.level]}.`,
      );
    }
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
      const cash = this.companies.cash[c];
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
      } else if (have === Charter.Extraction) {
        earned = revenue >= req.land.revenue && this.ownedSites(c) >= req.land.sites;
      }
      if (earned) {
        this.companies.charter[c] = have + 1;
        this.onCharter?.(c, have + 1);
      }
    }
  }

  onCharter: ((company: number, charter: number) => void) | null = null;
  onEvent: ((kind: string, text: string) => void) | null = null;

  ownedAssets(company: number): number {
    let n = 0;
    for (let a = 0; a < this.assets.count; a++) if (this.assets.owner[a] === company) n++;
    return n;
  }

  ownedSites(company: number): number {
    let n = 0;
    for (let s = 0; s < this.sites.count; s++) if (this.sites.owner[s] === company) n++;
    return n;
  }

  /**
   * design.md §3.8: insolvency is an event in the world, not a game-over
   * screen. The assets go on the market and everybody else gets to respond.
   */
  private declareBankrupt(company: number): void {
    if (this.companies.bankrupt[company]) return;
    this.companies.bankrupt[company] = 1;
    // Outstanding contracts go with it. Leaving them active means an
    // administrator racking up deadline penalties on a company that no longer
    // has a single vehicle.
    for (let k = 0; k < this.contracts.count; k++) {
      if (this.contracts.holder[k] === company) this.contracts.release(k);
    }
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

  /**
   * A new operator sets up, some years after somebody else failed.
   *
   * design.md 3.8 says insolvency is an event in the world rather than a
   * game-over screen, and the same ought to be true of the region as a whole:
   * a failed carrier leaves a yard, a route somebody knows is viable, and a
   * gap in the market. Without this the region only ever loses companies —
   * across a sixty-year sweep three of the four rivals were gone by the end
   * and the last decades had nobody in them to compete with, buy from, or be
   * regulated against. Every mechanism in the ownership spine needs somebody
   * on the other side of it.
   *
   * They arrive on the same terms anybody else did, which is what stops this
   * being a difficulty knob: the same starting capital, a fresh personality,
   * and no charter. If the region is genuinely unprofitable they will fail
   * too, and that is information rather than a bug.
   */
  private stepEntrants(): void {
    if (this.entrantDue === 0 || this.tick < this.entrantDue) return;
    this.entrantDue = 0;
    let live = 0;
    for (let c = 1; c < this.companies.count; c++) if (!this.companies.bankrupt[c]) live++;
    if (live >= this.config.companyCount - 1) return;

    // Re-use a failed company's slot: the table is small and fixed, and a
    // region that has seen eight failures has not run out of entrepreneurs.
    let slot = NONE;
    for (let c = 1; c < this.companies.count; c++) {
      if (c !== this.player && this.companies.bankrupt[c]) { slot = c; break; }
    }
    if (slot === NONE) return;

    const name = ENTRANT_NAMES[this.rng.int(ENTRANT_NAMES.length)];
    this.companies.revive(slot, name, this.content.balance.startingCash);
    this.companies.isAi[slot] = 1;
    this.companies.aggression[slot] = 30 + this.rng.int(60);
    this.companies.horizon[slot] = 25 + this.rng.int(65);
    this.companies.thrift[slot] = 25 + this.rng.int(65);
    this.onEvent?.('entrant', `${name} has set up in the region.`);
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
      case Cmd.BidContract:
        if (c.a < this.contracts.count && this.contracts.state[c.a] === ContractState.Offered) {
          this.contracts.bids[c.a * MAX_COMPANIES + c.issuer] = Math.max(1, c.b);
        }
        break;
      case Cmd.DropContract:
        if (this.contracts.holder[c.a] === c.issuer) {
          this.contracts.state[c.a] = ContractState.Failed;
          this.companies.post(c.issuer, Line.Penalties, this.contracts.penalty[c.a]);
          this.companies.missed[c.issuer]++;
          this.contracts.release(c.a);
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
      case Cmd.Remediate:
        this.remediate(c.issuer, c.a, c.b);
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
   * Pay to mend the ground. design.md 2.3.
   *
   * The design asks for a redemption arc rather than only a ratchet, and the
   * shape of that is deliberately asymmetric: spoiling is instant and free —
   * it is a side effect of a pit that is making you money — while mending is
   * slow, expensive, and something you have to choose. Remediation buys credit
   * that the monthly pass spends down over years; it does not repaint the
   * valley the afternoon you pay for it.
   *
   * Radius is in amenity cells rather than tiles, because that is the grid the
   * field is on and pretending otherwise would let a player pay for precision
   * the model does not have.
   */
  remediate(company: number, tile: number, radiusCells: number): boolean {
    if (this.era < REMEDIATION_FROM_ERA) {
      this.onEvent?.('refused', 'Nobody restores land yet. That comes later in the century.');
      return false;
    }
    if (this.companies.charter[company] < Charter.Land) {
      this.onEvent?.('refused', 'Restoring land is a matter for a land charter.');
      return false;
    }
    const size = this.config.size;
    const x = tile % size;
    const y = (tile / size) | 0;
    const centre = this.amenity.cellOf(x, y);
    const cols = this.amenity.cols;
    const r = Math.max(0, Math.min(8, radiusCells));
    const cx = centre % cols;
    const cy = (centre / cols) | 0;

    let deficit = 0;
    const cells: number[] = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= this.amenity.rows) continue;
        if (dx * dx + dy * dy > r * r) continue;
        const c = ny * cols + nx;
        const gap = this.amenity.potential[c] - this.amenity.current[c] - this.amenity.restored[c];
        if (gap <= 0) continue;
        deficit += gap;
        cells.push(c);
      }
    }
    if (deficit <= 0) {
      this.onEvent?.('refused', 'There is nothing wrong with the ground there.');
      return false;
    }
    const price = Math.round(deficit * REMEDIATION_PRICE);
    if (this.companies.cash[company] < price) {
      this.onEvent?.('refused', `Restoring that would cost ${Math.round(price / 100)}.`);
      return false;
    }
    for (const c of cells) {
      this.amenity.restored[c] = this.amenity.potential[c] - this.amenity.current[c];
    }
    this.companies.post(company, Line.Construction, price);
    if (company === this.player) {
      this.onEvent?.('remediation', 'Restoration is under way. It will take years, as these things do.');
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

    const asset = this.assets.alloc(mode, cls, company, way.publicCharge, this.tick);
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
    this.assets.charge[asset] = this.content.ways[this.assets.cls[asset]].publicCharge;
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

  // ------------------------------------------------------------- hashing

  hash(): number {
    const h = new Hasher();
    h.int(this.tick);
    h.array(this.rng.getState());
    hashNetwork(h, this.graph, this.assets);
    hashSites(h, this.sites, this.towns);
    hashEconomy(h, this.companies, this.contracts, this.services);
    // The regulator is state that steers future state, so a divergence in it
    // has to show up here rather than a decade later when a charge cap lands
    // on one client and not the other.
    h.array(this.regulator.level, this.companies.count);
    h.array(this.regulator.pressure, this.companies.count);
    h.array(this.regulator.relief, this.companies.count);
    h.int(this.climate.weather).int(this.climate.severity);
    h.int(this.events.count);
    h.array(this.events.active, this.events.count);
    h.array(this.events.kind, this.events.count);
    h.array(this.events.ends, this.events.count);
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
