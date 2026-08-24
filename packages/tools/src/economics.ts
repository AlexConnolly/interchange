/**
 * Static economics: for every vehicle, cargo and haul length, what does an
 * hour of that vehicle's life earn?
 *
 * content-and-balance.md §3 wants the balance sweep to find dominant
 * strategies and dead cargo. A full-game sweep will do that eventually, but
 * most of what it finds is visible in closed form and arrives in a second
 * rather than overnight — a cargo whose best margin is negative at every
 * distance for every vehicle in its era is dead content, and no amount of
 * simulating will rescue it.
 *
 *   node packages/tools/src/economics.ts [era]
 */

import { content, type VehicleDef, type CargoDef } from '@interchange/data';
import { TICKS_PER_DAY, haulageRate } from '@interchange/sim';

const c = content();
const onlyEra = process.argv[2] ? Number(process.argv[2]) : 0;

const DISTANCES = [10, 20, 40, 80, 160, 320];

/**
 * The shortest haul each mode plausibly runs. Without this the table says a
 * wide-body doing ten-tile hops is the best business in the game, which is
 * true of the arithmetic and false of the world: aircraft fly between
 * airports, and there is not going to be an airport every ten tiles.
 */
const MIN_DISTANCE: Record<string, number> = {
  road: 6, rail: 12, water: 40, air: 80, pipe: 10, wire: 1, conveyor: 2,
};

interface Row {
  vehicle: VehicleDef;
  cargo: CargoDef;
  distance: number;
  /** Pence per game day, net of running cost. */
  net: number;
  tonnesPerDay: number;
  paybackDays: number;
}

const rows: Row[] = [];

for (const v of c.vehicles) {
  if (onlyEra && v.era !== onlyEra) continue;
  for (const cargo of c.cargo) {
    if (cargo.tier === 'networked') continue;
    if (!v.handling.includes(cargo.handling)) continue;
    if (cargo.fromEra > v.era) continue;
    for (const distance of DISTANCES) {
      if (distance < (MIN_DISTANCE[v.mode] ?? 1)) continue;
      // Round trip: out loaded, back empty. That is the arithmetic Act I is
      // meant to teach, so the model has to include it.
      const tilesPerTick = v.speed / 65536;
      const travelTicks = (distance * 2) / tilesPerTick;
      const transferTicks = (v.capacity / v.transferRate) * 2;
      const tripTicks = travelTicks + transferTicks;
      const tripsPerDay = TICKS_PER_DAY / tripTicks;
      const tonnesPerDay = tripsPerDay * v.capacity;
      const revenue = tripsPerDay * haulageRate(cargo.basePrice, distance) * v.capacity;
      const net = revenue - v.runningCost;
      rows.push({
        vehicle: v,
        cargo,
        distance,
        net,
        tonnesPerDay,
        paybackDays: net > 0 ? v.cost / net : Infinity,
      });
    }
  }
}

// ---- 1. is any cargo dead? --------------------------------------------
console.log('=== cargo viability (best net pence/day across all vehicles) ===');
const byCargo = new Map<string, Row[]>();
for (const r of rows) {
  const list = byCargo.get(r.cargo.id) ?? [];
  list.push(r);
  byCargo.set(r.cargo.id, list);
}
let dead = 0;
for (const cargo of c.cargo) {
  if (cargo.tier === 'networked') continue;
  const list = byCargo.get(cargo.id);
  if (!list || list.length === 0) {
    console.log(`  ${cargo.name.padEnd(16)} NO VEHICLE CAN CARRY IT`);
    dead++;
    continue;
  }
  const best = list.reduce((a, b) => (b.net > a.net ? b : a));
  const flag = best.net <= 0 ? '  DEAD — never profitable' : '';
  console.log(
    `  ${cargo.name.padEnd(16)} ${money(best.net).padStart(12)}/day  ` +
    `via ${best.vehicle.name} at ${best.distance} tiles${flag}`,
  );
  if (best.net <= 0) dead++;
}

// ---- 2. per-era: is the best move obvious? -----------------------------
console.log('\n=== best net pence/day per era, and the spread ===');
for (let era = 1; era <= 8; era++) {
  const inEra = rows.filter((r) => r.vehicle.era <= era && r.cargo.fromEra <= era && r.net > 0);
  if (inEra.length === 0) {
    console.log(`  era ${era}: nothing is profitable`);
    continue;
  }
  const sorted = inEra.slice().sort((a, b) => b.net - a.net);
  const top = sorted[0];
  // A dominant strategy shows up as the best option being far clear of the
  // rest of the top ten. If one line prints ten times, that line is the game.
  const tenth = sorted[Math.min(9, sorted.length - 1)];
  const ratio = tenth.net > 0 ? top.net / tenth.net : Infinity;
  const distinct = new Set(sorted.slice(0, 10).map((r) => `${r.vehicle.id}/${r.cargo.id}`)).size;
  console.log(
    `  era ${era}: best ${money(top.net)}/day  ${top.vehicle.name} + ${top.cargo.name} @ ${top.distance}t` +
    `   top10 spread ${ratio.toFixed(1)}x, ${distinct} distinct pairs` +
    (ratio > 6 ? '   DOMINANT' : ''),
  );
}

// ---- 3. Act I specifically --------------------------------------------
console.log('\n=== Act I: a horse dray, which is the whole first two hours ===');
const dray = c.vehicles.find((v) => v.id === 'dray-horse')!;
console.log(`  ${dray.name}: ${dray.capacity}t, ${dray.displayKph} km/h, costs ${money(dray.cost)}, runs at ${money(dray.runningCost)}/day`);
console.log('  distance   coal            timber          goods           tonnes/day');
for (const distance of [10, 20, 40, 80]) {
  const cells = ['coal', 'timber', 'goods'].map((id) => {
    const cargo = c.cargo.find((x) => x.id === id)!;
    const r = rows.find((q) => q.vehicle.id === dray.id && q.cargo.id === id && q.distance === distance);
    void cargo;
    return r ? `${money(r.net)}/day`.padEnd(16) : 'n/a'.padEnd(16);
  });
  const any = rows.find((q) => q.vehicle.id === dray.id && q.distance === distance);
  console.log(`  ${String(distance).padStart(5)}      ${cells.join('')}${any ? any.tonnesPerDay.toFixed(2) : ''}`);
}
const drayBest = rows.filter((r) => r.vehicle.id === dray.id && r.net > 0).sort((a, b) => a.paybackDays - b.paybackDays)[0];
if (drayBest) {
  console.log(
    `  best payback: ${drayBest.paybackDays.toFixed(0)} game days ` +
    `(${(drayBest.paybackDays / 240).toFixed(1)} years) hauling ${drayBest.cargo.name} ${drayBest.distance} tiles`,
  );
  if (drayBest.paybackDays > 900) console.log('  WARNING: a dray never pays for itself inside Act I');
  if (drayBest.paybackDays < 120) console.log('  WARNING: a dray pays for itself in months — Act I has no pressure');
} else {
  console.log('  WARNING: a horse dray is never profitable. Act I is unplayable.');
}

console.log(`\n${dead} dead cargo types.`);

function money(pence: number): string {
  if (!Number.isFinite(pence)) return 'inf';
  const pounds = pence / 100;
  if (Math.abs(pounds) >= 1000) return `${(pounds / 1000).toFixed(1)}k`;
  return pounds.toFixed(2);
}
