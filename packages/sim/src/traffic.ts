/**
 * Mesoscopic traffic. architecture.md §4.
 *
 * Full car-following for twenty thousand vehicles is both too expensive and
 * more precision than the game needs. Each link is a chain of fixed-length
 * cells; a vehicle occupies cells and cannot enter one that is taken. That
 * alone produces real queues and real spillback — a jam at a junction backs up
 * through the link behind it and then into the link behind *that*, because
 * the cells are genuinely full, not because a formula said congestion is 0.8.
 *
 * Junctions are where the model earns its keep, and where the Junction Lab
 * later plugs in. A movement through a node is a chord across it, from where
 * the vehicle enters to where it leaves; two movements conflict when their
 * chords cross. That is a general rule — it works for three arms or seven,
 * for a slip road or a roundabout — rather than a hand-written table per
 * junction shape, and it is what makes the Lab's readouts mean something.
 */

import {
  ACCEL, CELLS_PER_TILE, CELL_LENGTH, Control, DECEL, LOOKAHEAD_CELLS,
  SIGNAL_PHASE_TICKS,
} from './constants.ts';
import { ANGLE_FULL, fxCos, fxSin, fxMul, FX_ONE, type Fx } from './fixed.ts';
import { NONE, type AssetTable, type Graph } from './network.ts';

export const VState = {
  Idle: 0,
  Travelling: 1,
  Loading: 2,
  Unloading: 3,
  Broken: 4,
  Queued: 5,
} as const;
export type VState = (typeof VState)[keyof typeof VState];

/**
 * Per-node movement geometry, computed once per graph version.
 *
 * `angle` is where each approach meets the node, in brads. A movement's chord
 * runs from the entry point (diametrically opposite the approach bearing) to
 * the exit point, both pushed to the left-hand side of their arm so that a
 * left turn hugs the kerb and does not conflict with anything, which is
 * exactly how it behaves on the road.
 */
export interface NodeGeometry {
  version: number;
  /** Entry point per incoming link, as an index into `inLinks`. */
  inLinks: Int32Array;
  outLinks: Int32Array;
  inAx: Int32Array;
  inAy: Int32Array;
  outBx: Int32Array;
  outBy: Int32Array;
  /** Number of distinct signal phases when the node is signalled. */
  phases: number;
  /** Phase index per (in, out) movement, or -1. */
  phaseOf: Int32Array;
}

const KERB_OFFSET = Math.round(0.22 * FX_ONE);
const ARM_RADIUS = FX_ONE;

/** Bearing in brads from tile a to tile b. */
function bearing(size: number, from: number, to: number): number {
  const dx = (to % size) - (from % size);
  const dy = ((to / size) | 0) - ((from / size) | 0);
  // Integer octant table rather than atan2: the values are always one of
  // eight, because ways are laid on the grid.
  if (dx === 0 && dy < 0) return 0;
  if (dx > 0 && dy < 0) return 512;
  if (dx > 0 && dy === 0) return 1024;
  if (dx > 0 && dy > 0) return 1536;
  if (dx === 0 && dy > 0) return 2048;
  if (dx < 0 && dy > 0) return 2560;
  if (dx < 0 && dy === 0) return 3072;
  return 3584;
}

