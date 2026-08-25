/**
 * Balance by simulation, not intuition. content-and-balance.md §3.
 *
 * The simulation runs headless at hundreds of thousands of ticks a second, so
 * a full game is a fraction of a second and a thousand of them is an evening.
 * That turns balancing — historically years of human play-testing intuition —
 * into an overnight job that produces evidence.
 *
 * The document names the signals. Three of them are specific to this design
 * and two of those matter most, because they are the only way to tell whether
 * the ownership spine works before humans play it:
 *
 *   toll revenue against bypass rate   tests the §3.3 self-balancing curve
 *   income mix over time               tests whether the arc happens at all
 *
 * Everything below is measurement. Nothing here changes the game; it prints
 * numbers, and the numbers are an argument about the JSON.
 *
 *   node packages/tools/src/balance.ts [runs] [years]
 */

import {
  createWorld, Cmd, cmd, Line, LINE_NAMES, TICKS_PER_YEAR, SiteState, AUTHORITY,
  RATE_WEIGHT_BY_TIER,
} from '@interchange/sim';
import { content, loadContent } from '@interchange/data';

const RUNS = Number(process.argv[2] ?? 12);
const YEARS = Number(process.argv[3] ?? 30);
const C = content();

interface RunResult {
  seed: number;
  tonnes: number;
  deliveries: number;
  /** Per company. */
  wealth: number[];
  rentShare: number[];
  charters: number[];
  bankrupt: number[];
  /** Cargo id -> tonnes moved across all companies. */
  cargoMoved: Float64Array;
  industrySurvival: { alive: number; dead: number };
  population: number;
  tollRevenue: number;
  tollPasses: number;
  ownedByPlayers: number;
  timeToFirstProfitYears: number;
  timeToCharterYears: number[];
  amenityStart: number;
  amenityEnd: number;
}

function runOne(seed: number): RunResult {
  const w = createWorld({ seed, size: 384, townCount: 14, companyCount: 5 });
  // Everyone is a rival. The sweep is about whether the *design* produces a
  // spread of outcomes, not about whether one hand-played strategy beats the
  // AI — and an unattended company is the only comparable subject.
  for (let c = 1; c < w.companies.count; c++) w.companies.isAi[c] = 1;

  const cargoMoved = new Float64Array(C.cargo.length);
  const timeToCharter = new Array(w.companies.count).fill(-1);
  let firstProfit = -1;
  let amenityStart = 0;

  {
    let sum = 0;
    for (let i = 0; i < w.terrain.amenityBase.length; i += 37) sum += w.terrain.amenityBase[i];
    amenityStart = sum / Math.ceil(w.terrain.amenityBase.length / 37);
  }

  const ticks = TICKS_PER_YEAR * YEARS;
  for (let i = 0; i < ticks; i++) {
    w.step();
    if ((i & 1023) === 0) {
      if (firstProfit < 0) {
        for (let c = 1; c < w.companies.count; c++) {
          if (w.companies.cash[c] > C.balance.startingCash * 2) {
            firstProfit = i / TICKS_PER_YEAR;
            break;
          }
        }
      }
      for (let c = 1; c < w.companies.count; c++) {
        if (timeToCharter[c] < 0 && w.companies.charter[c] >= 1) timeToCharter[c] = i / TICKS_PER_YEAR;
      }
    }
  }

  for (let c = 0; c < w.companies.count; c++) {
    for (let k = 0; k < C.cargo.length; k++) {
      cargoMoved[k] += w.movedByCargo[c * C.cargo.length + k];
    }
  }

  let alive = 0;
  let dead = 0;
  for (let s = 0; s < w.sites.count; s++) {
    if (w.sites.state[s] === SiteState.Dead) dead++;
    else alive++;
  }
  let population = 0;
  for (let t = 0; t < w.towns.count; t++) population += w.towns.population[t];

  let tollRevenue = 0;
  let tollPasses = 0;
  let ownedByPlayers = 0;
  for (let a = 0; a < w.assets.count; a++) {
    tollRevenue += w.assets.revenuePrev[a] + w.assets.revenue[a];
    tollPasses += w.assets.passesPrev[a] + w.assets.passes[a];
    if (w.assets.owner[a] !== AUTHORITY) ownedByPlayers++;
  }

  let amenityEnd = 0;
  {
    let sum = 0;
    for (let i = 0; i < w.terrain.amenityBase.length; i += 37) sum += w.terrain.amenityBase[i];
    amenityEnd = sum / Math.ceil(w.terrain.amenityBase.length / 37);
  }

  return {
    seed,
    tonnes: w.stats.tonnesMoved,
    deliveries: w.stats.delivered,
    wealth: Array.from({ length: w.companies.count - 1 }, (_, i) => w.companies.cash[i + 1] - w.companies.debt[i + 1]),
    rentShare: Array.from({ length: w.companies.count - 1 }, (_, i) => w.companies.rentShare(i + 1)),
    charters: Array.from({ length: w.companies.count - 1 }, (_, i) => w.companies.charter[i + 1]),
    bankrupt: Array.from({ length: w.companies.count - 1 }, (_, i) => w.companies.bankrupt[i + 1]),
    cargoMoved,
    industrySurvival: { alive, dead },
    population,
    tollRevenue,
    tollPasses,
    ownedByPlayers,
    timeToFirstProfitYears: firstProfit,
    timeToCharterYears: timeToCharter.slice(1),
    amenityStart,
    amenityEnd,
  };
}

