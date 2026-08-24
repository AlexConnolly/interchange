import { generateTerrain, TileRouter, CLUSTER } from '@interchange/sim';
const t = generateTerrain({ size: 256, seed: 1860, townCount: 9, companyCount: 4 });
const r = new TileRouter(t);
const a = t.idx(t.towns[0].x, t.towns[0].y);
const b = t.idx(t.towns[1].x, t.towns[1].y);
console.log('towns', t.towns[0].x, t.towns[0].y, '->', t.towns[1].x, t.towns[1].y);
const p = r.route(a, b);
console.log('path', p ? p.length : 'NULL', 'expanded', r.lastExpanded, 'prepared', r.lastPrepared, 'absNodes', r.abstractNodes);
if (p) {
  // is it contiguous?
  let bad = 0;
  for (let i = 1; i < p.length; i++) {
    const dx = Math.abs(p[i]%256 - p[i-1]%256), dy = Math.abs((p[i]/256|0) - (p[i-1]/256|0));
    if (dx + dy !== 1) bad++;
  }
  console.log('endpoints ok:', p[0]===a, p[p.length-1]===b, 'discontinuities', bad, 'cost', r.routeCost(p).toFixed(0));
}
