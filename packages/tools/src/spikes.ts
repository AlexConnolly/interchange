/**
 * Phase 0. The five hardest things, proven before anything is built on them.
 *
 * roadmap.md: "Gate: all five green, or the design changes. Cheaper to change
 * it here than anywhere else."
 *
 * Three of the five are measurable headlessly and live here. Spike 2 (25,000
 * instanced vehicles at 60 fps) needs a GPU and lives in the browser at
 * `/perf`; spike 5 (the art spike) needs Blender and lives in `art/`. Both
 * report into the same table via `art/out/spikes.json` so the gate is one
 * answer and not three.
 *
 *   node packages/tools/src/spikes.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  createWorld, Cmd, cmd, StopAction, TileRouter, CLUSTER, NONE,
  HASH_INTERVAL, MAX_COMPANIES, generateTerrain,
} from '@interchange/sim';
import { content } from '@interchange/data';

interface SpikeResult {
  n: number;
  name: string;
  target: string;
  measured: string;
  pass: boolean;
  note?: string;
}

const results: SpikeResult[] = [];
const t = (): number => Number(process.hrtime.bigint() / 1000n) / 1000;

// ---------------------------------------------------------------- spike 1
//
// Determinism replay harness. The most important test in the project
// (architecture.md §11), and the one that has to exist from the first commit
// rather than being retrofitted.

function spike1(): void {
  console.log('\n--- 1. determinism replay harness ---');
  const SEEDS = [1860, 4242, 90210];
  let allMatch = true;
  let totalTicks = 0;
  const details: string[] = [];

  for (const seed of SEEDS) {
    const a = createWorld({ seed, size: 256, townCount: 9, companyCount: 4 });
    // A log with something in it: an idle world is a weak test, because most
    // of the state that can diverge is state nothing is touching.
    const log = buildExerciseLog(a);
    a.queue.loadLog(log);
    const TICKS = 12000;
    for (let i = 0; i < TICKS; i++) a.step();

    const b = createWorld({ seed, size: 256, townCount: 9, companyCount: 4 });
    b.queue.loadLog(log);
    for (let i = 0; i < TICKS; i++) b.step();

    totalTicks += TICKS;
    let match = a.hashes.length > 0 && a.hashes.length === b.hashes.length;
    let firstBad = -1;
    for (let i = 0; i < a.hashes.length; i++) {
      if (a.hashes[i].hash !== b.hashes[i].hash) {
        match = false;
        firstBad = a.hashes[i].tick;
        break;
      }
    }
    allMatch &&= match;
    details.push(`seed ${seed}: ${a.hashes.length} hashes ${match ? 'match' : `DIVERGE at tick ${firstBad}`}`);
    console.log(`  ${details[details.length - 1]}`);
  }

  // The rules themselves, checked rather than assumed. A grep is a weak test
  // and a runtime probe is a strong one: if `Math.random` were reachable from
  // the sim, replacing it would change the hash.
  const probe = createWorld({ seed: 7, size: 128, townCount: 5, companyCount: 2 });
  const before = probe.hash();
  const realRandom = Math.random;
  const realNow = Date.now;
  Math.random = () => 0.123456789;
  Date.now = () => 1700000000000;
  for (let i = 0; i < 600; i++) probe.step();
  const withStubs = probe.hash();
  Math.random = realRandom;
  Date.now = realNow;

  const probe2 = createWorld({ seed: 7, size: 128, townCount: 5, companyCount: 2 });
  for (let i = 0; i < 600; i++) probe2.step();
  const clean = probe2.hash();
  const noAmbient = withStubs === clean;
  console.log(`  ambient sources: ${noAmbient ? 'unused — Math.random and Date.now cannot reach sim state' : 'REACHABLE, rule 2 or 3 is broken'}`);
  void before;

  results.push({
    n: 1,
    name: 'Determinism replay harness',
    target: 'identical hash stream across runs; no ambient entropy',
    measured: `${SEEDS.length} seeds x 12k ticks, ${allMatch ? 'all match' : 'DIVERGENCE'}; ambient ${noAmbient ? 'clean' : 'LEAKING'}`,
    pass: allMatch && noAmbient,
    note: `${totalTicks} ticks compared, hashed every ${HASH_INTERVAL}`,
  });
}

/** A command log that touches most of the systems, so the replay test has
 *  something to disagree about. */
