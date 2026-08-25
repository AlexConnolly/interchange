/**
 * The whole client, for now.
 *
 * Step one of `design.md` §9: the district, looking like the target frame, with
 * no economy in it at all. Terrain, fields, hedges, roads, shadows, and traffic
 * moving. If that is not lovely, nothing later saves it — which is the lesson
 * from putting art in phase six of six last time and finding the mistakes were
 * geometric by then.
 *
 * So there is deliberately no contract panel, no fleet screen and no money in
 * here yet. Those are steps two and three, and adding them before this looks
 * right would be repeating the exact mistake the post-mortem is about.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createWorld, Facility, Mode, NO_WAY, TICKS_PER_DAY, SPEED_STEPS, type World,
} from '@interchange/sim';
import { loadContent } from '@interchange/data';
import { Renderer, RoadClass, TILES_ACROSS_DEFAULT, type RenderSource } from '@interchange/render';
import { ContractPanel, Pins, money } from './Pins.tsx';
import { Vehicles, Yard } from './Fleet.tsx';
import './style.css';

loadContent();

const DISTRICT = 128;

/**
 * Map the content's way classes onto the three the renderer draws.
 *
 * The renderer has a hierarchy — track, lane, spine — because the old build
 * drew every way identically and a network with no hierarchy reads as a
 * spiderweb however sparse it is. This is where the content's four classes
 * collapse onto it.
 */
function roadClassOf(cls: number, names: string[]): RoadClass {
  const id = names[cls] ?? 'lane';
  if (id === 'track') return RoadClass.Track;
  if (id === 'dual' || id === 'road') return RoadClass.Spine;
  return RoadClass.Lane;
}

