/**
 * Phase 0, spike 2: 25,000 instanced vehicles holding 60 fps under the ortho
 * camera. Also the performance harness roadmap.md Phase 6 asks for — frame
 * time and tick time against per-device budgets, tracked over time.
 *
 * It runs in the real client against the real renderer and the real
 * simulation, because a synthetic instancing benchmark would answer a
 * different question. The vehicles here are pathing, queueing at junctions and
 * paying access charges exactly as they would in a game; the only artificial
 * thing is the grid they are doing it on, and that is artificial in the
 * direction of *harder* — a four-arm conflict at every intersection.
 *
 *   /?perf              default 25,000 on a 1024 region
 *   /?perf&n=6000&size=512   the tablet tier from architecture.md §5
 */

import { useEffect, useRef, useState } from 'react';
import { buildStressRegion, createWorld, SPEED_STEPS, type StressReport } from '@interchange/sim';
import { Renderer } from '@interchange/render';
import { num } from './format.ts';

interface Sample {
  fps: number;
  frameMs: number;
  tickMs: number;
  drawCalls: number;
  triangles: number;
  instances: number;
  chunks: number;
}

export function Perf(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('building the region…');
  const [report, setReport] = useState<StressReport | null>(null);
  const [sample, setSample] = useState<Sample | null>(null);
  const [verdict, setVerdict] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const target = Number(q.get('n') ?? 25000);
    const size = Number(q.get('size') ?? 1024);
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: Renderer | null = null;
    let raf = 0;
    let cancelled = false;

    // Off the click handler, so the button repaints before a second of
    // terrain generation blocks the thread.
    const timer = setTimeout(() => {
      if (cancelled) return;
      setStatus(`generating ${size}x${size}…`);
      const world = createWorld({ seed: 1860, size, townCount: 14, companyCount: 4 });
      setStatus('laying a developed network…');
      const rep = buildStressRegion(world, { vehicles: target, spacing: size >= 768 ? 8 : 6 });
      setReport(rep);
      (globalThis as Record<string, unknown>).perfWorld = world;
      (globalThis as Record<string, unknown>).perfRenderer = () => renderer;

      /**
       * A measurement that does not depend on requestAnimationFrame.
       *
       * rAF is throttled or stopped entirely in a background tab, which makes
       * the on-screen readout unusable from an automated harness and from CI.
       * This runs the same work in a tight loop and reports the time each part
       * actually took, which is the number the budget is about — the frame
       * rate is then whatever vsync allows given that cost.
       */
      (globalThis as Record<string, unknown>).perfMeasure = (frames = 120) => {
        const rr = renderer!;
        // Settle: build chunks and compile shaders before timing anything.
        for (let i = 0; i < 40; i++) {
          world.step();
          world.project();
          rr.render(sourceFor(world, rr), 0);
        }
        const render: number[] = [];
        const tick: number[] = [];
        const slow: { frame: number; ms: number; phases: Record<string, number> }[] = [];
        for (let i = 0; i < frames; i++) {
          const a = performance.now();
          world.step();
          world.project();
          const b = performance.now();
          rr.render(sourceFor(world, rr), (i % 4) / 4);
          const c = performance.now();
          tick.push(b - a);
          render.push(c - b);
          // Keep the breakdown of anything that blew the frame budget, so the
          // question "which part was slow" has an answer rather than a theory.
          if (c - b > 20 && slow.length < 12) {
            slow.push({ frame: i, ms: +(c - b).toFixed(1), phases: { ...rr.stats } as unknown as Record<string, number> });
          }
        }
        const stat = (xs: number[]) => {
          const s = xs.slice().sort((p, q) => p - q);
          return { median: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] };
        };
        return {
          slow,
          phases: { ...rr.stats },
          tick: stat(tick),
          render: stat(render),
          combined: stat(render.map((r, i) => r + tick[i])),
          drawCalls: rr.stats.drawCalls,
          triangles: rr.stats.triangles,
          instances: rr.stats.instances,
          chunks: rr.stats.chunks,
          vehicles: rep.vehicles,
          cells: rep.cells,
          roadTiles: rep.roadTiles,
          nodes: rep.nodes,
          size,
        };
      };

      renderer = new Renderer(canvas);
      renderer.camState.x = size / 2;
      renderer.camState.z = size / 2;
      // The zoom that shows the most vehicles at once: any further out and the
      // far LOD takes over, any closer and the test is measuring an empty
      // screen. This is the worst case the budget has to hold.
      renderer.camState.view = 150;
      renderer.invalidateWays();
      const r = canvas.getBoundingClientRect();
      renderer.resize(Math.max(1, r.width), Math.max(1, r.height));
      world.speed = 1;

      const frames: number[] = [];
      const ticks: number[] = [];
      let last = performance.now();
      let started = 0;
      let settled = false;

      const loop = (now: number): void => {
        if (cancelled) return;
        raf = requestAnimationFrame(loop);
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;

        const t0 = performance.now();
        const steps = Math.max(1, Math.round(dt * 20 * SPEED_STEPS[world.speed]));
        for (let i = 0; i < Math.min(steps, 4); i++) world.step();
        world.project();
        const tickMs = (performance.now() - t0) / Math.min(steps, 4);

        renderer!.render(sourceFor(world, renderer!), 0);

        // Ignore the first second: chunk streaming, shader compilation and the
        // instance buffers all land in it and none of them recur.
        if (started === 0) started = now;
        if (now - started > 700) {
          settled = true;
          frames.push(dt * 1000);
          ticks.push(tickMs);
          if (frames.length > 180) frames.shift();
          if (ticks.length > 180) ticks.shift();
        }

        // Exposed continuously so the numbers can be read from outside — the
        // on-screen readout needs the tab in the foreground for long enough to
        // collect a sample, and an automated run cannot guarantee that.
        (globalThis as Record<string, unknown>).perfLive = { frames, ticks };
        if (settled && frames.length % 10 === 0 && frames.length > 0) {
          const sorted = frames.slice().sort((a, b) => a - b);
          const median = sorted[sorted.length >> 1];
          const p95 = sorted[Math.floor(sorted.length * 0.95)];
          const s: Sample = {
            fps: 1000 / median,
            frameMs: p95,
            tickMs: ticks.reduce((a, b) => a + b, 0) / ticks.length,
            drawCalls: renderer!.stats.drawCalls,
            triangles: renderer!.stats.triangles,
            instances: renderer!.stats.instances,
            chunks: renderer!.stats.chunks,
          };
          setSample(s);
          if (frames.length >= 90) {
            const pass = s.fps >= 58 && s.frameMs <= 20;
            setVerdict(pass ? 'GREEN' : 'RED');
            // Left where the headless gate can pick it up.
            localStorage.setItem('interchange.spike2', JSON.stringify({
              n: 2,
              name: '25,000 instanced vehicles at 60 fps',
              target: '60 fps median, p95 frame under 20 ms, at the ortho camera',
              measured: `${rep.vehicles} vehicles, ${s.fps.toFixed(0)} fps median, p95 ${s.frameMs.toFixed(1)} ms, ` +
                `${s.drawCalls} draws, ${num(s.triangles)} tris, tick ${s.tickMs.toFixed(2)} ms`,
              pass,
              note: `${num(rep.roadTiles)} road tiles, ${num(rep.cells)} cells, ${rep.nodes} nodes on a ${size}x${size} region`,
            }));
          }
        }
        setStatus(settled ? 'measuring…' : 'settling…');
      };
      raf = requestAnimationFrame(loop);
    }, 30);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      renderer?.dispose();
    };
  }, []);

  return (
    <div className="app">
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <div className="panel" style={{ position: 'absolute', top: 12, left: 12, width: 380 }}>
        <h2>Spike 2 — instanced vehicles <span className={verdict === 'GREEN' ? 'pos' : verdict === 'RED' ? 'neg' : 'dim'}>{verdict ?? status}</span></h2>
        <dl className="kv">
          {report && (
            <>
              <dt>Vehicles</dt><dd>{num(report.vehicles)}</dd>
              <dt>Road tiles</dt><dd>{num(report.roadTiles)}</dd>
              <dt>Traffic cells</dt><dd>{num(report.cells)}</dd>
              <dt>Junctions</dt><dd>{num(report.nodes)}</dd>
              <dt>Services</dt><dd>{num(report.services)}</dd>
              <dt>Built in</dt><dd>{num(report.ms)} ms</dd>
            </>
          )}
          {sample && (
            <>
              <dt>Frame rate</dt>
              <dd className={sample.fps >= 58 ? 'pos' : sample.fps >= 45 ? 'warnc' : 'neg'}>{sample.fps.toFixed(0)} fps</dd>
              <dt>Frame p95</dt>
              <dd className={sample.frameMs <= 20 ? 'pos' : 'neg'}>{sample.frameMs.toFixed(1)} ms</dd>
              <dt>Simulation tick</dt><dd>{sample.tickMs.toFixed(2)} ms</dd>
              <dt>Drawn instances</dt><dd>{num(sample.instances)}</dd>
              <dt>Draw calls</dt><dd>{num(sample.drawCalls)}</dd>
              <dt>Triangles</dt><dd>{num(sample.triangles)}</dd>
              <dt>Terrain chunks</dt><dd>{num(sample.chunks)}</dd>
            </>
          )}
        </dl>
        <div className="legend">
          <span className="dim">
            The tick budget is 50 ms at 20 Hz. Anything under that leaves the frame to the renderer.
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The renderer's view of a world. Duplicated from Engine deliberately: the
 * harness must not depend on the game's UI plumbing, or it stops being a
 * measurement of the renderer.
 *
 * Cached, because rebuilding it every frame allocates four arrays and a
 * twenty-field object, and at sixty frames a second that is enough garbage to
 * put a collection in the middle of the measurement. The first version of this
 * harness reported a 76 ms p95 against a 13 ms median for exactly that reason.
 */
const sourceCache = new WeakMap<object, Parameters<Renderer['render']>[0]>();

function sourceFor(world: ReturnType<typeof createWorld>, renderer: Renderer): Parameters<Renderer['render']>[0] {
  const cached = sourceCache.get(world);
  if (cached) {
    cached.vehicleCount = world.vehicles.count;
    cached.siteCount = world.sites.count;
    cached.townCount = world.towns.count;
    cached.era = world.era;
    return cached;
  }
  const c = world.content;
  const built: Parameters<Renderer['render']>[0] = {
    size: world.config.size,
    height: world.terrain.height,
    biome: world.terrain.biome,
    flags: world.terrain.flags,
    amenity: world.terrain.amenityBase,
    wayClass: world.layers.map((l) => l.cls),
    wayDir: world.layers.map((l) => l.dir),
    wayAsset: world.layers.map((l) => l.asset),
    wayLink: world.layers.map((l) => l.link),
    wayLevel: world.layers.map((l) => l.level),
    wayFlags: world.layers.map((l) => l.flags),
    assetOwner: world.assets.owner,
    assetCondition: world.assets.condition,
    linkFlowPrev: world.graph.linkFlowPrev,
    linkCellCount: world.graph.linkCellCount,
    wayColourOf: () => [0.35, 0.33, 0.30],
    cargoColourOf: () => [0.4, 0.4, 0.4],
    tileCargo: world.tileCargo,
    tileTonnes: world.tileTonnes,
    invisibleWay: () => false,
    vehicleCount: world.vehicles.count,
    vAlive: world.vehicles.alive,
    vType: world.vehicles.type,
    vCompany: world.vehicles.company,
    vX: world.vehicles.x,
    vY: world.vehicles.y,
    vHeading: world.vehicles.heading,
    vState: world.vehicles.state,
    vLoad: world.vehicles.load,
    vehicleClassOf: (t) => c.vehicles[t]?.class ?? 'lorry',
    vehicleEraOf: (t) => c.vehicles[t]?.era ?? 1,
    siteCount: world.sites.count,
    sX: world.sites.x,
    sY: world.sites.y,
    sState: world.sites.state,
    sDef: world.sites.def,
    sOwner: world.sites.owner,
    industryKitOf: (d) => c.industries[d]?.kit ?? 'works',
    industryFootprintOf: (d) => c.industries[d]?.footprint ?? 2,
    townCount: world.towns.count,
    tX: world.towns.x,
    tY: world.towns.y,
    tPopulation: world.towns.population,
    overlayField: null,
    gridSatisfaction: null,
    gridOfTile: null,
    dayFraction: 0.42,
    season: 1,
    era: world.era,
    player: world.player,
  };
  sourceCache.set(world, built);
  void renderer;
  return built;
}
