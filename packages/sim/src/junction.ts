/**
 * The Junction Lab's simulation. design.md §2.1, and D3.
 *
 * Alignments are placed on the grid, but any node where two or more meet opens
 * into an editor where the interchange is shaped directly: priority rules,
 * signals, roundabout, grade separation, banned turns. This runs that
 * configuration with real vehicles and reports **throughput, mean delay and
 * 95th-percentile queue length**.
 *
 * The rule that makes the readouts mean anything is that this is the *same*
 * model as `traffic.ts`, at higher cell resolution — same cell occupancy, same
 * chord-crossing conflict test, same admission order. What you tune here is
 * what you get out there. A separate, prettier junction simulator that
 * disagreed with the world by ten per cent would be worse than no lab at all,
 * because the player would tune against it and then not understand why their
 * junction underperformed.
 *
 * It is also deterministic and pure: given the same geometry, configuration
 * and demand it returns the same numbers on every machine, so a blueprint's
 * quoted figures are a fact rather than a claim.
 */

import { Control } from './constants.ts';
import { Rng } from './rng.ts';
import { chordsCross } from './traffic.ts';

/** Cells per arm in the lab. Four times the world's resolution, so a queue is
 *  measured in vehicles rather than in halves of a tile. */
export const LAB_CELLS = 40;
export const LAB_ARM_TILES = 5;

export const MovementMode = {
  /** Not permitted: a banned turn. */
  Banned: 0,
  /** Crosses the junction at grade and conflicts with anything it crosses. */
  AtGrade: 1,
  /** Flies over or dives under. Costs money; conflicts with nothing. */
  Separated: 2,
} as const;

export interface JunctionGeometry {
  /** Bearing of each arm in brads, measured outward from the node. */
  bearings: number[];
  /** Way class index per arm, for the speed limit. */
  cls: number[];
  /** Entry and exit points on the unit circle, kerb-offset, per arm. */
  inAx: Float64Array;
  inAy: Float64Array;
  outBx: Float64Array;
  outBy: Float64Array;
}

export interface JunctionConfig {
  control: number;
  /** `arms * arms` movement modes, indexed `from * arms + to`. */
  movement: Uint8Array;
  /** Signal phase per movement, and how many phases there are. */
  phase: Int32Array;
  phaseCount: number;
  /** Ticks of green per phase. */
  phaseTicks: number;
  /** Roundabout circulating radius, in cells. Larger is slower to cross and
   *  holds more vehicles, which is exactly the real trade. */
  roundaboutSize: number;
}

export interface ArmResult {
  arrived: number;
  served: number;
  meanDelay: number;
  maxQueue: number;
  p95Queue: number;
}

export interface JunctionResult {
  /** Vehicles cleared per hundred ticks. */
  throughput: number;
  meanDelay: number;
  p95Queue: number;
  /** Vehicles that arrived but never got through in the run. */
  stranded: number;
  perArm: ArmResult[];
  /** Cost of the grade separations the configuration asks for, in pence. */
  structureCost: number;
  /** True if some movement is banned in a way that strands an arm entirely. */
  disconnected: boolean;
}

const KERB = 0.22;

export function makeGeometry(bearings: number[], cls: number[]): JunctionGeometry {
  const n = bearings.length;
  const inAx = new Float64Array(n);
  const inAy = new Float64Array(n);
  const outBx = new Float64Array(n);
  const outBy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (bearings[i] / 4096) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // Same convention as traffic.ts: outbound on the left of the arm looking
    // out, inbound on the right, so a left turn hugs the kerb.
    outBx[i] = s - KERB * c;
    outBy[i] = -c - KERB * s;
    inAx[i] = s + KERB * c;
    inAy[i] = -c + KERB * s;
  }
  return { bearings, cls, inAx, inAy, outBx, outBy };
}

/** Default configuration for a junction of `n` arms: everything permitted at
 *  grade, phases grouped so each phase is a set that can all run at once. */
export function defaultConfig(geo: JunctionGeometry, control: number): JunctionConfig {
  const n = geo.bearings.length;
  const movement = new Uint8Array(n * n).fill(MovementMode.AtGrade);
  for (let i = 0; i < n; i++) movement[i * n + i] = MovementMode.Banned;
  const phase = new Int32Array(n * n).fill(-1);
  let phaseCount = 0;

  const remaining: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let o = 0; o < n; o++) if (i !== o) remaining.push(i * n + o);
  }
  while (remaining.length > 0 && phaseCount < 8) {
    const group: number[] = [];
    for (let k = 0; k < remaining.length; ) {
      const m = remaining[k];
      if (!conflictsWithAny(geo, movement, m, group, n)) {
        group.push(m);
        phase[m] = phaseCount;
        remaining.splice(k, 1);
      } else k++;
    }
    if (group.length === 0) break;
    phaseCount++;
  }
  return {
    control,
    movement,
    phase,
    phaseCount: Math.max(1, phaseCount),
    phaseTicks: 24,
    roundaboutSize: 8,
  };
}

