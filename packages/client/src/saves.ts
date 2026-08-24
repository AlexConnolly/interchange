/**
 * Saves, replays and timelapse — which are all the same thing.
 *
 * architecture.md §7: a save is a seed plus a command log, so it is kilobytes
 * rather than megabytes, and a save *is* a replay. Nothing here is a feature
 * built on top of the simulation; it is all consequences of the command model
 * that were already paid for.
 *
 * Cloud saves need somewhere to put them and O6 closed Act I as a private
 * playtest, so this is local storage plus a file the player can hand to
 * somebody. The interface is the one a server would have — list, read, write,
 * delete against a string key — so pointing it at Supabase later is a change
 * of backend and not a change of design.
 */

import { decodeLog, loadGame, saveGame, type SaveFile, type World } from '@interchange/sim';

const PREFIX = 'interchange.save.';
const INDEX = 'interchange.saves';

export interface SaveEntry {
  key: string;
  name: string;
  savedAt: number;
  year: number;
  company: string;
  cash: number;
  bytes: number;
  auto: boolean;
}

interface StoredSave extends SaveFile {
  name: string;
  savedAt: number;
  auto: boolean;
}

/** The backend. Local now; the same three methods over HTTP later. */
export interface SaveStore {
  list(): SaveEntry[];
  read(key: string): StoredSave | null;
  write(key: string, save: StoredSave): boolean;
  remove(key: string): void;
}

export const localStore: SaveStore = {
  list(): SaveEntry[] {
    try {
      const raw = localStorage.getItem(INDEX);
      return raw ? (JSON.parse(raw) as SaveEntry[]) : [];
    } catch {
      return [];
    }
  },
  read(key): StoredSave | null {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw ? (JSON.parse(raw) as StoredSave) : null;
    } catch {
      return null;
    }
  },
  write(key, save): boolean {
    try {
      const body = JSON.stringify(save);
      localStorage.setItem(PREFIX + key, body);
      const index = localStore.list().filter((e) => e.key !== key);
      index.unshift({
        key,
        name: save.name,
        savedAt: save.savedAt,
        year: save.meta.year,
        company: save.meta.company,
        cash: save.meta.cash,
        bytes: body.length,
        auto: save.auto,
      });
      localStorage.setItem(INDEX, JSON.stringify(index.slice(0, 40)));
      return true;
    } catch {
      // Quota, private browsing, or a save so long it will not fit. A command
      // log has to get very long indeed to reach five megabytes, but a player
      // who hits it should be told rather than silently losing the game.
      return false;
    }
  },
  remove(key): void {
    try {
      localStorage.removeItem(PREFIX + key);
      localStorage.setItem(INDEX, JSON.stringify(localStore.list().filter((e) => e.key !== key)));
    } catch {
      // nothing to do
    }
  },
};

export function saveWorld(world: World, name: string, auto = false, store: SaveStore = localStore): SaveEntry | null {
  const file = saveGame(world);
  const key = auto ? 'auto' : `${Date.now().toString(36)}`;
  const stored: StoredSave = { ...file, name, savedAt: Date.now(), auto };
  if (!store.write(key, stored)) return null;
  return store.list().find((e) => e.key === key) ?? null;
}

export interface LoadedWorld {
  world: World;
  divergences: { tick: number; expected: number; actual: number }[];
  ms: number;
}

/**
 * Rebuild a world from a save by replaying its log.
 *
 * The hash check is not decoration: if replaying the same log from the same
 * seed produces a different world, determinism has broken, and this is the
 * cheapest place in the project to find out.
 */
export function loadWorld(
  key: string,
  create: (config: SaveFile['config']) => World,
  store: SaveStore = localStore,
): LoadedWorld | null {
  const stored = store.read(key);
  if (!stored) return null;
  const t0 = performance.now();
  const { world, divergences } = loadGame(stored, create);
  return { world, divergences, ms: performance.now() - t0 };
}

export function loadFromText(
  text: string,
  create: (config: SaveFile['config']) => World,
): LoadedWorld | null {
  try {
    const file = JSON.parse(text) as SaveFile;
    if (!file || typeof file.log !== 'string' || !file.config) return null;
    const t0 = performance.now();
    const { world, divergences } = loadGame(file, create);
    return { world, divergences, ms: performance.now() - t0 };
  } catch {
    return null;
  }
}

/** Hand the player a file. The whole game, in a few kilobytes of text. */
export function downloadSave(world: World, name: string): void {
  const file = saveGame(world);
  const blob = new Blob([JSON.stringify({ ...file, name }, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${file.meta.year}.interchange.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * How many commands a save holds, and how big it is. Worth surfacing because
 * architecture.md's claim that cloud saves stop being a storage problem is a
 * claim, and a claim you can see the number for is a fact.
 */
export function saveStats(world: World): { commands: number; bytes: number; ticks: number } {
  const file = saveGame(world);
  return {
    commands: decodeLog(file.log).length,
    bytes: JSON.stringify(file).length,
    ticks: file.tick,
  };
}
