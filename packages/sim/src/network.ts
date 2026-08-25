/**
 * The way network: tiles, assets, and the link graph derived from them.
 *
 * Three representations, each doing a job the others cannot.
 *
 *   TILES    what the player places and what the renderer draws. Grid-snapped
 *            (D2), one class and one direction mask per tile per mode.
 *   ASSETS   what is *owned*. An asset is the group of tiles laid in one act
 *            of construction: it has an owner, an access charge, a condition
 *            and a revenue history, and it is the unit you buy, sell and price
 *            (design.md §3). Assets are stable for the life of the world.
 *   LINKS    what vehicles drive on. A link is a maximal chain of degree-two
 *            tiles between two junctions, cut into traffic cells.
 *
 * The split matters because the link graph is *rebuilt* whenever the network
 * is edited. If ownership lived on links it would evaporate every time
 * somebody laid a spur, so ownership lives on assets and links only point at
 * them. That one decision is what makes the ownership spine survive contact
 * with construction.
 */

import {
  CELLS_PER_TILE, CELL_LENGTH, Control, DIR_BIT, DIR_DX, DIR_DY, DIR_OPPOSITE,
  MAX_ASSETS, MAX_LINKS, MAX_NODES, MODE_COUNT, AUTHORITY, FLOW_WINDOW,
} from './constants.ts';
import { fxDiv, fxMul, FX_ONE, type Fx } from './fixed.ts';
import type { Hasher } from './hash.ts';

export const NO_WAY = 255;
export const NONE = -1;

/**
 * One mode's tile layer. Separate arrays per mode rather than one tagged
 * layer, because a road and a railway crossing the same tile is normal and a
 * single layer would have to forbid it or encode a combination explosion.
 */
export class WayLayer {
  readonly mode: number;
  readonly size: number;
  /** Way class index into content.ways, or NO_WAY. */
  readonly cls: Uint8Array;
  /** Connection bitmask, DIR_N | DIR_E | DIR_S | DIR_W. */
  readonly dir: Uint8Array;
  /** Asset this tile belongs to, or NONE. Ownership and charge live there. */
  readonly asset: Int32Array;
  /** Link this tile currently belongs to. Rebuilt with the graph. */
  readonly link: Int32Array;
  /** Position of the tile along its link's chain, for vehicle remapping. */
  readonly linkOffset: Uint16Array;
  /**
   * Formation level, in height units. A way sits on this, not on the ground —
   * which is where embankments, cuttings, bridges and tunnels come from, and
   * why a railway has to find the valley. See construction.ts.
   */
  readonly level: Int16Array;
  /** WayFlag bits: embankment, cutting, bridge, tunnel. */
  readonly flags: Uint8Array;
  /**
   * Tiles that must become graph nodes whatever their degree: the access
   * point of an industry, a station, a depot. Without this a colliery halfway
   * along a straight road is invisible to the graph, because a degree-two tile
   * is a plain continuation and gets traced straight through.
   */
  readonly terminal: Uint8Array;
  /** Count of tiles carrying this mode, so an empty layer costs nothing. */
  tileCount = 0;

  constructor(mode: number, size: number) {
    this.mode = mode;
    this.size = size;
    const n = size * size;
    this.cls = new Uint8Array(n).fill(NO_WAY);
    this.dir = new Uint8Array(n);
    this.asset = new Int32Array(n).fill(NONE);
    this.link = new Int32Array(n).fill(NONE);
    this.linkOffset = new Uint16Array(n);
    this.terminal = new Uint8Array(n);
    this.level = new Int16Array(n);
    this.flags = new Uint8Array(n);
  }

  has(tile: number): boolean {
    return this.cls[tile] !== NO_WAY;
  }
}

/**
 * The ownable unit. design.md §3.1: every piece of fixed infrastructure has an
 * owner and an access charge, and the authority owns whatever nobody else
 * does.
 */
