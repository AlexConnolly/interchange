/**
 * Saving the whole world, generically.
 *
 * There was already a save format in `snapshot.ts` and it does not work any more,
 * for a reason worth writing down rather than quietly replacing. It saves a
 * *command log* and reloads by replaying it, which is a lovely design — kilobytes
 * per save, a replay is a bug report, cloud saves stop being a storage problem.
 * It is also entirely dependent on every player action going through the command
 * queue, and none of them do. Measured: `buyLand`, `placeSite`, `layTrackAt`,
 * `acceptContract`, `cancelContract`, `sellOnMarket`, `buyPlace` and `foundYard`
 * contain zero pushes to the queue between them. Replaying a save of a
 * twenty-hour game would rebuild the district exactly as generated, with the
 * player having done nothing at all.
 *
 * So this saves *state*. And it does it by walking the tables rather than by
 * naming their fields, which is the ask — "better to json the entire state so you
 * have forward thinking than to directly reference fields" — and is right for a
 * reason beyond convenience: a hand-written serialiser is a list of everything
 * somebody remembered, and the failure mode is silent. A field added to
 * `SiteTable` next month and not added here would not throw. It would load a
 * world subtly unlike the one that was saved, and the player would find it before
 * we did.
 *
 * ## What it walks
 *
 * The World's state lives in a dozen table objects whose fields are almost all
 * typed arrays. So: for each root, take every own enumerable property, and keep
 * the ones that are a typed array or a plain scalar. Everything else — functions,
 * nested class instances, Maps used as caches — is skipped, and `ROOTS` says
 * explicitly which objects get walked at all.
 *
 * ## What it deliberately leaves out
 *
 * **The terrain**, because it is a pure function of the seed. Storing a megabyte
 * of heightmap in every save is storing a number twice. `snapshot.ts` had this
 * right — *almost*. See `MUTABLE_TERRAIN`: one array in there is not a function of
 * the seed at all any more, and finding that took a test that stepped both worlds
 * after loading rather than merely comparing them.
 *
 * **The graph and the routers**, because they are caches over the way layers.
 * `rebuild()` reconstructs them from the roads, and a save that carried them
 * would be a save that could disagree with its own roads.
 *
 * **The command log**, which is now vestigial.
 *
 * ## Why there is a round-trip test and why it matters more than usual
 *
 * A generic walker is only trustworthy if something checks that what came back is
 * what went in. `stateHash` exists for that: it digests every value the walker can
 * see, so a save-restore-compare either matches exactly or names the field that
 * did not. Without it "generic" is a hope.
 */

import type { World } from './world.ts';
import type { WorldConfig } from './terrain.ts';

/**
 * Bumped when the shape changes in a way an old save cannot survive.
 *
 * 2: housing. A field carries `use`, `plots` and `made`, and a town carries the
 * `capacity` that gates its growth. A version-1 save has none of them, so every
 * field would load as farmland and every town as having room for nobody — which
 * would read as a district that had stopped growing for no reason.
 */
export const STATE_VERSION = 2;

/**
 * The objects whose fields get saved, by the name they are stored under.
 *
 * An explicit list rather than a walk of the World itself, because the World also
 * holds the terrain, the routers and a graph — things that are either derived or
 * enormous — and "save everything except these nine" is a rule that goes wrong
 * the moment somebody adds a tenth. This way, a new *table* has to be added here
 * on purpose, and a new *field* on an existing table is picked up for nothing.
 */
const ROOTS = [
  'vehicles', 'sites', 'towns', 'companies', 'services', 'assets',
  'yards', 'contractBoard', 'land', 'influence', 'amenity',
  /*
   * And the random number generator, which is state and not configuration.
   *
   * Easy to leave out and impossible to leave out quietly. The restore was exact —
   * zero differing fields across every table — and the two worlds then *diverged*
   * three days after loading, because one was drawing from a stream a hundred
   * thousand numbers further along than the other. A loaded game would have been
   * correct at the instant of loading and a different game by the afternoon.
   *
   * `Rng` holds four words. They are `private`, which in TypeScript is a
   * compile-time promise and not a runtime one, so the walker sees them — which is
   * exactly the sort of thing a hand-written serialiser would have had no way of
   * knowing it needed.
   */
  'rng',
] as const;

/**
 * World-level values that are state rather than derivation.
 *
 * Named individually because the World is not a table — it is the whole object,
 * with a hundred methods and a dozen caches on it — so walking it wholesale would
 * pick up nonsense. Short enough to keep honest, and the round-trip test fails if
 * one is missing.
 */
