/**
 * Laying an alignment: the route, the profile, and what it costs.
 *
 * The interesting half is the profile. A way does not sit on the ground; it
 * sits on a *formation* whose height is smoothed along the route until the
 * gradient is inside what the way class can climb. Everything characterful
 * then falls out of the difference between the formation and the ground:
 *
 *   formation well above ground   ->  embankment, and past a threshold a bridge
 *   formation well below ground   ->  cutting, and past a threshold a tunnel
 *   formation on the ground       ->  ordinary construction
 *
 * One mechanism, four features, and the reason a railway behaves differently
 * from a road is a single number in the data rather than a special case in the
 * code: a lorry shrugs at a one-in-ten and a locomotive cannot start on one, so
 * the railway has to find the valley and the road can go over the top.
 *
 * That is also why terrain is a cost and not a paint tool (design.md §13):
 * moving earth is expensive and permanent, and the player pays for it in the
 * estimate before they commit.
 */

import { DIR_BIT, DIR_DX, DIR_DY, DIR_OPPOSITE, Mode } from './constants.ts';
import { NONE, type WayLayer } from './network.ts';
import { SEA_LEVEL, type Terrain } from './terrain.ts';

/** Height difference at which the formation stops sitting on the ground. */
export const STRUCTURE_THRESHOLD = 26;
/** And at which it becomes a bridge or a tunnel rather than earthworks. */
export const SPAN_THRESHOLD = 70;

export const WayFlag = {
  Embankment: 1,
  Cutting: 2,
  Bridge: 4,
  Tunnel: 8,
} as const;

export interface WayClassProfile {
  buildCost: number;
  maxGradient: number;
  /** Height units one lock chamber lifts, or zero for a way that cannot be
   *  locked. Only water has this. */
  locking: number;
  minRadius: number;
  bridgeCostPct: number;
  tunnelCostPct: number;
}

/**
 * Height units one lock chamber lifts a boat.
 *
 * A height unit is half a metre (scale.md), and a lock chamber is about two
 * metres, so four. It is a constant rather than content because it is a fact
 * about water and gates rather than a balance figure: a deeper lock is not a
 * design option, it is a different physics.
 */
export const LOCK_LIFT = 4;

export interface AlignmentTile {
  tile: number;
  /** Formation level, in height units. */
  level: number;
  ground: number;
  flags: number;
  cost: number;
  /** Someone else already owns the way here. The alignment passes through and
   *  joins onto it; it does not replace it and is not charged for it. */
  foreign: boolean;
}

export interface Alignment {
  tiles: AlignmentTile[];
  totalCost: number;
  earthworks: number;
  bridges: number;
  tunnels: number;
  /** Steepest gradient on the finished formation, for the readout. */
  steepest: number;
  /** Lock chambers on a water alignment. A canal does not climb; a lock does,
   *  which is why this is counted separately from earthworks. */
  locks: number;
  /** Tiles that already carried this mode of yours and are being upgraded. */
  reused: number;
  /** Tiles belonging to someone else that the alignment runs onto. */
  foreign: number;
  ok: boolean;
  problem: string;
}

/**
 * Resolve a route into runs long enough for a way class's minimum radius.
 *
 * The tile router returns the cheapest path across the terrain, and on a
 * diagonal that is a staircase — a turn every single tile. A road does not
 * care. A railway cannot be built at all: every alignment comes back "curves
 * are too tight", which reads as the game being broken rather than as the
 * terrain being difficult.
 *
 * So the staircase is resampled into waypoints and rebuilt as long straight
 * runs meeting at single corners, which is both what a railway looks like and
 * what a surveyor would have drawn. The terrain cost is slightly worse than
 * the free path and that is correct: a railway *is* more expensive to align
 * than a road, and this is where that comes from.
 */
