/**
 * A scratch probe. Not a test — a way of asking the world a question in the
 * terminal when the answer would otherwise need a browser and a mouse.
 *
 *   node --experimental-strip-types packages/tools/src/probe.ts
 *
 * Kept in the repo rather than in a temp directory because the workspace's
 * relative imports only resolve from inside it, and because the questions it
 * asks tend to be worth asking twice. It has already caught four things a
 * screenshot could not: an empty contract board, a route that ignored every
 * road in the district, a second van eight months away, and farms that were
 * never generated at all.
 */

import {
  createWorld, Mode, NO_WAY, snowCover, DAYS_PER_YEAR, TICKS_PER_DAY,
  facilitiesFor, Works, PLANNING_FROM_VEHICLES,
} from '../../sim/src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

const D = 128;
const w = createWorld({ seed: 1985, size: D, townCount: 3, companyCount: 1 });
w.tick = 60 * TICKS_PER_DAY;

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
w.primeStock();

const yard = w.foundYard(Math.round(cx), Math.round(cz), 'Marchford Yard');
const vi = w.openingVehicle(opening.cargo);
if (yard >= 0) {
  const v = w.content.vehicles[vi];
  w.yards.add(yard, facilitiesFor({
    handling: v.handling as readonly string[], cls: v.class,
  }));
}
w.buyVehicleAtYard(vi, yard);
w.offerWorkNow();
console.log('starting vehicle:', w.content.vehicles[vi].name,
  '| cash left £' + (w.companies.cash[w.player] / 100).toFixed(0));

// ---- routes follow roads ---------------------------------------------------
const layer = w.layers[Mode.Road];
const board = w.contractBoard;
console.log('--- route preview');
for (let i = 0; i < board.count; i++) {
  const from = board.from[i];
  const to = board.to[i];
  if (from < 0 || to < 0) continue;
  const path = w.previewRoute(from, to);
  const offRoad = path.filter((t) => layer.cls[t] === NO_WAY).length;
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
}

// ---- the season ------------------------------------------------------------
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const row: string[] = [];
for (let mo = 0; mo < 12; mo++) {
  row.push(`${months[mo]} ${snowCover(Math.round((mo / 12) * DAYS_PER_YEAR)).toFixed(2)}`);
}
console.log('--- snow through the year');
console.log(`  ${row.join('  ')}`);

// ---- the opening actually plays --------------------------------------------
console.log('--- the opening');
for (let i = 0; i < board.count; i++) {
  if (board.from[i] < 0) continue;
  console.log(
    `  offer: ${w.content.cargo[board.cargo[i]].name} `
    + `${w.content.industries[w.sites.def[board.from[i]]].name} -> `
    + `${w.content.industries[w.sites.def[board.to[i]]].name} `
    + `(${w.content.cargo[board.cargo[i]].handling}) `
    + `£${(board.pay[i] / 100).toFixed(2)}/t`,
  );
}
let took = -1;
for (let i = 0; i < board.count; i++) {
  const d = w.driversFor(i).find((x) => x.suitable);
  if (d && w.acceptContract(i, w.player, d.vehicle)) { took = i; break; }
}
console.log(`  accepted ${took}`);

const van = w.content.vehicles[vi].cost;
let secondVan = -1;
for (let day = 1; day <= 260; day++) {
  for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
  w.takeEarnings();
  if (secondVan < 0 && w.companies.cash[w.player] >= van) secondVan = day;
}
console.log(`  a second van affordable on day ${secondVan}`);
console.log(`  after 260 days: £${(w.companies.cash[w.player] / 100).toFixed(0)}`
  + `, approval ${w.approval.toFixed(1)}, fleet ${w.fleetSize()}`);

// ---- rung 6: the distribution centre ---------------------------------------
console.log('--- rung 6: a distribution centre');
w.companies.cash[w.player] = 20_000_000;
let placed: { site: number; reason: string } = { site: -1, reason: 'not tried' };
for (let r = 4; r <= 16 && placed.site < 0; r++) {
  for (let a = 0; a < 24 && placed.site < 0; a++) {
    const ang = (a / 24) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(ang) * r);
    const z = Math.round(cz + Math.sin(ang) * r);
    const t = w.foundDepot(x, z, 'Marchford Depot');
    if (t.site >= 0) placed = t; else placed.reason = t.reason;
  }
}
console.log(`  founded: site ${placed.site} (${placed.reason || 'ok'})`);
if (placed.site >= 0) {
  const t = w.siteAccessTile[placed.site];
  console.log(`  on the road: ${layer.cls[t] !== NO_WAY}`
    + `, is a depot: ${w.isDepot(placed.site)}`
    + `, yards now: ${w.yards.count}`);
  // A depot hands back what it was given: put dairy in and see who wants it.
  const dairy = w.content.cargoIndex.get('dairy') ?? 0;
  w.sites.addStock(placed.site, dairy, 40);
  const takers = w.buyersFor(placed.site);
  console.log(`  holding 40 t of dairy, buyers found: ${takers.length}`
    + (takers.length > 0
      ? ` (nearest ${w.content.industries[w.sites.def[takers[0].site]].name})`
      : ''));
}