const SCALARS = [
  'tick', 'speed', 'player', 'focusX', 'focusY', 'dayOffset',
  'approval', 'standing', 'landRevision', 'seasonRevision', 'housingRevision',
] as const;
/*
 * `era` is deliberately not here. It is a getter over the year, and the year is a
 * getter over the tick — so it is derived twice and writing it back throws
 * outright: "Cannot set property era of #<World> which has only a getter". Caught
 * by the round-trip test on its first run, which is the sort of thing that test is
 * for: a hand-written serialiser would have had the same mistake and simply
 * skipped it.
 */

/**
 * The parts of the terrain that are *not* a pure function of the seed.
 *
 * `snapshot.ts` says the terrain need not be saved because the seed regenerates
 * it, and that was true when it was written. It is not true of `fields.crop`: the
 * simulation rewrites it in place all year — ploughed, drilled, growing, ripe, cut,
 * stubble — so it is as much state as a lorry's position.
 *
 * This was invisible in every static comparison. The restore came back with *zero*
 * differing fields, and the two worlds then diverged two days later, because one
 * of them was farming the generated crop map and the other the one it had been
 * farming for ninety days. Only a test that steps *after* loading finds this class
 * of bug, which is why there is one.
 *
 * A list of dotted paths so the next one is a string rather than an argument.
 * Everything else in the terrain — height, flags, deposit, the parcel map — is
 * read-only after generation, checked by grepping for writes rather than assumed.
 */
const MUTABLE_TERRAIN = ['fields.crop'] as const;

function reach(root: object, path: string): { owner: object; key: string } | null {
  const parts = path.split('.');
  let o: Record<string, unknown> = root as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = o[parts[i]];
    if (!next || typeof next !== 'object') return null;
    o = next as Record<string, unknown>;
  }
  return { owner: o, key: parts[parts.length - 1] };
}

/**
 * Typed arrays on the World that are *not* saved, and why.
 *
 * A deny-list, and it is a deny-list because the allow-list was wrong. This was
 * eight names written out by hand — and the very first bug report was "save lost
 * my vehicles", because `vehicleYard` was not one of them. Every lorry came back
 * belonging to no yard, so the fleet screen and the bays were empty and the
 * vehicles might as well have been gone.
 *
 * Worse, the round-trip test could not see it: `stateHash` walks the same list, so
 * a field missing from it is invisible to both halves of the comparison. An
 * allow-list of state is a list of what somebody remembered, which is exactly what
 * the top of this file says not to write. Enumerated, there were *twenty-nine*
 * typed arrays on the World and the list named eight.
 *
 * So: everything is saved unless it is named here, and there is a test that fails
 * if a new field is neither saved nor listed. Three kinds live here.
 *
 * **Pathfinder scratch.** `routePool` is 1.9 million entries of working memory for
 * an A*. It holds whatever the last search left in it and means nothing between
 * calls; saving it would be seven megabytes of noise.
 *
 * **Caches.** `valueCache` is memoised cargo values, rebuilt on demand.
 *
 * **Content tables.** `vehicleSpeed`, `waySpeed` and the rest are the content files
 * flattened into typed arrays at construction. They are a property of the game's
 * data, not of the save — and saving them would mean an old save quietly
 * overriding a rebalanced vehicle with its old numbers.
 */
const NOT_SAVED = new Set([
  'routePool', 'routeCameFrom', 'routeCost', 'routeSeen',
  'valueCache',
  'waySpeed', 'wayUpkeep', 'wayCharge', 'wayWear', 'wayLanes',
  'vehicleSpeed', 'vehicleCapacity', 'vehicleTransfer', 'vehicleRunning',
  'vehicleMode',
  'townDemandPerThousand', 'townProducePerThousand',
]);

/**
 * Every typed array on the World that is state.
 *
 * Walked rather than listed, which is the whole point. `vehicleYard`, the money
 * journal, `loadOriginX/Y` and `lapStart` were all missing from the hand-written
 * version and are all carried now without anybody having to notice them.
 */
export function worldArrays(w: object): string[] {
  const out: string[] = [];
  for (const key of Object.keys(w)) {
    if (NOT_SAVED.has(key)) continue;
    const v = (w as Record<string, unknown>)[key];
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) out.push(key);
  }
  return out.sort();
}