export class AssetTable {
  count = 0;
  readonly owner = new Int16Array(MAX_ASSETS);
  readonly mode = new Uint8Array(MAX_ASSETS);
  readonly cls = new Uint8Array(MAX_ASSETS);
  /** Access charge in pence per vehicle per tile. */
  readonly charge = new Int32Array(MAX_ASSETS);
  /** 0..255. Decay reduces it; it multiplies the speed limit. */
  readonly condition = new Uint8Array(MAX_ASSETS);
  readonly tiles = new Int32Array(MAX_ASSETS);
  /** Vehicle passes in the current flow window, and the previous window's
   *  total — valuation and the toll curve both read the settled figure so a
   *  half-finished window cannot make an asset look worthless. */
  readonly passes = new Int32Array(MAX_ASSETS);
  readonly passesPrev = new Int32Array(MAX_ASSETS);
  /*
   * Passes by somebody who is not the owner — the only ones that pay.
   *
   * A toll road used exclusively by its owner's own lorries earns nothing at
   * all, so buying by total traffic buys the busy road you are already on
   * rather than the one other people need. Rent stayed at zero per cent of
   * every company's income for the whole of a hundred-year run, which made
   * the ownership spine look inert when what was actually happening was that
   * everybody had bought their own road.
   */
  readonly foreignPasses = new Int32Array(MAX_ASSETS);
  readonly foreignPassesPrev = new Int32Array(MAX_ASSETS);
  /** Access-charge revenue, same windowing. */
  readonly revenue = new Float64Array(MAX_ASSETS);
  readonly revenuePrev = new Float64Array(MAX_ASSETS);
  /** What it cost to build. The valuation floor, so an unused asset is still
   *  worth something and cannot be bought for nothing. */
  readonly buildCost = new Float64Array(MAX_ASSETS);
  /** Tick the asset was created, for depreciation. */
  readonly built = new Int32Array(MAX_ASSETS);
  /** Set when the owner has listed it; rivals and the authority may bid. */
  readonly forSale = new Uint8Array(MAX_ASSETS);

  alloc(mode: number, cls: number, owner: number, charge: number, tick: number): number {
    if (this.count >= MAX_ASSETS) return NONE;
    const id = this.count++;
    this.owner[id] = owner;
    this.mode[id] = mode;
    this.cls[id] = cls;
    this.charge[id] = charge;
    this.condition[id] = 255;
    this.tiles[id] = 0;
    this.passes[id] = 0;
    this.passesPrev[id] = 0;
    this.foreignPasses[id] = 0;
    this.foreignPassesPrev[id] = 0;
    this.revenue[id] = 0;
    this.revenuePrev[id] = 0;
    this.buildCost[id] = 0;
    this.built[id] = tick;
    this.forSale[id] = 0;
    return id;
  }

  /** design.md §3.3, the second snowball damper: an asset's price is a
   *  multiple of what it recently earned, so a profitable road is expensive
   *  precisely because it is profitable. The build cost is a floor, and a
   *  worn-out asset is discounted toward it. */
  valuation(id: number, valuationPct: number): number {
    const earnings = this.revenuePrev[id];
    const fromEarnings = (earnings * valuationPct) / 100;
    const floor = (this.buildCost[id] * this.condition[id]) / 255 / 2;
    return Math.round(Math.max(floor, fromEarnings));
  }

  rollWindow(): void {
    for (let i = 0; i < this.count; i++) {
      this.passesPrev[i] = this.passes[i];
      this.foreignPassesPrev[i] = this.foreignPasses[i];
      this.revenuePrev[i] = this.revenue[i];
      this.passes[i] = 0;
      this.foreignPasses[i] = 0;
      this.revenue[i] = 0;
    }
  }
}

/**
 * Nodes and directed links.
 *
 * Rebuilt wholesale on edit. A full retrace of twenty thousand road tiles is
 * under a millisecond and happens only when the player builds something, so
 * incremental retracing would be complexity bought with no benefit — and a
 * partial rebuild is exactly the sort of thing that produces a graph which
 * differs by one edge on one machine.
 */
export class Graph {
  nodeCount = 0;
  readonly nodeTile = new Int32Array(MAX_NODES);
  readonly nodeMode = new Uint8Array(MAX_NODES);
  readonly nodeControl = new Uint8Array(MAX_NODES);
  /** Site or town this node serves, or NONE. Set by the world, not the tracer. */
  readonly nodeSite = new Int32Array(MAX_NODES);
  /** Index into `nodeOutStart` adjacency. */
  readonly nodeOutStart = new Int32Array(MAX_NODES + 1);

