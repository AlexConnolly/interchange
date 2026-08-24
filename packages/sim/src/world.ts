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
  MODE_COUNT, MODE_NAMES, Mode, PATH_LATENCY_TICKS, SPEED_STEPS, START_YEAR,
  TICKS_PER_DAY, TICKS_PER_YEAR, DAYS_PER_MONTH, DAYS_PER_YEAR,
} from './constants.ts';
import { Cmd, CommandQueue, type Command } from './commands.ts';
import {
  CompanyTable, ContractState, ContractTable, Charter, Line, LINE_COUNT,
  ServiceTable, StopAction, MAX_STOPS, hashEconomy, haulageRate, makeContract, stepFinance,
} from './economy.ts';
import { FX_ONE, fx, fxDiv, fxMul } from './fixed.ts';
import { Hasher } from './hash.ts';
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
import { generateTerrain, SEA_LEVEL, type Terrain, type WorldConfig } from './terrain.ts';
import { alignForRadius, layAlignment, planAlignment, removeWayTile, type Alignment } from './construction.ts';
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
  private vehicleSpeed = new Int32Array(256);
  private vehicleCapacity = new Int32Array(256);
  private vehicleTransfer = new Int32Array(256);
  private vehicleRunning = new Float64Array(256);
  private vehicleMode = new Uint8Array(256);
  private cargoPrice = new Int32Array(64);
  private recipes: RecipeTables;
  private townDemandPerThousand: Int32Array;
  private routeCosts: RouteCosts;

  /** Access tiles, so sites and towns survive a graph rebuild. */
  siteAccessTile: Int32Array;
  townAccessTile: Int32Array;
  /** Reverse lookups for delivery: node id to site or town. */
  private nodeSiteOf = new Map<number, number>();
  private nodeTownOf = new Map<number, number>();

  /** Where a vehicle's current load was picked up, for the distance premium. */
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
    this.townAccessTile = new Int32Array(64).fill(NONE);

    // ---- derived tables -------------------------------------------------
    content.ways.forEach((w, i) => {
      this.waySpeed[i] = w.speedLimit;
      this.wayUpkeep[i] = w.upkeep;
      this.wayWear[i] = w.wear;
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
      this.recipes.period[i] = ind.recipe.period;
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
    });

    // What a thousand townspeople want per day. Passengers and mail are
    // produced by towns rather than wanted by them, so they are zero here.
    this.townDemandPerThousand = new Int32Array(content.cargo.length);
    const want: Record<string, number> = {
      goods: 6, food: 8, coal: 5, textiles: 2, planks: 2, cement: 2,
      paper: 1, glass: 1, fuel: 2, electronics: 1, luxury: 1, retail: 3,
    };
    for (const [id, v] of Object.entries(want)) {
      const i = content.cargoIndex.get(id);
      if (i !== undefined) this.townDemandPerThousand[i] = v;
    }

    this.routeCosts = { speedLimit: this.waySpeed, valueOfTime: content.balance.valueOfTime };
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
    rebuildGraph(this.graph, this.layers, this.assets);
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

    // running costs
    for (let id = 0; id < this.vehicles.count; id++) {
      if (!this.vehicles.alive[id]) continue;
      const cost = this.vehicleRunning[this.vehicles.type[id]];
      this.companies.post(this.vehicles.company[id], Line.RunningCosts, cost);
      this.vehicles.costs[id] += cost;
      const svc = this.vehicles.service[id];
      if (svc !== NONE) this.services.costs[svc] += cost;
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

    stepSiteDecay(this.sites, b);
    stepTowns(this.towns, this.townDemandPerThousand, b.townGrowthPerDay);
    this.stepContracts();
    stepFinance(this.companies, b, (c) => this.declareBankrupt(c));

    if (this.day % b.contractIntervalDays === 0) this.offerContract();
    if (this.dayOfMonth === 0 && this.day > 0) this.companies.closeMonth();
    if (this.tick % TICKS_PER_YEAR === 0 && this.tick > 0) this.companies.closeYear();
    this.checkCharters();
  }

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
      this.graph.cells[cell] = id;
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

      if (action === StopAction.Unload || action === StopAction.Exchange) {
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
            // The destination takes this cargo but has no room right now: a
            // full yard is the signal decay is measured from, so wait.
            v.dwell[id] = TICKS_PER_DAY / 2;
            busy = true;
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
              }
              v.cargo[id] = cargo;
              v.load[id] += got;
              if (!isTown) {
                this.sites.collected[target] += got;
                this.sites.everServed[target] = 1;
              }
              busy = true;
            }
          }
          if (action === StopAction.LoadFull && v.load[id] < capacity) {
            // Wait for a full load. This is the decision the act is about:
            // a full load out and an empty load back is half a business.
            if (!busy) v.dwell[id] = TICKS_PER_DAY / 3;
            busy = true;
          }
        }
      }

      if (busy) {
        v.state[id] = action === StopAction.Unload ? VState.Unloading : VState.Loading;
        continue;
      }

      // Done here. Move to the next stop.
      v.orderIndex[id] = (stopIdx + 1) % svcT.stopCount[svc];
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
    const dist = Math.sqrt(dx * dx + dy * dy);
    const pence = haulageRate(this.cargoPrice[cargo], dist) * tonnes;
    this.companies.post(company, Line.Haulage, pence);
    this.vehicles.revenue[vehicle] += pence;
    this.stats.tonnesMoved += tonnes;
    this.stats.delivered++;
    const svc = this.vehicles.service[vehicle];
    if (svc !== NONE) {
      this.services.revenue[svc] += pence;
      this.services.tonnes[svc] += tonnes;
    }
    if (!isTown) this.sites.shipped[target] += tonnes;

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
    makeContract(this.contracts, seed, this.tick, this.rng, b);
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

  // -------------------------------------------------------------- charters

  /**
   * Charter progression, design.md §1. Each is a licence to do a category of
   * thing you could previously only pay someone else to do — so the gate is
   * that you have run a real business at the current level, not that a
   * timer expired.
   */
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
      let earned = false;
      if (have === Charter.Carrier) {
        earned = delivered >= 6 && revenue >= 900000 && cash >= 400000;
      } else if (have === Charter.Construction) {
        earned = revenue >= 4000000 && this.ownedAssets(c) >= 4;
      } else if (have === Charter.Extraction) {
        earned = revenue >= 14000000 && this.ownedSites(c) >= 3;
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
      case Cmd.BuyVehicle:
        this.buyVehicle(c.issuer, c.a, c.b);
        break;
      case Cmd.SellVehicle:
        this.sellVehicle(c.a, true);
        break;
      case Cmd.CreateService:
        this.services.alloc(c.issuer, typeof c.data === 'string' ? c.data : `Service ${this.services.count + 1}`);
        break;
      case Cmd.DeleteService:
        this.deleteService(c.a);
        break;
      case Cmd.AddStop:
        // `c` packs the town flag in bit 0 and the cargo in the rest, so the
        // command still fits four integers. 255 means "whatever pays best".
        if (this.services.company[c.a] === c.issuer) {
          this.services.addStop(c.a, c.b, c.c & 3, c.d as StopAction, c.c >> 2);
        }
        break;
      case Cmd.RemoveStop:
        this.removeStop(c.a, c.b, c.issuer);
        break;
      case Cmd.SetServiceActive:
        if (this.services.company[c.a] === c.issuer) this.services.active[c.a] = c.b ? 1 : 0;
        break;
      case Cmd.AssignVehicle:
        this.assignVehicle(c.a, c.b, c.issuer);
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
      case Cmd.BuildWay:
        // Tile list in `data`, because a route is the one payload that will
        // not fit in four integers. Still a few hundred bytes in the log.
        if (Array.isArray(c.data)) this.buildWay(c.issuer, c.a, c.b, c.data);
        break;
      case Cmd.DemolishWay:
        if (Array.isArray(c.data)) this.demolishWay(c.issuer, c.a, c.data);
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

  /** Positions for the renderer. Never called by the tick. */
  project(): void {
    projectVehicles(this.graph, this.vehicles, this.config.size);
  }
}