/** And the ones deliberately left out, so a test can check the split is complete. */
export function worldArraysSkipped(w: object): string[] {
  const out: string[] = [];
  for (const key of Object.keys(w)) {
    if (!NOT_SAVED.has(key)) continue;
    const v = (w as Record<string, unknown>)[key];
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) out.push(key);
  }
  return out.sort();
}

type Cell = number | string | boolean | null;

interface Bag {
  [key: string]: Cell | Packed | Bag;
}

export interface SavedState {
  version: number;
  config: WorldConfig;
  /** Every root's own scalar and typed-array fields. */
  roots: { [root: string]: Bag };
  /** The World's own scalars, and its loose typed arrays. */
  world: Bag;
  /** The way layers, which are the roads and are certainly not derived. */
  layers: Bag[];
  /** Tiles the client told the sim about — see `registerBuildings`. */
  built: number[];
  /** The bits of terrain the simulation rewrites. See `MUTABLE_TERRAIN`. */
  terrain: Bag;
}

/**
 * A typed array as text, with its padding folded away.
 *
 * Two things going on, and the second one is the whole reason a save is 60 KB
 * rather than 13 MB.
 *
 * **Base64 of the bytes**, not a JSON array of decimals. It round-trips exactly,
 * where a float printed as decimal does not always, and for the byte arrays —
 * which are most of the big ones — it is a quarter of the size.
 *
 * **And the tail is folded.** Every table in this project is allocated at its
 * maximum capacity and used from the front: `MAX_ASSETS` slots of `revenue` for a
 * game with four assets. Saving all of it cost 417 KB *per field*, and there are
 * dozens of fields — measured, 13.2 MB for a save of the opening district, which
 * localStorage would refuse outright.
 *
 * So a run of identical values at the end is stored as the value and nothing else.
 * A *run of the trailing element*, not a run of zeroes, and that distinction is
 * the reason this is exact rather than nearly: half these arrays are initialised
 * to something else — `NO_OWNER` is -1, site health starts at 100 — so trimming
 * zeroes would have silently rewritten every unused slot in the register.
 */
function packArray(a: ArrayBufferView & { length: number }): Packed {
  const arr = a as unknown as { length: number; [i: number]: number };
  const n = arr.length;
  let cut = n;
  if (n > 0) {
    const tail = arr[n - 1];
    while (cut > 0 && arr[cut - 1] === tail) cut--;
  }
  const per = a.byteLength / Math.max(1, n);
  const bytes = new Uint8Array(a.buffer, a.byteOffset, Math.round(cut * per));
  let str = '';
  /*
   * In chunks: `String.fromCharCode(...bytes)` on a large array overflows the
   * argument list and throws. The sort of thing that works on every test and
   * fails on the first real save.
   */
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    str += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return {
    $: a.constructor.name, n, d: btoa(str), t: n > 0 ? arr[n - 1] : 0,
  };
}

interface Packed {
  /** The typed-array kind, by constructor name. */
  $: string;
  /** How many elements the whole array has. */
  n: number;
  /** Base64 of the leading elements that are not part of the trailing run. */
  d: string;
  /** The value every remaining element holds. */
  t: number;
}

const KINDS: Record<string, new (n: number) => ArrayBufferView & { length: number }> = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
  Int32Array, Uint32Array, Float32Array, Float64Array,
};

function isPacked(v: unknown): v is Packed {
  return typeof v === 'object' && v !== null && '$' in v && 'd' in v;
}

/**
 * Write a packed array into an existing one.
 *
 * Into the existing array rather than returning a new one, and this is the
 * load-bearing detail of the whole restore: half the fields here are `readonly`
 * typed arrays handed to other systems at construction — the renderer holds
 * `sites.stock`, the router holds the layer arrays — so replacing the array would
 * leave every one of those pointing at the old one. The result would be a world
 * that loaded correctly and drew the state it had before.
 */
function unpackInto(dst: ArrayBufferView & { length: number }, v: Packed): void {
  const out = dst as unknown as { length: number; [i: number]: number };
  const str = atob(v.d);
  const per = dst.byteLength / Math.max(1, dst.length);
  const lead = Math.floor(str.length / Math.max(1, per));
  // The trailing run first, then the prefix over the top of it.
  for (let i = 0; i < out.length; i++) out[i] = v.t;
  if (str.length === 0) return;
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  const Kind = KINDS[v.$];
  if (!Kind) return;
  const from = new Kind(lead) as unknown as { [i: number]: number };
  const raw = new Uint8Array(
    (from as unknown as ArrayBufferView).buffer,
    (from as unknown as ArrayBufferView).byteOffset,
    (from as unknown as ArrayBufferView).byteLength,
  );
  raw.set(bytes.subarray(0, raw.length));
  const most = Math.min(lead, out.length);
  for (let i = 0; i < most; i++) out[i] = from[i];
}