export function App(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [hud, setHud] = useState({ date: '', vehicles: 0, fps: 0, tris: 0, cash: 0, free: 0 });
  const [live, setLive] = useState<{ world: World; renderer: Renderer } | null>(null);
  const [open, setOpen] = useState(-1);
  const [screen, setScreen] = useState<'none' | 'vehicles' | 'yard'>('none');
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((r) => r + 1), []);

  const accept = useCallback((id: number): void => {
    if (!live) return;
    if (live.world.acceptContract(id, live.world.player)) {
      setOpen(-1);
      bump();
    }
  }, [live, bump]);

  const buy = useCallback((typeIndex: number): void => {
    if (!live) return;
    const r = live.world.buyVehicleAtYard(typeIndex);
    if (r.vehicle >= 0) bump();
  }, [live, bump]);

  const addFacility = useCallback((yard: number, facility: number): void => {
    if (!live) return;
    if (live.world.addFacility(yard, facility)) bump();
  }, [live, bump]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const world = createWorld({
      seed: 1985, size: DISTRICT, townCount: 3, companyCount: 1,
    });
    const wayNames = world.content.ways.map((w) => w.id);
    const layer = world.layers[Mode.Road];

    // The road class per tile, computed once: the way layer does not change in
    // step one because nothing can be built yet.
    const roadClass = new Int8Array(DISTRICT * DISTRICT).fill(-1);
    for (let i = 0; i < DISTRICT * DISTRICT; i++) {
      if (layer.cls[i] !== NO_WAY) roadClass[i] = roadClassOf(layer.cls[i], wayNames);
    }

    /*
     * The influence area. design.md 3.
     *
     * Seeded with the yard — for now, the largest settlement, since there is no
     * yard yet — so the opening view is a small pocket of countryside with the
     * rest of the district faded out behind it. That fade is doing four jobs at
     * once: fog of war, the tutorial, the tech tree, and the reason you cannot
     * begin by driving into the city.
     */
    const src: RenderSource = {
      size: DISTRICT,
      height: world.terrain.height,
      parcel: world.terrain.fields.parcel,
      crop: world.terrain.fields.crop,
      hasRoad: (t) => roadClass[t] >= 0,
      isWater: (t) => world.terrain.height[t] <= 0,
      influence: (t) => world.influence.at(t),
      roadClass,
      level: layer.level,
      vehicleCount: 0,
      vx: new Float32Array(512),
      vz: new Float32Array(512),
      vHeading: new Float32Array(512),
      vLivery: new Uint8Array(512),
      dayFraction: 0.62,
    };

    const renderer = new Renderer(canvas);
    /*
     * Open on the largest settlement, well inside the map.
     *
     * The old build opened on towns[0], which is merely the first one the
     * generator placed, and often gave half a screen of empty sea. Clamping a
     * third of the way in from each edge also means the opening shot is never
     * looking off the edge of the district, which is what a naive clamp of a
     * corner town produced.
     */
    let best = 0;
    for (let t = 1; t < world.towns.count; t++) {
      if (world.towns.population[t] > world.towns.population[best]) best = t;
    }
    const inset = DISTRICT * 0.3;
    const clamp = (v: number): number => Math.max(inset, Math.min(DISTRICT - inset, v));
    renderer.camX = clamp(world.towns.x[best] ?? DISTRICT / 2);
    renderer.camZ = clamp(world.towns.y[best] ?? DISTRICT / 2);

    // Where you begin: one small pocket, and nothing else visible.
    /*
     * Where you begin: one small pocket round the yard, and nothing else
     * visible. The yard is not a place yet, so the opening influence is seeded
     * on the camera and the sites near it; step three replaces this with the
     * yard itself.
     */
    world.refreshInfluence([{ x: renderer.camX, y: renderer.camZ, strength: 2.4 }]);

    /*
     * One truck, and enough for a second. design.md 1.
     *
     * You are not given a fleet, you are given the *first purchase*, and making
     * it is what starts the loop. The truck starts at the nearest site to the
     * yard because there is no yard yet — step three gives it one.
     */
    {
      const vanIndex = world.content.vehicles.findIndex((v) => v.id === 'rigid-box');
      let nearest = 0;
      let best = Infinity;
      for (let i = 0; i < world.sites.count; i++) {
        const dx = world.sites.x[i] - renderer.camX;
        const dy = world.sites.y[i] - renderer.camZ;
        const d = dx * dx + dy * dy;
        if (d < best) { best = d; nearest = i; }
      }
      world.companies.cash[world.player] = world.content.balance.startingCash;

      /*
       * The yard, then the truck in it.
       *
       * A chiller from the start, because the opening job is a milk run and a
       * yard that cannot take the only truck that can do the only job is not a
       * constraint, it is a dead end. Everything else is bought.
       */
      const yard = world.foundYard(Math.round(renderer.camX), Math.round(renderer.camZ), 'Marchford Yard');
      if (yard >= 0) world.yards.add(yard, Facility.Chiller);
      const bought = vanIndex >= 0 ? world.buyVehicleAtYard(vanIndex) : { vehicle: -1 };
      void bought;
      void nearest;
      // And work to do, straight away.
      world.offerWorkNow();
    }
    /*
     * A little wider than the reference framing.
     *
     * The reference is 26 tiles, which is the framing a lorry is readable at and
     * the one the game is played at. Opening slightly wider puts the edge of the
     * influence area on screen from the first second, because the boundary is
     * the point of the mechanic — but not so wide that the roads become threads,
     * which 2.4x did.
     */
    renderer.tilesAcross = TILES_ACROSS_DEFAULT * 1.4;

    const fit = (): void => {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      renderer.resize(w, h);
    };
    fit();
    window.addEventListener('resize', fit);

    // Drag to pan, wheel to zoom. Two gestures, which is the whole of the
    // camera: the eight-control budget does not have room for a camera panel.
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const down = (e: PointerEvent): void => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent): void => {
      if (!dragging) return;
      const perPixel = renderer.tilesAcross / (canvas.clientWidth || 1);
      const dx = (e.clientX - lastX) * perPixel;
      const dy = (e.clientY - lastY) * perPixel;
      // The camera looks down a rotated axis, so screen movement has to be
      // turned back into world movement or panning fights the player.
      const a = (-32 * Math.PI) / 180;
      renderer.camX -= dx * Math.cos(a) - dy * Math.sin(a) * 1.6;
      renderer.camZ -= dx * Math.sin(a) + dy * Math.cos(a) * 1.6;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const up = (e: PointerEvent): void => {
      dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      const next = renderer.tilesAcross * (e.deltaY > 0 ? 1.12 : 1 / 1.12);
      // Bounded so a lorry never becomes unreadable, which is the number the
      // whole scale question resolves to.
      renderer.tilesAcross = Math.max(14, Math.min(70, next));
      fit();
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('wheel', wheel, { passive: false });

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const frames: number[] = [];
    let hudTick = 0;

    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      frames.push(dt);
      if (frames.length > 30) frames.shift();

      acc += dt * 20 * SPEED_STEPS[2];
      let ran = 0;
      while (acc >= 1 && ran < 40) {
        world.step();
        acc -= 1;
        ran++;
      }
      if (ran > 0) world.project();

      // Vehicles, straight out of the traffic table.
      let n = 0;
      for (let i = 0; i < world.vehicles.count && n < src.vx.length; i++) {
        if (!world.vehicles.alive[i]) continue;
        src.vx[n] = world.vehicles.x[i] / 65536;
        src.vz[n] = world.vehicles.y[i] / 65536;
        src.vHeading[n] = world.vehicles.heading[i] / 4096;
        src.vLivery[n] = world.vehicles.company[i] & 3;
        n++;
      }
      src.vehicleCount = n;
      src.dayFraction = ((world.tick + TICKS_PER_DAY * 0.62) % TICKS_PER_DAY) / TICKS_PER_DAY;

      renderer.render(src);

      hudTick++;
      if (hudTick % 20 === 0) {
        const mean = frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length);
        const st = renderer.stats;
        let free = 0;
        for (let v = 0; v < world.vehicles.count; v++) {
          if (world.vehicles.alive[v] && world.vehicles.company[v] === world.player
            && world.vehicles.service[v] === -1) free++;
        }
        setHud({
          date: world.dateString(),
          vehicles: n,
          fps: Math.round(1 / Math.max(1e-6, mean)),
          tris: st.triangles,
          cash: world.companies.cash[world.player],
          free,
        });
      }
    };
    raf = requestAnimationFrame(loop);
    setLive({ world, renderer });
    setReady(true);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('wheel', wheel);
      renderer.dispose();
    };
  }, []);

  return (
    <div className="app">
      <canvas ref={canvasRef} className="world" />
      {live && (
        <Pins
          world={live.world}
          renderer={live.renderer}
          revision={revision}
          onOpen={setOpen}
        />
      )}
      {live && open >= 0 && (
        <ContractPanel
          world={live.world}
          contract={open}
          onClose={() => setOpen(-1)}
          onAccept={accept}
        />
      )}
      {live && screen === 'vehicles' && (
        <Vehicles world={live.world} onBuy={buy} onClose={() => setScreen('none')} />
      )}
      {live && screen === 'yard' && (
        <Yard world={live.world} yard={0} onAdd={addFacility} onClose={() => setScreen('none')} />
      )}
      <div className="hud">
        <span className="brand">Interchange</span>
        <span className="money">{money(hud.cash)}</span>
        <span>{hud.date}</span>
        <span className="dim">{hud.vehicles} out · {hud.free} idle</span>
        <button
          className="hud-btn"
          onClick={() => setScreen(screen === 'yard' ? 'none' : 'yard')}
        >Yard</button>
        <button
          className="hud-btn"
          onClick={() => setScreen(screen === 'vehicles' ? 'none' : 'vehicles')}
        >Vehicles</button>
      </div>
      {!ready && <div className="loading">Surveying the district…</div>}
    </div>
  );
}