export function alignForRadius(
  path: ArrayLike<number>,
  minRadius: number,
  size: number,
): Int32Array {
  if (minRadius <= 0 || path.length < 3) return Int32Array.from(path as ArrayLike<number>);
  const run = Math.max(minRadius, 2);

  // Waypoints along the free path, so the alignment still follows the valley
  // the router found, then *quantised* to a lattice of `run` tiles. The
  // quantisation is what makes the guarantee cheap: every leg between two
  // lattice points is a whole number of `run`s, so every straight run is at
  // least `run` long by construction rather than by inspection afterwards.
  const first = path[0];
  const last = path[path.length - 1];
  const ox = first % size;
  const oy = (first / size) | 0;
  const snap = (v: number, o: number): number => o + Math.round((v - o) / run) * run;

  const way: [number, number][] = [[ox, oy]];
  const stride = Math.max(run * 2, 6);
  for (let i = stride; i < path.length - 1; i += stride) {
    const x = snap(path[i] % size, ox);
    const y = snap((path[i] / size) | 0, oy);
    const prev = way[way.length - 1];
    if (x !== prev[0] || y !== prev[1]) way.push([x, y]);
  }
  way.push([last % size, (last / size) | 0]);

  const out: number[] = [];
  const push = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const tile = y * size + x;
    if (out.length === 0 || out[out.length - 1] !== tile) out.push(tile);
  };
  push(ox, oy);

  let cx = ox;
  let cy = oy;
  for (let k = 1; k < way.length; k++) {
    const [tx, ty] = way[k];
    // The longer leg first, so the corner sits toward the far end and two
    // consecutive legs do not corner in the same place.
    const xFirst = Math.abs(tx - cx) >= Math.abs(ty - cy);
    if (xFirst) {
      while (cx !== tx) { cx += tx > cx ? 1 : -1; push(cx, cy); }
      while (cy !== ty) { cy += ty > cy ? 1 : -1; push(cx, cy); }
    } else {
      while (cy !== ty) { cy += ty > cy ? 1 : -1; push(cx, cy); }
      while (cx !== tx) { cx += tx > cx ? 1 : -1; push(cx, cy); }
    }
  }
  return Int32Array.from(out);
}

/**
 * Plan an alignment along a path of tiles.
 *
 * The profile is fitted by relaxation rather than by anything clever: start
 * with the ground, then repeatedly pull each point toward the average of its
 * neighbours wherever the gradient between them is illegal. It converges in a
 * handful of passes, it produces the sagging, smoothed line a surveyor would
 * draw, and — unlike a closed-form fit — it degrades gracefully when the
 * terrain makes the constraint impossible, which on a mountainside it often
 * does.
 */
