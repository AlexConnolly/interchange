/**
 * The Phase 5 gate: zero desyncs over a full era run.
 *
 * Runs several independent simulations of one shared world, side by side in
 * one process, exchanging commands through the real Room from the relay — the
 * same ordering, the same latency budget, the same spectator rules. What is
 * *not* shared is any state: each client has its own World built from the
 * seed, and they only ever see each other's commands.
 *
 * That is the whole claim of deterministic lockstep, and it is the claim this
 * checks: if the architecture holds, four machines that have exchanged only a
 * few kilobytes of commands agree on the position of every lorry in the region
 * two hundred and forty years later.
 *
 * Running it in one process is not a cheat. The thing being tested is whether
 * the *simulation* is deterministic given identical input, and separate
 * Worlds share nothing but the module code. What it cannot test is drift
 * between browsers or CPUs, which is what risks.md R1 puts a CI matrix on;
 * this catches everything that is the same on every machine, which is where
 * essentially all desyncs live.
 *
 *   node packages/tools/src/shared.ts [years] [clients]
 */

import { createWorld, Cmd, cmd, StopAction, TICKS_PER_YEAR, SiteState, NONE, Mode } from '@interchange/sim';
import { Room, LATENCY_TICKS, type WireCommand } from '@interchange/server';
import { content } from '@interchange/data';

const YEARS = Number(process.argv[2] ?? 240);
const CLIENTS = Number(process.argv[3] ?? 4);
const C = content();
const SEED = 5150;

interface Client {
  id: number;
  world: ReturnType<typeof createWorld>;
  player: ReturnType<Room['join']>['player'];
  /** Commands the relay has handed back, not yet applied. */
  inbox: WireCommand[];
  hashes: Map<number, number>;
}

const room = new Room('gate', { seed: SEED, size: 384, townCount: 14, companyCount: CLIENTS + 1 });

const clients: Client[] = [];
for (let i = 0; i < CLIENTS; i++) {
  const { player } = room.join(`Client ${i + 1}`);
  clients.push({
    id: player.id,
    world: createWorld({ seed: SEED, size: 384, townCount: 14, companyCount: CLIENTS + 1 }),
    player,
    inbox: [],
    hashes: new Map(),
  });
}

/*
 * Every company that is not a connected client is an AI, on every client,
 * identically — so each machine is simulating the same rivals as well as the
 * same humans. Rivals are the harder half of this test: they issue far more
 * commands than the humans do, and they do it from their own reading of the
 * world, so any divergence at all makes them start behaving differently.
 */
for (const c of clients) {
  for (let i = 1; i < c.world.companies.count; i++) {
    c.world.companies.isAi[i] = clients.some((o) => o.player.id === i) ? 0 : 1;
  }
}

/**
 * A route this client would open, chosen from its own view of the world.
 *
 * Deterministic and identical on every client, which is the point: they are
 * all looking at the same world, so they all see the same candidate list, and
 * the only thing that differs is which one this client takes.
 */
function openRoute(c: Client, n: number): WireCommand[] {
  const w = c.world;
  const candidates: { from: number; to: number; d: number }[] = [];
  for (let s = 0; s < w.sites.count; s++) {
    if (!w.sites.connected(s) || w.sites.state[s] === SiteState.Dead) continue;
    if (!w.sites.isExtraction(s)) continue;
    for (const id of Object.keys(C.industries[w.sites.def[s]].recipe.outputs)) {
      const ci = C.cargoIndex.get(id);
      if (ci === undefined || w.townDemandFor(ci) <= 0) continue;
      for (let t = 0; t < w.towns.count; t++) {
        if (w.towns.nodeOf(t, Mode.Road) === NONE) continue;
        const d = Math.hypot(w.sites.x[s] - w.towns.x[t], w.sites.y[s] - w.towns.y[t]);
        if (d < 8 || d > 70) continue;
        candidates.push({ from: s, to: t, d });
      }
    }
  }
  candidates.sort((x, y) => x.d - y.d || x.from - y.from || x.to - y.to);
  if (candidates.length === 0) return [];
  const best = candidates[n % candidates.length];
  const dray = C.vehicles.findIndex((v) => v.mode === 'road' && v.era <= 1 && v.handling.includes('bulk'));
  const out: WireCommand[] = [
    { tick: 0, issuer: c.id, kind: Cmd.CreateService, a: 0, b: 0, c: 0, d: 0, data: `Route ${n}` },
    { tick: 0, issuer: c.id, kind: Cmd.AddStop, a: -1, b: best.from, c: 255 << 2, d: StopAction.LoadFull },
    { tick: 0, issuer: c.id, kind: Cmd.AddStop, a: -1, b: best.to, c: (255 << 2) | 1, d: StopAction.Unload },
  ];
  // Two drays, which the opening harness found to be the best return on one
  // route in Act I.
  for (let i = 0; i < 2; i++) {
    out.push({ tick: 0, issuer: c.id, kind: Cmd.BuyVehicle, a: dray, b: best.from, c: 0, d: 0 });
    out.push({ tick: 0, issuer: c.id, kind: Cmd.AssignVehicle, a: -1, b: -1, c: 0, d: 0 });
  }
  return out;
}

