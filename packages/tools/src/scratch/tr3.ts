import { generateTerrain, TileRouter } from '@interchange/sim';
const t = generateTerrain({ size: 256, seed: 1860, townCount: 9, companyCount: 4 });
const r: any = new TileRouter(t);
r.prepare(55);
const c = r.clusters[55];
console.log('entrances', c.entrances.length, c.entrances.map((e: number) => [e % 256, (e / 256) | 0]));
console.log('dist matrix finite count', [...c.dist].filter(Number.isFinite).length, 'of', c.dist.length);
console.log('absNodes after one prepare', r.absTile.length);
console.log('degrees', r.absTo.map((x: number[]) => x.length));