// ---- rung 7: the planning board --------------------------------------------
console.log('--- rung 7: the parish');
console.log(`  board opens at ${PLANNING_FROM_VEHICLES} vehicles;`
  + ` fleet is ${w.fleetSize()}, open: ${w.planningOpen()}`);
const boxIdx = w.content.vehicles.findIndex((v) => v.id === 'rigid-box');
for (let i = 0; i < 3; i++) w.buyVehicleAtYard(boxIdx, w.yards.count > 1 ? 1 : 0);
console.log(`  after buying: fleet ${w.fleetSize()}, open: ${w.planningOpen()}`);

const before = w.approval;
for (let i = 0; i < 6; i++) w.fundParish(1_000_000);
console.log(`  approval ${before.toFixed(1)} -> ${w.approval.toFixed(1)}`
  + ' after £60,000 of funding (diminishing on purpose)');

// Own something out on a lane, which is what a real player would have by now:
// the depot landed next to the yard on the best road, so the pair had nothing
// to widen and the test was measuring an empty case.
if (opening.from >= 0) {
  w.sites.owner[opening.from] = w.player;
  w.refreshInfluence();
}
w.approval = 90;
const list = w.proposals();
console.log(`  proposals at 90 approval: ${list.length}`);
for (const p of list) {
  console.log(`    ${p.label}: £${(p.cost / 100).toFixed(0)}, needs ${p.approval}, `
    + `ok ${p.ok}${p.reason ? ' - ' + p.reason : ''}`);
}
// What classes are actually on the ground, and which is "best"?
{
  const counts = new Map<number, number>();
  for (let t = 0; t < D * D; t++) {
    const c = layer.cls[t];
    if (c === NO_WAY) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [c, n] of [...counts].sort((a, b) => a[0] - b[0])) {
    parts.push(`${w.content.ways[c].id}(${c}) ${n}`);
  }
  console.log(`  road tiles by class: ${parts.join(', ')}`);
  const mine: number[] = [];
  for (let i = 0; i < w.sites.count; i++) if (w.sites.owner[i] === w.player) mine.push(i);
  console.log(`  sites you own: ${mine.length}, yards: ${w.yards.count}`);
  const handles: number[] = [...mine];
  for (let y = 0; y < w.yards.count; y++) {
    if (w.yards.owner[y] === w.player) handles.push(-1 - y);
  }
  const tileOf2 = (h: number): number =>
    (h >= 0 ? w.siteAccessTile[h] : w.yards.tile[-1 - h]);
  for (let i = 0; i < handles.length; i++) {
    for (let j = i + 1; j < handles.length; j++) {
      const a = tileOf2(handles[i]);
      const b = tileOf2(handles[j]);
      const path = w.roadRoute(a, b);
      const classes = new Set(path.map((t) => layer.cls[t]));
      console.log(`    pair ${handles[i]}(${a}) -> ${handles[j]}(${b}): `
        + `path ${path.length}, classes {${[...classes].join(',')}}`);
    }
  }
}
const widen = list.find((p) => p.works === Works.Widen && p.ok);
if (widen) {
  const count = (c: number): number => {
    let n = 0;
    for (let t = 0; t < D * D; t++) if (layer.cls[t] === c) n++;
    return n;
  };
  const roadBefore = count(2);
  const r = w.propose(widen.works, widen.from, widen.to);
  console.log(`  widened "${widen.label}": ${r.ok}${r.reason ? ' - ' + r.reason : ''}; `
    + `road-class tiles ${roadBefore} -> ${count(2)}`);
} else {
  console.log('  nothing widenable is affordable');
}

const had = w.standing;
w.approval = 95;
const r2 = w.propose(Works.Standing, -1, -1);
console.log(`  asked to be counted: ${r2.ok}${r2.reason ? ' - ' + r2.reason : ''}; `
  + `standing ${had} -> ${w.standing}, approval now ${w.approval.toFixed(1)}`);