export function buildNodeGeometry(g: Graph, node: number, size: number): NodeGeometry {
  const outStart = g.nodeOutStart[node];
  const outEnd = g.nodeOutStart[node + 1];
  const outs: number[] = [];
  for (let i = outStart; i < outEnd; i++) outs.push(g.outLinks[i]);
  // Every outgoing link's twin is the incoming one on the same arm.
  const ins = outs.map((l) => g.linkTwin[l]);

  const nodeTile = g.nodeTile[node];
  const inAx = new Int32Array(ins.length);
  const inAy = new Int32Array(ins.length);
  const outBx = new Int32Array(outs.length);
  const outBy = new Int32Array(outs.length);

  for (let i = 0; i < outs.length; i++) {
    // Second tile along the outgoing chain gives the arm's direction.
    const len = g.linkChainLen[outs[i]];
    const start = g.linkChainStart[outs[i]];
    const forward = (outs[i] & 1) === 0;
    const nextTile = g.chain[start + (forward ? Math.min(1, len - 1) : Math.max(0, len - 2))];
    const b = bearing(size, nodeTile, nextTile);
    const c = fxCos(b);
    const s = fxSin(b);
    // Exit point: out along the arm, offset to the left-hand side of it. In a
    // left-hand-drive world the outbound lane is the left half looking out.
    outBx[i] = (fxMul(ARM_RADIUS, s) - fxMul(KERB_OFFSET, c)) | 0;
    outBy[i] = (fxMul(ARM_RADIUS, -c) - fxMul(KERB_OFFSET, s)) | 0;
    // Entry point on the same arm, offset the other way.
    inAx[i] = (fxMul(ARM_RADIUS, s) + fxMul(KERB_OFFSET, c)) | 0;
    inAy[i] = (fxMul(ARM_RADIUS, -c) + fxMul(KERB_OFFSET, s)) | 0;
  }

  // Signal phases: greedily group mutually compatible movements. Two
  // movements share a phase only if their chords do not cross, so a phase is
  // a set that can all run at once — which is what a signal stage is.
  const n = ins.length;
  const phaseOf = new Int32Array(n * n).fill(-1);
  let phases = 0;
  const movements: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let o = 0; o < n; o++) {
      if (i === o && n > 1) continue; // no u-turns at a real junction
      movements.push(i * n + o);
    }
  }
  const conflictsWithin = (m: number, group: number[]): boolean => {
    for (const other of group) {
      if (chordsCross(
        inAx[(m / n) | 0], inAy[(m / n) | 0], outBx[m % n], outBy[m % n],
        inAx[(other / n) | 0], inAy[(other / n) | 0], outBx[other % n], outBy[other % n],
      )) return true;
    }
    return false;
  };
  const remaining = movements.slice();
  while (remaining.length > 0 && phases < 8) {
    const group: number[] = [];
    for (let k = 0; k < remaining.length; ) {
      if (!conflictsWithin(remaining[k], group)) {
        group.push(remaining[k]);
        phaseOf[remaining[k]] = phases;
        remaining.splice(k, 1);
      } else k++;
    }
    if (group.length === 0) break;
    phases++;
  }
  if (phases === 0) phases = 1;

  return {
    version: g.version,
    inLinks: Int32Array.from(ins),
    outLinks: Int32Array.from(outs),
    inAx, inAy, outBx, outBy,
    phases,
    phaseOf,
  };
}

/** Do segments AB and CD properly cross? Touching at an endpoint does not
 *  count — two movements that merge into the same exit share a lane rather
 *  than colliding, and the cell occupancy already handles that. */