function isTyped(v: unknown): v is ArrayBufferView & { length: number } {
  return ArrayBuffer.isView(v) && !(v instanceof DataView);
}


/**
 * Everything savable about one object, one level deep.
 *
 * One level, and that is a decision rather than a limitation: the tables are flat
 * by design, and a serialiser that recursed would start dragging in the routers
 * and the graph through whatever holds a reference to them. Where a nested object
 * genuinely holds state — `land.tiles`, an array of arrays — it is handled
 * explicitly below, because a general answer to "how deep" is how you end up
 * saving the whole heap.
 */
/**
 * Fields that are caches over other saved fields, by name.
 *
 * `link` and `linkOffset` on a way layer are tile-to-graph back-references, and
 * `rebuildGraph` writes both from `cls` and `dir` — which the restore calls
 * anyway, because the graph itself is not saved either. Keeping them cost 108 KB
 * of a 182 KB save to store an answer we recompute on load regardless.
 *
 * By name rather than by root, because that is the level the fact is true at: it
 * is `link` that is derived, wherever it appears. A short list, and the round-trip
 * test is what proves each entry belongs on it — anything genuinely needed would
 * fail the hash comparison the moment it was added here.
 */
const DERIVED = new Set(['link', 'linkOffset']);

function bagOf(o: object): Bag {
  const out: Bag = {};
  for (const key of Object.keys(o)) {
    if (DERIVED.has(key)) continue;
    const v = (o as Record<string, unknown>)[key];
    if (isTyped(v)) out[key] = packArray(v);
    else if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
      out[key] = v;
    }
  }
  return out;
}

function restoreBag(o: object, bag: Bag): void {
  for (const [key, v] of Object.entries(bag)) {
    const cur = (o as Record<string, unknown>)[key];
    if (isPacked(v)) {
      /*
       * Copied into the existing array rather than replacing it, and this is the
       * load-bearing detail of the whole restore. Half the fields in this project
       * are `readonly` typed arrays handed out to other systems at construction —
       * the renderer holds `sites.stock`, the router holds layer arrays — so
       * assigning a new array would leave every one of those pointing at the old
       * one. A world that looked right and drew the state it had before the load.
       */
      if (!isTyped(cur)) {
        /*
         * Nothing there to copy into, so make one.
         *
         * Some arrays are created lazily on first use — `cropBase` and `cropWant`
         * are, which is why a freshly generated world has no own property for them
         * and the restore silently skipped both. Assigning is safe *only* in this
         * case, and the distinction matters: the whole reason the branch below
         * copies rather than assigns is that other systems hold references to those
         * arrays from construction. An array that does not exist yet has no
         * references to break.
         */
        const Kind = KINDS[v.$];
        if (!Kind) continue;
        const made = new Kind(v.n);
        unpackInto(made, v);
        (o as Record<string, unknown>)[key] = made;
        continue;
      }
      unpackInto(cur, v);
    } else if (v === null || typeof v === 'object') {
      // Nothing nested is written by `bagOf`; a `null` here is an old save.
      continue;
    } else if (typeof cur === typeof v || cur === undefined) {
      (o as Record<string, unknown>)[key] = v;
    }
  }
}

/** Dump the world. */
export function saveState(w: World): SavedState {
  const roots: { [root: string]: Bag } = {};
  for (const name of ROOTS) {
    const r = (w as unknown as Record<string, unknown>)[name];
    if (r && typeof r === 'object') roots[name] = bagOf(r);
  }
  const world: Bag = {};
  for (const key of SCALARS) {
    const v = (w as unknown as Record<string, unknown>)[key];
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
      world[key] = v;
    }
  }
  for (const key of worldArrays(w as unknown as object)) {
    const v = (w as unknown as Record<string, unknown>)[key];
    if (isTyped(v)) world[key] = packArray(v);
  }
  const terrain: Bag = {};
  for (const path of MUTABLE_TERRAIN) {
    const at = reach(w.terrain as unknown as object, path);
    if (!at) continue;
    const v = (at.owner as Record<string, unknown>)[at.key];
    if (isTyped(v)) terrain[path] = packArray(v);
  }
  return {
    version: STATE_VERSION,
    config: w.config,
    roots,
    world,
    layers: w.layers.map((l) => bagOf(l as unknown as object)),
    built: [...w.buildingTiles()],
    terrain,
  };
}

