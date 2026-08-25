import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SPEED_STEPS, CHARTER_NAMES, TICKS_PER_DAY, Cmd, Mode, createWorld,
} from '@interchange/sim';
import { OverlayMode } from '@interchange/render';
import { content } from '@interchange/data';
import { Engine } from './engine.ts';
import { SettingsPanel } from './Settings.tsx';
import { loadSettings } from './settings.ts';
import { WorldView, type Picked } from './WorldView.tsx';
import { BuildPalette, CharterPanel, Contracts, Finance, Fleet, FleetList, Industries, Inspector, Ownership, Saves, Services } from './panels.tsx';
import { Reports } from './Reports.tsx';
import { loadWorld, saveWorld } from './saves.ts';
import { applyPreview, clearPreview, emptyBuildState, updatePlan } from './build.ts';
import { JunctionLab } from './JunctionLab.tsx';
import { ArtReview } from './ArtReview.tsx';
import { money, num, shortMoney } from './format.ts';

const C = content();

type Window_ = 'services' | 'contracts' | 'fleet' | 'finance' | 'charter' | 'build' | 'ownership' | 'industry' | null;

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
  if (params.art) return <ArtReview />;
  const [seed, setSeed] = useState(() => params.seed ?? 1860 + Math.floor(Math.random() * 9000));
  const [size, setSize] = useState(() => params.size ?? 512);
  const [started, setStarted] = useState(params.play);
  // Session state lives outside React, so a change in it has to be pushed in.
  const [, nudge] = useState(0);
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
          setEngine(new Engine({ seed, size, townCount: 5, companyCount: 1 }));
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
  const [sharing, setSharing] = useState(false);
  const [relay, setRelay] = useState(() => {
    const here = globalThis.location;
    const proto = here?.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${here?.host ?? 'localhost:8787'}/relay`;
  });
  const [room, setRoom] = useState('the-vale');
  const [who, setWho] = useState('Player');
  return (
    <div className="start">
      <div className="card">
        <h1>Interchange</h1>
        <div className="tag">
          One district, ten years, and a yard with two trucks. You start hauling
          milk from a farm to the creamery, on roads that belong to the council,
          and you pay for every mile of it. Buy trucks, then yards, then the
          road itself.
        </div>
        <div className="fields">
          <label>
            Region seed
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 1985)}
            />
          </label>
          <label>
            Region size
            {/* One size. decisions.md D6: "small worlds that look beautiful"
                and a 32 km square are not compatible, and the tiers were a
                performance hedge for a scale no longer being built. */}
            <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
              <option value={256}>256 × 256 — one district</option>
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
          >{busy ? 'Surveying the district…' : 'Begin, 1985'}</button>
          <button className="btn" onClick={() => setSeed(1985 + Math.floor(Math.random() * 9000))}>
            New seed
          </button>
        </div>
      </div>
    </div>
  );
}

function Game({ engine: initialEngine }: { engine: Engine }): JSX.Element {
  // The engine is state, because loading a save replaces the world entirely
  // and everything holding a reference to the old one has to let go of it.
  const [engine, setEngine] = useState(initialEngine);
  const [, force] = useState(0);
  const [picked, setPicked] = useState<Picked>({ kind: 'none', id: -1, tile: -1 });
  const [leftWindow, setLeftWindow] = useState<Window_>('services');
  const [rightWindow, setRightWindow] = useState<Window_>('charter');
  const [activeService, setActiveService] = useState(-1);
  const [showDepot, setShowDepot] = useState(false);
  const [labNode, setLabNode] = useState(-1);
  const [foundIndustry, setFoundIndustry] = useState(-1);
  const [hoverTile, setHoverTile] = useState(-1);
  const [showSaves, setShowSaves] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  /** features.md 19: photo mode. Everything the interface draws goes away and
   *  the world stays, which is the whole feature. */
  const [photo, setPhoto] = useState(false);
  const [hover, setHover] = useState<{ text: string; x: number; y: number } | null>(null);
  const lastEventTick = useRef(0);
  // Build state lives in a ref: the drag handlers are installed once and the
  // plan changes many times a second, so putting it in React state would mean
  // a re-render per tile crossed.
  const build = useRef(emptyBuildState());
  const [buildTick, setBuildTick] = useState(0);

  useEffect(() => engine.subscribe(() => force((n) => n + 1)), [engine]);

  const lastAutosave = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      const year = engine.world.year;
      if (year === lastAutosave.current) return;
      lastAutosave.current = year;
      if (engine.world.tick > 0) saveWorld(engine.world, `${engine.world.companies.names[engine.world.player]} — ${year}`, true);
    }, 4000);
    return () => clearInterval(id);
  }, [engine]);

  const w = engine.world;
  const overlay = engine.renderer?.overlay ?? OverlayMode.None;

  const focus = useCallback((x: number, y: number) => {
    const r = engine.renderer;
    if (!r) return;
    r.camState.x = x;
    r.camState.z = y;
  }, [engine]);

  const onDragStart = useCallback((tile: number) => {
    const b = build.current;
    if (!b.selection && !b.demolish) return false;
    b.fromTile = tile;
    b.toTile = -1;
    updatePlan(engine, b, tile);
    applyPreview(engine, b);
    return true;
  }, [engine]);

  const onDragMove = useCallback((tile: number) => {
    const b = build.current;
    if (b.fromTile < 0) return;
    if (b.demolish) {
      // Demolition is a straight line rather than a route: you are taking up
      // what is there, not planning something new.
      const size = engine.world.config.size;
      b.path = lineBetween(b.fromTile, tile, size);
      b.plan = null;
      applyPreview(engine, b);
      engine.renderer?.setPreview(b.path, null, null, false, size);
      return;
    }
    if (updatePlan(engine, b, tile)) {
      applyPreview(engine, b);
      setBuildTick((n) => n + 1);
    }
  }, [engine]);

  const onDragEnd = useCallback((tile: number) => {
    const b = build.current;
    if (b.fromTile < 0) return;
    if (b.demolish && b.path) {
      engine.issue(Cmd.DemolishWay, Mode.Road, 0, 0, 0, [...b.path]);
      engine.issue(Cmd.DemolishWay, Mode.Rail, 0, 0, 0, [...b.path]);
    } else if (b.selection && b.plan && b.plan.ok && b.path) {
      engine.issue(Cmd.BuildWay, b.selection.mode, b.selection.cls, 0, 0, [...b.path]);
    }
    clearPreview(engine, b);
    setBuildTick((n) => n + 1);
    void tile;
  }, [engine]);

  const onPick = useCallback((p: Picked) => {
    if (foundIndustry >= 0 && p.tile >= 0) {
      engine.issue(Cmd.FoundIndustry, foundIndustry, p.tile);
      setFoundIndustry(-1);
      return;
    }
    if (p.kind === 'tile' && p.tile >= 0) {
      const gph = engine.world.graph;
      for (let mode = 0; mode < 2; mode++) {
        const n = gph.nodeAt(mode, p.tile);
        if (n >= 0 && gph.nodeOutStart[n + 1] - gph.nodeOutStart[n] >= 3) {
          setLabNode(n);
          return;
        }
      }
    }
    setPicked(p);
    if (engine.renderer) engine.renderer.selectedVehicle = p.kind === 'vehicle' ? p.id : -1;
    if (p.kind !== 'none') setRightWindow(null);
  }, [engine, foundIndustry]);

  const onHover = useCallback((p: Picked | null, screen: { x: number; y: number } | null) => {
    if (p && p.tile >= 0) setHoverTile(p.tile);
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

  // The world view owns the keyboard for camera control, so it announces this
  // rather than knowing what the interface does about it.
  useEffect(() => {
    const toggle = (): void => setPhoto((v) => !v);
    window.addEventListener('interchange:photo', toggle);
    return () => window.removeEventListener('interchange:photo', toggle);
  }, []);

  return (
    <div className={`app${photo ? ' photo' : ''}`}>
      <WorldView engine={engine} onPick={onPick} onHover={onHover}
        onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} />

      {photo && <PhotoBar engine={engine} onLeave={() => setPhoto(false)} />}

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
          <button className="btn" style={{ margin: '4px 4px 4px 0' }} onClick={() => setShowReports(true)}>Reports</button>
          <button className="btn" style={{ margin: '4px 4px 4px 0' }} onClick={() => setShowSettings(true)} aria-label="Settings and key bindings">Settings</button>
          <button className="btn" style={{ margin: '4px 4px 4px 0' }} onClick={() => setShowSaves(true)}>Saves</button>
        </div>

        <div className="rail">
          <RailButton label="Services" icon="⇄" on={leftWindow === 'services'} onClick={() => setLeftWindow(leftWindow === 'services' ? null : 'services')} />
          <RailButton label="Contracts" icon="§" on={leftWindow === 'contracts'} onClick={() => setLeftWindow(leftWindow === 'contracts' ? null : 'contracts')} />
          <RailButton label="Fleet" icon="⬒" on={leftWindow === 'fleet'} onClick={() => setLeftWindow(leftWindow === 'fleet' ? null : 'fleet')} />
          <RailButton label="Construction" icon="⌂" on={leftWindow === 'build'} onClick={() => {
            setLeftWindow(leftWindow === 'build' ? null : 'build');
            if (leftWindow === 'build') { build.current.selection = null; build.current.demolish = false; clearPreview(engine, build.current); }
          }} />
          <RailButton label="Ownership" icon="§§" on={leftWindow === 'ownership'} onClick={() => setLeftWindow(leftWindow === 'ownership' ? null : 'ownership')} />
          <RailButton label="Found industry" icon="⛭" on={leftWindow === 'industry'} onClick={() => {
            setLeftWindow(leftWindow === 'industry' ? null : 'industry');
            if (leftWindow === 'industry') setFoundIndustry(-1);
          }} />
          <RailButton label="Junction Lab — the busiest junction on your network" icon="✳" on={labNode >= 0} onClick={() => {
            if (labNode >= 0) { setLabNode(-1); return; }
            // The busiest junction with something to arbitrate. Opening the
            // Lab on a two-arm node would be opening it on a straight road.
            const gph = engine.world.graph;
            let best = -1;
            let bestFlow = -1;
            for (let i = 0; i < gph.nodeCount; i++) {
              const arms = gph.nodeOutStart[i + 1] - gph.nodeOutStart[i];
              if (arms < 3) continue;
              let flow = 0;
              for (let k = gph.nodeOutStart[i]; k < gph.nodeOutStart[i + 1]; k++) {
                flow += gph.linkFlowPrev[gph.outLinks[k]] + gph.linkFlow[gph.outLinks[k]];
              }
              if (flow > bestFlow) { bestFlow = flow; best = i; }
            }
            if (best >= 0) setLabNode(best);
          }} />
          <div style={{ height: 8 }} />
          <RailButton label="Congestion overlay" icon="◍" on={overlay === OverlayMode.Congestion} onClick={() => engine.setOverlay(overlay === OverlayMode.Congestion ? OverlayMode.None : OverlayMode.Congestion)} />
          <RailButton label="Ownership overlay" icon="◈" on={overlay === OverlayMode.Ownership} onClick={() => engine.setOverlay(overlay === OverlayMode.Ownership ? OverlayMode.None : OverlayMode.Ownership)} />
          <RailButton label="Amenity overlay" icon="❋" on={overlay === OverlayMode.Amenity} onClick={() => engine.setOverlay(overlay === OverlayMode.Amenity ? OverlayMode.None : OverlayMode.Amenity)} />
          <RailButton label="Labour catchment" icon="☗" on={overlay === OverlayMode.Catchment} onClick={() => engine.setOverlay(overlay === OverlayMode.Catchment ? OverlayMode.None : OverlayMode.Catchment)} />
          <RailButton label="Power grid" icon="⚡" on={overlay === OverlayMode.Power} onClick={() => engine.setOverlay(overlay === OverlayMode.Power ? OverlayMode.None : OverlayMode.Power)} />
          <RailButton label="Water network" icon="≋" on={overlay === OverlayMode.Water} onClick={() => engine.setOverlay(overlay === OverlayMode.Water ? OverlayMode.None : OverlayMode.Water)} />
          <RailButton label="Cargo flow — what each way carries" icon="⇉" on={overlay === OverlayMode.Cargo} onClick={() => engine.setOverlay(overlay === OverlayMode.Cargo ? OverlayMode.None : OverlayMode.Cargo)} />
          <RailButton label="Photo mode — hide the interface" icon="▣" on={photo} onClick={() => setPhoto(true)} />
        </div>

        {leftWindow === 'services' && <Services engine={engine} active={activeService} setActive={setActiveService} onFocus={focus} />}
        {leftWindow === 'contracts' && <Contracts engine={engine} onFocus={focus} />}
        {leftWindow === 'fleet' && <FleetList engine={engine} onSelect={(id) => onPick({ kind: 'vehicle', id, tile: -1 })} />}
        {leftWindow === 'build' && (
          <BuildPalette
            engine={engine}
            state={build.current}
            onSelect={(mode, cls) => {
              const b = build.current;
              b.selection = b.selection?.cls === cls ? null : { mode, cls };
              b.demolish = false;
              clearPreview(engine, b);
              setBuildTick((n) => n + 1);
            }}
            onDemolish={() => {
              const b = build.current;
              b.demolish = !b.demolish;
              b.selection = null;
              clearPreview(engine, b);
              setBuildTick((n) => n + 1);
            }}
          />
        )}
        {leftWindow === 'ownership' && <Ownership engine={engine} onFocus={focus} />}
        {leftWindow === 'industry' && (
          <Industries engine={engine} selected={foundIndustry} onSelect={setFoundIndustry} tile={hoverTile} />
        )}

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

      {overlay !== OverlayMode.None && <OverlayLegend mode={overlay} engine={engine} />}
      {hover && <div className="tooltip" style={{ left: hover.x, top: hover.y - 10 }}>{hover.text}</div>}
      {showDepot && <Fleet engine={engine} onClose={() => setShowDepot(false)} />}
      {showReports && <Reports engine={engine} onClose={() => setShowReports(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showSaves && (
        <Saves
          engine={engine}
          onClose={() => setShowSaves(false)}
          onLoad={(key) => {
            const loaded = loadWorld(key, (cfg) => createWorld(cfg));
            if (!loaded) return;
            const next = new Engine(loaded.world.config);
            // Replace the engine's world with the replayed one rather than
            // replaying inside it, so the load either produces a whole world
            // or leaves the current one alone.
            next.adopt(loaded.world);
            engine.detach();
            setEngine(next);
            setShowSaves(false);
          }}
        />
      )}
      {labNode >= 0 && <JunctionLab engine={engine} node={labNode} onClose={() => setLabNode(-1)} />}
    </div>
  );
}

/** Tiles on a straight line between two, for demolition. */
function lineBetween(a: number, b: number, size: number): Int32Array {
  const ax = a % size;
  const ay = (a / size) | 0;
  const bx = b % size;
  const by = (b / size) | 0;
  const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
  const out = new Int32Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    out[i] = Math.round(ay + (by - ay) * t) * size + Math.round(ax + (bx - ax) * t);
  }
  return out;
}

/**
 * Photo mode. features.md 19.
 *
 * The whole feature is subtraction: everything the interface draws goes away
 * and the world stays. That is worth building because this is a game whose
 * world is the thing worth looking at — the art direction is a whole document
 * about silhouette, era language and how a region reads from above — and every
 * screenshot anybody takes of it otherwise has a ledger across a third of it.
 *
 * The bar below is the one exception, and it can be hidden too: the shot stays
 * clean while the way out is still findable. A mode you cannot leave is a bug,
 * and a mode with a permanent button in the corner is not photo mode.
 */
function PhotoBar({ engine, onLeave }: { engine: Engine; onLeave: () => void }): JSX.Element {
  const w = engine.world;
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') onLeave();
      if (e.key === 'h' || e.key === 'H') setHidden((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onLeave]);

  if (hidden) return <></>;
  return (
    <div className="photobar">
      <span className="stamp">{w.dateString()}</span>
      <span className="dim">{C.eras.find((e) => e.n === w.era)?.name}</span>
      <span style={{ flex: 1 }} />
      <span className="dim">Q/E turn &middot; +/&minus; zoom &middot; H hides this &middot; Esc leaves</span>
      <button className="btn tiny" onClick={onLeave}>Leave</button>
    </div>
  );
}

function RailButton({ label, icon, on, onClick }: { label: string; icon: string; on: boolean; onClick: () => void }): JSX.Element {
  /*
   * The label is the button's name, not only its tooltip.
   *
   * These are icon buttons — a glyph and nothing else — so without an
   * accessible name a screen reader announces "button, right-left arrow" and
   * the entire left rail is unusable. `title` gives a sighted mouse user a
   * tooltip and gives everybody else nothing, which is the commonest way an
   * interface like this fails an audit.
   */
  return (
    <button aria-pressed={on} aria-label={label} title={label} onClick={onClick}>
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}

/** Overlay modes recolour the world wholesale, so the legend is the only mark
 *  the mode adds — and it lives in the DOM, not the world (art-direction §14). */
/**
 * The cargoes actually moving, not the whole cargo table.
 *
 * Thirty-odd swatches would be a colour chart rather than a legend. The ones
 * a player is looking at are the ones on the map in front of them, so the
 * legend is built from what the region is carrying and stays short.
 */
function cargoLegend(engine: Engine): string[][] {
  const w = engine.world;
  const tally = new Map<number, number>();
  for (let t = 0; t < w.tileCargo.length; t++) {
    const c = w.tileCargo[t];
    if (c === 255) continue;
    tally.set(c, (tally.get(c) ?? 0) + 1);
  }
  const top = [...tally].sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (top.length === 0) return [['#31333a', 'nothing moving yet']];
  return top.map(([c]) => [C.cargo[c]?.colour ?? '#888888', C.cargo[c]?.name.toLowerCase() ?? '?']);
}

function OverlayLegend({ mode, engine }: { mode: OverlayMode; engine: Engine }): JSX.Element {
  const items =
    mode === OverlayMode.Congestion
      ? [['#4fb477', 'free'], ['#e0b040', 'busy'], ['#d4632f', 'congested'], ['#c02f2f', 'jammed']]
      : mode === OverlayMode.Ownership
        ? [['#4fb477', 'yours'], ['#7c8288', 'the authority'], ['#c85a3c', 'a rival']]
        : mode === OverlayMode.Cargo
        ? cargoLegend(engine)
        : mode === OverlayMode.Catchment
          ? [['#b8a83c', 'many within a commute'], ['#1a2450', 'nobody']]
          : mode === OverlayMode.Power || mode === OverlayMode.Water
            ? [['#4fb477', 'supplied'], ['#e0b040', 'short'], ['#c02f2f', 'starved'], ['#2a2c30', 'not on the network']]
            : [['#4a7a52', 'high amenity'], ['#b06040', 'degraded']];
  return (
    <div className="panel legend" style={{ position: 'absolute', bottom: 10, left: 64 }}>
      {items.map(([c, l]) => (
        <span key={l}><i style={{ background: c }} />{l}</span>
      ))}
    </div>
  );
}