export function chordsCross(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function cross(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  // Scaled down before multiplying: the coordinates are Q16.16 around unity,
  // and the raw product of two of them overflows the exact-integer window.
  const abx = (bx - ax) >> 8;
  const aby = (by - ay) >> 8;
  const apx = (px - ax) >> 8;
  const apy = (py - ay) >> 8;
  return abx * apy - aby * apx;
}

/**
 * Vehicles, structure of arrays.
 *
 * The free list is LIFO and iteration is by index, so both are deterministic
 * without needing a sorted key (rule 4).
 */
export class VehicleTable {
  count = 0;
  readonly alive: Uint8Array;
  readonly company: Int16Array;
  readonly type: Uint8Array;
  readonly state: Uint8Array;

  readonly link: Int32Array;
  readonly cell: Int32Array;
  readonly pos: Int32Array;
  readonly speed: Int32Array;
  /** Cells the vehicle body occupies behind its head. */
  readonly length: Uint8Array;

  /** Assigned service, and how far through its stop list the vehicle is. */
  readonly service: Int32Array;
  readonly orderIndex: Int32Array;
  /** Node the vehicle is currently heading for. */
  readonly targetNode: Int32Array;
  /** Slice of the route pool. */
  readonly routeStart: Int32Array;
  readonly routeLen: Int32Array;
  readonly routeCursor: Int32Array;
  /** Tick at which an outstanding route request lands. NONE if none. */
  readonly pathDueTick: Int32Array;

  readonly cargo: Uint8Array;
  readonly load: Int32Array;
  readonly dwell: Int32Array;

  /** Interpolated world position for the renderer, Q16.16 tiles. */
  readonly x: Int32Array;
  readonly y: Int32Array;
  readonly heading: Int32Array;

  readonly odometer: Float64Array;
  /** Tiles run since the current load was picked up. The haulage rate is paid
   *  on this rather than on the crow-flies distance, because the running cost
   *  is paid on it too and a rate in different units from its cost is not a
   *  rate. */
  readonly haulDistance: Float64Array;
  /** The stop index this vehicle last took on cargo at, or -1. An Exchange
   *  stop must not treat what it has just picked up as something to put down. */
  readonly loadedAt: Int32Array;
  /** Ticks spent waiting at the current stop, for the patience rule. */
  readonly waited: Int32Array;
  readonly revenue: Float64Array;
  readonly costs: Float64Array;
  readonly boughtTick: Int32Array;
  /** Ticks spent stationary in traffic, for the reliability and the overlay. */
  readonly delayTicks: Int32Array;

  private free: Int32Array;
  private freeCount = 0;

  constructor(capacity: number) {
    this.alive = new Uint8Array(capacity);
    this.company = new Int16Array(capacity);
    this.type = new Uint8Array(capacity);
    this.state = new Uint8Array(capacity);
    this.link = new Int32Array(capacity).fill(NONE);
    this.cell = new Int32Array(capacity);
    this.pos = new Int32Array(capacity);
    this.speed = new Int32Array(capacity);
    this.length = new Uint8Array(capacity);
    this.service = new Int32Array(capacity).fill(NONE);
    this.orderIndex = new Int32Array(capacity);
    this.targetNode = new Int32Array(capacity).fill(NONE);
    this.routeStart = new Int32Array(capacity);
    this.routeLen = new Int32Array(capacity);
    this.routeCursor = new Int32Array(capacity);
    this.pathDueTick = new Int32Array(capacity).fill(NONE);
    this.cargo = new Uint8Array(capacity).fill(255);
    this.load = new Int32Array(capacity);
    this.dwell = new Int32Array(capacity);
    this.x = new Int32Array(capacity);
    this.y = new Int32Array(capacity);
    this.heading = new Int32Array(capacity);
    this.odometer = new Float64Array(capacity);
    this.haulDistance = new Float64Array(capacity);
    this.loadedAt = new Int32Array(capacity).fill(-1);
    this.waited = new Int32Array(capacity);
    this.revenue = new Float64Array(capacity);
    this.costs = new Float64Array(capacity);
    this.boughtTick = new Int32Array(capacity);
    this.delayTicks = new Int32Array(capacity);
    this.free = new Int32Array(capacity);
  }

  alloc(): number {
    let id: number;
    if (this.freeCount > 0) id = this.free[--this.freeCount];
    else {
      if (this.count >= this.alive.length) return NONE;
      id = this.count++;
    }
    this.alive[id] = 1;
    this.state[id] = VState.Idle;
    this.link[id] = NONE;
    this.cell[id] = 0;
    this.pos[id] = 0;
    this.speed[id] = 0;
    this.service[id] = NONE;
    this.orderIndex[id] = 0;
    this.targetNode[id] = NONE;
    this.routeLen[id] = 0;
    this.routeCursor[id] = 0;
    this.pathDueTick[id] = NONE;
    this.cargo[id] = 255;
    this.load[id] = 0;
    this.dwell[id] = 0;
    this.odometer[id] = 0;
    this.haulDistance[id] = 0;
    this.loadedAt[id] = -1;
    this.waited[id] = 0;
    this.revenue[id] = 0;
    this.costs[id] = 0;
    this.delayTicks[id] = 0;
    return id;
  }

  release(id: number): void {
    this.alive[id] = 0;
    this.free[this.freeCount++] = id;
  }
}

/**
 * Vehicles waiting to cross a junction this tick, as parallel arrays.
 *
 * This was an array of objects, which is the obvious way to write it and cost
 * a few thousand short-lived allocations *per tick* on a busy region — enough
 * garbage to schedule a collection every twenty frames and put a fifty
 * millisecond stall into an otherwise six millisecond frame. Structure of
 * arrays with a reused index buffer allocates nothing at all.
 */
class CrossingBuffer {
  count = 0;
  readonly vehicle: Int32Array;
  readonly node: Int32Array;
  readonly inIdx: Int32Array;
  readonly outIdx: Int32Array;
  readonly link: Int32Array;
  readonly nextLink: Int32Array;
  readonly rank: Int32Array;
  /** Indices into the above, sorted for arbitration. */
  readonly order: Int32Array;
  /** Which crossings were let through at the node being resolved. */
  readonly admitted: Int32Array;
  admittedCount = 0;

  constructor(capacity: number) {
    this.vehicle = new Int32Array(capacity);
    this.node = new Int32Array(capacity);
    this.inIdx = new Int32Array(capacity);
    this.outIdx = new Int32Array(capacity);
    this.link = new Int32Array(capacity);
    this.nextLink = new Int32Array(capacity);
    this.rank = new Int32Array(capacity);
    this.order = new Int32Array(capacity);
    this.admitted = new Int32Array(64);
  }

  push(vehicle: number, node: number, inIdx: number, outIdx: number, link: number, nextLink: number, rank: number): void {
    const i = this.count;
    if (i >= this.vehicle.length) return;
    this.vehicle[i] = vehicle;
    this.node[i] = node;
    this.inIdx[i] = inIdx;
    this.outIdx[i] = outIdx;
    this.link[i] = link;
    this.nextLink[i] = nextLink;
    this.rank[i] = rank;
    this.count = i + 1;
  }
}

let crossings: CrossingBuffer | null = null;

export interface TrafficStats {
  moving: number;
  queued: number;
  crossings: number;
  admitted: number;
  /** Sum of ticks spent blocked this tick, for the delay readout. */
  blocked: number;
}

/**
 * One tick of traffic.
 *
 * Two passes. The first advances every vehicle inside its own link and parks
 * anything that has reached the end in the crossing list. The second resolves
 * those crossings per node. The split is what makes the junction rules apply
 * to all approaches at once rather than to whichever vehicle happened to be
 * updated first, which would silently give the lowest-id approach priority
 * over every other one for the whole game.
 */
/** Reused so a tick reports its statistics without allocating one. */
const scratchStats: TrafficStats = { moving: 0, queued: 0, crossings: 0, admitted: 0, blocked: 0 };

export function stepTraffic(
  g: Graph,
  assets: AssetTable,
  v: VehicleTable,
  routePool: Int32Array,
  vehicleSpeed: Int32Array,
  waySpeed: Int32Array,
  tick: number,
  size: number,
  geometry: (NodeGeometry | null)[],
  onArrive: (vehicle: number, node: number) => void,
  onEnterLink: (vehicle: number, link: number) => void,
  /**
   * Percentage of the posted limit this link allows for this vehicle right
   * now: weather, flooding, road condition, what the lorry is fitted with.
   *
   * A function rather than a table because it depends on where the link is and
   * *who is on it*, not only on what class the road is. It takes the vehicle
   * rather than the company for the same reason — winter tyres are fitted to a
   * lorry, not bought by a firm, so a fleet part-fitted for snow has some
   * vehicles running and some standing still. Returning 0 stops the vehicle
   * where it is, which is the intended behaviour and not an edge case.
   */
  conditions: ((link: number, vehicle: number) => number) | null,
): TrafficStats {
  const stats = scratchStats;
  stats.moving = 0;
  stats.queued = 0;
  stats.crossings = 0;
  stats.admitted = 0;
  stats.blocked = 0;
  if (crossings === null || crossings.vehicle.length < v.count + 8) {
    crossings = new CrossingBuffer(Math.max(4096, v.count + 64));
  }
  const cx = crossings;
  cx.count = 0;

  // ---- pass one: advance within the link -------------------------------
  for (let id = 0; id < v.count; id++) {
    if (!v.alive[id] || v.state[id] !== VState.Travelling) continue;
    const link = v.link[id];
    if (link === NONE) continue;

    const cellStart = g.linkCellStart[link];
    const cellCount = g.linkCellCount[link];
    const asset = g.linkAsset[link];
    let limit = waySpeed[g.linkCls[link]];
    if (asset !== NONE) {
      const cond = assets.condition[asset];
      if (cond < 200) limit = ((limit * (85 + cond)) / 285) | 0;
    }
    const own = vehicleSpeed[v.type[id]];
    if (own < limit) limit = own;
    if (conditions !== null) {
      const pct = conditions(link, id);
      if (pct < 100) limit = ((limit * pct) / 100) | 0;
    }

    // Look ahead. `free` is how many cells are clear in front; a vehicle with
    // the full lookahead clear runs at the limit, and one with none stops.
    // Anything in between slows proportionally, which is what makes a queue
    // read as a queue instead of a line of stationary objects (art §12).
    let free = 0;
    for (let k = 1; k <= LOOKAHEAD_CELLS; k++) {
      const c = v.cell[id] + k;
      if (c >= cellCount) {
        // The junction is the obstacle. Treat it as clear only if the vehicle
        // already has permission, which it gets by being admitted below.
        free = Math.min(free + 1, LOOKAHEAD_CELLS);
        break;
      }
      if (g.cells[cellStart + c] !== NONE) break;
      free++;
    }
    let desired = free >= LOOKAHEAD_CELLS ? limit : ((limit * free) / LOOKAHEAD_CELLS) | 0;

    let speed = v.speed[id];
    if (speed < desired) speed = Math.min(desired, speed + ACCEL);
    else if (speed > desired) speed = Math.max(desired, speed - DECEL);
    v.speed[id] = speed;
    if (speed === 0) {
      v.delayTicks[id]++;
      stats.blocked++;
    } else stats.moving++;

    let pos = v.pos[id] + speed;
    let cell = v.cell[id];
    let reachedEnd = false;
    while (pos >= CELL_LENGTH) {
      const next = cell + 1;
      if (next >= cellCount) {
        reachedEnd = true;
        pos = CELL_LENGTH - 1;
        break;
      }
      if (g.cells[cellStart + next] !== NONE) {
        pos = CELL_LENGTH - 1;
        v.speed[id] = 0;
        break;
      }
      g.cells[cellStart + cell] = NONE;
      cell = next;
      g.cells[cellStart + cell] = id;
      pos -= CELL_LENGTH;
      v.odometer[id] += 1 / CELLS_PER_TILE;
      v.haulDistance[id] += 1 / CELLS_PER_TILE;
    }
    v.pos[id] = pos;
    v.cell[id] = cell;

    if (reachedEnd) {
      const node = g.linkTo[link];
      const cursor = v.routeCursor[id];
      const len = v.routeLen[id];
      if (cursor + 1 >= len) {
        // End of route. Release the cell and hand the vehicle back.
        g.cells[cellStart + cell] = NONE;
        if (g.linkOccupancy[link] > 0) g.linkOccupancy[link]--;
        v.link[id] = NONE;
        v.speed[id] = 0;
        onArrive(id, node);
        continue;
      }
      const nextLink = routePool[v.routeStart[id] + cursor + 1];
      const geo = geometry[node];
      let inIdx = 0;
      let outIdx = 0;
      if (geo) {
        for (let i = 0; i < geo.inLinks.length; i++) if (geo.inLinks[i] === link) inIdx = i;
        for (let i = 0; i < geo.outLinks.length; i++) if (geo.outLinks[i] === nextLink) outIdx = i;
      }
      // A vehicle already at a standstill in a queue outranks one arriving at
      // speed, so a junction drains rather than starving its slowest arm.
      cx.push(id, node, inIdx, outIdx, link, nextLink, v.delayTicks[id]);
      stats.queued++;
    }
  }

  // ---- pass two: junctions ---------------------------------------------
  const n = cx.count;
  const order = cx.order.subarray(0, n);
  for (let i = 0; i < n; i++) order[i] = i;
  // Node first so each junction's arrivals are contiguous; then longest wait,
  // then vehicle id. The last term is what makes the arbitration a function of
  // the world rather than of the order the first pass happened to visit in.
  order.sort((a, b) => cx.node[a] - cx.node[b] || cx.rank[b] - cx.rank[a] || cx.vehicle[a] - cx.vehicle[b]);
  stats.crossings = n;

  let i = 0;
  while (i < n) {
    const node = cx.node[order[i]];
    let j = i;
    while (j < n && cx.node[order[j]] === node) j++;
    const geo = geometry[node];
    const control = g.nodeControl[node];
    cx.admittedCount = 0;

    for (let k = i; k < j; k++) {
      const c = order[k];
      // The exit cell has to be free whatever the rule says.
      const next = cx.nextLink[c];
      const nStart = g.linkCellStart[next];
      if (g.cells[nStart] !== NONE) continue;
      // And on a railway, so does a block. This is the one place the two modes
      // genuinely differ in the traffic model: a road takes whatever fits, a
      // railway takes a whole section of line and holds it.
      if (g.linkOccupancy[next] >= g.linkCapacity[next]) continue;

      const inIdx = cx.inIdx[c];
      const outIdx = cx.outIdx[c];

      if (control === Control.Signals && geo) {
        const phase = ((tick / SIGNAL_PHASE_TICKS) | 0) % geo.phases;
        if (geo.phaseOf[inIdx * geo.inLinks.length + outIdx] !== phase) continue;
      } else if (control === Control.AllWayStop) {
        // Strict round-robin by approach, so no arm can be starved. The tick
        // is simulation state, so keying off it is deterministic.
        if (geo && geo.inLinks.length > 1) {
          const turn = ((tick / 8) | 0) % geo.inLinks.length;
          if (inIdx !== turn) continue;
        }
      }

      if (geo && cx.admittedCount > 0 && control !== Control.None) {
        const arms = geo.inLinks.length;
        let blocked = false;
        for (let a = 0; a < cx.admittedCount; a++) {
          const o = cx.admitted[a];
          const oIn = cx.inIdx[o];
          if (oIn === inIdx) continue;
          if (chordsCross(
            geo.inAx[inIdx], geo.inAy[inIdx], geo.outBx[outIdx], geo.outBy[outIdx],
            geo.inAx[oIn], geo.inAy[oIn], geo.outBx[cx.outIdx[o]], geo.outBy[cx.outIdx[o]],
          )) {
            blocked = true;
            break;
          }
          // A roundabout also refuses anything entering in front of
          // circulating traffic, modelled as the adjacent arm.
          if (control === Control.Roundabout && (inIdx + 1) % arms === oIn) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
      }

      // Admit: release the last cell of the old link, take the first of the new.
      const vehicle = cx.vehicle[c];
      const oldLink = cx.link[c];
      g.cells[g.linkCellStart[oldLink] + g.linkCellCount[oldLink] - 1] = NONE;
      if (g.linkOccupancy[oldLink] > 0) g.linkOccupancy[oldLink]--;
      g.linkOccupancy[next]++;
      g.cells[nStart] = vehicle;
      v.link[vehicle] = next;
      v.cell[vehicle] = 0;
      v.pos[vehicle] = 0;
      v.routeCursor[vehicle]++;
      v.delayTicks[vehicle] = 0;
      g.linkFlow[next]++;
      if (cx.admittedCount < cx.admitted.length) cx.admitted[cx.admittedCount++] = c;
      stats.admitted++;
      onEnterLink(vehicle, next);
    }
    i = j;
  }

  return stats;
}

/**
 * Project every vehicle onto world coordinates for the renderer.
 *
 * Kept out of the tick because it is presentation: the sim does not need a
 * vehicle's xy, only its cell. Running it separately also means a dropped
 * frame costs a projection and never a tick.
 */
export function projectVehicles(g: Graph, v: VehicleTable, size: number): void {
  for (let id = 0; id < v.count; id++) {
    if (!v.alive[id]) continue;
    const link = v.link[id];
    if (link === NONE) continue;
    const len = g.linkChainLen[link];
    const start = g.linkChainStart[link];
    const forward = (link & 1) === 0;
    const cellsPerLink = g.linkCellCount[link];
    // Distance along the chain in tiles, Q16.16.
    const along = v.cell[id] * CELL_LENGTH + v.pos[id];
    const tileIdx = Math.min(len - 2, along >> 16);
    const frac = along - (tileIdx << 16);
    const a = g.chain[start + (forward ? tileIdx : len - 1 - tileIdx)];
    const b = g.chain[start + (forward ? tileIdx + 1 : len - 2 - tileIdx)];
    const ax = (a % size) * FX_ONE;
    const ay = ((a / size) | 0) * FX_ONE;
    const bx = (b % size) * FX_ONE;
    const by = ((b / size) | 0) * FX_ONE;
    v.x[id] = (ax + fxMul((bx - ax) | 0, frac)) | 0;
    v.y[id] = (ay + fxMul((by - ay) | 0, frac)) | 0;
    v.heading[id] = bearing(size, a, b);
    void cellsPerLink;
  }
}

export { ANGLE_FULL };
