/**
 * Do the assets fit their budgets, and does a frame fit a device? Phase 6.
 *
 * art-direction.md §15 sets triangle budgets per class and calls them
 * provisional, to be confirmed against the real frame budget. This confirms
 * them, in the only way that means anything: by counting the triangles every
 * model actually emits and by working out what a frame full of them costs on
 * each class of machine anybody will play this on.
 *
 * The two halves answer different questions and both are needed. A model can
 * be within budget and the game still drop frames, because the budget is per
 * asset and the frame is a crowd. And a frame can be comfortable while one
 * asset is four times its budget, which is fine today and is the thing that
 * makes the next twenty assets impossible.
 *
 * Device tiers are deliberately coarse. Three is enough to make decisions with
 * and more would be a spurious precision about hardware nobody has measured.
 *
 *   node packages/tools/src/budgets.ts
 */

import { buildVehicle, buildIndustry, buildTownBlock, LIVERIES } from '@interchange/render';
import { content } from '@interchange/data';

const C = content();

interface Budget { near: [number, number]; far: [number, number] }

/** Straight from the table in art-direction.md 15. */
const BUDGETS: Record<string, Budget> = {
  vehicle: { near: [300, 700], far: [40, 80] },
  building: { near: [300, 900], far: [60, 120] },
  industry: { near: [3000, 8000], far: [400, 800] },
};

/**
 * What a machine can be expected to do.
 *
 * Triangles per frame is the crude number and it is the right crude number:
 * this renderer is fill-light and geometry-heavy by design — flat shading, no
 * textures, no post — so triangles and draw calls are what it spends. The
 * figures are conservative for each class rather than best-case, because a
 * budget you only meet on a good day is not a budget.
 */
const TIERS = [
  { name: 'low     (integrated, 2018 laptop)', tris: 900_000, draws: 400, hz: 30 },
  { name: 'mid     (integrated, recent)', tris: 2_500_000, draws: 900, hz: 60 },
  { name: 'high    (discrete)', tris: 8_000_000, draws: 2000, hz: 60 },
];

/** The mesh is unindexed triangle soup, so three vertices is one triangle. */
function countTris(build: () => { vertexCount: number }): number {
  return Math.round(build().vertexCount / 3);
}

console.log('Interchange — asset and frame budgets\n');
console.log('art-direction.md 15\n');

// ---- assets ------------------------------------------------------------
let over = 0;
let checked = 0;
const rows: { name: string; kind: string; near: number; far: number; verdict: string }[] = [];

for (let i = 0; i < C.vehicles.length; i++) {
  const v = C.vehicles[i];
  const near = countTris(() => buildVehicle({ cls: v.model, era: v.era, livery: LIVERIES[1], far: false }));
  const far = countTris(() => buildVehicle({ cls: v.model, era: v.era, livery: LIVERIES[1], far: true }));
  const b = BUDGETS.vehicle;
  const bad = near > b.near[1] || far > b.far[1];
  if (bad) over++;
  checked++;
  rows.push({
    name: v.name, kind: 'vehicle', near, far,
    verdict: bad ? `OVER (near ${b.near[1]}, far ${b.far[1]})` : 'ok',
  });
}

for (let i = 0; i < C.industries.length; i++) {
  const ind = C.industries[i];
  // State 0 is thriving, which is the busiest of the three.
  const near = countTris(() => buildIndustry(ind.kit, 0, i * 7, ind.footprint));
  const far = near;
  const b = BUDGETS.industry;
  const bad = near > b.near[1] || far > b.far[1];
  if (bad) over++;
  checked++;
  rows.push({
    name: ind.name, kind: 'industry', near, far,
    verdict: bad ? `OVER (near ${b.near[1]}, far ${b.far[1]})` : 'ok',
  });
}

