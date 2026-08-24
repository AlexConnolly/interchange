/**
 * Power, water, and labour — the three networks a mine needs before it
 * produces anything at all. design.md §2.2.
 *
 * Most games in this genre have one network. This has three, and they
 * interact: a mine needs power and water (utility) and workers within a
 * commute (demand) before it produces a tonne of ore, and then needs a way to
 * ship the ore out (transport). Almost every interesting decision touches at
 * least two.
 *
 * Two of the three are *networks* in the same sense as a road: a graph you
 * build, that somebody owns, and that charges for passage. Electricity does
 * not ride in a vehicle, but it does travel along a line somebody paid for,
 * and design.md §3.5 is explicit that Act III is where "grid wheeling charges,
 * water transfer charges — now the three networks share one economic
 * language". So the ownership spine reaches them by the same route: a grid is
 * a set of connected assets, and moving a unit across an asset you do not own
 * costs you money and pays the owner.
 *
 * The third, labour, is not built. It is the catchment of the towns that can
 * reach the site inside a commute, which makes where you put an industry a
 * question about the transport network you already have.
 */

import { MODE_COUNT, Mode, AUTHORITY, TICKS_PER_DAY } from './constants.ts';
import { NONE, type AssetTable, type Graph } from './network.ts';
import type { SiteTable, TownTable } from './sites.ts';

/** How far a person will travel to work, in ticks of journey time. */
export const COMMUTE_BUDGET = 260;

export interface Grid {
  /** Node ids in this connected component. */
  nodes: number[];
  /** Assets the component runs over, for wheeling charges. */
  assets: number[];
  generation: number;
  demand: number;
  /** Fraction of demand met, 0..100. */
  satisfaction: number;
  /** Total line length, which is where the losses come from. */
  tiles: number;
}

export interface UtilityState {
  /** Grid index per node, or -1. */
  gridOfNode: Int32Array;
  grids: Grid[];
}

export function emptyUtilityState(maxNodes: number): UtilityState {
  return { gridOfNode: new Int32Array(maxNodes).fill(-1), grids: [] };
}

/**
 * Find the connected components of one mode's network.
 *
 * A "grid" is exactly a connected component: two generators on the same wires
 * pool their output, and two on separate wires do not, which is the whole
 * reason a transmission line is worth building.
 */
export function buildGrids(g: Graph, assets: AssetTable, mode: number, out: UtilityState): void {
  out.gridOfNode.fill(-1);
  out.grids.length = 0;
  const stack: number[] = [];

  for (let start = 0; start < g.nodeCount; start++) {
    if (g.nodeMode[start] !== mode || out.gridOfNode[start] !== -1) continue;
    const index = out.grids.length;
    const grid: Grid = { nodes: [], assets: [], generation: 0, demand: 0, satisfaction: 0, tiles: 0 };
    out.grids.push(grid);
    stack.length = 0;
    stack.push(start);
    out.gridOfNode[start] = index;

    while (stack.length > 0) {
      const n = stack.pop() as number;
      grid.nodes.push(n);
      for (let i = g.nodeOutStart[n]; i < g.nodeOutStart[n + 1]; i++) {
        const link = g.outLinks[i];
        if (g.linkMode[link] !== mode) continue;
        grid.tiles += g.linkChainLen[link] - 1;
        const asset = g.linkAsset[link];
        if (asset !== NONE && !grid.assets.includes(asset)) grid.assets.push(asset);
        const to = g.linkTo[link];
        if (out.gridOfNode[to] !== -1) continue;
        out.gridOfNode[to] = index;
        stack.push(to);
      }
    }
    // Each link was walked from both ends.
    grid.tiles = Math.round(grid.tiles / 2);
    grid.nodes.sort((a, b) => a - b);
    grid.assets.sort((a, b) => a - b);
  }
  void assets;
}

export interface UtilityLedger {
  /** Company -> pence, for the wheeling charges collected and paid. */
  charge(payer: number, payee: number, amount: number, asset: number): void;
}

/**
 * Balance one utility network for a day.
 *
 * Generation and demand are summed per grid, and every site on that grid gets
 * the same fraction of what it asked for. Losses rise with the length of the
 * grid, which is the diegetic reason not to run one enormous grid across the
 * whole region — and the reason a local generator beside a smelter is worth
 * more than a bigger one two hundred tiles away.
 */