export function movementsConflict(
  geo: JunctionGeometry, movement: Uint8Array, a: number, b: number, n: number,
): boolean {
  if (movement[a] === MovementMode.Separated || movement[b] === MovementMode.Separated) return false;
  const ai = (a / n) | 0;
  const ao = a % n;
  const bi = (b / n) | 0;
  const bo = b % n;
  // Two movements from the same approach share a lane; the cell occupancy
  // handles that and they do not "conflict" in the crossing sense.
  if (ai === bi) return false;
  return chordsCross(
    geo.inAx[ai] * 65536, geo.inAy[ai] * 65536, geo.outBx[ao] * 65536, geo.outBy[ao] * 65536,
    geo.inAx[bi] * 65536, geo.inAy[bi] * 65536, geo.outBx[bo] * 65536, geo.outBy[bo] * 65536,
  );
}

function conflictsWithAny(
  geo: JunctionGeometry, movement: Uint8Array, m: number, group: number[], n: number,
): boolean {
  for (const other of group) if (movementsConflict(geo, movement, m, other, n)) return true;
  return false;
}

/**
 * Run the junction.
 *
 * `demand[from * arms + to]` is arrivals per hundred ticks for that movement.
 * Arrivals are a deterministic Bernoulli draw from the seeded generator rather
 * than a smooth rate, because a junction fed a perfectly even stream never
 * queues and the whole point is to find out what happens when it does.
 */