  linkCount = 0;
  readonly linkFrom = new Int32Array(MAX_LINKS);
  readonly linkTo = new Int32Array(MAX_LINKS);
  readonly linkTwin = new Int32Array(MAX_LINKS);
  readonly linkMode = new Uint8Array(MAX_LINKS);
  readonly linkCls = new Uint8Array(MAX_LINKS);
  /** Length in Q16.16 tiles. */
  readonly linkLength = new Int32Array(MAX_LINKS);
  /** Tiles of chain, into `chain`. */
  readonly linkChainStart = new Int32Array(MAX_LINKS);
  readonly linkChainLen = new Int32Array(MAX_LINKS);
  /** Traffic cells, into the occupancy pool. */
  readonly linkCellStart = new Int32Array(MAX_LINKS);
  readonly linkCellCount = new Int32Array(MAX_LINKS);
  /** Sum of the per-tile access charges along the chain, in pence, cached
   *  because routing reads it once per link per expansion. */
  readonly linkCharge = new Int32Array(MAX_LINKS);
  /** The single asset the link belongs to when it is uniform, else NONE.
   *  Charging walks the chain when this is NONE. */
  readonly linkAsset = new Int32Array(MAX_LINKS);
  /** Rolling traffic count, for the congestion overlay and decay. */
  readonly linkFlow = new Int32Array(MAX_LINKS);
  readonly linkFlowPrev = new Int32Array(MAX_LINKS);
  /**
   * How many vehicles the link may hold at once.
   *
   * For a road this is its cell count: vehicles pack in nose to tail. For a
   * railway it is the number of *blocks*, because two trains may not occupy
   * one section of single line — which is the whole of what makes signalling a
   * puzzle rather than a decoration, and why a busy branch needs passing
   * loops or doubling rather than more locomotives.
   */
  readonly linkCapacity = new Int32Array(MAX_LINKS);
  /** Vehicles on the link right now, against that capacity. */
  readonly linkOccupancy = new Int32Array(MAX_LINKS);

  /** Flattened adjacency: outgoing link ids grouped by from-node. */
  outLinks = new Int32Array(MAX_LINKS);

  /** Flattened tile chains for every link. */
  chain = new Int32Array(1024);
  chainLen = 0;

  /** Cell occupancy: the vehicle id in each cell, or NONE. */
  cells = new Int32Array(1024).fill(NONE);
  cellCount = 0;

  /** Bumped on every rebuild. Route caches compare against it. */
  version = 0;

  /**
   * Tile to node id, keyed by mode and tile. Probed, never iterated, so using
   * a Map here does not breach the no-unordered-iteration rule.
   */
  nodeOfTile = new Map<number, number>();

  nodeAt(mode: number, tile: number): number {
    const n = this.nodeOfTile.get(mode * 0x40000000 + tile);
    return n === undefined ? NONE : n;
  }
}

/** Bit count of a four-bit direction mask. */
function degree(mask: number): number {
  return ((mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1)) | 0;
}

export interface WayCostTable {
  /** Q16.16 tiles per tick, per way class. */
  speedLimit: Int32Array;
}

/**
 * Retrace every layer into nodes and links.
 *
 * Determinism note: tiles are visited in ascending tile index and directions
 * in the fixed N-E-S-W order, so the node ids, link ids and adjacency ordering
 * are a pure function of the tile arrays. Nothing here iterates a Map or a Set.
 */
/** Tiles per signal block on a railway. */
export const BLOCK_TILES = 8;

