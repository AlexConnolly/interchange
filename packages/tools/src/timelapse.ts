/**
 * A whole region, 1860 to 2100, as one animated picture. features.md §14.
 *
 *   node packages/tools/src/timelapse.ts [seed] [size] [years] [out.gif]
 *
 * The feature table's note against this row is "marketing asset for nothing",
 * and *for nothing* is the load-bearing half. The simulation already runs a
 * full game headlessly in a fraction of a second and already knows where every
 * way, town and works is; the only thing between that and a two-century
 * timelapse was deciding which pixels to write. So this is a hundred lines on
 * top of work that existed, and it produces the single most useful picture of
 * the game there is — the one that shows the arc.
 *
 * What it draws is deliberately not the game's camera. An isometric three-
 * quarter view is right for playing and wrong for this: across 240 frames what
 * a viewer needs is the shape of the region and how the network grew over it,
 * and that reads far better from directly overhead. So the terrain is the same
 * tonal ground mapshot.ts uses, and everything built on it is laid over in the
 * palette's own colours.
 *
 * Frames are captured yearly, which is both a natural unit and the right one
 * visually: a network changes visibly year to year and imperceptibly day to
 * day, so a daily capture would be ninety times the file for no more
 * information.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createWorld, TICKS_PER_YEAR, SiteState, MODE_COUNT, NONE } from '@interchange/sim';
import { Biome, SEA_LEVEL } from '../../sim/src/terrain.ts';
import { loadContent } from '@interchange/data';
import { encodeGif } from './gif.ts';
import { drawText } from './png.ts';

const seed = Number(process.argv[2] ?? 1860);
const size = Number(process.argv[3] ?? 384);
const years = Number(process.argv[4] ?? 240);
const out = process.argv[5] ?? 'artefacts/timelapse.gif';

/*
 * The palette. Indices matter — everything below writes them directly — and
 * the ordering is by layer rather than by hue, so a later layer always has a
 * higher index and "draw the most important thing last" is the same statement
 * as "take the larger index".
 *
 * art-direction.md 5.2 governs the first eleven: the land is a ground, not a
 * subject, so it is desaturated and tonal, and water is the one large
 * saturated field. The network colours after it are the game's own, which is
 * what makes the timelapse read as the same product as the screen.
 */
const PALETTE: [number, number, number][] = [
  [22, 44, 74],    // 0  ocean
  [46, 86, 120],   // 1  shallows
  [206, 192, 158], // 2  beach
  [126, 140, 106], // 3  grass
  [156, 158, 106], // 4  farmland
  [124, 116, 100], // 5  moor
  [78, 100, 78],   // 6  forest
  [136, 132, 128], // 7  rock
  [226, 228, 232], // 8  snow
  [58, 104, 138],  // 9  river
  [104, 112, 92],  // 10 marsh
  [188, 172, 132], // 11 road
  [64, 58, 54],    // 12 rail
  [92, 158, 178],  // 13 water way
  [214, 118, 66],  // 14 works
  [244, 232, 210], // 15 town
  [255, 255, 255], // 16 caption
  [30, 30, 34],    // 17 caption ground
];

const OCEAN = 0;
const ROAD = 11;
const RAIL = 12;
const WATERWAY = 13;
const WORKS = 14;
const TOWN = 15;
const INK = 16;
const PAPER = 17;

/** Mode order is road, rail, canal, sea, air; air has no tiles to draw. */
const MODE_COLOUR = [ROAD, RAIL, WATERWAY, WATERWAY, RAIL];

loadContent();
const world = createWorld({ seed, size, townCount: 14, companyCount: 5 });
const terrain = world.terrain;

/** The ground, drawn once: it does not change, and redrawing it 240 times was
 *  a third of the run time. */
const ground = new Uint8Array(size * size);
for (let i = 0; i < size * size; i++) {
  ground[i] = terrain.height[i] < SEA_LEVEL ? OCEAN : (terrain.biome[i] as number);
}

const CAPTION_H = 14;
const frameW = size;
const frameH = size + CAPTION_H;
const frames: Uint8Array[] = [];

