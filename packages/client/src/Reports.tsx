/**
 * Statistics and graphs. "The genre demands them" (features.md §17), and it is
 * right to: a transport game without a graph of tonnage over time is a game
 * where you cannot tell whether the thing you did last year worked.
 *
 * The graph that matters most is the income mix. design.md §3.5 says the arc
 * from haulier to magnate should be visible in the income statement rather
 * than in narration, and content-and-balance.md names it as one of the two
 * signals that tell us whether the ownership spine works at all. So it is not
 * one line among twelve; it is the first chart, and it is drawn as a share
 * rather than as an amount, because the shape is the story and the magnitude
 * is not.
 */

import { useEffect, useRef, useState } from 'react';
import { HISTORY_MONTHS, LINE_IS_INCOME, LINE_NAMES, Line } from '@interchange/sim';
import { money, num, shortMoney } from './format.ts';
import { saveStats } from './saves.ts';
import type { Engine } from './engine.ts';

type Chart = 'mix' | 'profit' | 'cash' | 'tonnage';

const CHARTS: { id: Chart; label: string; note: string }[] = [
  { id: 'mix', label: 'Income mix', note: 'Operating income against rent. Act I is all haulage; by Act IV it should not be.' },
  { id: 'profit', label: 'Profit and loss', note: 'Income above the line, expenditure below, month by month.' },
  { id: 'cash', label: 'Cash and debt', note: 'What you have, and what you owe.' },
  { id: 'tonnage', label: 'Tonnage', note: 'Everything you have moved, cumulatively.' },
];

