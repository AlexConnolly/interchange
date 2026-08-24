/**
 * Saves, replays and snapshots. architecture.md §7.
 *
 *   save = { seed, worldConfig, commandLog[], snapshots[] }
 *
 * The command log is authoritative and a snapshot is only an optimisation for
 * load time — it can always be discarded and rebuilt by replaying. That is why
 * a save is kilobytes, why cloud saves stop being a storage problem, and why a
 * save *is* a replay with no extra work.
 *
 * It is also the bug-report format: a player sends a log, we replay the exact
 * failure. In a genre this stateful that is worth an enormous amount.
 */

import { decodeLog, encodeLog, type Command } from './commands.ts';
import { LINE_COUNT } from './economy.ts';
import { MAX_STOPS } from './economy.ts';
import type { World } from './world.ts';
import type { WorldConfig } from './terrain.ts';

export const SAVE_VERSION = 1;

export interface SaveFile {
  version: number;
  config: WorldConfig;
  /** Tick the log runs to. Replaying past it is fine; short of it is a bug. */
  tick: number;
  log: string;
  /** Rolling hashes, so a load can verify the replay reproduced the world. */
  hashes: { tick: number; hash: number }[];
  meta: {
    savedAtTick: number;
    company: string;
    cash: number;
    year: number;
  };
}

export function saveGame(w: World): SaveFile {
  return {
    version: SAVE_VERSION,
    config: w.config,
    tick: w.tick,
    log: encodeLog(w.queue.log),
    hashes: w.hashes.slice(-32),
    meta: {
      savedAtTick: w.tick,
      company: w.companies.names[w.player] ?? 'Unknown',
      cash: Math.round(w.companies.cash[w.player] ?? 0),
      year: w.year,
    },
  };
}

export interface LoadResult {
  world: World;
  /** Ticks where the replay's hash did not match the save's. Empty is good. */
  divergences: { tick: number; expected: number; actual: number }[];
}

/**
 * Rebuild a world by replaying its log.
 *
 * The hash check is not optional decoration. If a replay of the same log from
 * the same seed produces a different world, determinism has broken somewhere
 * and this is the cheapest place in the whole project to notice.
 */
export function loadGame(
  save: SaveFile,
  create: (config: WorldConfig) => World,
  onProgress?: (tick: number, total: number) => void,
): LoadResult {
  const world = create(save.config);
  const log = decodeLog(save.log);
  world.queue.loadLog(log);
  const expected = new Map(save.hashes.map((h) => [h.tick, h.hash]));
  const divergences: { tick: number; expected: number; actual: number }[] = [];

  const target = save.tick;
  for (let i = 0; i < target; i++) {
    const report = world.step();
    if (report.hash !== null) {
      const want = expected.get(report.tick);
      if (want !== undefined && want !== report.hash) {
        divergences.push({ tick: report.tick, expected: want, actual: report.hash });
      }
    }
    if (onProgress && (i & 1023) === 0) onProgress(i, target);
  }
  return { world, divergences };
}

// ------------------------------------------------------------- snapshots

/**
 * A binary dump of the mutable state. Used to make a load fast and to hand a
 * late-joining multiplayer client a starting point without replaying an
 * evening's worth of ticks.
 *
 * The terrain is not in here: it is a pure function of the seed, so storing a
 * megabyte of heightmap in every autosave would be storing a number twice.
 */
export function snapshot(w: World): ArrayBuffer {
  const parts: (ArrayBufferView | number[])[] = [];
  const header: number[] = [w.tick, w.graph.version, w.assets.count, w.vehicles.count, w.sites.count, w.towns.count, w.companies.count, w.contracts.count, w.services.count];
  parts.push(new Int32Array(header));
  parts.push(w.rng.getState());

  for (const layer of w.layers) {
    parts.push(new Int32Array([layer.tileCount]));
    if (layer.tileCount === 0) continue;
    parts.push(layer.cls);
    parts.push(layer.dir);
    parts.push(layer.asset);
    parts.push(layer.terminal);
  }

  parts.push(w.assets.owner.subarray(0, w.assets.count));
  parts.push(w.assets.mode.subarray(0, w.assets.count));
  parts.push(w.assets.cls.subarray(0, w.assets.count));
  parts.push(w.assets.charge.subarray(0, w.assets.count));
  parts.push(w.assets.condition.subarray(0, w.assets.count));
  parts.push(w.assets.tiles.subarray(0, w.assets.count));
  parts.push(w.assets.revenue.subarray(0, w.assets.count));
  parts.push(w.assets.revenuePrev.subarray(0, w.assets.count));
  parts.push(w.assets.buildCost.subarray(0, w.assets.count));

  const v = w.vehicles;
  const n = v.count;
  parts.push(v.alive.subarray(0, n));
  parts.push(v.company.subarray(0, n));
  parts.push(v.type.subarray(0, n));
  parts.push(v.state.subarray(0, n));
  parts.push(v.link.subarray(0, n));
  parts.push(v.cell.subarray(0, n));
  parts.push(v.pos.subarray(0, n));
  parts.push(v.speed.subarray(0, n));
  parts.push(v.service.subarray(0, n));
  parts.push(v.orderIndex.subarray(0, n));
  parts.push(v.targetNode.subarray(0, n));
  parts.push(v.cargo.subarray(0, n));
  parts.push(v.load.subarray(0, n));
  parts.push(v.dwell.subarray(0, n));

  parts.push(w.sites.def.subarray(0, w.sites.count));
  parts.push(w.sites.x.subarray(0, w.sites.count));
  parts.push(w.sites.y.subarray(0, w.sites.count));
  parts.push(w.sites.owner.subarray(0, w.sites.count));
  parts.push(w.sites.state.subarray(0, w.sites.count));
  parts.push(w.sites.satisfaction.subarray(0, w.sites.count));
  parts.push(w.sites.cycle.subarray(0, w.sites.count));
  parts.push(w.sites.stock.subarray(0, w.sites.count * w.sites.cargoCount));

  parts.push(w.towns.population.subarray(0, w.towns.count));
  parts.push(w.towns.served.subarray(0, w.towns.count));
  parts.push(w.towns.stock.subarray(0, w.towns.count * w.towns.cargoCount));

  parts.push(w.companies.cash.subarray(0, w.companies.count));
  parts.push(w.companies.debt.subarray(0, w.companies.count));
  parts.push(w.companies.charter.subarray(0, w.companies.count));
  parts.push(w.companies.ledger.subarray(0, w.companies.count * LINE_COUNT));

  let bytes = 0;
  for (const p of parts) bytes += ArrayBuffer.isView(p) ? p.byteLength : p.length * 4;
  const out = new Uint8Array(bytes);
  let off = 0;
  for (const p of parts) {
    const view = ArrayBuffer.isView(p)
      ? new Uint8Array(p.buffer, p.byteOffset, p.byteLength)
      : new Uint8Array(new Int32Array(p).buffer);
    out.set(view, off);
    off += view.byteLength;
  }
  return out.buffer;
}

/** Rough size of a save, for the "cloud saves are not a storage problem"
 *  claim in architecture.md §7 — worth being able to check rather than assert. */
export function saveSizeBytes(save: SaveFile): number {
  return JSON.stringify(save).length;
}

export { MAX_STOPS };
export type { Command };