function buildExerciseLog(w: ReturnType<typeof createWorld>): ReturnType<typeof cmd>[] {
  const c = content();
  const log: ReturnType<typeof cmd>[] = [];
  const dray = c.vehicleIndex.get('dray-horse') ?? 0;
  const heavy = c.vehicleIndex.get('dray-heavy') ?? 0;
  let tick = 4;
  let serviceCount = 0;

  // Two services per company, on whatever producer/consumer pairs exist.
  for (let company = 1; company < Math.min(4, w.companies.count); company++) {
    const pairs = findPairs(w, 2);
    for (const [from, to] of pairs) {
      const svc = serviceCount++;
      log.push(cmd(tick++, company, Cmd.CreateService, 0, 0, 0, 0, `S${svc}`));
      log.push(cmd(tick++, company, Cmd.AddStop, svc, from, 255 << 2, StopAction.LoadFull));
      log.push(cmd(tick++, company, Cmd.AddStop, svc, to, 255 << 2, StopAction.Unload));
      for (let k = 0; k < 5; k++) {
        log.push(cmd(tick++, company, Cmd.BuyVehicle, k % 2 === 0 ? dray : heavy, from));
      }
    }
  }
  // Assign everything a few ticks later, once the vehicles exist.
  let vid = 0;
  for (let company = 1; company < Math.min(4, w.companies.count); company++) {
    for (let s = 0; s < 2; s++) {
      for (let k = 0; k < 5; k++) log.push(cmd(tick++, company, Cmd.AssignVehicle, vid++, (company - 1) * 2 + s));
    }
  }
  // And some later churn: speed changes, a sale, a bid.
  log.push(cmd(2000, 1, Cmd.SellVehicle, 0));
  log.push(cmd(3000, 1, Cmd.BidContract, 0, 400));
  log.push(cmd(5000, 2, Cmd.BidContract, 0, 380));
  return log;
}