console.log(`Interchange — shared world gate: ${CLIENTS} clients, ${YEARS} game years\n`);
const ticks = TICKS_PER_YEAR * YEARS;
const t0 = Date.now();
let issued = 0;
let compared = 0;
let desyncs = 0;
let routes = 0;

for (let tick = 0; tick < ticks; tick++) {
  /*
   * Deliver on arrival, not on the tick.
   *
   * A command is scheduled for a *future* tick and has to be in the queue
   * before then, because the queue fires everything due at or before the
   * current tick and a command handed over after its moment has passed is
   * simply never applied. Waiting for the tick to arrive before delivering it
   * produced a harness that reported zero desyncs and zero tonnage: three
   * clients agreeing perfectly about a world in which nothing had happened.
   * The latency budget is exactly the room this leaves.
   */
  for (const c of clients) {
    for (const wc of c.inbox) {
      c.world.queue.push(cmd(wc.tick, wc.issuer, wc.kind, wc.a, wc.b, wc.c, wc.d, wc.data));
    }
    c.inbox.length = 0;
    c.world.step();
  }

  // Somebody opens a route now and then. Staggered so the relay is ordering
  // commands from different clients arriving in the same window, which is the
  // case an ordering bug would show up in.
  if (tick > 0 && tick % (TICKS_PER_YEAR * 4) === 0) {
    const c = clients[(tick / (TICKS_PER_YEAR * 4)) % clients.length];
    room.advanceTo(tick);
    const accepted = room.submit(c.player, openRoute(c, routes++));
    if (accepted.length > 0) {
      issued += accepted.length;
      for (const other of clients) other.inbox.push(...accepted.map((x) => ({ ...x })));
    }
  }

  // Hashes, on the simulation's own schedule.
  if (tick > 0 && tick % 256 === 0) {
    room.advanceTo(tick);
    let agreed = -1;
    for (const c of clients) {
      const h = c.world.hash();
      c.hashes.set(tick, h);
      if (agreed === -1) agreed = h;
      else if (h !== agreed) desyncs++;
      const problem = room.report(c.player, tick, h);
      if (problem) { /* counted by the room too */ }
    }
    compared++;
  }
}

const ms = Date.now() - t0;
const perClient = clients.map((c) => `${c.world.stats.tonnesMoved.toFixed(0)}t`).join(' / ');
console.log(`  ${YEARS} years in ${(ms / 1000).toFixed(1)} s`);
console.log(`  commands relayed: ${issued} (latency budget ${LATENCY_TICKS} ticks)`);
console.log(`  hash comparisons: ${compared} points x ${CLIENTS} clients`);
console.log(`  tonnage per client: ${perClient}`);
console.log(`  room desyncs: ${room.desyncCount}`);
console.log(`  harness desyncs: ${desyncs}`);
console.log(desyncs === 0 && room.desyncCount === 0
  ? '\n  PASS — zero desyncs over a full era run.'
  : '\n  FAIL — the clients disagree. See architecture.md 1.');
process.exitCode = desyncs === 0 && room.desyncCount === 0 ? 0 : 1;