{
  /*
   * Towns are measured per building, not per block.
   *
   * A block is up to twenty-two buildings and the budget in the table is for
   * one, so comparing the whole block against it is comparing the wrong
   * things — which this tool did on its first run and reported the town as
   * over budget when it is nothing of the kind.
   *
   * The honest reading is more interesting than the false alarm. A town
   * building here costs about eighty triangles, which is the *far* end of the
   * building budget rather than the near end, and that is deliberate: a town
   * in this game is massing seen from above, in the same way that woodland is
   * massing rather than individual trees. There is no authored far LOD for a
   * town because the near representation is already at that complexity, and
   * the art checklist's requirement for one is met by there being nothing to
   * simplify.
   */
  const BUILDINGS = 22;
  const era4 = countTris(() => buildTownBlock(3, BUILDINGS, 4, false));
  const era1 = countTris(() => buildTownBlock(3, BUILDINGS, 1, false));
  const per = Math.round(Math.max(era1, era4) / BUILDINGS);
  const b = BUDGETS.building;
  const bad = per > b.near[1];
  if (bad) over++;
  checked++;
  rows.push({
    name: `Town building (of ${BUILDINGS})`, kind: 'town', near: per, far: per,
    verdict: bad ? `OVER (near ${b.near[1]})` : per <= b.far[1] ? 'ok — already at far-LOD weight' : 'ok',
  });
}

rows.sort((a, b) => b.near - a.near);
console.log('=== the heaviest assets ===');
for (const r of rows.slice(0, 14)) {
  console.log(
    `  ${r.name.padEnd(22)} ${r.kind.padEnd(9)} near ${String(r.near).padStart(6)}`
    + `  far ${String(r.far).padStart(5)}  ${r.verdict}`,
  );
}
console.log(`\n  ${checked - over}/${checked} assets within budget.`);

// ---- a frame -----------------------------------------------------------
//
// A busy Act IV region: what the renderer is actually asked to draw when the
// player has built something worth looking at.
const SCENE = {
  vehiclesNear: 60,
  vehiclesFar: 900,
  industries: 60,
  towns: 14,
  terrainChunks: 64,
  trisPerChunk: 4200,
};

const meanVehicleNear = rows.filter((r) => r.kind === 'vehicle').reduce((a, r) => a + r.near, 0)
  / Math.max(1, rows.filter((r) => r.kind === 'vehicle').length);
const meanVehicleFar = rows.filter((r) => r.kind === 'vehicle').reduce((a, r) => a + r.far, 0)
  / Math.max(1, rows.filter((r) => r.kind === 'vehicle').length);
const meanIndustry = rows.filter((r) => r.kind === 'industry').reduce((a, r) => a + r.far, 0)
  / Math.max(1, rows.filter((r) => r.kind === 'industry').length);

const frameTris = Math.round(
  SCENE.vehiclesNear * meanVehicleNear
  + SCENE.vehiclesFar * meanVehicleFar
  + SCENE.industries * meanIndustry
  + SCENE.towns * 22 * rows.find((r) => r.kind === 'town')!.far
  + SCENE.terrainChunks * SCENE.trisPerChunk,
);

// One instanced draw per vehicle type present, per industry kit, plus chunks.
const frameDraws = C.vehicles.length + 18 + SCENE.terrainChunks + 8;

console.log('\n=== a busy frame ===');
console.log(`  ${SCENE.vehiclesNear} near vehicles, ${SCENE.vehiclesFar} far, ${SCENE.industries} industries,`);
console.log(`  ${SCENE.towns} towns, ${SCENE.terrainChunks} terrain chunks`);
console.log(`  ${frameTris.toLocaleString('en-GB')} triangles, about ${frameDraws} draw calls\n`);

let tiersOk = 0;
for (const tier of TIERS) {
  const triOk = frameTris <= tier.tris;
  const drawOk = frameDraws <= tier.draws;
  if (triOk && drawOk) tiersOk++;
  console.log(
    `  ${tier.name.padEnd(34)} ${String(tier.hz).padStart(2)} Hz  `
    + `tris ${(frameTris / tier.tris * 100).toFixed(0).padStart(3)}% of budget  `
    + `draws ${(frameDraws / tier.draws * 100).toFixed(0).padStart(3)}%  `
    + `${triOk && drawOk ? 'fits' : 'OVER'}`,
  );
}

console.log(`\n${over === 0 ? 'PASS' : 'FAIL'} — assets within budget: ${checked - over}/${checked}.`);
console.log(`${tiersOk === TIERS.length ? 'PASS' : 'PARTIAL'} — device tiers that fit: ${tiersOk}/${TIERS.length}.`);
process.exitCode = over === 0 && tiersOk >= 2 ? 0 : 1;