export function rebuildGraph(
  g: Graph, layers: WayLayer[], assets: AssetTable, wayLanes?: Int32Array,
): void {
  g.nodeCount = 0;
  g.linkCount = 0;
  g.chainLen = 0;
  g.cellCount = 0;

  // Node lookup is per rebuild and never iterated, only probed.
  const nodeOf = new Map<number, number>();
  g.nodeOfTile = nodeOf;
  const chainOut: number[] = [];

  const addNode = (tile: number, mode: number): number => {
    const key = mode * 0x40000000 + tile;
    const existing = nodeOf.get(key);
    if (existing !== undefined) return existing;
    const id = g.nodeCount++;
    g.nodeTile[id] = tile;
    g.nodeMode[id] = mode;
    g.nodeControl[id] = Control.None;
    g.nodeSite[id] = NONE;
    nodeOf.set(key, id);
    return id;
  };

  interface PendingLink {
    from: number;
    to: number;
    mode: number;
    cls: number;
    chain: number[];
  }
  const pending: PendingLink[] = [];

  for (const layer of layers) {
    if (layer.tileCount === 0) continue;
    const size = layer.size;
    const n = size * size;

    // Pass one: every tile that is not a plain continuation becomes a node.
    // A ring of degree-two tiles has none, so the lowest-indexed tile of any
    // untraced ring is promoted afterwards.
    for (let tile = 0; tile < n; tile++) {
      if (!layer.has(tile)) continue;
      if (degree(layer.dir[tile]) !== 2 || layer.terminal[tile]) addNode(tile, layer.mode);
    }

    const traced = new Uint8Array(n);

    const traceFrom = (startTile: number): void => {
      const startNode = addNode(startTile, layer.mode);
      for (let d = 0; d < 4; d++) {
        if ((layer.dir[startTile] & DIR_BIT[d]) === 0) continue;
        const chain: number[] = [startTile];
        let x = startTile % size;
        let y = (startTile / size) | 0;
        let dir = d;
        let guard = 0;
        for (;;) {
          if (++guard > n) break;
          x += DIR_DX[dir];
          y += DIR_DY[dir];
          if (x < 0 || y < 0 || x >= size || y >= size) break;
          const tile = y * size + x;
          if (!layer.has(tile)) break;
          chain.push(tile);
          if (degree(layer.dir[tile]) !== 2 || nodeOf.has(layer.mode * 0x40000000 + tile)) break;
          traced[tile] = 1;
          // Continue through: the one connection that is not where we came in.
          const back = DIR_OPPOSITE[dir];
          let next = -1;
          for (let k = 0; k < 4; k++) {
            if (k === back) continue;
            if ((layer.dir[tile] & DIR_BIT[k]) !== 0) {
              next = k;
              break;
            }
          }
          if (next < 0) break;
          dir = next;
        }
        if (chain.length < 2) continue;
        const endTile = chain[chain.length - 1];
        if (!layer.has(endTile)) continue;
        const endNode = addNode(endTile, layer.mode);
        if (endNode === startNode && chain.length === 2) continue;
        // Each undirected chain is discovered from both ends; keep the one
        // whose start tile is the lower index so it is added exactly once.
        if (endTile < startTile) continue;
        if (endTile === startTile && chain[1] > chain[chain.length - 2]) continue;
        pending.push({
          from: startNode,
          to: endNode,
          mode: layer.mode,
          cls: layer.cls[startTile],
          chain,
        });
      }
    };

    // Ascending tile order over the nodes discovered in pass one.
    const nodeTiles: number[] = [];
    for (let tile = 0; tile < n; tile++) {
      if (layer.has(tile) && (degree(layer.dir[tile]) !== 2 || layer.terminal[tile])) nodeTiles.push(tile);
    }
    for (const tile of nodeTiles) traceFrom(tile);

    // Rings: any way tile still untraced and not a node.
    for (let tile = 0; tile < n; tile++) {
      if (!layer.has(tile) || traced[tile]) continue;
      if (nodeOf.has(layer.mode * 0x40000000 + tile)) continue;
      traced[tile] = 1;
      traceFrom(tile);
    }
  }

  // ---- materialise ------------------------------------------------------
  // Links are created in pairs so `twin` is always `id ^ 1`, which the traffic
  // model relies on to find the opposing direction without a lookup.
  let cellCursor = 0;
  const chainPool: number[] = [];
  for (const p of pending) {
    const fwd = g.linkCount++;
    const rev = g.linkCount++;
    const start = chainPool.length;
    for (const t of p.chain) chainPool.push(t);

    const tiles = p.chain.length;
    const length = (tiles - 1) * FX_ONE;
    const cells = Math.max(1, (tiles - 1) * CELLS_PER_TILE);

    let charge = 0;
    let asset = NONE;
    let uniform = true;
    const layer = layers[p.mode];
    for (let i = 0; i < tiles; i++) {
      const a = layer.asset[p.chain[i]];
      if (a !== NONE) {
        charge += assets.charge[a];
        if (asset === NONE) asset = a;
        else if (asset !== a) uniform = false;
      }
    }

    for (const [id, dirFwd] of [[fwd, true], [rev, false]] as [number, boolean][]) {
      g.linkFrom[id] = dirFwd ? p.from : p.to;
      g.linkTo[id] = dirFwd ? p.to : p.from;
      g.linkTwin[id] = dirFwd ? rev : fwd;
      g.linkMode[id] = p.mode;
      g.linkCls[id] = p.cls;
      g.linkLength[id] = length;
      g.linkChainStart[id] = start;
      g.linkChainLen[id] = tiles;
      g.linkCellStart[id] = cellCursor;
      g.linkCellCount[id] = cells;
      g.linkCharge[id] = charge;
      g.linkAsset[id] = uniform ? asset : NONE;
      g.linkFlow[id] = 0;
      g.linkFlowPrev[id] = 0;
      g.linkOccupancy[id] = 0;
      cellCursor += cells;
    }
  }

  // The reverse link walks the same chain backwards; the traffic model reads
  // it with an index flip rather than storing a second copy.
  // Capacity, once the classes are known. Rail is blocked: a section of
  // single line holds one train, a double holds one each way, and a longer
  // section is divided into more blocks rather than holding more trains.
  for (let id = 0; id < g.linkCount; id++) {
    if (g.linkMode[id] === 1) {
      const tiles = g.linkChainLen[id] - 1;
      const lanes = wayLanes ? wayLanes[g.linkCls[id]] : 1;
      g.linkCapacity[id] = Math.max(1, Math.floor(tiles / BLOCK_TILES)) * Math.max(1, lanes);
    } else {
      g.linkCapacity[id] = g.linkCellCount[id];
    }
  }

  g.chain = Int32Array.from(chainPool);
  g.chainLen = chainPool.length;
  g.cells = new Int32Array(Math.max(1, cellCursor)).fill(NONE);
  g.cellCount = cellCursor;

  // ---- tile back-references --------------------------------------------
  for (const layer of layers) {
    if (layer.tileCount === 0) continue;
    layer.link.fill(NONE);
  }
  for (let id = 0; id < g.linkCount; id += 2) {
    const layer = layers[g.linkMode[id]];
    const start = g.linkChainStart[id];
    const len = g.linkChainLen[id];
    for (let i = 0; i < len; i++) {
      const tile = g.chain[start + i];
      // Junction tiles belong to several links; the first wins, which is only
      // used for picking and overlay colour.
      if (layer.link[tile] === NONE) {
        layer.link[tile] = id;
        layer.linkOffset[tile] = i;
      }
    }
  }

  // ---- adjacency --------------------------------------------------------
  const outCount = new Int32Array(g.nodeCount + 1);
  for (let id = 0; id < g.linkCount; id++) outCount[g.linkFrom[id]]++;
  let acc = 0;
  for (let i = 0; i < g.nodeCount; i++) {
    g.nodeOutStart[i] = acc;
    acc += outCount[i];
  }
  g.nodeOutStart[g.nodeCount] = acc;
  const cursor = Int32Array.from(g.nodeOutStart.subarray(0, g.nodeCount));
  g.outLinks = new Int32Array(Math.max(1, acc));
  for (let id = 0; id < g.linkCount; id++) {
    g.outLinks[cursor[g.linkFrom[id]]++] = id;
  }

  // ---- junction control -------------------------------------------------
  // Default rules only. The Junction Lab replaces these per node from Phase 2.
  for (let i = 0; i < g.nodeCount; i++) {
    const outs = g.nodeOutStart[i + 1] - g.nodeOutStart[i];
    g.nodeControl[i] = outs <= 2 ? Control.None : Control.Priority;
  }

  g.version++;
}