export function simulateJunction(
  geo: JunctionGeometry,
  config: JunctionConfig,
  demand: Float64Array,
  ticks: number,
  seed: number,
  separationCost = 240000,
): JunctionResult {
  const n = geo.bearings.length;
  const rng = new Rng(seed);

  // One approach queue per arm, as a chain of cells. Occupancy is the same
  // discipline as the world: a vehicle cannot enter a cell that is taken, so
  // spillback is real rather than modelled.
  const cells = new Int32Array(n * LAB_CELLS).fill(-1);
  const headOut = new Int32Array(n * LAB_CELLS).fill(-1);
  const arrivedTick = new Int32Array(n * LAB_CELLS).fill(0);
  const arrived = new Int32Array(n);
  const served = new Int32Array(n);
  const totalDelay = new Float64Array(n);
  const maxQueue = new Int32Array(n);
  const queueSamples: number[][] = [];
  for (let i = 0; i < n; i++) queueSamples.push([]);

  // A roundabout has a circulating carriageway of its own: a ring of cells
  // that entering traffic has to find a gap in.
  const ring = new Int32Array(Math.max(1, config.roundaboutSize * n)).fill(-1);

  let nextId = 1;
  let stranded = 0;

  for (let tick = 0; tick < ticks; tick++) {
    // ---- arrivals ------------------------------------------------------
    for (let from = 0; from < n; from++) {
      for (let to = 0; to < n; to++) {
        const rate = demand[from * n + to];
        if (rate <= 0) continue;
        if (config.movement[from * n + to] === MovementMode.Banned) continue;
        // rate is per hundred ticks; draw against a ten-thousandth scale so
        // fractional rates are representable.
        if (!rng.chance(Math.round(rate * 100), 10000)) continue;
        const base = from * LAB_CELLS;
        const tail = base + LAB_CELLS - 1;
        if (cells[tail] !== -1) {
          // The queue has backed up out of the junction entirely. In the world
          // this is the spillback that blocks the road behind; here it is a
          // vehicle that never arrives, and it counts against the design.
          stranded++;
          continue;
        }
        cells[tail] = nextId++;
        headOut[tail] = to;
        arrivedTick[tail] = tick;
        arrived[from]++;
      }
    }

    // ---- advance the queues --------------------------------------------
    for (let arm = 0; arm < n; arm++) {
      const base = arm * LAB_CELLS;
      for (let c = 0; c < LAB_CELLS - 1; c++) {
        if (cells[base + c] !== -1) continue;
        if (cells[base + c + 1] === -1) continue;
        cells[base + c] = cells[base + c + 1];
        headOut[base + c] = headOut[base + c + 1];
        arrivedTick[base + c] = arrivedTick[base + c + 1];
        cells[base + c + 1] = -1;
        headOut[base + c + 1] = -1;
      }
    }

    // ---- the roundabout circulates -------------------------------------
    if (config.control === Control.Roundabout) {
      const last = ring[ring.length - 1];
      for (let i = ring.length - 1; i > 0; i--) ring[i] = ring[i - 1];
      ring[0] = last;
    }

    // ---- admission ------------------------------------------------------
    const admitted: number[] = [];
    const phase = ((tick / Math.max(1, config.phaseTicks)) | 0) % Math.max(1, config.phaseCount);
    const turn = ((tick / 6) | 0) % n;

    // Longest wait first, then arm index. Deterministic, and it drains the
    // junction rather than starving the arm nobody is looking at.
    const order: number[] = [];
    for (let arm = 0; arm < n; arm++) if (cells[arm * LAB_CELLS] !== -1) order.push(arm);
    order.sort((a, b) => (arrivedTick[a * LAB_CELLS] - arrivedTick[b * LAB_CELLS]) || (a - b));

    for (const arm of order) {
      const head = arm * LAB_CELLS;
      const to = headOut[head];
      const m = arm * n + to;
      if (config.movement[m] === MovementMode.Banned) continue;

      if (config.control === Control.Signals && config.movement[m] !== MovementMode.Separated) {
        if (config.phase[m] !== phase) continue;
      } else if (config.control === Control.AllWayStop && config.movement[m] !== MovementMode.Separated) {
        if (arm !== turn) continue;
      } else if (config.control === Control.Roundabout && config.movement[m] !== MovementMode.Separated) {
        // Entering traffic gives way to the ring. A gap is a free ring cell at
        // this arm's entry point.
        const entry = (arm * config.roundaboutSize) % ring.length;
        if (ring[entry] !== -1) continue;
        ring[entry] = cells[head];
      }

      let blocked = false;
      for (const other of admitted) {
        if (movementsConflict(geo, config.movement, m, other, n)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      served[arm]++;
      // Delay is time *lost*, not time taken. A vehicle joining the back of an
      // empty approach still has to travel its length, and counting that as
      // delay puts a floor of forty ticks under every junction in the game and
      // makes a perfect design look as bad as a terrible one.
      totalDelay[arm] += Math.max(0, tick - arrivedTick[head] - LAB_CELLS);
      cells[head] = -1;
      headOut[head] = -1;
      admitted.push(m);
    }

    // ---- sample the queues ---------------------------------------------
    if ((tick & 3) === 0) {
      for (let arm = 0; arm < n; arm++) {
        let q = 0;
        for (let c = 0; c < LAB_CELLS; c++) if (cells[arm * LAB_CELLS + c] !== -1) q++;
        queueSamples[arm].push(q);
        if (q > maxQueue[arm]) maxQueue[arm] = q;
      }
    }
  }

  const perArm: ArmResult[] = [];
  let totalServed = 0;
  let delaySum = 0;
  let worstP95 = 0;
  for (let arm = 0; arm < n; arm++) {
    const samples = queueSamples[arm].slice().sort((a, b) => a - b);
    const p95 = samples.length > 0 ? samples[Math.floor(samples.length * 0.95)] : 0;
    perArm.push({
      arrived: arrived[arm],
      served: served[arm],
      meanDelay: served[arm] > 0 ? totalDelay[arm] / served[arm] : 0,
      maxQueue: maxQueue[arm],
      p95Queue: p95,
    });
    totalServed += served[arm];
    delaySum += totalDelay[arm];
    if (p95 > worstP95) worstP95 = p95;
  }

  let structureCost = 0;
  for (let i = 0; i < config.movement.length; i++) {
    if (config.movement[i] === MovementMode.Separated) structureCost += separationCost;
  }

  // An arm with no permitted movement out is a design error worth naming.
  let disconnected = false;
  for (let i = 0; i < n && !disconnected; i++) {
    let any = false;
    for (let o = 0; o < n; o++) if (config.movement[i * n + o] !== MovementMode.Banned) any = true;
    if (!any) disconnected = true;
  }

  return {
    throughput: (totalServed * 100) / Math.max(1, ticks),
    meanDelay: totalServed > 0 ? delaySum / totalServed : 0,
    p95Queue: worstP95,
    stranded,
    perArm,
    structureCost,
    disconnected,
  };
}

/**
 * A blueprint is a configuration plus the arm count it was designed for.
 *
 * "Junctions are saveable as blueprints and shareable between players. This is
 * nearly free given the command-based architecture — a blueprint is a small
 * command sequence." (design.md §2.1.) The encoding is deliberately a short
 * string so it can be pasted into a chat window.
 */
export function encodeBlueprint(name: string, config: JunctionConfig, arms: number): string {
  const parts = [
    'IXJ1',
    String(arms),
    String(config.control),
    String(config.phaseCount),
    String(config.phaseTicks),
    String(config.roundaboutSize),
    Array.from(config.movement).join(''),
    Array.from(config.phase).map((p) => (p < 0 ? 'z' : String(p))).join(''),
    name.replace(/[|]/g, ' '),
  ];
  return parts.join('|');
}

export function decodeBlueprint(text: string): { name: string; arms: number; config: JunctionConfig } | null {
  const p = text.trim().split('|');
  if (p.length < 9 || p[0] !== 'IXJ1') return null;
  const arms = Number(p[1]);
  if (!Number.isFinite(arms) || arms < 2 || arms > 8) return null;
  const movement = Uint8Array.from(p[6].split('').map(Number));
  const phase = Int32Array.from(p[7].split('').map((c) => (c === 'z' ? -1 : Number(c))));
  if (movement.length !== arms * arms || phase.length !== arms * arms) return null;
  return {
    name: p.slice(8).join('|'),
    arms,
    config: {
      control: Number(p[2]),
      phaseCount: Math.max(1, Number(p[3])),
      phaseTicks: Math.max(1, Number(p[4])),
      roundaboutSize: Math.max(1, Number(p[5])),
      movement,
      phase,
    },
  };
}

export { Control };