export function Reports({ engine, onClose }: { engine: Engine; onClose: () => void }): JSX.Element {
  const [chart, setChart] = useState<Chart>('mix');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const w = engine.world;
  const p = w.player;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = 840;
    const H = 300;
    const dpr = Math.min(2, devicePixelRatio ?? 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const months = w.companies.historyMonths;
    if (months < 2) {
      ctx.fillStyle = '#666c72';
      ctx.font = '13px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Not enough history yet. Come back in a few months.', W / 2, H / 2);
      return;
    }

    const base = p * HISTORY_MONTHS * LINE_NAMES.length;
    const at = (month: number, line: number): number =>
      w.companies.history[base + (HISTORY_MONTHS - months + month) * LINE_NAMES.length + line];

    const pad = { l: 62, r: 14, t: 16, b: 26 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;
    const x = (i: number): number => pad.l + (i / Math.max(1, months - 1)) * plotW;

    // Hairline rules and tabular figures: the drafting language, same as the
    // rest of the overlay.
    ctx.strokeStyle = 'rgba(232,230,223,0.10)';
    ctx.lineWidth = 1;
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = '#666c72';
    ctx.textAlign = 'right';

    if (chart === 'mix') {
      for (let k = 0; k <= 4; k++) {
        const yy = pad.t + (k / 4) * plotH;
        ctx.beginPath();
        ctx.moveTo(pad.l, yy);
        ctx.lineTo(W - pad.r, yy);
        ctx.stroke();
        ctx.fillText(`${100 - k * 25}%`, pad.l - 8, yy + 3);
      }
      // A stacked area: haulage, contract bonuses, then rent on top.
      const bands: { line: number; colour: string; label: string }[] = [
        { line: Line.Haulage, colour: 'rgba(122,142,168,0.85)', label: 'Haulage' },
        { line: Line.ContractBonus, colour: 'rgba(96,120,150,0.85)', label: 'Contracts' },
        { line: Line.AccessCharged, colour: 'rgba(200,161,58,0.9)', label: 'Rent' },
      ];
      let lower = new Float64Array(months);
      for (const band of bands) {
        ctx.beginPath();
        for (let i = 0; i < months; i++) {
          const total = bands.reduce((acc, b) => acc + Math.max(0, at(i, b.line)), 0);
          const share = total > 0 ? Math.max(0, at(i, band.line)) / total : 0;
          const yTop = pad.t + plotH - (lower[i] + share) * plotH;
          if (i === 0) ctx.moveTo(x(i), yTop);
          else ctx.lineTo(x(i), yTop);
        }
        for (let i = months - 1; i >= 0; i--) {
          ctx.lineTo(x(i), pad.t + plotH - lower[i] * plotH);
        }
        ctx.closePath();
        ctx.fillStyle = band.colour;
        ctx.fill();
        const next = new Float64Array(months);
        for (let i = 0; i < months; i++) {
          const total = bands.reduce((acc, b) => acc + Math.max(0, at(i, b.line)), 0);
          next[i] = lower[i] + (total > 0 ? Math.max(0, at(i, band.line)) / total : 0);
        }
        lower = next;
      }
      ctx.textAlign = 'left';
      let ly = pad.t + 12;
      for (const band of bands) {
        ctx.fillStyle = band.colour;
        ctx.fillRect(pad.l + 8, ly - 8, 9, 9);
        ctx.fillStyle = '#9aa0a6';
        ctx.font = '11px Inter, system-ui, sans-serif';
        ctx.fillText(band.label, pad.l + 22, ly);
        ly += 15;
      }
    } else if (chart === 'tonnage') {
      // Cumulative, so the slope is the rate and the height is the record.
      const series = new Float64Array(months);
      let acc = 0;
      for (let i = 0; i < months; i++) {
        acc += Math.max(0, at(i, Line.Haulage)) / 400;
        series[i] = acc;
      }
      drawLine(ctx, series, x, pad, plotH, '#c8a13a', (v) => num(v));
    } else if (chart === 'cash') {
      const cash = new Float64Array(months);
      const debt = new Float64Array(months);
      let c = 0;
      for (let i = 0; i < months; i++) {
        for (let l = 0; l < LINE_NAMES.length; l++) c += LINE_IS_INCOME[l] ? at(i, l) : -at(i, l);
        cash[i] = c;
        debt[i] = -at(i, Line.Interest) * 40;
      }
      drawLine(ctx, cash, x, pad, plotH, '#4fb477', (v) => shortMoney(v));
      drawLine(ctx, debt, x, pad, plotH, '#c8453c', (v) => shortMoney(v), true);
    } else {
      const income = new Float64Array(months);
      const spend = new Float64Array(months);
      for (let i = 0; i < months; i++) {
        for (let l = 0; l < LINE_NAMES.length; l++) {
          if (LINE_IS_INCOME[l]) income[i] += at(i, l);
          else spend[i] += at(i, l);
        }
      }
      let peak = 1;
      for (let i = 0; i < months; i++) peak = Math.max(peak, income[i], spend[i]);
      const mid = pad.t + plotH / 2;
      ctx.strokeStyle = 'rgba(232,230,223,0.22)';
      ctx.beginPath();
      ctx.moveTo(pad.l, mid);
      ctx.lineTo(W - pad.r, mid);
      ctx.stroke();
      const barW = Math.max(1.5, plotW / months - 1);
      for (let i = 0; i < months; i++) {
        ctx.fillStyle = 'rgba(79,180,119,0.8)';
        ctx.fillRect(x(i) - barW / 2, mid - (income[i] / peak) * (plotH / 2), barW, (income[i] / peak) * (plotH / 2));
        ctx.fillStyle = 'rgba(200,69,60,0.75)';
        ctx.fillRect(x(i) - barW / 2, mid, barW, (spend[i] / peak) * (plotH / 2));
      }
      ctx.fillStyle = '#666c72';
      ctx.textAlign = 'right';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(shortMoney(peak), pad.l - 8, pad.t + 10);
      ctx.fillText(shortMoney(-peak), pad.l - 8, pad.t + plotH);
    }

    ctx.fillStyle = '#666c72';
    ctx.textAlign = 'left';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(`${months} months`, pad.l, H - 8);
    ctx.textAlign = 'right';
    ctx.fillText(w.dateString(), W - pad.r, H - 8);
  }, [chart, engine.revision, w.companies.historyMonths]);

  const stats = saveStats(w);

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" style={{ width: 'min(900px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0, padding: '10px 14px', borderBottom: '1px solid var(--rule)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ flex: 1 }}>Reports</span>
          <div className="speeds">
            {CHARTS.map((c) => (
              <button key={c.id} aria-pressed={chart === c.id} onClick={() => setChart(c.id)}>{c.label}</button>
            ))}
          </div>
          <button className="btn tiny" onClick={onClose}>Close</button>
        </h2>
        <div className="body">
          <canvas ref={canvasRef} style={{ width: '100%', display: 'block' }} />
          <div className="legend">
            <span className="dim">{CHARTS.find((c) => c.id === chart)?.note}</span>
          </div>
          <dl className="kv" style={{ borderTop: '1px solid var(--rule)' }}>
            <dt>Rent share of income</dt><dd>{w.companies.rentShare(p)}%</dd>
            <dt>Infrastructure owned</dt><dd>{num(w.ownedAssets(p))} assets</dd>
            <dt>Tonnes moved</dt><dd>{num(w.stats.tonnesMoved)}</dd>
            <dt>Deliveries</dt><dd>{num(w.stats.delivered)}</dd>
            <dt>Reliability</dt><dd>{w.companies.reliability(p)}%</dd>
            <dt>Cash</dt><dd>{money(w.companies.cash[p])}</dd>
            <dt>Debt</dt><dd className={w.companies.debt[p] > 0 ? 'neg' : 'dim'}>{money(w.companies.debt[p])}</dd>
          </dl>
          {/*
            architecture.md §7 claims a save is kilobytes because it is a seed
            plus a command log. Worth being able to see the number rather than
            taking it on trust.
          */}
          <div className="legend">
            <span className="dim">
              This game is {num(stats.commands)} commands over {num(stats.ticks)} ticks —{' '}
              {(stats.bytes / 1024).toFixed(1)} kB of save.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  series: Float64Array,
  x: (i: number) => number,
  pad: { l: number; r: number; t: number; b: number },
  plotH: number,
  colour: string,
  fmt: (v: number) => string,
  skipLabels = false,
): void {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of series) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return;
  if (hi - lo < 1) hi = lo + 1;
  const y = (v: number): number => pad.t + plotH - ((v - lo) / (hi - lo)) * plotH;

  ctx.strokeStyle = colour;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < series.length; i++) {
    if (i === 0) ctx.moveTo(x(i), y(series[i]));
    else ctx.lineTo(x(i), y(series[i]));
  }
  ctx.stroke();

  if (skipLabels) return;
  ctx.fillStyle = '#666c72';
  ctx.textAlign = 'right';
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(fmt(hi), pad.l - 8, pad.t + 9);
  ctx.fillText(fmt(lo), pad.l - 8, pad.t + plotH);
}