/** Tiles along a link in travel order. `out` must hold `linkChainLen` items. */
export function linkChain(g: Graph, link: number, out: Int32Array): number {
  const start = g.linkChainStart[link];
  const len = g.linkChainLen[link];
  const forward = (link & 1) === 0;
  for (let i = 0; i < len; i++) {
    out[i] = g.chain[start + (forward ? i : len - 1 - i)];
  }
  return len;
}

/** The tile a cell sits on, and how far along that tile it is. */
export function cellTile(g: Graph, link: number, cell: number): number {
  const len = g.linkChainLen[link];
  const start = g.linkChainStart[link];
  const forward = (link & 1) === 0;
  const along = Math.min(len - 1, Math.floor(cell / CELLS_PER_TILE));
  return g.chain[start + (forward ? along : len - 1 - along)];
}

/**
 * Effective speed limit on a link: the class ceiling, reduced by condition.
 * A neglected road is slow before it is impassable, which is what makes decay
 * something you notice in the timetable rather than in a dialog.
 */
export function linkSpeed(g: Graph, assets: AssetTable, ways: WayCostTable, link: number): Fx {
  const base = ways.speedLimit[g.linkCls[link]];
  const asset = g.linkAsset[link];
  if (asset === NONE) return base;
  const cond = assets.condition[asset];
  if (cond >= 200) return base;
  // Below 200 the penalty ramps in; at zero condition a way runs at a third
  // of its rating rather than stopping, so a collapse is survivable.
  const factor = fxDiv((85 + cond) * FX_ONE, 285 * FX_ONE);
  return fxMul(base, factor);
}

export function hashNetwork(h: Hasher, g: Graph, assets: AssetTable): void {
  h.int(g.nodeCount).int(g.linkCount).int(g.cellCount).int(assets.count);
  h.array(g.linkFrom, g.linkCount);
  h.array(g.linkCharge, g.linkCount);
  h.array(g.cells, g.cellCount);
  h.array(assets.owner, assets.count);
  h.array(assets.charge, assets.count);
  h.array(assets.condition, assets.count);
  for (let i = 0; i < assets.count; i++) h.big(Math.round(assets.revenue[i]));
}

export { FLOW_WINDOW, AUTHORITY, MODE_COUNT };