// ---------------------------------------------------------------- the sweep

console.log(`Interchange — balance sweep: ${RUNS} runs of ${YEARS} game years`);
console.log('content-and-balance.md §3\n');

const t0 = Date.now();
const results: RunResult[] = [];
for (let i = 0; i < RUNS; i++) {
  const seed = 1860 + i * 977;
  results.push(runOne(seed));
  process.stdout.write(`\r  ${i + 1}/${RUNS} runs`);
}
const ms = Date.now() - t0;
console.log(`\r  ${RUNS} runs in ${(ms / 1000).toFixed(1)} s (${(ms / RUNS).toFixed(0)} ms each)\n`);

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const money = (p: number): string => {
  const v = p / 100;
  return Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}m` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : v.toFixed(0);
};

// ---- 1. cargo utilisation: is anything dead content? --------------------
console.log('=== cargo utilisation ===');
/*
 * Weighted, because a bus seat is not a tonne of coal.
 *
 * Passenger-tier cargo is counted in people — an omnibus is quoted at
 * eighteen and a commuter train at a hundred and eighty — so measuring
 * dominance on raw units said passengers and post were seventy per cent of
 * everything happening in the region when they were about a fifth of the
 * money. Weighting by the same figure the tariff uses measures what the
 * heading claims to measure, which is how much of the region's carrying trade
 * a cargo actually is.
 */
const totalByCargo = new Float64Array(C.cargo.length);
for (const r of results) {
  for (let k = 0; k < C.cargo.length; k++) {
    totalByCargo[k] += r.cargoMoved[k] * (RATE_WEIGHT_BY_TIER[C.cargo[k].tier] ?? 1);
  }
}
const rawByCargo = new Float64Array(C.cargo.length);
for (const r of results) for (let k = 0; k < C.cargo.length; k++) rawByCargo[k] += r.cargoMoved[k];
const grandTotal = totalByCargo.reduce((a, b) => a + b, 0);
const dead: string[] = [];
const live: { name: string; share: number }[] = [];
for (let k = 0; k < C.cargo.length; k++) {
  const cargo = C.cargo[k];
  if (cargo.tier === 'networked') continue;
  // A cargo that does not exist until era six cannot be dead in a thirty-year
  // run that ends in 1890, so it is excluded rather than reported.
  const eraEnd = 1860 + YEARS;
  const eraOf = C.eras.find((e) => e.n === cargo.fromEra);
  if (eraOf && eraOf.from > eraEnd) continue;
  const share = grandTotal > 0 ? (totalByCargo[k] / grandTotal) * 100 : 0;
  if (rawByCargo[k] < 1) dead.push(cargo.name);
  else live.push({ name: cargo.name, share });
}
live.sort((a, b) => b.share - a.share);
console.log(`  moved (share of the carrying trade, seats weighted against tonnes):`);
console.log(`    ${live.slice(0, 10).map((l) => `${l.name} ${l.share.toFixed(1)}%`).join(', ')}`);
console.log(`  ${dead.length} never moved: ${dead.length ? dead.join(', ') : 'none'}`);
if (live.length > 0 && live[0].share > 55) {
  console.log(`  WARNING: ${live[0].name} is ${live[0].share.toFixed(0)}% of all tonnage — a dominant cargo`);
}

// ---- 2. dominant strategy: how spread are the outcomes? ----------------
console.log('\n=== wealth spread across companies (snowball detection) ===');
const ginis: number[] = [];
for (const r of results) {
  const xs = r.wealth.map((v) => Math.max(0, v)).sort((a, b) => a - b);
  const n = xs.length;
  const total = xs.reduce((a, b) => a + b, 0);
  if (total <= 0 || n === 0) {
    ginis.push(0);
    continue;
  }
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * xs[i];
  ginis.push((2 * cum) / (n * total) - (n + 1) / n);
}
const gini = mean(ginis);
console.log(`  Gini ${gini.toFixed(3)} across ${results[0].wealth.length} companies`);
console.log(`  bankruptcies ${mean(results.map((r) => r.bankrupt.reduce((a, b) => a + b, 0))).toFixed(2)} per run`);
console.log(`  wealth: ${results.slice(0, 4).map((r) => `[${r.wealth.map(money).join(' ')}]`).join(' ')}`);
if (gini > 0.72) console.log('  WARNING: one company takes almost everything — R6, the snowball');
else if (gini < 0.10) console.log('  WARNING: outcomes are nearly identical — nothing the player does matters');

// ---- 3. the ownership spine ------------------------------------------
console.log('\n=== the ownership spine (the two signals that matter) ===');
const rentShares = results.flatMap((r) => r.rentShare);
console.log(`  rent share of income: mean ${mean(rentShares).toFixed(1)}%, max ${Math.max(...rentShares)}%`);
console.log(`  assets in private hands: ${mean(results.map((r) => r.ownedByPlayers)).toFixed(1)} per run`);
const tollPerPass = mean(results.map((r) => (r.tollPasses > 0 ? r.tollRevenue / r.tollPasses : 0)));
console.log(`  toll revenue ${money(mean(results.map((r) => r.tollRevenue)))} over ${mean(results.map((r) => r.tollPasses)).toFixed(0)} passes (${(tollPerPass / 100).toFixed(2)} per pass)`);
if (mean(results.map((r) => r.ownedByPlayers)) < 1) {
  console.log('  WARNING: nobody ever buys or builds infrastructure. The spine is inert.');
} else if (mean(rentShares) < 1) {
  console.log('  NOTE: rent is not yet a meaningful share. Expected before Act II; a problem after.');
}

// ---- 4. difficulty cliffs ----------------------------------------------
console.log('\n=== pacing ===');
const profits = results.map((r) => r.timeToFirstProfitYears).filter((v) => v >= 0);
const charters = results.flatMap((r) => r.timeToCharterYears).filter((v) => v >= 0);
console.log(`  doubled starting capital: ${profits.length}/${RUNS} runs, mean ${mean(profits).toFixed(1)} years`);
console.log(`  construction charter earned: ${charters.length} companies, mean ${mean(charters).toFixed(1)} years`);
if (profits.length < RUNS * 0.4) console.log('  WARNING: most companies never get going — the opening is too hard');
if (charters.length === 0) console.log('  WARNING: nobody ever earns a charter. Act II is unreachable.');

// ---- 5. the world ------------------------------------------------------
console.log('\n=== the region ===');
console.log(`  tonnage ${mean(results.map((r) => r.tonnes)).toFixed(0)} per run`);
console.log(`  industry survival ${mean(results.map((r) => r.industrySurvival.alive)).toFixed(1)} alive / ${mean(results.map((r) => r.industrySurvival.dead)).toFixed(1)} dead`);
console.log(`  population ${mean(results.map((r) => r.population)).toFixed(0)}`);
const deadShare = mean(results.map((r) => r.industrySurvival.dead / Math.max(1, r.industrySurvival.alive + r.industrySurvival.dead)));
if (deadShare > 0.4) console.log(`  WARNING: ${(deadShare * 100).toFixed(0)}% of industry dies — decay is too harsh`);

console.log('\nEverything above is a claim about the JSON in packages/data/content.');
void loadContent;
void cmd;
void Cmd;
void Line;
void LINE_NAMES;
