import { generateTerrain, TileRouter } from '@interchange/sim';
const t = generateTerrain({ size: 256, seed: 1860, townCount: 9, companyCount: 4 });
const r: any = new TileRouter(t);
const a = t.idx(t.towns[0].x, t.towns[0].y);
r.route(a, t.idx(t.towns[1].x, t.towns[1].y));
console.log('absNodes', r.absTile.length, 'prepared', r.preparedClusters);
const deg = r.absTo.map((x: number[]) => x.length);
console.log('edge counts (first 20):', deg.slice(0, 20));
console.log('nodes with 0 edges:', deg.filter((d: number) => d === 0).length, 'of', deg.length);
// what cluster is each node in, and is that cluster prepared?
const ci = r.absCluster.slice(0, 20);
console.log('clusters of first 20 nodes:', ci);
console.log('cluster of start tile:', ((t.towns[0].y/16|0) * Math.ceil(256/16) + (t.towns[0].x/16|0)));
