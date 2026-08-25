/**
 * A scratch probe. Not a test — a way of asking the world a question in the
 * terminal when the answer would otherwise need a browser and a mouse.
 *
 *   node --experimental-strip-types packages/tools/src/probe.ts
 *
 * Kept in the repo rather than in a temp directory because the workspace's
 * relative imports only resolve from inside it, and because the questions it
 * asks tend to be worth asking twice.
 */

import { createWorld, Facility, Mode, NO_WAY, snowCover, DAYS_PER_YEAR } from '../../sim/src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

const D = 128;
const w = createWorld({ seed: 1985, size: D, townCount: 3, companyCount: 1 });

let best = 0;
for (let t = 1; t < w.towns.count; t++) {
  if (w.towns.population[t] > w.towns.population[best]) best = t;
}
const inset = D * 0.3;
const clamp = (v: number): number => Math.max(inset, Math.min(D - inset, v));
const cx = clamp(w.towns.x[best]);
const cz = clamp(w.towns.y[best]);
w.refreshInfluence([{ x: cx, y: cz, strength: 2.4 }]);
w.companies.cash[w.player] = w.content.balance.startingCash;
const yard = w.foundYard(Math.round(cx), Math.round(cz), 'Marchford Yard');
if (yard >= 0) w.yards.add(yard, Facility.Chiller);
const vi = w.content.vehicles.findIndex((v) => v.id === 'rigid-box');
w.buyVehicleAtYard(vi);
w.offerWorkNow();

// ---- routes follow roads ---------------------------------------------------
const layer = w.layers[Mode.Road];
const board = w.contractBoard;
console.log('--- route preview');
let checked = 0;
for (let i = 0; i < board.count; i++) {
  const from = board.from[i];
  const to = board.to[i];
  if (from < 0 || to < 0) continue;
  const path = w.previewRoute(from, to);
  const offRoad = path.filter((t) => layer.cls[t] === NO_WAY).length;
  // Contiguity: every step must be a four-neighbour of the last, or the drawn
  // line jumps a gap and the preview is a lie.
  let breaks = 0;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1];
    const b = path[k];
    const d = Math.abs((a % D) - (b % D)) + Math.abs(Math.floor(a / D) - Math.floor(b / D));
    if (d !== 1) breaks++;
  }
  console.log(
    `  ${w.content.industries[w.sites.def[from]].name} -> `
    + `${w.content.industries[w.sites.def[to]].name}: `
    + `${path.length} tiles, ${offRoad} off-road, ${breaks} breaks`,
  );
  checked++;
}
if (checked === 0) console.log('  (no offers on the board)');

// ---- the season ------------------------------------------------------------
console.log('--- snow through the year');
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const row: string[] = [];
for (let mo = 0; mo < 12; mo++) {
  const day = Math.round((mo / 12) * DAYS_PER_YEAR);
  row.push(`${months[mo]} ${snowCover(day).toFixed(2)}`);
}
console.log(`  ${row.join('  ')}`);
