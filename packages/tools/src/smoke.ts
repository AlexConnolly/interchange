/**
 * Bring a world up, run it, and report. The first thing to run after touching
 * anything in the sim.
 *
 *   node packages/tools/src/smoke.ts [seed] [size] [ticks]
 */

import { createWorld, Cmd, cmd, StopAction, SiteState, Line, LINE_NAMES, TICKS_PER_DAY, NONE } from '@interchange/sim';

const seed = Number(process.argv[2] ?? 1860);
const size = Number(process.argv[3] ?? 512);
const ticks = Number(process.argv[4] ?? 20000);

console.log(`building world  seed=${seed} size=${size}`);
let t0 = Date.now();
const w = createWorld({ seed, size, townCount: 14, companyCount: 4 });
console.log(`  built in ${Date.now() - t0} ms`);
console.log(`  towns ${w.towns.count}  sites ${w.sites.count}  assets ${w.assets.count}`);
console.log(`  graph: ${w.graph.nodeCount} nodes, ${w.graph.linkCount} links, ${w.graph.cellCount} cells`);
console.log(`  road tiles ${w.layers[0].tileCount}`);

if (w.graph.linkCount === 0) {
  console.log('FAIL: no links in the graph — nothing can move');
  process.exit(1);
}

// Sites with no network node cannot be served at all, which is a worldgen bug
// rather than a gameplay problem, so it is worth failing loudly on.
let orphanSites = 0;
for (let s = 0; s < w.sites.count; s++) if (w.sites.node[s] === NONE) orphanSites++;
let orphanTowns = 0;
for (let t = 0; t < w.towns.count; t++) if (w.towns.node[t] === NONE) orphanTowns++;
console.log(`  unreachable: ${orphanSites}/${w.sites.count} sites, ${orphanTowns}/${w.towns.count} towns`);

// --- set up one service by hand: find a producer and a matching consumer ---
const content = w.content;
// The closest producer/consumer pair that is actually connected. A player
// starting Act I picks a short haul, not the longest one on the map, so the
// smoke test should measure what they would actually do.
let from = -1;
let to = -1;
let cargo = -1;
let bestDist = Infinity;
for (let a = 0; a < w.sites.count; a++) {
  if (w.sites.node[a] === NONE) continue;
  // Origin must be an extraction site. A processing site only has whatever
  // its own inputs let it make, so a service run off one moves exactly as
  // much as its starting stock and then stops — correct behaviour, and
  // useless as a measurement of whether the loop works.
  if (content.industries[w.sites.def[a]].kind !== 'extraction') continue;
  const outs = content.industries[w.sites.def[a]].recipe.outputs;
  for (const id of Object.keys(outs)) {
    const ci = content.cargoIndex.get(id);
    if (ci === undefined) continue;
    for (let b = 0; b < w.sites.count; b++) {
      if (b === a || w.sites.node[b] === NONE) continue;
      if (content.industries[w.sites.def[b]].recipe.inputs[id] === undefined) continue;
      const d = Math.hypot(w.sites.x[a] - w.sites.x[b], w.sites.y[a] - w.sites.y[b]);
      if (d < bestDist) {
        bestDist = d;
        from = a;
        to = b;
        cargo = ci;
      }
    }
  }
}

if (from < 0) {
  console.log('FAIL: no producer/consumer pair is reachable — the economy has no first move');
  process.exit(1);
}
const dist = Math.hypot(w.sites.x[from] - w.sites.x[to], w.sites.y[from] - w.sites.y[to]);
console.log(
  `  service: ${content.industries[w.sites.def[from]].name} -> ${content.industries[w.sites.def[to]].name}` +
  `  (${content.cargo[cargo].name}, ${dist.toFixed(0)} tiles)`,
);

const player = w.player;
w.queue.push(cmd(1, player, Cmd.CreateService, 0, 0, 0, 0, 'Test run'));
w.queue.push(cmd(2, player, Cmd.AddStop, 0, from, 255 << 2, StopAction.LoadFull));
w.queue.push(cmd(2, player, Cmd.AddStop, 0, to, 255 << 2, StopAction.Unload));
const drayType = content.vehicleIndex.get('dray-horse') ?? 0;
for (let i = 0; i < 6; i++) {
  w.queue.push(cmd(3 + i, player, Cmd.BuyVehicle, drayType, from));
}
for (let i = 0; i < 6; i++) {
  w.queue.push(cmd(12 + i, player, Cmd.AssignVehicle, i, 0));
}