export function planAlignment(
  terrain: Terrain,
  layer: WayLayer,
  path: ArrayLike<number>,
  cls: number,
  profile: WayClassProfile,
  /** Who is building, and who owns each asset. Without this the planner
   *  happily quotes for resurfacing a rival's road, charges for it, and hands
   *  the player nothing — the money leaves and the ownership does not move. */
  company = 0,
  ownerOfAsset?: (asset: number) => number,
): Alignment {
  const n = path.length;
  const out: Alignment = {
    tiles: [],
    totalCost: 0,
    earthworks: 0,
    bridges: 0,
    tunnels: 0,
    steepest: 0,
    locks: 0,
    reused: 0,
    foreign: 0,
    ok: true,
    problem: '',
  };
  if (n < 2) {
    out.ok = false;
    out.problem = 'An alignment needs at least two tiles.';
    return out;
  }

  const ground = new Int32Array(n);
  const level = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Water is levelled to just above the sea, because a bridge deck does not
    // dip to the seabed.
    const h = terrain.height[path[i]];
    ground[i] = h;
    level[i] = h <= SEA_LEVEL ? SEA_LEVEL + 12 : h;
  }

  // The ends are pinned: an alignment has to meet whatever it joins.
  const maxGrad = Math.max(1, profile.maxGradient);
  for (let pass = 0; pass < 64; pass++) {
    let worst = 0;
    for (let i = 1; i < n - 1; i++) {
      const before = level[i - 1];
      const after = level[i + 1];
      const target = (before + after) / 2;
      const gA = Math.abs(level[i] - before);
      const gB = Math.abs(after - level[i]);
      const excess = Math.max(gA, gB) - maxGrad;
      if (excess <= 0) continue;
      worst = Math.max(worst, excess);
      // Move a fraction of the way to the mean. Going all the way oscillates.
      level[i] += (target - level[i]) * 0.55;
    }
    if (worst <= 0.5) break;
  }

  /*
   * Locks, and why a canal is not just a very flat road.
   *
   * A canal has a maximum gradient of two height units per tile, which is to
   * say none: water does not run uphill and a level pound is level. Relaxing
   * the profile the way a railway does cannot help, because there is no
   * embankment tall enough to make a valley flat. So a canal built by the
   * rules every other way class follows is a canal that can only be laid on
   * ground that is already dead level, which in this terrain is almost
   * nowhere — the class existed in the content for the whole project and not
   * one could ever be built.
   *
   * The answer is the one the eighteenth century found. A canal climbs in
   * steps: a run of level pound, a lock, another level pound. So a water
   * alignment is allowed to step, the steps are counted, and each one is
   * charged for — which makes a flight of locks up a valley expensive and
   * slow and characterful, exactly as it should be, rather than illegal.
   */
  const stepped = profile.locking > 0;
  for (let i = 1; i < n; i++) {
    const g = Math.abs(level[i] - level[i - 1]);
    if (stepped && g > maxGrad) {
      // One lock per chamber-worth of lift, rounded up. A lock chamber raises
      // a boat about two metres, so a long climb is a flight rather than one
      // enormous chamber, and it is priced like a flight.
      out.locks += Math.max(1, Math.ceil(g / profile.locking));
      continue;
    }
    if (g > out.steepest) out.steepest = g;
  }
  if (out.steepest > maxGrad * 1.6) {
    out.ok = false;
    out.problem = `Too steep for ${maxGrad} per tile — the formation cannot be made to climb it.`;
  }

  // Minimum radius: count how sharply the path turns. A railway that turns a
  // right angle in one tile is not a railway.
  if (profile.minRadius > 0) {
    let tightest = 99;
    // The approaches are exempt. Real railways have tighter geometry in the
    // yard than on the main line, and without this exemption an alignment can
    // never quite reach a terminal that is not on the lattice.
    const skip = profile.minRadius + 1;
    for (let i = Math.max(1, skip); i < n - 1 - skip; i++) {
      const size = terrain.size;
      const ax = (path[i] % size) - (path[i - 1] % size);
      const ay = ((path[i] / size) | 0) - ((path[i - 1] / size) | 0);
      const bx = (path[i + 1] % size) - (path[i] % size);
      const by = ((path[i + 1] / size) | 0) - ((path[i] / size) | 0);
      if (ax === bx && ay === by) continue;
      // A change of direction inside `minRadius` tiles of the last one is too
      // tight. Measured by walking back until the direction last changed.
      let run = 1;
      for (let k = i - 1; k > 0; k--) {
        const px = (path[k] % size) - (path[k - 1] % size);
        const py = ((path[k] / size) | 0) - ((path[k - 1] / size) | 0);
        if (px !== ax || py !== ay) break;
        run++;
      }
      if (run < tightest) tightest = run;
    }
    if (tightest < profile.minRadius) {
      out.ok = false;
      out.problem = `Curves are too tight — this way needs ${profile.minRadius} tiles between turns and the route has ${tightest}.`;
    }
  }

  // Nothing to do is worth saying out loud rather than silently succeeding.
  let allForeign = true;
  for (let i = 0; i < n && allForeign; i++) {
    const asset = layer.asset[path[i]];
    if (layer.cls[path[i]] === 255) allForeign = false;
    else if (asset === NONE || ownerOfAsset === undefined) allForeign = false;
    else if (ownerOfAsset(asset) === company) allForeign = false;
  }
  if (allForeign) {
    out.ok = false;
    out.problem = "That route is already somebody else's way the whole distance. Buy it, or go round.";
  }

  for (let i = 0; i < n; i++) {
    const tile = path[i];
    const diff = level[i] - ground[i];
    let flags: number = 0;
    let multiplier = 100;
    const water = ground[i] <= SEA_LEVEL;

    if (water || diff > SPAN_THRESHOLD) {
      flags |= WayFlag.Bridge;
      multiplier = profile.bridgeCostPct;
      out.bridges++;
    } else if (diff < -SPAN_THRESHOLD) {
      flags |= WayFlag.Tunnel;
      multiplier = profile.tunnelCostPct;
      out.tunnels++;
    } else if (diff > STRUCTURE_THRESHOLD) {
      flags |= WayFlag.Embankment;
      // Earthworks scale with the volume moved, which is roughly the square of
      // the height — a two-metre bank is not twice a one-metre bank.
      multiplier = 100 + Math.round((diff * diff) / 24);
      out.earthworks++;
    } else if (diff < -STRUCTURE_THRESHOLD) {
      flags |= WayFlag.Cutting;
      multiplier = 100 + Math.round((diff * diff) / 20);
      out.earthworks++;
    }

    const existing = layer.cls[tile] !== 255;
    const asset = layer.asset[tile];
    const otherOwner = existing && asset !== NONE && ownerOfAsset !== undefined
      && ownerOfAsset(asset) !== company;

    let cost: number;
    if (otherOwner) {
      // Run onto it and join, but change nothing and pay nothing. You will go
      // on paying their access charge to use it, which is the point: the way
      // to stop paying is to buy it or to go round, and this is where "round"
      // begins.
      out.foreign++;
      cost = 0;
      flags = 0;
    } else {
      if (existing) out.reused++;
      // Re-laying over your own formation is cheap; the earth is already moved.
      cost = Math.round(((profile.buildCost * multiplier) / 100) * (existing ? 0.35 : 1));
    }
    out.totalCost += cost;
    out.tiles.push({
      tile,
      level: otherOwner ? layer.level[tile] || ground[i] : Math.round(level[i]),
      ground: ground[i],
      flags,
      cost,
      foreign: otherOwner,
    });
  }

  // A lock is a masonry chamber with gates, and it costs about what a short
  // stretch of the canal itself does. Charged after the per-tile pass so it
  // shows in the estimate as its own line, the way a viaduct does: "nine
  // thousand pounds, of which six is the flight of locks" is a different
  // sentence from "nine thousand pounds".
  if (out.locks > 0) out.totalCost += out.locks * profile.buildCost * 2;

  void cls;
  return out;
}

