/**
 * The simulation package. Zero browser dependencies by design: lockstep
 * requires the client, the headless server and the tooling to run byte-identical
 * simulation code (architecture.md §10), so anything that reaches for `window`
 * belongs in `render` or `client` instead.
 */

export * from './fixed.ts';
export * from './rng.ts';
export * from './hash.ts';
export * from './noise.ts';
export * from './heap.ts';
export * from './constants.ts';
export * from './terrain.ts';
export * from './network.ts';
export * from './tilerouter.ts';
export * from './pathfinding.ts';
export * from './traffic.ts';
export * from './sites.ts';
export * from './economy.ts';
export * from './commands.ts';
export * from './world.ts';
export * from './worldgen.ts';
export * from './construction.ts';
export * from './junction.ts';
export * from './utilities.ts';
export * from './objectives.ts';
export * from './rivals.ts';
export * from './seaair.ts';
export * from './stress.ts';
export * from './snapshot.ts';

import { loadContent, type Content } from '@interchange/data';
import { DEFAULT_CONFIG, type WorldConfig } from './terrain.ts';
import { World } from './world.ts';
import { generateWorld } from './worldgen.ts';

/** Build a fresh world from a seed. The only entry point anything outside
 *  this package should need. */
export function createWorld(config: Partial<WorldConfig> = {}, content?: Content): World {
  const cfg: WorldConfig = { ...DEFAULT_CONFIG, ...config };
  const w = new World(cfg, content ?? loadContent());
  generateWorld(w);
  return w;
}
export * from './regulation.ts';
export * from './weather.ts';
export * from './amenity.ts';
export * from './publicworks.ts';
export * from './reclamation.ts';