t0 = Date.now();
let lastReport = 0;
for (let i = 0; i < ticks; i++) {
  w.step();
  // Bid only on contracts this fleet could actually run: same cargo, same two
  // ends as the service. Bidding on everything and failing it all measures the
  // penalty system, not the haulage loop.
  if (i % 200 === 0) {
    for (let k = 0; k < w.contracts.count; k++) {
      if (w.contracts.state[k] !== 0 || w.contracts.bids[k * 9 + player] !== 0) continue;
      if (w.contracts.cargo[k] !== cargo) continue;
      if (w.contracts.fromSite[k] !== from || w.contracts.toIsTown[k] === 1 || w.contracts.toSite[k] !== to) continue;
      w.queue.push(cmd(w.tick + 2, player, Cmd.BidContract, k, w.contracts.rate[k]));
    }
  }
  if (i - lastReport >= ticks / 5) {
    lastReport = i;
    console.log(
      `  ${w.dateString().padEnd(12)} cash ${fmt(w.companies.cash[player])}` +
      `  moved ${w.stats.tonnesMoved.toFixed(0)}t  deliveries ${w.stats.delivered}` +
      `  paths ${w.stats.pathsResolved}`,
    );
  }
}
const ms = Date.now() - t0;

console.log(`\nran ${ticks} ticks in ${ms} ms  (${(ticks / (ms / 1000)).toFixed(0)} ticks/s, ${(ms / ticks).toFixed(3)} ms/tick)`);
console.log(`  simulated ${(ticks / TICKS_PER_DAY / 360).toFixed(1)} game years at ${((ticks / 20) / (ms / 1000)).toFixed(0)}x real time`);

console.log('\nledger (player, this year):');
for (let l = 0; l < LINE_NAMES.length; l++) {
  const v = w.companies.ledgerYear[player * LINE_NAMES.length + l];
  if (v === 0) continue;
  console.log(`  ${LINE_NAMES[l].padEnd(24)} ${fmt(v)}`);
}
console.log(`  ${'cash'.padEnd(24)} ${fmt(w.companies.cash[player])}   debt ${fmt(w.companies.debt[player])}`);
console.log(`  rent share ${w.companies.rentShare(player)}%   reliability ${w.companies.reliability(player)}%   charter ${w.companies.charter[player]}`);

const states = [0, 0, 0, 0];
for (let s = 0; s < w.sites.count; s++) states[w.sites.state[s]]++;
console.log(`\nsites: thriving ${states[0]}  struggling ${states[1]}  dead ${states[2]}  mothballed ${states[3]}`);
let pop = 0;
for (let t = 0; t < w.towns.count; t++) pop += w.towns.population[t];
console.log(`towns: population ${pop}`);
console.log(`router: ${w.router.hits} hits / ${w.router.misses} misses, ${w.router.cacheSize()} cached routes`);

// Determinism: a second world from the same seed and the same log must produce
// the identical hash stream. This is the cheapest possible version of the CI
// replay harness and catches most of what it would catch.
console.log('\nreplay check...');
const w2 = createWorld({ seed, size, townCount: 14, companyCount: 4 });
w2.queue.loadLog(w.queue.log);
let mismatch = -1;
for (let i = 0; i < ticks; i++) {
  w2.step();
}
for (let i = 0; i < w.hashes.length; i++) {
  if (w.hashes[i].hash !== w2.hashes[i]?.hash) {
    mismatch = w.hashes[i].tick;
    break;
  }
}
console.log(
  mismatch < 0
    ? `  ${w.hashes.length} hashes match — deterministic over ${ticks} ticks`
    : `  DESYNC at tick ${mismatch}`,
);
if (mismatch >= 0) process.exit(1);

function fmt(pence: number): string {
  const p = Math.round(pence);
  const neg = p < 0;
  const pounds = Math.abs(p) / 100;
  const s = pounds >= 1e6 ? `${(pounds / 1e6).toFixed(2)}M` : pounds.toLocaleString('en-GB', { maximumFractionDigits: 0 });
  return `${neg ? '-' : ''}GBP ${s}`;
}