/**
 * Commit an alignment to a layer. Returns the tiles actually changed.
 *
 * Connectivity is set in both directions between consecutive tiles, which is
 * what makes the graph tracer see a way rather than a row of unrelated tiles.
 */
export function layAlignment(
  layer: WayLayer,
  size: number,
  alignment: Alignment,
  cls: number,
  asset: number,
): number {
  let laid = 0;
  for (let i = 0; i < alignment.tiles.length; i++) {
    const t = alignment.tiles[i];
    if (t.foreign) {
      // Leave the tile entirely alone; only the connection is made, below.
    } else if (layer.cls[t.tile] === 255) {
      layer.cls[t.tile] = cls;
      layer.asset[t.tile] = asset;
      layer.tileCount++;
      laid++;
    } else {
      layer.cls[t.tile] = cls;
    }
    if (!t.foreign) {
      layer.level[t.tile] = t.level;
      layer.flags[t.tile] = t.flags;
    }

    if (i + 1 < alignment.tiles.length) {
      const a = t.tile;
      const b = alignment.tiles[i + 1].tile;
      const dx = (b % size) - (a % size);
      const dy = ((b / size) | 0) - ((a / size) | 0);
      let d = -1;
      for (let k = 0; k < 4; k++) if (DIR_DX[k] === dx && DIR_DY[k] === dy) d = k;
      if (d >= 0) {
        layer.dir[a] |= DIR_BIT[d];
        layer.dir[b] |= DIR_BIT[DIR_OPPOSITE[d]];
      }
    }
  }
  return laid;
}

/** Remove a way tile and detach it from its neighbours. */
export function removeWayTile(layer: WayLayer, size: number, tile: number): boolean {
  if (layer.cls[tile] === 255) return false;
  for (let d = 0; d < 4; d++) {
    if ((layer.dir[tile] & DIR_BIT[d]) === 0) continue;
    const nx = (tile % size) + DIR_DX[d];
    const ny = ((tile / size) | 0) + DIR_DY[d];
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
    layer.dir[ny * size + nx] &= ~DIR_BIT[DIR_OPPOSITE[d]];
  }
  layer.cls[tile] = 255;
  layer.dir[tile] = 0;
  layer.asset[tile] = NONE;
  layer.flags[tile] = 0;
  layer.terminal[tile] = 0;
  layer.tileCount--;
  return true;
}

export { Mode };
