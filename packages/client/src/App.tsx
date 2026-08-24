import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SPEED_STEPS, CHARTER_NAMES, TICKS_PER_DAY } from '@interchange/sim';
import { OverlayMode } from '@interchange/render';
import { content } from '@interchange/data';
import { Engine } from './engine.ts';
import { WorldView, type Picked } from './WorldView.tsx';
import { CharterPanel, Contracts, Finance, Fleet, FleetList, Inspector, Services } from './panels.tsx';
import { Perf } from './Perf.tsx';
import { ArtReview } from './ArtReview.tsx';
import { money, num, shortMoney } from './format.ts';

const C = content();

type Window_ = 'services' | 'contracts' | 'fleet' | 'finance' | 'charter' | null;

/**
 * A region is a seed and a size, so a region is a URL. `?seed=1860&size=512`
 * reproduces someone else's map exactly, and `&play` skips the start card —
 * which is what a playtest link wants to be.
 */
function urlParams(): { seed: number | null; size: number | null; play: boolean; perf: boolean; art: boolean } {
  const q = new URLSearchParams(globalThis.location?.search ?? '');
  const seed = q.get('seed');
  const size = q.get('size');
  return {
    seed: seed === null ? null : Number(seed) || null,
    size: size === null ? null : Number(size) || null,
    play: q.has('play'),
    perf: q.has('perf'),
    art: q.has('art'),
  };
}

export function App(): JSX.Element {
  const params = useMemo(urlParams, []);
  // The performance harness is a different application that happens to share a
  // renderer, so it forks here rather than living inside the game's state.
  if (params.perf) return <Perf />;
  if (params.art) return <ArtReview />;
  const [seed, setSeed] = useState(() => params.seed ?? 1860 + Math.floor(Math.random() * 9000));
  const [size, setSize] = useState(() => params.size ?? 512);
  const [started, setStarted] = useState(params.play);
  const [engine, setEngine] = useState<Engine | null>(() =>
    params.play ? new Engine({ seed: params.seed ?? 1860, size: params.size ?? 512, townCount: (params.size ?? 512) >= 512 ? 14 : 9, companyCount: 4 }) : null,
  );

  if (!started || !engine) {
    return (
      <StartCard
        seed={seed}
        size={size}
        setSeed={setSeed}
        setSize={setSize}
        onStart={() => {
          setEngine(new Engine({ seed, size, townCount: size >= 512 ? 14 : 9, companyCount: 4 }));
          setStarted(true);
        }}
      />
    );
  }
  return <Game engine={engine} />;
}

function StartCard({
  seed, size, setSeed, setSize, onStart,
}: {
  seed: number; size: number;
  setSeed: (n: number) => void; setSize: (n: number) => void;
  onStart: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  return (
    <div className="start">
      <div className="card">
        <h1>Interchange</h1>
        <div className="tag">
          An isometric transport and development sim spanning 1860 to 2100. You
          start with a single horse dray hauling somebody else’s ore. The roads
          belong to the regional authority, and you pay to use every one of them.
        </div>
        <div className="fields">
          <label>
            Region seed
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 1860)}
            />
          </label>
          <label>
            Region size
            <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
              <option value={256}>256 × 256 — quick</option>
              <option value={384}>384 × 384 — compact</option>
              <option value={512}>512 × 512 — standard</option>
              <option value={768}>768 × 768 — large</option>
              <option value={1024}>1024 × 1024 — full region</option>
            </select>
          </label>
        </div>
        <div className="actions">
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              // A beat for the button to repaint before terrain generation
              // blocks the thread for a second or so. Deliberately a timeout
              // and not requestAnimationFrame: rAF does not fire in a
              // background tab, so a player who clicks Begin and switches away
              // comes back to a start card that never started.
              setTimeout(onStart, 24);
            }}
          >{busy ? 'Surveying the region…' : 'Begin, 1860'}</button>
          <button className="btn" onClick={() => setSeed(1860 + Math.floor(Math.random() * 9000))}>
            New seed
          </button>
        </div>
      </div>
    </div>
  );
}