function capture(label: string): void {
  const f = new Uint8Array(frameW * frameH);
  f.set(ground);
  // Re-read the coast each frame so reclaimed land appears as it is made.
  for (let i = 0; i < size * size; i++) {
    if (terrain.height[i] >= SEA_LEVEL && f[i] === OCEAN) f[i] = Biome.Beach as number;
  }

  /*
   * Ways, by mode, in the order the modes are declared — so rail draws over
   * road where they share a tile, which is the right answer for legibility: at
   * one pixel a tile the heavier network is the one you want to see.
   */
  for (let m = 0; m < MODE_COUNT; m++) {
    const layer = world.layers[m];
    if (!layer) continue;
    const colour = MODE_COLOUR[m] ?? ROAD;
    for (let i = 0; i < size * size; i++) {
      if (layer.link[i] === NONE || layer.link[i] === undefined) continue;
      f[i] = colour;
    }
  }

  // Industry, as a two-pixel mark so a single works is visible at this scale.
  for (let s = 0; s < world.sites.count; s++) {
    if (world.sites.state[s] === SiteState.Dead) continue;
    const x = world.sites.x[s];
    const y = world.sites.y[s];
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < size && ny < size) f[ny * size + nx] = WORKS;
      }
    }
  }

  /*
   * Towns, sized by population. This is the part that makes the timelapse an
   * argument rather than a picture: a region where the towns visibly swell
   * along the lines somebody built is the whole design working, and a region
   * where they do not is a bug you can see from across the room.
   */
  for (let t = 0; t < world.towns.count; t++) {
    const r = Math.max(1, Math.min(7, Math.round(Math.sqrt(world.towns.population[t]) / 26)));
    const cx = world.towns.x[t];
    const cy = world.towns.y[t];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        f[ny * size + nx] = TOWN;
      }
    }
  }

  // And the caption strip, which is what turns 240 near-identical frames into
  // a timelapse: without a year on it a viewer cannot tell it is moving.
  for (let i = size * size; i < frameW * frameH; i++) f[i] = PAPER;
  const rgba = new Uint8Array(frameW * frameH * 4);
  drawText(rgba, frameW, frameH, label, 4, size + 4, [255, 255, 255]);
  for (let i = 0; i < frameW * frameH; i++) if (rgba[i * 4 + 3] > 0) f[i] = INK;
  frames.push(f);
}

function wayTiles(): number {
  let n = 0;
  for (let m = 0; m < MODE_COUNT; m++) {
    const layer = world.layers[m];
    if (!layer) continue;
    for (let i = 0; i < size * size; i++) {
      if (layer.link[i] !== NONE && layer.link[i] !== undefined) n++;
    }
  }
  return n;
}

const t0 = Date.now();
const from = world.year;
let population = 0;
let ways = 0;
capture(`${world.year}   the region before anybody`);
for (let y = 0; y < years; y++) {
  for (let i = 0; i < TICKS_PER_YEAR; i++) world.step();
  population = 0;
  for (let t = 0; t < world.towns.count; t++) population += world.towns.population[t];
  ways = wayTiles();
  capture(`${world.year}   ${population.toLocaleString('en-GB')} people   ${ways.toLocaleString('en-GB')} tiles of way`);
  if (y % 20 === 0) process.stdout.write(`  ${world.year} ... ${population} people, ${ways} tiles\n`);
}

const gif = encodeGif(frames, {
  width: frameW,
  height: frameH,
  palette: PALETTE,
  // Twelve frames a second: fast enough that two centuries is twenty seconds,
  // slow enough to watch a line get built.
  delay: 8,
});
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, gif);

const ms = Date.now() - t0;
console.log(`\n${frames.length} frames, ${from}-${world.year}`);
console.log(`${(gif.length / 1024 / 1024).toFixed(2)} MB -> ${out}`);
console.log(`${(ms / 1000).toFixed(1)}s for ${years} simulated years`);
console.log(`ended with ${population.toLocaleString('en-GB')} people and ${ways.toLocaleString('en-GB')} tiles of way`);
