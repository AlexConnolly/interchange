import { createWorld, TICKS_PER_YEAR, LINE_COUNT, Line } from '@interchange/sim';
const rows: {done:number; rev:number; cash:number}[] = [];
for (let r = 0; r < 8; r++) {
  const w = createWorld({ seed: 1860 + r * 977, size: 384, townCount: 14, companyCount: 5 });
  for (let c = 1; c < w.companies.count; c++) w.companies.isAi[c] = 1;
  for (let i = 0; i < TICKS_PER_YEAR * 40 - 400; i++) w.step();
  for (let c = 1; c < w.companies.count; c++) {
    if (w.companies.bankrupt[c]) continue;
    const base = c * LINE_COUNT;
    rows.push({
      done: w.companies.delivered[c],
      rev: w.companies.ledgerYear[base + Line.Haulage] + w.companies.ledgerYear[base + Line.ContractBonus] + w.companies.ledgerYear[base + Line.AccessCharged],
      cash: w.companies.cash[c],
    });
  }
}
const pct = (xs: number[], p: number) => xs.slice().sort((a,b)=>a-b)[Math.floor(xs.length*p)] ?? 0;
console.log(`${rows.length} surviving companies at year 40`);
for (const k of ['done','rev','cash'] as const) {
  const xs = rows.map(r => r[k]);
  const f = (v: number) => k === 'done' ? v.toFixed(0) : (v/100).toFixed(0);
  console.log(`  ${k.padEnd(5)} p25 ${f(pct(xs,0.25))}  median ${f(pct(xs,0.5))}  p75 ${f(pct(xs,0.75))}  p90 ${f(pct(xs,0.9))}  max ${f(Math.max(...xs))}`);
}