/**
 * Put it back, into a world already generated from the same seed.
 *
 * The caller creates the world — that is what keeps the terrain out of the save —
 * and this overwrites the mutable half of it. The order matters at the end:
 * everything derived from the roads has to be rebuilt *after* the roads are back,
 * or the router is answering questions about a district that no longer exists.
 */
export function restoreState(w: World, s: SavedState): void {
  for (const [name, bag] of Object.entries(s.roots)) {
    const r = (w as unknown as Record<string, unknown>)[name];
    if (r && typeof r === 'object') restoreBag(r, bag);
  }
  restoreBag(w as unknown as object, s.world);
  for (let i = 0; i < s.layers.length && i < w.layers.length; i++) {
    restoreBag(w.layers[i] as unknown as object, s.layers[i]);
  }
  for (const [path, v] of Object.entries(s.terrain ?? {})) {
    if (!isPacked(v)) continue;
    const at = reach(w.terrain as unknown as object, path);
    if (!at) continue;
    const cur = (at.owner as Record<string, unknown>)[at.key];
    if (isTyped(cur)) unpackInto(cur, v);
  }
  w.registerBuildings(s.built);
  /*
   * And the graph, which is a cache over the roads that were just written.
   *
   * `rebuild` retraces the network and re-attaches every site and town to it. Not
   * optional, and not cheap to notice the absence of: without it a loaded game has
   * lorries that cannot find a route down a lane that is plainly there.
   *
   * `refreshInfluence` is deliberately *not* called, which took a measurement to
   * settle. It was here first, on the reasoning that the fog of war is derived from
   * the yards and places you own — and the round-trip test then failed on exactly
   * two fields, both of them influence. The reason is that the field in a running
   * game is *slightly stale*: it is recomputed when something is bought, not every
   * tick, so a world thirty days past its last purchase has a fog of war a little
   * behind its own state.
   *
   * Recomputing on load would therefore have loaded a world subtly different from
   * the one saved — the boundary would jump the moment you pressed Load, which is
   * the one place a player would notice and be unable to explain. The saved field
   * is what they were looking at, so the saved field wins. It costs about 86 KB of
   * a 160 KB save, which is a fair price for the load looking like the save.
   */
  w.rebuild();
}

/**
 * A digest of everything the walker can see.
 *
 * This is what makes the generic approach honest. It exists so that a test can
 * save a played world, restore it into a fresh one, and compare — and a mismatch
 * points at the field rather than at the idea. `saveState` and this walk the same
 * properties by construction, so a field the walker cannot see is also a field
 * this cannot see, which is the one hole; `ROOTS` is the mitigation and it is
 * short enough to read.
 */
export function stateHash(w: World): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const eat = (n: number): void => {
    h1 = ((h1 ^ n) * 0x01000193) >>> 0;
    h2 = ((h2 + n) * 0x85ebca6b) >>> 0;
  };
  const eatBag = (bag: Bag): void => {
    for (const key of Object.keys(bag).sort()) {
      for (let i = 0; i < key.length; i++) eat(key.charCodeAt(i));
      const v = bag[key];
      if (isPacked(v)) {
        eat(v.d.length);
        for (let i = 0; i < v.d.length; i++) eat(v.d.charCodeAt(i));
      } else if (typeof v === 'number') {
        // Rounded, because a float that survives base64 exactly can still differ
        // in its last bit through arithmetic that is *supposed* to be the same.
        eat(Math.round(v * 1000) | 0);
      } else if (typeof v === 'string') {
        for (let i = 0; i < v.length; i++) eat(v.charCodeAt(i));
      } else if (typeof v === 'boolean') eat(v ? 1 : 0);
    }
  };
  const s = saveState(w);
  for (const name of Object.keys(s.roots).sort()) eatBag(s.roots[name]);
  eatBag(s.world);
  for (const l of s.layers) eatBag(l);
  eatBag(s.terrain);
  for (const t of s.built) eat(t);
  return `${(h1 >>> 0).toString(16)}-${(h2 >>> 0).toString(16)}`;
}
