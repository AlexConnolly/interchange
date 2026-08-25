/**
 * What the palette looks like to everybody. art-direction.md 10.
 *
 *   node packages/tools/src/palette.ts
 */
import {
  LIVERIES, SEMANTIC, findClashes, simulate, perceptualDistance, Vision, VISION_NAMES,
  semanticOrderHolds,
} from '@interchange/render';

const PATTERNS = ['plain', 'band', 'roof panel', 'diagonal flash', 'twin stripe'];
console.log('Interchange — palette legibility\n');
console.log('=== liveries ===');
for (const l of LIVERIES) {
  const row = [Vision.Protanopia, Vision.Deuteranopia, Vision.Tritanopia]
    .map((v) => perceptualDistance(l.colour, simulate(l.colour, v)).toFixed(0).padStart(3))
    .join(' ');
  console.log(`  ${l.name.padEnd(10)} ${PATTERNS[l.pattern].padEnd(15)} shift under p/d/t: ${row}`);
}

console.log('\n=== same-pattern pairs, closest first ===');
const rows: { a: string; b: string; vision: string; d: number }[] = [];
for (const vision of [Vision.Normal, Vision.Protanopia, Vision.Deuteranopia, Vision.Tritanopia]) {
  for (let i = 0; i < LIVERIES.length; i++) {
    for (let j = i + 1; j < LIVERIES.length; j++) {
      if (LIVERIES[i].pattern !== LIVERIES[j].pattern) continue;
      rows.push({
        a: LIVERIES[i].name, b: LIVERIES[j].name, vision: VISION_NAMES[vision],
        d: perceptualDistance(simulate(LIVERIES[i].colour, vision), simulate(LIVERIES[j].colour, vision)),
      });
    }
  }
}
rows.sort((x, y) => x.d - y.d);
for (const r of rows.slice(0, 12)) {
  console.log(`  ${r.d.toFixed(1).padStart(6)}  ${r.a} / ${r.b}  (${r.vision})`);
}

console.log('\n=== congestion scale lightness ===');
for (const row of semanticOrderHolds()) {
  console.log(`  ${row.vision.padEnd(13)} ${row.lightness.map((l) => l.toFixed(1).padStart(6)).join(' ')}  ${row.ok ? 'ordered' : 'FOLDS'}`);
}

const clashes = findClashes();
console.log(`\n${clashes.length} clashes at the default threshold.`);
for (const c of clashes) console.log(`  ${c.a} / ${c.b} under ${c.vision}: ${c.distance.toFixed(1)}`);
void SEMANTIC;
