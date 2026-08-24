/**
 * The Junction Lab. design.md §2.1, D3, and the feature the spec says not to
 * cut.
 *
 * The whole game is grid-snapped placement, which is right for six transport
 * modes and throws away what made Freeways special. This is where that gets
 * put back, deliberately, in one contained place: alignments are placed on the
 * grid, but the node where they meet opens into an editor where you shape how
 * the movements resolve and watch the throughput respond.
 *
 * Every control is a direct manipulation of the plan rather than a form. You
 * click the chord you want banned. You drag a movement into a different signal
 * phase. You lift a movement onto a flyover and watch the conflicts it was in
 * disappear and the bill appear. The readout — throughput, mean delay,
 * 95th-percentile queue — updates on every change, because the point is the
 * feedback loop and not the numbers.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Control, MovementMode, decodeBlueprint, defaultConfig, encodeBlueprint,
  makeGeometry, movementsConflict, simulateJunction,
  type JunctionConfig, type JunctionResult,
} from '@interchange/sim';
import { content } from '@interchange/data';
import { money, num } from './format.ts';
import type { Engine } from './engine.ts';

const C = content();
const SIZE = 460;

const CONTROLS: { value: number; label: string; note: string }[] = [
  { value: Control.Priority, label: 'Priority', note: 'Whoever gets there first, with the longest wait breaking ties. Free, and it fails under load.' },
  { value: Control.Signals, label: 'Signals', note: 'Fixed phases. Predictable, fair, and it spends a share of every cycle on an empty arm.' },
  { value: Control.Roundabout, label: 'Roundabout', note: 'Circulating traffic has priority. Superb until one arm dominates, then it locks.' },
  { value: Control.AllWayStop, label: 'All-way stop', note: 'Strict round-robin. Nobody is ever starved and nobody ever gets anywhere quickly.' },
];

export function JunctionLab({
  engine, node, onClose,
}: {
  engine: Engine;
  node: number;
  onClose: () => void;
}): JSX.Element {
  const w = engine.world;
  const g = w.graph;

  // Arms, taken from the real node so the lab is shaping the real junction.
  const { bearings, cls, arms, names } = useMemo(() => {
    const outStart = g.nodeOutStart[node];
    const outEnd = g.nodeOutStart[node + 1];
    const b: number[] = [];
    const c: number[] = [];
    const nm: string[] = [];
    const size = w.config.size;
    const nodeTile = g.nodeTile[node];
    for (let i = outStart; i < outEnd; i++) {
      const link = g.outLinks[i];
      const len = g.linkChainLen[link];
      const start = g.linkChainStart[link];
      const forward = (link & 1) === 0;
      const next = g.chain[start + (forward ? Math.min(1, len - 1) : Math.max(0, len - 2))];
      const dx = (next % size) - (nodeTile % size);
      const dy = ((next / size) | 0) - ((nodeTile / size) | 0);
      const brad = Math.round((Math.atan2(dx, -dy) / (Math.PI * 2)) * 4096 + 4096) % 4096;
      b.push(brad);
      c.push(g.linkCls[link]);
      nm.push(compass(brad));
    }
    return { bearings: b, cls: c, arms: b.length, names: nm };
  }, [node, g.version]);

  const geo = useMemo(() => makeGeometry(bearings, cls), [bearings, cls]);
  const [config, setConfig] = useState<JunctionConfig>(() => defaultConfig(geo, g.nodeControl[node]));
  const [selected, setSelected] = useState(-1);
  /** Design load, per movement per hundred ticks. A junction with no traffic
   *  on it yet tells you nothing, so the Lab tests against a load you choose —
   *  which is also how you find out what it will do when the region grows. */
  const [load, setLoad] = useState(10);
  const [blueprint, setBlueprint] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Demand from the real flows through this node, so the lab is tuning against
  // the traffic the junction actually gets rather than a synthetic load.
  const demand = useMemo(() => {
    const d = new Float64Array(arms * arms);
    const outStart = g.nodeOutStart[node];
    for (let i = 0; i < arms; i++) {
      for (let o = 0; o < arms; o++) {
        if (i === o) continue;
        const link = g.outLinks[outStart + o];
        const flow = Math.max(g.linkFlowPrev[link], g.linkFlow[link]);
        // The measured flow if there is one, and the design load otherwise —
        // and the design load if it is higher, because the question the Lab
        // answers is "what will this do when it is busy".
        d[i * arms + o] = Math.max(load, (flow / Math.max(1, arms - 1)) * 0.12);
      }
    }
    return d;
  }, [node, g.version, arms, load]);

  const result: JunctionResult = useMemo(
    () => simulateJunction(geo, config, demand, 2400, 20250825),
    [geo, config, demand],
  );

  // ---- the plan ----------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, devicePixelRatio ?? 1);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);

    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const R = SIZE * 0.40;
    const px = (x: number): number => cx + x * R;
    const py = (y: number): number => cy + y * R;

    // The arms.
    ctx.lineCap = 'round';
    for (let i = 0; i < arms; i++) {
      const a = (bearings[i] / 4096) * Math.PI * 2;
      const ex = Math.sin(a);
      const ey = -Math.cos(a);
      ctx.strokeStyle = 'rgba(232,230,223,0.16)';
      ctx.lineWidth = 26;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(px(ex * 1.12), py(ey * 1.12));
      ctx.stroke();
      ctx.fillStyle = '#9aa0a6';
      ctx.font = '600 11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(names[i], px(ex * 1.24), py(ey * 1.24) + 4);
    }

    const phaseNow = 0;
    // Movement chords, drawn from where a vehicle enters to where it leaves.
    for (let i = 0; i < arms; i++) {
      for (let o = 0; o < arms; o++) {
        if (i === o) continue;
        const m = i * arms + o;
        const mode = config.movement[m];
        const isSel = m === selected;
        const ax = px(geo.inAx[i]);
        const ay = py(geo.inAy[i]);
        const bx = px(geo.outBx[o]);
        const by = py(geo.outBy[o]);

        if (mode === MovementMode.Banned) {
          ctx.strokeStyle = isSel ? 'rgba(200,69,60,0.9)' : 'rgba(200,69,60,0.22)';
          ctx.setLineDash([4, 5]);
          ctx.lineWidth = isSel ? 3 : 1.5;
        } else if (mode === MovementMode.Separated) {
          ctx.strokeStyle = isSel ? '#e8d9a0' : 'rgba(200,161,58,0.75)';
          ctx.setLineDash([]);
          ctx.lineWidth = isSel ? 5 : 3.5;
        } else {
          // At grade: coloured by whether it is in conflict with anything else
          // that is also permitted. Red chords are where the delay comes from.
          let conflicted = false;
          for (let k = 0; k < arms * arms && !conflicted; k++) {
            if (k === m || config.movement[k] === MovementMode.Banned) continue;
            if (movementsConflict(geo, config.movement, m, k, arms)) conflicted = true;
          }
          ctx.strokeStyle = isSel
            ? '#f2f0e6'
            : conflicted ? 'rgba(212,131,47,0.72)' : 'rgba(79,180,119,0.72)';
          ctx.setLineDash([]);
          ctx.lineWidth = isSel ? 4 : 2;
        }

        // A curve rather than a straight line, bowed away from the centre, so
        // two opposite movements do not lie on top of each other.
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo(cx + (ax - cx) * 0.12 + (bx - cx) * 0.12, cy + (ay - cy) * 0.12 + (by - cy) * 0.12, bx, by);
        ctx.stroke();
        ctx.setLineDash([]);

        if (config.control === Control.Signals && mode === MovementMode.AtGrade) {
          const t = 0.5;
          const mx = (ax + bx) / 2 * (1 - t) + cx * t;
          const my = (ay + by) / 2 * (1 - t) + cy * t;
          ctx.fillStyle = PHASE_COLOURS[config.phase[m] % PHASE_COLOURS.length] ?? '#888';
          ctx.beginPath();
          ctx.arc(mx, my, isSel ? 7 : 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#0e1116';
          ctx.font = '700 9px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(String(config.phase[m] + 1), mx, my + 3);
        }
      }
    }
    void phaseNow;

    // Queue bars: the readout drawn where the queue actually is.
    for (let i = 0; i < arms; i++) {
      const a = (bearings[i] / 4096) * Math.PI * 2;
      const ex = Math.sin(a);
      const ey = -Math.cos(a);
      const q = result.perArm[i]?.p95Queue ?? 0;
      const frac = Math.min(1, q / 30);
      ctx.strokeStyle = frac > 0.8 ? '#c8453c' : frac > 0.45 ? '#d4832f' : '#4fb477';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(px(ex * 1.14 + ey * 0.12), py(ey * 1.14 - ex * 0.12));
      ctx.lineTo(px(ex * (1.14 - frac * 0.5) + ey * 0.12), py(ey * (1.14 - frac * 0.5) - ex * 0.12));
      ctx.stroke();
    }
  }, [geo, config, selected, result, arms, bearings, names]);

  const setMovement = (m: number, mode: number): void => {
    const next = { ...config, movement: Uint8Array.from(config.movement) };
    next.movement[m] = mode;
    setConfig(next);
  };

  const cyclePhase = (m: number): void => {
    const next = { ...config, phase: Int32Array.from(config.phase) };
    next.phase[m] = (next.phase[m] + 1) % config.phaseCount;
    setConfig(next);
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * SIZE;
    const y = ((e.clientY - r.top) / r.height) * SIZE;
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const R = SIZE * 0.4;
    let best = -1;
    let bestD = 26;
    for (let i = 0; i < arms; i++) {
      for (let o = 0; o < arms; o++) {
        if (i === o) continue;
        const ax = cx + geo.inAx[i] * R;
        const ay = cy + geo.inAy[i] * R;
        const bx = cx + geo.outBx[o] * R;
        const by = cy + geo.outBy[o] * R;
        const d = distanceToSegment(x, y, ax, ay, bx, by);
        if (d < bestD) {
          bestD = d;
          best = i * arms + o;
        }
      }
    }
    setSelected(best);
  };

  const cost = result.structureCost;
  const canAfford = w.companies.cash[w.player] >= cost;

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" style={{ width: 'min(1060px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0, padding: '10px 14px', borderBottom: '1px solid var(--rule)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ flex: 1 }}>Junction Lab — {arms} arms</span>
          <button className="btn tiny" onClick={onClose}>Close</button>
        </h2>
        <div className="body" style={{ display: 'flex', gap: 0 }}>
          <div style={{ padding: 14, borderRight: '1px solid var(--rule)' }}>
            <canvas
              ref={canvasRef}
              onClick={onCanvasClick}
              style={{ width: SIZE, height: SIZE, display: 'block', cursor: 'crosshair' }}
            />
            <div className="legend" style={{ borderTop: 0, paddingLeft: 0 }}>
              <span><i style={{ background: '#4fb477' }} />free</span>
              <span><i style={{ background: '#d4832f' }} />in conflict</span>
              <span><i style={{ background: '#c8a13a' }} />grade separated</span>
              <span><i style={{ background: '#c8453c' }} />banned</span>
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 320 }}>
            <div className="ledger"><div className="head">Control</div></div>
            {CONTROLS.map((c) => (
              <div
                key={c.value}
                className={`row click ${config.control === c.value ? 'selected' : ''}`}
                onClick={() => setConfig({ ...defaultConfig(geo, c.value), movement: config.movement })}
              >
                <div className="grow">
                  <div className="title">{c.label}</div>
                  <div className="sub" style={{ whiteSpace: 'normal', fontFamily: 'inherit' }}>{c.note}</div>
                </div>
              </div>
            ))}

            {config.control === Control.Signals && (
              <div className="row">
                <span className="grow title">Phase length</span>
                <button className="btn tiny" onClick={() => setConfig({ ...config, phaseTicks: Math.max(6, config.phaseTicks - 6) })}>−</button>
                <span className="mono">{config.phaseTicks}</span>
                <button className="btn tiny" onClick={() => setConfig({ ...config, phaseTicks: Math.min(90, config.phaseTicks + 6) })}>+</button>
              </div>
            )}
            {config.control === Control.Roundabout && (
              <div className="row">
                <span className="grow title">Circulating size</span>
                <button className="btn tiny" onClick={() => setConfig({ ...config, roundaboutSize: Math.max(3, config.roundaboutSize - 1) })}>−</button>
                <span className="mono">{config.roundaboutSize}</span>
                <button className="btn tiny" onClick={() => setConfig({ ...config, roundaboutSize: Math.min(20, config.roundaboutSize + 1) })}>+</button>
              </div>
            )}

            <div className="ledger"><div className="head">Selected movement</div></div>
            {selected < 0 ? (
              <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--ink-dim)' }}>
                Click a line on the plan. Orange lines are the ones in conflict — those are where the delay is.
              </div>
            ) : (
              <>
                <div className="row">
                  <span className="grow title">
                    {names[(selected / arms) | 0]} → {names[selected % arms]}
                  </span>
                </div>
                <div className="row">
                  <button className="btn tiny" aria-pressed={config.movement[selected] === MovementMode.AtGrade}
                    onClick={() => setMovement(selected, MovementMode.AtGrade)}>At grade</button>
                  <button className="btn tiny" aria-pressed={config.movement[selected] === MovementMode.Separated}
                    onClick={() => setMovement(selected, MovementMode.Separated)}>Grade separate</button>
                  <button className="btn tiny danger" aria-pressed={config.movement[selected] === MovementMode.Banned}
                    onClick={() => setMovement(selected, MovementMode.Banned)}>Ban</button>
                  {config.control === Control.Signals && config.movement[selected] === MovementMode.AtGrade && (
                    <button className="btn tiny" onClick={() => cyclePhase(selected)}>
                      Phase {config.phase[selected] + 1}
                    </button>
                  )}
                </div>
              </>
            )}

            <div className="ledger"><div className="head">Performance</div></div>
            <div className="row">
              <span className="grow title">Design load</span>
              <button className="btn tiny" onClick={() => setLoad(Math.max(1, load - 3))}>−</button>
              <span className="mono">{load}/100 per movement</span>
              <button className="btn tiny" onClick={() => setLoad(Math.min(60, load + 3))}>+</button>
            </div>
            <dl className="kv">
              <dt>Throughput</dt>
              <dd>{result.throughput.toFixed(1)} / 100 ticks</dd>
              <dt>Mean delay</dt>
              <dd className={result.meanDelay > 40 ? 'neg' : result.meanDelay > 15 ? 'warnc' : 'pos'}>
                {result.meanDelay.toFixed(1)} ticks
              </dd>
              <dt>95th-percentile queue</dt>
              <dd className={result.p95Queue > 20 ? 'neg' : result.p95Queue > 9 ? 'warnc' : 'pos'}>
                {result.p95Queue} vehicles
              </dd>
              {result.stranded > 0 && (<><dt>Turned away</dt><dd className="neg">{num(result.stranded)}</dd></>)}
              {cost > 0 && (<><dt>Structure</dt><dd className={canAfford ? '' : 'neg'}>{money(cost)}</dd></>)}
            </dl>
            {result.disconnected && (
              <div style={{ padding: '0 10px 8px', fontSize: 11.5, color: 'var(--bad)' }}>
                An arm has no permitted movement out of it. Traffic arriving there can never leave.
              </div>
            )}

            <div className="ledger"><div className="head">Blueprint</div></div>
            <div className="row">
              <input
                className="mono"
                value={blueprint}
                onChange={(e) => setBlueprint(e.target.value)}
                placeholder="paste to load"
                style={{ flex: 1, background: '#14181e', border: '1px solid var(--rule)', color: 'var(--ink)', fontSize: 11, padding: '4px 6px' }}
              />
              <button className="btn tiny" onClick={() => setBlueprint(encodeBlueprint('junction', config, arms))}>Copy</button>
              <button className="btn tiny" onClick={() => {
                const d = decodeBlueprint(blueprint);
                if (d && d.arms === arms) setConfig(d.config);
              }}>Load</button>
            </div>

            <div className="row">
              <div className="grow" />
              <button
                className="btn primary"
                disabled={!canAfford || result.disconnected}
                onClick={() => {
                  engine.issue(0x2a, node, config.control);
                  onClose();
                }}
              >Apply to junction</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const PHASE_COLOURS = ['#4fb477', '#e0b040', '#7f9fd4', '#c88ad4', '#4fbfa8', '#d4832f', '#9aa0a6', '#c8453c'];

function compass(brad: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(brad / 512) % 8];
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  const qx = ax + dx * t;
  const qy = ay + dy * t;
  return Math.hypot(px - qx, py - qy);
}

export { C };