function Game({ engine }: { engine: Engine }): JSX.Element {
  const [, force] = useState(0);
  const [picked, setPicked] = useState<Picked>({ kind: 'none', id: -1, tile: -1 });
  const [leftWindow, setLeftWindow] = useState<Window_>('services');
  const [rightWindow, setRightWindow] = useState<Window_>('charter');
  const [activeService, setActiveService] = useState(-1);
  const [showDepot, setShowDepot] = useState(false);
  const [hover, setHover] = useState<{ text: string; x: number; y: number } | null>(null);
  const lastEventTick = useRef(0);

  useEffect(() => engine.subscribe(() => force((n) => n + 1)), [engine]);

  const w = engine.world;
  const overlay = engine.renderer?.overlay ?? OverlayMode.None;

  const focus = useCallback((x: number, y: number) => {
    const r = engine.renderer;
    if (!r) return;
    r.camState.x = x;
    r.camState.z = y;
  }, [engine]);

  const onPick = useCallback((p: Picked) => {
    setPicked(p);
    if (engine.renderer) engine.renderer.selectedVehicle = p.kind === 'vehicle' ? p.id : -1;
    if (p.kind !== 'none') setRightWindow(null);
  }, [engine]);

  const onHover = useCallback((p: Picked | null, screen: { x: number; y: number } | null) => {
    if (!p || !screen) { setHover(null); return; }
    const wd = engine.world;
    let text = '';
    if (p.kind === 'vehicle') {
      const def = C.vehicles[wd.vehicles.type[p.id]];
      const load = wd.vehicles.load[p.id];
      const cargo = wd.vehicles.cargo[p.id];
      text = `${def.name}${cargo === 255 ? ' — empty' : ` — ${load}t ${C.cargo[cargo].name}`}`;
    } else if (p.kind === 'site') {
      text = `${C.industries[wd.sites.def[p.id]].name}`;
    } else if (p.kind === 'town') {
      text = `${wd.towns.names[p.id]} — ${num(wd.towns.population[p.id])}`;
    } else return setHover(null);
    setHover({ text, x: screen.x, y: screen.y });
  }, [engine]);

  const speed = w.speed;
  const cash = w.companies.cash[w.player];
  const debt = w.companies.debt[w.player];
  const events = engine.events.filter((e) => w.tick - e.tick < TICKS_PER_DAY * 24).slice(0, 4);
  useEffect(() => {
    if (events.length > 0) lastEventTick.current = events[0].tick;
  }, [events.length]);

  const era = useMemo(() => C.eras.find((e) => e.n === w.era) ?? C.eras[0], [w.era]);

  return (
    <div className="app">
      <WorldView engine={engine} onPick={onPick} onHover={onHover} />

      <div className="hud">
        <div className="topbar">
          <div className="brand">Interchange</div>
          <div className="cell">
            <div className="label">Date</div>
            <div className="value">{w.dateString()}</div>
          </div>
          <div className="cell">
            <div className="label">Era {era.n} · {era.name}</div>
            <div className="value small">{era.from}–{era.to}</div>
          </div>
          <div className="cell">
            <div className="label">Cash</div>
            <div className={`value ${cash < 0 ? 'neg' : ''}`}>{money(cash)}</div>
          </div>
          {debt > 0 && (
            <div className="cell">
              <div className="label">Debt</div>
              <div className="value neg">{money(debt)}</div>
            </div>
          )}
          <div className="cell">
            <div className="label">Charter</div>
            <div className="value small">{CHARTER_NAMES[w.companies.charter[w.player]]}</div>
          </div>
          <div className="cell grow">
            <div className="label">Moved</div>
            <div className="value small">
              {num(w.stats.tonnesMoved)} t · {w.vehicles.count} vehicles · {engine.fps.toFixed(0)} fps
            </div>
          </div>
          <div className="speeds">
            {SPEED_STEPS.map((s, i) => (
              <button key={i} aria-pressed={speed === i} onClick={() => engine.setSpeed(i)}>
                {s === 0 ? '❚❚' : `${s}×`}
              </button>
            ))}
          </div>
          <button className="btn" style={{ margin: 4 }} onClick={() => setShowDepot(true)}>Depot</button>
        </div>

        <div className="rail">
          <RailButton label="Services" icon="⇄" on={leftWindow === 'services'} onClick={() => setLeftWindow(leftWindow === 'services' ? null : 'services')} />
          <RailButton label="Contracts" icon="§" on={leftWindow === 'contracts'} onClick={() => setLeftWindow(leftWindow === 'contracts' ? null : 'contracts')} />
          <RailButton label="Fleet" icon="⬒" on={leftWindow === 'fleet'} onClick={() => setLeftWindow(leftWindow === 'fleet' ? null : 'fleet')} />
          <div style={{ height: 8 }} />
          <RailButton label="Congestion overlay" icon="◍" on={overlay === OverlayMode.Congestion} onClick={() => engine.setOverlay(overlay === OverlayMode.Congestion ? OverlayMode.None : OverlayMode.Congestion)} />
          <RailButton label="Ownership overlay" icon="◈" on={overlay === OverlayMode.Ownership} onClick={() => engine.setOverlay(overlay === OverlayMode.Ownership ? OverlayMode.None : OverlayMode.Ownership)} />
          <RailButton label="Amenity overlay" icon="❋" on={overlay === OverlayMode.Amenity} onClick={() => engine.setOverlay(overlay === OverlayMode.Amenity ? OverlayMode.None : OverlayMode.Amenity)} />
        </div>

        {leftWindow === 'services' && <Services engine={engine} active={activeService} setActive={setActiveService} onFocus={focus} />}
        {leftWindow === 'contracts' && <Contracts engine={engine} onFocus={focus} />}
        {leftWindow === 'fleet' && <FleetList engine={engine} onSelect={(id) => onPick({ kind: 'vehicle', id, tile: -1 })} />}

        {picked.kind !== 'none'
          ? <Inspector engine={engine} picked={picked} activeService={activeService} onFocus={focus} />
          : rightWindow === 'finance' ? <Finance engine={engine} />
          : rightWindow === 'charter' ? <CharterPanel engine={engine} />
          : null}

        <div className="rail" style={{ gridColumn: 3, justifySelf: 'end' }}>
          <RailButton label="Charter" icon="✦" on={rightWindow === 'charter' && picked.kind === 'none'} onClick={() => { setPicked({ kind: 'none', id: -1, tile: -1 }); setRightWindow(rightWindow === 'charter' ? null : 'charter'); }} />
          <RailButton label="Finance" icon="£" on={rightWindow === 'finance' && picked.kind === 'none'} onClick={() => { setPicked({ kind: 'none', id: -1, tile: -1 }); setRightWindow(rightWindow === 'finance' ? null : 'finance'); }} />
        </div>

        <div className="log">
          {events.map((e, i) => (
            <div key={`${e.tick}-${i}`} className={`msg ${e.kind === 'bankruptcy' || e.kind === 'refused' ? 'bad' : e.kind === 'charter' ? 'good' : ''}`}>
              {e.text}
            </div>
          ))}
        </div>
      </div>

      {overlay !== OverlayMode.None && <OverlayLegend mode={overlay} />}
      {hover && <div className="tooltip" style={{ left: hover.x, top: hover.y - 10 }}>{hover.text}</div>}
      {showDepot && <Fleet engine={engine} onClose={() => setShowDepot(false)} />}
    </div>
  );
}

function RailButton({ label, icon, on, onClick }: { label: string; icon: string; on: boolean; onClick: () => void }): JSX.Element {
  return <button aria-pressed={on} title={label} onClick={onClick}>{icon}</button>;
}

/** Overlay modes recolour the world wholesale, so the legend is the only mark
 *  the mode adds — and it lives in the DOM, not the world (art-direction §14). */
function OverlayLegend({ mode }: { mode: OverlayMode }): JSX.Element {
  const items =
    mode === OverlayMode.Congestion
      ? [['#4fb477', 'free'], ['#e0b040', 'busy'], ['#d4632f', 'congested'], ['#c02f2f', 'jammed']]
      : mode === OverlayMode.Ownership
        ? [['#4fb477', 'yours'], ['#7c8288', 'the authority'], ['#c85a3c', 'a rival']]
        : [['#4a7a52', 'high amenity'], ['#b06040', 'degraded']];
  return (
    <div className="panel legend" style={{ position: 'absolute', bottom: 10, left: 64 }}>
      {items.map(([c, l]) => (
        <span key={l}><i style={{ background: c }} />{l}</span>
      ))}
    </div>
  );
}
