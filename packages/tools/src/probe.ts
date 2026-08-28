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
  facilitiesFor,
} from '../../sim/src/index.ts';
import { loadContent } from '../../data/src/index.ts';

loadContent();

const D = 128;
const w = createWorld({ seed: Number(process.env.SEED ?? 1985), size: D, townCount: 3, companyCount: 1 });
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
const started = w.companies.cash[w.player];
/*
 * Milestones in *real minutes*, not game days.
 *
 * A game day is a number the design deliberately hides, and it has changed
 * length twice; what the player judges the game on is how long they have been
 * sitting there. So the yardstick is minutes at the client's tick rate, and
 * lengthening a day no longer silently rewrites every figure in this file.
 */
const TICKS_PER_SECOND = 13;
const minuteOf = (day: number): number => (day * TICKS_PER_DAY) / TICKS_PER_SECOND / 60;
let secondVan = -1;
for (let day = 1; day <= 400; day++) {
  if (minuteOf(day - 1) < 5 && minuteOf(day) >= 5) {
    console.log(`  first five real minutes: earned £`
      + `${((w.companies.cash[w.player] - started) / 100).toFixed(0)}`);
  }
  for (let t = 0; t < TICKS_PER_DAY; t++) w.step();
  w.takeEarnings();
  if (secondVan < 0 && w.companies.cash[w.player] >= van) secondVan = day;
}
console.log(`  a second van affordable after ${minuteOf(secondVan).toFixed(0)} real minutes`);
if (opening.from >= 0) {
  console.log(`  the dairy farm costs £${(w.priceOf(opening.from) / 100).toFixed(0)}`);
}
console.log(`  after ${minuteOf(400).toFixed(0)} real minutes: `
  + `£${(w.companies.cash[w.player] / 100).toFixed(0)}`
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

// ---- rung 7: the parish, which now gates rather than sells -----------------
console.log('--- rung 7: the parish');
const boxIdx = w.content.vehicles.findIndex((v) => v.id === 'rigid-box');
for (let i = 0; i < 3; i++) w.buyVehicleAtYard(boxIdx, w.yards.count > 1 ? 1 : 0);

/*
 * What the parish thinks of you, and where.
 *
 * The old version of this measured how much approval sixty thousand pounds
 * bought. Nothing buys approval now, so the questions worth asking are the two
 * the mechanic actually turns on: what the thresholds admit at rest, and whether
 * improving a neighbourhood opens the one thing it was refusing.
 */
console.log(`  overall ${w.approvalOverall().toFixed(1)}, record ${w.approval.toFixed(1)},`
  + ` towns counting you: ${w.standing}`);

/*
 * Some ground, because you cannot build without it and the rest of this measures
 * building. Money is not the variable here.
 */
w.companies.cash[w.player] = 200_000_000_00;
{
  let bought = 0;
  for (let b = 0; b < w.land.owner.length && bought < 6; b++) {
    if (w.buyLand(b).ok) bought++;
  }
  console.log(`  bought ${bought} fields to build on`);
}

// What the resting parish will and will not let you put up, anywhere you own.
{
  const owned = w.landOwned();
  const spot = owned.length > 0 ? owned[0] : -1;
  const at = spot >= 0 ? w.land.centres[spot] : { x: opening.x | 0, y: opening.y | 0 };
  const here = w.approvalAt(at.x, at.y);
  console.log(`  at your own ground (${at.x},${at.y}) approval is ${here.toFixed(1)}`);
  const admits: string[] = [];
  const refuses: string[] = [];
  w.content.industries.forEach((ind, di) => {
    (here >= ind.approvalNeed ? admits : refuses).push(
      `${ind.name}${ind.approvalNeed > 0 ? `(${ind.approvalNeed})` : ''}`,
    );
  });
  console.log(`    admits: ${admits.join(', ')}`);
  console.log(`    refuses: ${refuses.join(', ')}`);
}

/*
 * And the move the old design could not express: improve a place, then earn the
 * right to industrialise it. A green is £6,000 and lifts local approval by twelve
 * at the centre, which is the difference between being refused a creamery and
 * being allowed one.
 */
{
  /*
   * The first spot on your own ground where a thing will actually stand.
   *
   * Asked of the game rather than guessed at, because a parcel centre is as
   * likely as not to have the lane across it - which is what the first version of
   * this measured, and it reported "no spot" while sitting on six fields.
   */
  const findSpot = (di: number, avoid = -1): number => {
    for (let t = 0; t < D * D; t++) {
      if (avoid >= 0) {
        const dx = (t % D) - (avoid % D);
        const dy = ((t / D) | 0) - ((avoid / D) | 0);
        if (Math.sqrt(dx * dx + dy * dy) < 4) continue;
      }
      if (w.canPlaceSite(w.player, di, t).ok) return t;
    }
    return -1;
  };
  const greenIdx = w.content.industries.findIndex((i2) => i2.id === 'village-green');
  const creameryIdx = w.content.industries.findIndex((i2) => i2.id === 'creamery');
  /*
   * Where the creamery *would* go if approval allowed. `canPlaceSite` refuses it
   * outright at rest, so the spot is found with the green - same footprint rules,
   * no approval need - and then asked about.
   */
  const spot = findSpot(greenIdx);
  if (spot >= 0 && creameryIdx >= 0) {
    const sx = spot % D;
    const sy = (spot / D) | 0;
    const before = w.canPlaceSite(w.player, creameryIdx, spot);
    console.log(`  at (${sx},${sy}) approval ${w.approvalAt(sx, sy).toFixed(1)};`
      + ` a creamery: ok ${before.ok}${before.reason ? ' - ' + before.reason : ''}`);
    // Now the green, close enough to lift that spot but not on top of it.
    const near = findSpot(greenIdx, spot);
    const placed = near >= 0 ? w.placeSite(greenIdx, near)
      : { ok: false, reason: 'nowhere near', site: -1 };
    const away = near >= 0
      ? Math.round(Math.sqrt(Math.pow(near % D - sx, 2) + Math.pow(((near / D) | 0) - sy, 2)))
      : -1;
    console.log(`  put up a village green ${away} tiles off: ${placed.ok}`
      + `${placed.reason ? ' - ' + placed.reason : ''}`);
    if (placed.ok) {
      console.log(`    approval at the spot now ${w.approvalAt(sx, sy).toFixed(1)}`);
      const after = w.canPlaceSite(w.player, creameryIdx, spot);
      console.log(`    a creamery: ok ${after.ok}${after.reason ? ' - ' + after.reason : ''}`);
      console.log('    why: ' + w.approvalReasons(sx, sy)
        .map((r) => `${r.label} ${r.points >= 0 ? '+' : ''}${r.points.toFixed(1)}`)
        .join(', '));
      // And the other direction: what a depot does to the same neighbourhood.
      const depotIdx = w.content.industries.findIndex((i2) => i2.id === 'distribution-centre');
      w.approval = 62;
      w.refreshApproval();
      const depotSpot = findSpot(depotIdx, near);
      if (depotSpot >= 0) {
        const d = w.placeSite(depotIdx, depotSpot);
        console.log(`  with a record of 62, a depot: ${d.ok}`
          + `${d.reason ? ' - ' + d.reason : ''}`);
        if (d.ok) {
          console.log(`    approval by the green now ${w.approvalAt(sx, sy).toFixed(1)},`
            + ` overall ${w.approvalOverall().toFixed(1)}`);
          /*
           * The *nearest* legal spot to the first depot, not the first one found
           * anywhere. Scanning from tile zero returned a field forty tiles away
           * where the depot has no effect, so the test reported "yes" and was
           * measuring nothing.
           */
          let near2 = -1;
          let best2 = Infinity;
          for (let t = 0; t < D * D; t++) {
            const dx = (t % D) - (depotSpot % D);
            const dy = ((t / D) | 0) - ((depotSpot / D) | 0);
            const dd = Math.sqrt(dx * dx + dy * dy);
            if (dd >= best2) continue;
            if (!w.canPlaceSite(w.player, greenIdx, t).ok) continue;
            best2 = dd;
            near2 = t;
          }
          if (near2 >= 0) {
            const second = w.canPlaceSite(w.player, depotIdx, near2);
            const nx = near2 % D;
            const ny = (near2 / D) | 0;
            console.log(`    a second depot ${best2.toFixed(0)} tiles from the first:`
              + ` ok ${second.ok}${second.reason ? ' - ' + second.reason : ''}`);
            /*
             * With the reasons, because "yes" here is not necessarily a hole in
             * the gate — the green is close enough to be paying for the depot, and
             * that is the design working. Printing the figure is the difference
             * between a test that says yes and one that says why.
             */
            console.log(`      approval there ${w.approvalAt(nx, ny).toFixed(1)}: `
              + w.approvalReasons(nx, ny)
                .map((r) => `${r.label} ${r.points >= 0 ? '+' : ''}${r.points.toFixed(1)}`)
                .join(', '));
          }
        }
      }
      w.approval = 30;
      w.refreshApproval();
    }
  } else {
    console.log('  no spot on your own ground to build on');
  }
}

// Own something out on a lane, which is what a real player would have by now.
if (opening.from >= 0) {
  w.sites.owner[opening.from] = w.player;
  w.refreshInfluence();
}
const list = w.roadWorks();
console.log(`  road works offered: ${list.length}`);
for (const p2 of list) {
  console.log(`    ${p2.label}: £${(p2.cost / 100).toFixed(0)}, wants ${p2.approval},`
    + ` there it is ${p2.here.toFixed(0)}, ok ${p2.ok}${p2.reason ? ' - ' + p2.reason : ''}`);
}
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
}
const widen = list.find((p2) => p2.ok) ?? list[0];
if (widen) {
  const count = (c: number): number => {
    let n = 0;
    for (let t = 0; t < D * D; t++) if (layer.cls[t] === c) n++;
    return n;
  };
  const roadBefore = count(2);
  const r = w.widenTo(widen.from);
  console.log(`  widened "${widen.label}": ${r.ok}${r.reason ? ' - ' + r.reason : ''}; `
    + `road-class tiles ${roadBefore} -> ${count(2)}`);
} else {
  console.log('  nothing to widen');
}
