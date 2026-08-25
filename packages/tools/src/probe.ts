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

const opening = w.planOpening();
console.log('opening pair:',
  opening.from >= 0 ? w.content.industries[w.sites.def[opening.from]].name : 'none',
  '->',
  opening.to >= 0 ? w.content.industries[w.sites.def[opening.to]].name : 'none',
  '|', opening.cargo >= 0 ? w.content.cargo[opening.cargo].name : '-');
const inset = D * 0.3;
const clamp = (v: number): number => Math.max(inset, Math.min(D - inset, v));
const cx = clamp(opening.x);
const cz = clamp(opening.y);
w.refreshInfluence([{ x: cx, y: cz, strength: 2.4 }]);
w.companies.cash[w.player] = w.content.balance.startingCash;

const yard = w.foundYard(Math.round(cx), Math.round(cz), 'Marchford Yard');
if (yard >= 0) w.yards.add(yard, Facility.Chiller);
w.primeStock();
const vi = w.openingVehicle(opening.cargo);
console.log('starting vehicle:', w.content.vehicles[vi].name,
  '£' + (w.content.vehicles[vi].cost / 100).toFixed(0));
const bought = w.buyVehicleAtYard(vi);
console.log('bought', JSON.stringify(bought),
  'cash left £' + (w.companies.cash[w.player] / 100).toFixed(0));
w.offerWorkNow();

// Why is or is not there work?
{
  const t0 = w.siteAccessTile[opening.from];
  const t1 = w.siteAccessTile[opening.to];
  const outs = opening.cargo;
  console.log('  from tile', t0, 'usable', t0 >= 0 && w.influence.usable(t0),
    'inf', t0 >= 0 ? w.influence.at(t0).toFixed(2) : '-');
  console.log('  to   tile', t1, 'usable', t1 >= 0 && w.influence.usable(t1),
    'inf', t1 >= 0 ? w.influence.at(t1).toFixed(2) : '-');
  console.log('  stock at from', w.sites.stockOf(opening.from, outs),
    'room at to', w.sites.roomFor(opening.to, outs));
  const dx = w.sites.x[opening.to] - w.sites.x[opening.from];
  const dy = w.sites.y[opening.to] - w.sites.y[opening.from];
  console.log('  distance', Math.round(Math.hypot(dx, dy)));
  let visible = 0;
  for (let i = 0; i < w.sites.count; i++) {
    const t = w.siteAccessTile[i];
    if (t >= 0 && w.influence.usable(t)) visible++;
  }
  console.log('  visible sites', visible, 'of', w.sites.count);
  console.log('  board.count', w.contractBoard.count);
  for (let i = 0; i < w.sites.count; i++) {
    const t = w.siteAccessTile[i];
    const def = w.sites.def[i];
    console.log('   site', i, w.content.industries[def].name,
      'tile', t, 'usable', t >= 0 && w.influence.usable(t));
  }
}

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


// ---- can the opening actually be played? ----------------------------------
console.log('--- the opening');
for (let i = 0; i < board.count; i++) {
  if (board.from[i] < 0) continue;
  const h = w.content.cargo[board.cargo[i]].handling;
  console.log(
    `  offer: ${w.content.cargo[board.cargo[i]].name} `
    + `${w.content.industries[w.sites.def[board.from[i]]].name} -> `
    + `${w.content.industries[w.sites.def[board.to[i]]].name} `
    + `(${h}) £${(board.pay[i] / 100).toFixed(2)} a load`,
  );
}
// Take the first one it can do and run a quarter.
let took = -1;
for (let i = 0; i < board.count; i++) {
  const d = w.driversFor(i).find((x) => x.suitable);
  if (d && w.acceptContract(i, w.player, d.vehicle)) { took = i; break; }
}
console.log(`  accepted ${took}`);
const van = w.content.vehicles[vi].cost;
let firstAffordable = -1;
for (let day = 1; day <= 300; day++) {
  for (let t = 0; t < 800; t++) w.step();
  if (firstAffordable < 0 && w.companies.cash[w.player] >= van) firstAffordable = day;
  if (day % 20 === 0) {
    console.log(
      `  day ${String(day).padStart(3)}  £${(w.companies.cash[w.player] / 100).toFixed(0)}`
      + `  delivered ${took >= 0 ? board.delivered[took] : 0}`,
    );
  }
}
console.log(`  a second van affordable on day ${firstAffordable} `
  + `(${(firstAffordable / 20).toFixed(1)} months)`);
