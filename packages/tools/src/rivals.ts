/**
 * Do the rivals actually play?
 *
 * design.md §2.5 says a rival is a headless client issuing the same commands a
 * human issues. That is a claim about the code, and this is the check: run a
 * world with nobody at the keyboard and see whether the companies build a
 * business out of nothing but the command queue.
 *
 *   node packages/tools/src/rivals.ts [years]
 */

import { createWorld, Cmd, cmd, LINE_NAMES, Line, TICKS_PER_YEAR, decodeLog } from '@interchange/sim';

const years = Number(process.argv[2] ?? 12);
const w = createWorld({ seed: 1860, size: 384, townCount: 14, companyCount: 5 });

// Everybody gets the construction charter early, so the ownership half of the
// AI is exercised rather than sitting behind a gate for the whole run.
for (let c = 1; c < w.companies.count; c++) w.queue.push(cmd(200, c, Cmd.GrantCharter, c, 1));
for (let c = 1; c < w.companies.count; c++) w.queue.push(cmd(TICKS_PER_YEAR * 4, c, Cmd.GrantCharter, c, 2));
// The player is also run by the AI here: the point is to see whether the
// decision list can build a company at all.
w.companies.isAi[w.player] = 1;

const ticks = TICKS_PER_YEAR * years;
const t0 = Date.now();
for (let i = 0; i < ticks; i++) w.step();
const ms = Date.now() - t0;

console.log(`${years} game years in ${ms} ms (${((ticks / ms) * 1000).toFixed(0)} ticks/s)`);
console.log(`${decodeLog(w.queue.log.length ? JSON.stringify('') : '') ? '' : ''}commands issued: ${w.queue.log.length}`);
console.log('');
console.log('company                cash      revenue    rent   vehicles  services  assets  sites  bankrupt');
for (let c = 1; c < w.companies.count; c++) {
  const base = c * LINE_NAMES.length;
  const revenue =
    w.companies.ledgerYear[base + Line.Haulage] +
    w.companies.ledgerYear[base + Line.ContractBonus] +
    w.companies.ledgerYear[base + Line.AccessCharged];
  let vehicles = 0;
  for (let v = 0; v < w.vehicles.count; v++) if (w.vehicles.alive[v] && w.vehicles.company[v] === c) vehicles++;
  let services = 0;
  for (let s = 0; s < w.services.count; s++) if (w.services.company[s] === c && w.services.active[s]) services++;
  console.log(
    `${(w.companies.names[c] ?? '').padEnd(20)} ` +
    `${fmt(w.companies.cash[c]).padStart(9)} ` +
    `${fmt(revenue).padStart(11)} ` +
    `${String(w.companies.rentShare(c) + '%').padStart(6)} ` +
    `${String(vehicles).padStart(9)} ` +
    `${String(services).padStart(9)} ` +
    `${String(w.ownedAssets(c)).padStart(7)} ` +
    `${String(w.ownedSites(c)).padStart(6)} ` +
    `${w.companies.bankrupt[c] ? '  yes' : '   no'}`,
  );
}

console.log('');
console.log(`region: ${w.stats.tonnesMoved.toFixed(0)} t moved, ${w.stats.delivered} deliveries`);
let pop = 0;
for (let t = 0; t < w.towns.count; t++) pop += w.towns.population[t];
console.log(`towns: ${pop} people across ${w.towns.count} towns`);
const states = [0, 0, 0, 0];
for (let s = 0; s < w.sites.count; s++) states[w.sites.state[s]]++;
console.log(`sites: ${states[0]} thriving, ${states[1]} struggling, ${states[2]} dead, ${states[3]} mothballed`);
console.log(`network: ${w.graph.nodeCount} nodes, ${w.graph.linkCount} links, ${w.assets.count} assets`);

// The claim under test.
let active = 0;
for (let c = 1; c < w.companies.count; c++) {
  let vehicles = 0;
  for (let v = 0; v < w.vehicles.count; v++) if (w.vehicles.alive[v] && w.vehicles.company[v] === c) vehicles++;
  if (vehicles > 0 && !w.companies.bankrupt[c]) active++;
}
console.log('');
if (active === 0) console.log('FAIL: nobody built anything. The AI cannot play the game.');
else if (w.stats.tonnesMoved < 100) console.log('FAIL: companies exist but nothing moved.');
else console.log(`OK: ${active} of ${w.companies.count - 1} companies trading after ${years} years.`);

function fmt(pence: number): string {
  const p = Math.round(pence) / 100;
  if (Math.abs(p) >= 1e6) return `${(p / 1e6).toFixed(1)}m`;
  if (Math.abs(p) >= 1e3) return `${(p / 1e3).toFixed(1)}k`;
  return p.toFixed(0);
}
