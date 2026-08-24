/**
 * Dump a generated region as a picture. Run it after touching anything in
 * `terrain.ts` — a coastline that has gone wrong is invisible in the numbers
 * and obvious in one glance.
 *
 *   node packages/tools/src/mapshot.ts [seed] [size]
 */

import { mkdirSync } from 'node:fs';
import { generateTerrain, Biome, TileFlag, SEA_LEVEL, DEPOSIT_NAMES } from '../../sim/src/terrain.ts';
import { writePng, drawText } from './png.ts';

const seed = Number(process.argv[2] ?? 1860);
const size = Number(process.argv[3] ?? 512);

const t0 = Date.now();
const terrain = generateTerrain({ size, seed, townCount: 14, companyCount: 4 });
const ms = Date.now() - t0;

// Desaturated and tonal, per art-direction.md §5.2: the land is a ground, not
// a subject, and water is the one large saturated field.
const BIOME_RGB: [number, number, number][] = [
  [22, 44, 74], // ocean
  [46, 86, 120], // shallows
  [206, 192, 158], // beach
  [126, 140, 106], // grass
  [156, 158, 106], // farmland
  [124, 116, 100], // moor
  [78, 100, 78], // forest
  [136, 132, 128], // rock
  [226, 228, 232], // snow
  [58, 104, 138], // river
  [104, 112, 92], // marsh
];

const rgba = new Uint8Array(size * size * 4);
let maxH = 0;
for (let i = 0; i < size * size; i++) if (terrain.height[i] > maxH) maxH = terrain.height[i];

for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const b = terrain.biome[i];
    const base = BIOME_RGB[b] ?? [255, 0, 255];
    // Hillshade from the west-north-west, which is where the key light sits.
    const hx = terrain.heightAt(x - 1, y) - terrain.heightAt(x + 1, y);
    const hy = terrain.heightAt(x, y - 1) - terrain.heightAt(x, y + 1);
    const shade = terrain.height[i] > SEA_LEVEL ? Math.max(-60, Math.min(60, (hx * 2 + hy) >> 1)) : 0;
    const lift = terrain.height[i] > SEA_LEVEL ? Math.min(40, terrain.height[i] >> 5) : 0;
    const o = i * 4;
    rgba[o] = clamp(base[0] + shade + lift);
    rgba[o + 1] = clamp(base[1] + shade + lift);
    rgba[o + 2] = clamp(base[2] + shade + lift);
    rgba[o + 3] = 255;
  }
}

// Deposits and towns are the things the economy is built on, so they get the
// saturated marks — the same discipline the renderer uses.
for (const d of terrain.deposits) dot(d.x, d.y, 2, [216, 132, 60]);
for (const town of terrain.towns) {
  dot(town.x, town.y, 4, [232, 76, 60]);
  drawText(rgba, size, size, town.name, town.x + 6, town.y - 3, [255, 255, 255], 1);
}

drawText(rgba, size, size, `SEED ${seed}  ${size}X${size}  ${ms}MS`, 6, 6, [255, 255, 255], 1);

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function dot(x: number, y: number, r: number, rgb: [number, number, number]): void {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= size || py >= size) continue;
      const o = (py * size + px) * 4;
      rgba[o] = rgb[0];
      rgba[o + 1] = rgb[1];
      rgba[o + 2] = rgb[2];
    }
  }
}

mkdirSync('art/out', { recursive: true });
const path = `art/out/region-${seed}-${size}.png`;
writePng(path, size, size, rgba);

// ---- report ------------------------------------------------------------
let land = 0;
let buildable = 0;
let river = 0;
const biomeCount = new Array(11).fill(0);
for (let i = 0; i < size * size; i++) {
  if (terrain.height[i] > SEA_LEVEL) land++;
  if ((terrain.flags[i] & TileFlag.Buildable) !== 0) buildable++;
  if ((terrain.flags[i] & TileFlag.River) !== 0) river++;
  biomeCount[terrain.biome[i]]++;
}
const pct = (n: number): string => ((n / (size * size)) * 100).toFixed(1) + '%';

console.log(`wrote ${path}  (${ms} ms)`);
console.log(`land ${pct(land)}   buildable ${pct(buildable)}   river ${pct(river)}   peak ${(maxH / 2) | 0} m`);
console.log(
  'biomes  ' +
    biomeCount
      .map((c, i) => `${['sea', 'shal', 'bch', 'grs', 'farm', 'moor', 'for', 'rock', 'snow', 'riv', 'mrsh'][i]} ${pct(c)}`)
      .join('  '),
);
console.log(`towns ${terrain.towns.length}: ` + terrain.towns.map((t) => `${t.name}(${t.population})`).join(', '));
const byKind = new Map<number, number>();
for (const d of terrain.deposits) byKind.set(d.kind, (byKind.get(d.kind) ?? 0) + 1);
console.log(
  `deposits ${terrain.deposits.length}: ` +
    [...byKind.entries()].sort((a, b) => a[0] - b[0]).map(([k, c]) => `${DEPOSIT_NAMES[k]} ${c}`).join(', '),
);
if (land < size * size * 0.18) console.log('WARNING: less than 18% land — the island is too small to play on');
if (terrain.towns.length < 8) console.log('WARNING: fewer than 8 towns placed');

const bands = [0, 50, 100, 200, 400, 700, 1200, 2000, 3200, 99999];
const hist = new Array(bands.length - 1).fill(0);
for (let i = 0; i < size * size; i++) {
  const h = terrain.height[i];
  if (h <= SEA_LEVEL) continue;
  for (let b = 0; b < bands.length - 1; b++) {
    if (h >= bands[b] && h < bands[b + 1]) { hist[b]++; break; }
  }
}
console.log('height (m)  ' + hist.map((c, b) => `${bands[b] / 2}-${bands[b + 1] === 99999 ? '+' : bands[b + 1] / 2} ${((c / land) * 100).toFixed(0)}%`).join('  '));
