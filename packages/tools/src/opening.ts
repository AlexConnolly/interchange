/**
 * Is the opening actually winnable?
 *
 * The balance sweep keeps reporting that most companies never get going, and
 * that is a statement about four unattended AI companies rather than about
 * the game. The two are worth separating: if a single sensible opening move
 * — one short route, a couple of drays, no cleverness at all — pays, then the
 * economy is sound and the warning is about the AI. If it does not, the
 * economy is broken and no amount of AI work will help.
 *
 *   node packages/tools/src/opening.ts [years]
 */

import {
  createWorld, Cmd, cmd, StopAction, TICKS_PER_YEAR, SiteState, NONE,
  LINE_COUNT, Line, MAX_STOPS, Mode,
} from '@interchange/sim';
import { content } from '@interchange/data';

const YEARS = Number(process.argv[2] ?? 12);
const C = content();

interface Result { seed: number; net: number; tonnes: number; laps: number; dist: number }

function playOne(seed: number, drays: number): Result | null {
  const w = createWorld({ seed, size: 384, townCount: 14, companyCount: 5 });
  // Rivals off: this measures the opening, not the competition.
  for (let c = 1; c < w.companies.count; c++) w.companies.isAi[c] = 0;
  const me = w.player;

  /*
   * The obvious first move: the nearest *extraction* site to a town that wants
   * what it digs up.
   *
   * Extraction matters. A cement works also produces something a town wants,
   * and it is a trap: it is a processing site, so it makes cement only while
   * somebody brings it stone, and in an empty region nobody does. It runs
   * through its opening stock, produces thirty tonnes, and stops forever. A
   * colliery digs coal out of the ground and never stops. Any player works
   * that out in one game; a harness measuring whether the opening is winnable
   * has to know it, or it is measuring the wrong opening.
   */
  let best: { from: number; to: number; d: number } | null = null;
  for (let s = 0; s < w.sites.count; s++) {
    if (!w.sites.connected(s) || w.sites.state[s] === SiteState.Dead) continue;
    if (C.industries[w.sites.def[s]].kind !== 'extraction') continue;
    const outs = C.industries[w.sites.def[s]].recipe.outputs;
    for (const id of Object.keys(outs)) {
      const ci = C.cargoIndex.get(id);
      if (ci === undefined || w.townDemandFor(ci) <= 0) continue;
      for (let t = 0; t < w.towns.count; t++) {
        if (w.towns.nodeOf(t, Mode.Road) === NONE) continue;
        const d = Math.hypot(w.sites.x[s] - w.towns.x[t], w.sites.y[s] - w.towns.y[t]);
        if (d < 8) continue;
        if (!best || d < best.d) best = { from: s, to: t, d };
      }
    }
  }
  if (!best) return null;

  w.queue.push(cmd(0, me, Cmd.CreateService, 0, 0, 0, 0, 'First route'));
  w.queue.push(cmd(0, me, Cmd.AddStop, 0, best.from, 255 << 2, StopAction.LoadFull));
  w.queue.push(cmd(0, me, Cmd.AddStop, 0, best.to, (255 << 2) | 1, StopAction.Unload));
  const dray = C.vehicles.findIndex((v) => v.mode === 'road' && v.era <= 1 && v.handling.includes('bulk'));
  for (let i = 0; i < drays; i++) {
    w.queue.push(cmd(0, me, Cmd.BuyVehicle, dray, best.from, 0, 0));
    w.queue.push(cmd(0, me, Cmd.AssignVehicle, -1, 0));
  }

  const start = w.companies.cash[me];
  for (let i = 0; i < TICKS_PER_YEAR * YEARS; i++) w.step();
  const net = w.companies.cash[me] - w.companies.debt[me] - start;
  const laps = w.services.roundTrip[0] > 0
    ? (TICKS_PER_YEAR * YEARS) / w.services.roundTrip[0] : 0;
  void LINE_COUNT; void Line; void MAX_STOPS;
  return { seed, net, tonnes: w.services.tonnes[0], laps, dist: best.d };
}

console.log(`Interchange — is the opening winnable? ${YEARS} game years, rivals off\n`);
for (const drays of [1, 2, 4, 8]) {
  const rows: Result[] = [];
  for (let i = 0; i < 8; i++) {
    const r = playOne(1860 + i * 977, drays);
    if (r) rows.push(r);
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const wins = rows.filter((r) => r.net > 0).length;
  console.log(
    `${String(drays).padStart(2)} dray(s): net ${(mean(rows.map((r) => r.net)) / 100).toFixed(0).padStart(7)}`
    + `  tonnes ${mean(rows.map((r) => r.tonnes)).toFixed(0).padStart(5)}`
    + `  laps ${mean(rows.map((r) => r.laps)).toFixed(1).padStart(5)}`
    + `  haul ${mean(rows.map((r) => r.dist)).toFixed(0).padStart(3)} tiles`
    + `  profitable in ${wins}/${rows.length}`,
  );
}
console.log('\nA positive net with a small fleet means the opening is sound and');
console.log('"most companies never get going" is a statement about the rival AI.');