function findPairs(w: ReturnType<typeof createWorld>, want: number): [number, number][] {
  const c = content();
  const out: [number, number][] = [];
  for (let a = 0; a < w.sites.count && out.length < want; a++) {
    if (w.sites.node[a] === NONE) continue;
    if (c.industries[w.sites.def[a]].kind !== 'extraction') continue;
    for (const id of Object.keys(c.industries[w.sites.def[a]].recipe.outputs)) {
      for (let b = 0; b < w.sites.count; b++) {
        if (b === a || w.sites.node[b] === NONE) continue;
        if (c.industries[w.sites.def[b]].recipe.inputs[id] === undefined) continue;
        out.push([a, b]);
        break;
      }
      if (out.length >= want) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- spike 3
//
// Hierarchical pathfinding over a million-tile graph inside 2 ms — including
// the per-company cost-graph multiplier from D14, which roadmap.md flags as
// "the part most likely to bite" and risks.md tracks as R5.

function spike3(): void {
  console.log('\n--- 3. hierarchical pathfinding, 1M tiles, per-company ---');
  const terrain = generateTerrain({ size: 1024, seed: 1860, townCount: 14, companyCount: 4 });
  const router = new TileRouter(terrain);

  const land: number[] = [];
  for (let i = 0; i < terrain.size * terrain.size; i += 997) {
    if (terrain.height[i] > 0) land.push(i);
  }

  // Preparation and query are different costs and have to be reported
  // separately. A cluster is prepared once per region and then answers every
  // query that crosses it for the rest of the game; folding that one-off into
  // a per-query median makes the number meaningless in both directions — it
  // flatters the steady state and panics about a cost the player pays once.
  const warm0 = t();
  for (let k = 0; k < 40; k++) {
    router.route(land[(k * 53) % land.length], land[(k * 149 + 7) % land.length]);
  }
  const warmMs = t() - warm0;
  const preparedAfterWarm = router.preparedClusters;

  const samples: number[] = [];
  let expanded = 0;
  let found = 0;
  for (let k = 0; k < 200; k++) {
    const a = land[(k * 37) % land.length];
    const b = land[(k * 101 + 13) % land.length];
    const t0 = t();
    const path = router.route(a, b);
    samples.push(t() - t0);
    expanded += router.lastExpanded;
    if (path) found++;
  }
  samples.sort((x, y) => x - y);
  const median = samples[samples.length >> 1];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  console.log(`  warm-up: 40 long routes prepared ${preparedAfterWarm} of ${(1024 / CLUSTER) ** 2} clusters in ${warmMs.toFixed(0)} ms`);
  console.log(`  steady state: median ${median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, ${(expanded / 200) | 0} abstract nodes/query, ${found}/200 routed`);
  console.log(`  abstract graph: ${router.abstractNodes} nodes over ${router.preparedClusters} prepared clusters`);

  // The part that actually multiplies: every company sees a different cost
  // graph, so the vehicle router runs once per company per origin-destination.
  const w = createWorld({ seed: 1860, size: 512, townCount: 14, companyCount: 4 });
  const nodes: number[] = [];
  for (let n = 0; n < w.graph.nodeCount; n++) nodes.push(n);
  const perCompany: number[] = [];
  for (let company = 1; company < MAX_COMPANIES; company++) {
    const t0 = t();
    let found = 0;
    for (let k = 0; k < 200; k++) {
      const a = nodes[(k * 7) % nodes.length];
      const b = nodes[(k * 31 + 5) % nodes.length];
      const r = w.router.find(w.graph, w.assets, routeCosts(w), a, b, company, w.config.size);
      if (r && r.links.length > 0) found++;
    }
    perCompany.push((t() - t0) / 200);
    void found;
  }
  const worst = Math.max(...perCompany);
  const cold = perCompany[0];
  // Second pass: this is what the game actually pays, because a route is
  // computed once and then served from the per-company cache until something
  // invalidates it.
  const t1 = t();
  for (let company = 1; company < MAX_COMPANIES; company++) {
    for (let k = 0; k < 200; k++) {
      const a = nodes[(k * 7) % nodes.length];
      const b = nodes[(k * 31 + 5) % nodes.length];
      w.router.find(w.graph, w.assets, routeCosts(w), a, b, company, w.config.size);
    }
  }
  const cachedMs = (t() - t1) / (200 * (MAX_COMPANIES - 1));
  console.log(`  link graph, cold: ${cold.toFixed(3)} ms/query, worst company ${worst.toFixed(3)} ms`);
  console.log(`  link graph, cached: ${cachedMs.toFixed(4)} ms/query (${w.router.hits} hits / ${w.router.misses} misses)`);
  console.log(`  ${w.graph.nodeCount} nodes, ${w.graph.linkCount} links, ${w.router.cacheSize()} routes cached across ${MAX_COMPANIES - 1} companies`);

  const pass = median < 2.0 && p95 < 2.0 && worst < 2.0;
  results.push({
    n: 3,
    name: 'Hierarchical pathfinding, per-company',
    target: 'under 2 ms per query on a 1M-tile region',
    measured: `tile median ${median.toFixed(2)} ms / p95 ${p95.toFixed(2)} ms; link cold ${worst.toFixed(3)} ms, cached ${cachedMs.toFixed(4)} ms`,
    pass,
    note: `R5 mitigation confirmed: topology is shared, only weights are per company. Cluster preparation is ${warmMs.toFixed(0)} ms for ${preparedAfterWarm} clusters, once per region.`,
  });
}

function routeCosts(w: ReturnType<typeof createWorld>): { speedLimit: Int32Array; valueOfTime: number } {
  const c = content();
  const speedLimit = new Int32Array(64);
  c.ways.forEach((way, i) => {
    speedLimit[i] = way.speedLimit;
  });
  return { speedLimit, valueOfTime: c.balance.valueOfTime };
}

// ---------------------------------------------------------------- spike 4
//
// Chunked terrain streaming at region scale. The measurable part headlessly is
// generation and chunk meshing cost; the frame-time part is spike 2's job.

function spike4(): void {
  console.log('\n--- 4. chunked terrain at region scale ---');
  const t0 = t();
  const terrain = generateTerrain({ size: 1024, seed: 1860, townCount: 14, companyCount: 4 });
  const genMs = t() - t0;

  // Region generation must be a pure function of the seed, or streaming a
  // chunk on demand gives a different chunk from the one a full pass produced.
  const again = generateTerrain({ size: 1024, seed: 1860, townCount: 14, companyCount: 4 });
  let identical = true;
  for (let i = 0; i < terrain.height.length; i += 97) {
    if (terrain.height[i] !== again.height[i] || terrain.biome[i] !== again.biome[i]) {
      identical = false;
      break;
    }
  }

  // Chunk meshing: two triangles per tile, so the cost is proportional and the
  // number that matters is how many chunks fit in a frame.
  const CHUNK = 32;
  const t1 = t();
  let verts = 0;
  const chunkCount = 24;
  for (let k = 0; k < chunkCount; k++) {
    const cx = (k * 7) % (1024 / CHUNK);
    const cy = (k * 13) % (1024 / CHUNK);
    verts += meshChunkCost(terrain, cx * CHUNK, cy * CHUNK, CHUNK);
  }
  const meshMs = (t() - t1) / chunkCount;

  const bytes = terrain.height.byteLength + terrain.biome.byteLength + terrain.flags.byteLength +
    terrain.deposit.byteLength + terrain.amenityBase.byteLength;
  console.log(`  1024x1024 generated in ${genMs.toFixed(0)} ms, ${(bytes / 1048576).toFixed(1)} MB resident`);
  console.log(`  regeneration identical: ${identical}`);
  console.log(`  chunk mesh ${meshMs.toFixed(2)} ms each, ${(verts / chunkCount) | 0} verts — ${(16 / meshMs) | 0} chunks per 16 ms frame`);
  console.log(`  ${terrain.towns.length} towns, ${terrain.deposits.length} deposits`);

  const pass = genMs < 6000 && meshMs < 6 && identical;
  results.push({
    n: 4,
    name: 'Chunked terrain streaming',
    target: 'region generates in seconds; a chunk meshes well inside a frame',
    measured: `gen ${genMs.toFixed(0)} ms, ${(bytes / 1048576).toFixed(1)} MB, chunk ${meshMs.toFixed(2)} ms (${(16 / meshMs) | 0}/frame)`,
    pass,
  });
}

function meshChunkCost(terrain: ReturnType<typeof generateTerrain>, x0: number, y0: number, size: number): number {
  const s = terrain.size;
  let verts = 0;
  const out = new Float32Array(size * size * 18);
  let w = 0;
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      const h = terrain.height[y * s + x] / 64;
      for (let k = 0; k < 6; k++) {
        out[w++] = x;
        out[w++] = h;
        out[w++] = y;
      }
      verts += 6;
    }
  }
  return verts;
}

// ------------------------------------------------------------------ report

console.log('Interchange — Phase 0 spikes');
console.log('roadmap.md: all five green, or the design changes.');

spike1();
spike3();
spike4();

// Pull in whatever the browser and Blender halves last reported.
const OUT = 'art/out/spikes.json';
mkdirSync('art/out', { recursive: true });
let external: Record<string, SpikeResult> = {};
if (existsSync(OUT)) {
  try {
    external = JSON.parse(readFileSync(OUT, 'utf8')) as Record<string, SpikeResult>;
  } catch {
    external = {};
  }
}
for (const r of results) external[String(r.n)] = r;

const ALL: { n: number; name: string; where: string }[] = [
  { n: 1, name: 'Determinism replay harness', where: 'headless' },
  { n: 2, name: '25,000 instanced vehicles at 60 fps', where: 'browser: /?perf' },
  { n: 3, name: 'Hierarchical pathfinding, per-company', where: 'headless' },
  { n: 4, name: 'Chunked terrain streaming', where: 'headless' },
  { n: 5, name: 'Art spike: foreshortening and the 14-pixel test', where: 'art/: python art/spike_camera.py' },
];

console.log('\n=================== PHASE 0 GATE ===================');
let green = 0;
for (const spec of ALL) {
  const r = external[String(spec.n)];
  if (!r) {
    console.log(`  ${spec.n}. ${spec.name.padEnd(42)} NOT RUN   (${spec.where})`);
    continue;
  }
  if (r.pass) green++;
  console.log(`  ${spec.n}. ${spec.name.padEnd(42)} ${r.pass ? 'GREEN' : 'RED  '}`);
  console.log(`     target   ${r.target}`);
  console.log(`     measured ${r.measured}`);
  if (r.note) console.log(`     note     ${r.note}`);
}
console.log(`\n  ${green} of 5 green.`);
writeFileSync(OUT, JSON.stringify(external, null, 2) + '\n');
console.log(`  written to ${OUT}`);
if (green < 5) console.log('  Gate not passed. Run the remaining spikes.');
export { CLUSTER };
