/**
 * Save, load, and prove they agree.
 *
 * architecture.md §7 says the command log is authoritative and a save *is* a
 * replay. That is only true if replaying one reproduces the world exactly, so
 * this plays a game, saves it, replays the save, and compares the hash stream
 * tick for tick.
 *
 *   node packages/tools/src/saveload.ts
 */

import { createWorld, Cmd, cmd, StopAction, NONE, saveGame, loadGame, saveSizeBytes, decodeLog } from '@interchange/sim';
import { content } from '@interchange/data';

const C = content();
const TICKS = 24000;

const w = createWorld({ seed: 1860, size: 384, townCount: 14, companyCount: 4 });

// Play something worth saving: two services, a fleet, a charter, a road.
let from = -1;
let to = -1;
outer: for (let a = 0; a < w.sites.count; a++) {
  if (!w.sites.connected(a)) continue;
  if (C.industries[w.sites.def[a]].kind !== 'extraction') continue;
  for (const id of Object.keys(C.industries[w.sites.def[a]].recipe.outputs)) {
    for (let b = 0; b < w.sites.count; b++) {
      if (b === a || !w.sites.connected(b)) continue;
      if (C.industries[w.sites.def[b]].recipe.inputs[id] === undefined) continue;
      from = a;
      to = b;
      break outer;
    }
  }
}

const dray = C.vehicleIndex.get('dray-horse') ?? 0;
w.queue.push(cmd(2, 1, Cmd.CreateService, 0, 0, 0, 0, 'Coal run'));
w.queue.push(cmd(3, 1, Cmd.AddStop, 0, from, 255 << 2, StopAction.LoadFull));
w.queue.push(cmd(3, 1, Cmd.AddStop, 0, to, 255 << 2, StopAction.Unload));
for (let i = 0; i < 8; i++) w.queue.push(cmd(4 + i, 1, Cmd.BuyVehicle, dray, from));
for (let i = 0; i < 8; i++) w.queue.push(cmd(14 + i, 1, Cmd.AssignVehicle, i, 0));
w.queue.push(cmd(600, 1, Cmd.GrantCharter, 1, 1));
w.queue.push(cmd(900, 1, Cmd.SetCharge, 0, 12));
w.queue.push(cmd(1200, 1, Cmd.BuyAsset, 3));

for (let i = 0; i < TICKS; i++) w.step();

const file = saveGame(w);
const bytes = saveSizeBytes(file);
const commands = decodeLog(file.log).length;
console.log(`played ${TICKS} ticks, ${commands} commands`);
console.log(`save is ${(bytes / 1024).toFixed(1)} kB — ${(bytes / TICKS).toFixed(1)} bytes per tick`);
console.log(`  moved ${w.stats.tonnesMoved.toFixed(0)} t, cash ${(w.companies.cash[1] / 100).toFixed(0)}, assets ${w.ownedAssets(1)}`);

const t0 = Date.now();
const { world: replayed, divergences } = loadGame(file, (cfg) => createWorld(cfg));
const ms = Date.now() - t0;

console.log(`\nreplayed in ${ms} ms (${((TICKS / ms) * 1000).toFixed(0)} ticks/s)`);
console.log(`  divergences against the recorded hashes: ${divergences.length}`);
for (const d of divergences.slice(0, 4)) {
  console.log(`    tick ${d.tick}: expected ${d.expected.toString(16)}, got ${d.actual.toString(16)}`);
}

const same =
  replayed.tick === w.tick &&
  Math.round(replayed.companies.cash[1]) === Math.round(w.companies.cash[1]) &&
  replayed.hash() === w.hash();
console.log(`  final state identical: ${same}`);
console.log(`    tick        ${replayed.tick} vs ${w.tick}`);
console.log(`    cash        ${(replayed.companies.cash[1] / 100).toFixed(2)} vs ${(w.companies.cash[1] / 100).toFixed(2)}`);
console.log(`    tonnes      ${replayed.stats.tonnesMoved.toFixed(0)} vs ${w.stats.tonnesMoved.toFixed(0)}`);
console.log(`    state hash  ${replayed.hash().toString(16)} vs ${w.hash().toString(16)}`);

if (!same || divergences.length > 0) {
  console.log('\nFAIL: a save does not reproduce its game.');
  process.exit(1);
}
console.log('\nOK: the save is the replay.');