export function balanceGrids(
  state: UtilityState,
  sites: SiteTable,
  mode: number,
  need: (site: number) => number,
  supply: (site: number) => number,
  set: (site: number, percent: number) => void,
  assets: AssetTable,
  ledger: UtilityLedger,
  unitPrice: number,
): void {
  for (const grid of state.grids) {
    grid.generation = 0;
    grid.demand = 0;
  }

  // Which grid each site sits on, via its node for this mode.
  for (let s = 0; s < sites.count; s++) {
    const node = sites.nodeOf(s, mode);
    if (node === NONE) continue;
    const gi = state.gridOfNode[node];
    if (gi < 0) continue;
    state.grids[gi].generation += supply(s);
    state.grids[gi].demand += need(s);
  }

  for (const grid of state.grids) {
    // Line loss: two per cent per hundred tiles, capped. Small enough not to
    // punish a sensible network and large enough that a two-hundred-tile spur
    // to one mine is visibly a bad idea.
    const loss = Math.min(0.35, (grid.tiles / 100) * 0.02);
    const delivered = grid.generation * (1 - loss);
    grid.satisfaction = grid.demand > 0
      ? Math.max(0, Math.min(100, Math.round((delivered * 100) / grid.demand)))
      : 100;
  }

  for (let s = 0; s < sites.count; s++) {
    const want = need(s);
    if (want <= 0) {
      set(s, 100);
      continue;
    }
    const node = sites.nodeOf(s, mode);
    const gi = node === NONE ? -1 : state.gridOfNode[node];
    if (gi < 0) {
      // Not connected at all. An industry with no supply produces nothing,
      // which is the entire point of the three-network requirement.
      set(s, 0);
      continue;
    }
    const grid = state.grids[gi];
    set(s, grid.satisfaction);

    // Wheeling. Crossing somebody else's lines costs, and it is the same rule
    // as a lorry on somebody else's road — which is what design.md means by
    // the three networks sharing one economic language.
    const taken = (want * grid.satisfaction) / 100;
    if (taken <= 0) continue;
    const owner = sites.owner[s];
    for (const asset of grid.assets) {
      const lineOwner = assets.owner[asset];
      if (lineOwner === owner) continue;
      const fee = Math.round((taken * assets.charge[asset]) / 100);
      if (fee > 0) ledger.charge(owner, lineOwner, fee, asset);
    }
    // And the energy itself, bought from whoever generated it. Simplified to
    // the authority as the market maker, which is what a pool is.
    const cost = Math.round((taken * unitPrice) / 100);
    if (cost > 0 && owner !== AUTHORITY) ledger.charge(owner, AUTHORITY, cost, NONE);
  }
}

/**
 * Labour catchment.
 *
 * How many people can reach each node inside a commute. A Dijkstra outward
 * from every town over the road network, with the town's population decaying
 * with journey time — so a site beside a city is fully staffed, a site an hour
 * up a valley is not, and building a better road to it is a real answer.
 *
 * This is the demand network from design.md §2.2, and it is what stops
 * industry placement being a question about the terrain alone.
 */
export function computeLabour(
  g: Graph,
  towns: TownTable,
  speedOf: (link: number) => number,
  out: Float64Array,
): void {
  out.fill(0);
  if (g.nodeCount === 0) return;

  const dist = new Float64Array(g.nodeCount);
  const stamp = new Int32Array(g.nodeCount);
  let mark = 0;
  // A plain array as a bucket queue: journey times here are small integers of
  // ticks and a heap would cost more than it saves.
  const queue: number[] = [];

  for (let t = 0; t < towns.count; t++) {
    const start = towns.nodeOf(t, Mode.Road);
    if (start === NONE) continue;
    mark++;
    queue.length = 0;
    dist[start] = 0;
    stamp[start] = mark;
    queue.push(start);
    const pop = towns.population[t];

    // Breadth-first with a distance test rather than a strict priority queue:
    // the catchment is a soft falloff and being a few ticks out on the far
    // edge of it changes nothing anybody can perceive.
    for (let head = 0; head < queue.length; head++) {
      const n = queue[head];
      const d = dist[n];
      if (d > COMMUTE_BUDGET) continue;
      // Linear falloff to zero at the budget. People do not commute a little
      // bit less as it gets further; they stop.
      out[n] += pop * (1 - d / COMMUTE_BUDGET);
      for (let i = g.nodeOutStart[n]; i < g.nodeOutStart[n + 1]; i++) {
        const link = g.outLinks[i];
        if (g.linkMode[link] !== Mode.Road) continue;
        const speed = speedOf(link);
        if (speed <= 0) continue;
        const cost = (g.linkLength[link] / speed);
        const to = g.linkTo[link];
        const nd = d + cost;
        if (nd > COMMUTE_BUDGET) continue;
        if (stamp[to] === mark && dist[to] <= nd) continue;
        stamp[to] = mark;
        dist[to] = nd;
        queue.push(to);
      }
    }
  }
}

export { MODE_COUNT, TICKS_PER_DAY };
