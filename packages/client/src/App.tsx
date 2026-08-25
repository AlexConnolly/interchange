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
  createWorld, Mode, NO_WAY, TICKS_PER_DAY, SPEED_STEPS, facilitiesFor, type World,
} from '@interchange/sim';
import { loadContent } from '@interchange/data';
import {
  Renderer, RoadClass, TILES_ACROSS_DEFAULT, RUN, loadKit, type RenderSource,
} from '@interchange/render';
import { Alerts, Markers, money } from './Markers.tsx';
import { Vehicles, Yard } from './Fleet.tsx';
import { Place, type PlaceActions } from './Place.tsx';
import './style.css';

loadContent();

const DISTRICT = 128;

/** The keys that move the camera. WASD and the arrows, both. */
const PAN_KEYS = new Set([
  'w', 'a', 's', 'd',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
]);

/** What is on screen over the map. Exactly one thing, or nothing. */
type Panel =
  | { k: 'none' }
  | { k: 'place'; site: number }
  | { k: 'yard'; yard: number }
  | { k: 'vehicles' };

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
  const [live, setLive] = useState<
    { world: World; renderer: Renderer; src: RenderSource } | null>(null);
  /*
   * One panel, ever.
   *
   * Three independent pieces of state — a contract id, a place id and a screen
   * name — meant three windows could be open at once, stacked over each other
   * and over the map. A single tagged value makes that unrepresentable rather
   * than merely discouraged, which is the only way a rule like this holds: the
   * eight-control budget is not a guideline if the shape of the state allows a
   * breach.
   */
  const [panel, setPanel] = useState<Panel>({ k: 'none' });
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((r) => r + 1), []);

  const buy = useCallback((typeIndex: number): void => {
    if (!live) return;
    const r = live.world.buyVehicleAtYard(typeIndex);
    if (r.vehicle >= 0) bump();
  }, [live, bump]);

  const fit = useCallback((vehicle: number, fitting: number): void => {
    if (!live) return;
    if (live.world.fitVehicle(vehicle, fitting).ok) bump();
  }, [live, bump]);

  /**
   * Go to a place, and open it.
   *
   * The camera move is the point. "Where's my yard? I can't even see my yard"
   * was a fair complaint about a Yard button that opened a panel about a place
   * the player could not find on the map — a panel is not a location. Anything
   * that names a place now also takes you to it.
   */
  const lookAt = useCallback((x: number, z: number): void => {
    if (!live) return;
    live.renderer.camX = x;
    live.renderer.camZ = z;
  }, [live]);

  const addFacility = useCallback((yard: number, facility: number): void => {
    if (!live) return;
    if (live.world.addFacility(yard, facility)) bump();
  }, [live, bump]);

  /*
   * Everything the place panel can do.
   *
   * `preview` is the one worth reading. "26 tiles" is not an answer to where a
   * run goes — the player asked for the route drawn on the map, and drawn in
   * two colours, because a haulage job is two journeys: out from the yard to
   * the pickup, which earns nothing, and pickup to drop, which pays. Drawn as
   * one line they look like one journey, which hides exactly the thing you are
   * choosing between when two yards both have a spare tanker.
   */
  const placeActions: PlaceActions = {
    buy: useCallback((site: number): void => {
      if (!live) return;
      if (live.world.buySite(site).ok) bump();
    }, [live, bump]),
    supply: useCallback((from: number, to: number, cargo: number): void => {
      if (!live) return;
      if (live.world.supply(from, to, cargo)) bump();
    }, [live, bump]),
    accept: useCallback((contract: number, vehicle: number): void => {
      if (!live) return;
      if (live.world.acceptContract(contract, live.world.player, vehicle)) bump();
    }, [live, bump]),
    preview: useCallback((from: number, to: number): void => {
      if (!live) return;
      live.renderer.showRoute(
        from < 0 || to < 0 ? [] : [{
          tiles: live.world.previewRoute(from, to), colour: RUN.loaded,
        }],
        live.src,
      );
    }, [live]),
    previewDriver: useCallback((contract: number, vehicle: number): void => {
      if (!live) return;
      const { world, renderer, src } = live;
      const b = world.contractBoard;
      const yard = world.vehicleYard[vehicle] ?? -1;
      // Two legs, two colours. The empty run out of the yard earns nothing and
      // the loaded run pays, and a player choosing between two spare tankers at
      // two yards is choosing between two amounts of unpaid driving.
      renderer.showRoute([
        { tiles: world.routeFromYard(yard, b.from[contract]), colour: RUN.empty },
        { tiles: world.previewRoute(b.from[contract], b.to[contract]), colour: RUN.loaded },
      ], src);
    }, [live]),
    goTo: useCallback((site: number): void => {
      if (!live) return;
      lookAt(live.world.sites.x[site] + 0.5, live.world.sites.y[site] + 0.5);
      setPanel({ k: 'place', site });
    }, [live, lookAt]),
    close: useCallback((): void => setPanel({ k: 'none' }), []),
  };

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
      vModel: new Uint8Array(512),
      placeCount: 0,
      px: new Float32Array(320),
      pz: new Float32Array(320),
      pModel: new Uint8Array(320),
      pRot: new Float32Array(320),
      dayFraction: 0.62,
      snow: 0,
    };

    /*
     * The buildings, laid out once and never again.
     *
     * Positions are fixed at startup on purpose. An earlier build regenerated
     * the village every time the day rolled over, so the houses changed shape
     * overnight — which was reported, correctly, as "houses seem to change every
     * day?". A place is a place. What varies per frame is only *which* of these
     * are within your influence, and that is the fog of war rather than the
     * geometry.
     */
    const placeNames = [
      ...world.content.industries.map((i) => `plc_${i.id.replace(/-/g, '_')}`),
      'plc_yard',
      'vil_cottage_a', 'vil_cottage_b', 'vil_cottage_stone', 'vil_church',
      'vil_barn',
    ];
    const YARD_MODEL = world.content.industries.length;
    const VILLAGE_FIRST = YARD_MODEL + 1;

    interface Placed { x: number; z: number; model: number; rot: number; tile: number }
    const placed: Placed[] = [];

    // One building per business, at its access tile — the tile the road reaches,
    // so a farm sits on its own lane rather than in the middle of a field.
    for (let i = 0; i < world.sites.count; i++) {
      const tile = world.siteAccessTile[i];
      if (tile < 0) continue;
      placed.push({
        x: (tile % DISTRICT) + 0.5,
        z: Math.floor(tile / DISTRICT) + 0.5,
        model: world.sites.def[i],
        // A quarter turn either way, keyed off the tile so it never changes.
        rot: ((tile * 2654435761) % 4) / 4,
        tile,
      });
    }

    /*
     * And the village.
     *
     * Housing is not a business and is drawn anyway: a village consisting of
     * the one shop you can buy is not a village, and the target frame has a
     * street of cottages in it. One church per town, because a village needs a
     * landmark — it is what tells you at a glance which of the settlements on
     * screen is the big one.
     */
    for (let t = 0; t < world.towns.count; t++) {
      const cx = world.towns.x[t];
      const cz = world.towns.y[t];
      const spread = Math.max(2, Math.min(6, Math.round(world.towns.population[t] / 220)));
      let churched = false;
      // A deterministic walk outwards, so the same seed lays out the same
      // village every time.
      let h = (t * 2246822519 + 374761393) | 0;
      const rand = (): number => {
        h = (h * 1664525 + 1013904223) | 0;
        return ((h >>> 8) & 0xffff) / 0x10000;
      };
      const wanted = 5 + spread * 2;
      for (let tries = 0; tries < wanted * 8 && placed.length < 300; tries++) {
        const x = Math.round(cx + (rand() * 2 - 1) * spread);
        const z = Math.round(cz + (rand() * 2 - 1) * spread);
        if (x < 1 || z < 1 || x >= DISTRICT - 1 || z >= DISTRICT - 1) continue;
        const tile = z * DISTRICT + x;
        // Not on the road, not in the water, and not on top of another house.
        if (roadClass[tile] >= 0) continue;
        if (world.terrain.height[tile] <= 0) continue;
        if (placed.some((q) => q.tile === tile)) continue;
        // But *beside* a road, because a house that is not on a street is a
        // shed in a field.
        let touches = false;
        for (const d of [-1, 1, -DISTRICT, DISTRICT]) {
          if (roadClass[tile + d] >= 0) touches = true;
        }
        if (!touches) continue;
        let model: number;
        if (!churched) { model = VILLAGE_FIRST + 3; churched = true; } else {
          model = VILLAGE_FIRST + Math.floor(rand() * 3);
          if (rand() > 0.88) model = VILLAGE_FIRST + 4;
        }
        placed.push({ x: x + 0.5, z: z + 0.5, model, rot: Math.floor(rand() * 4) / 4, tile });
      }
    }

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
    /*
     * Where the game begins, decided by the world rather than by which town is
     * biggest.
     *
     * `planOpening` finds the closest pair of places where one makes what the
     * other wants, preferring the cargo the content nominates — which is milk,
     * so it is the run from a farm to a dairy. That is the founding image of the
     * whole game, so it is constructed rather than hoped for: picking the
     * largest settlement and trusting the generator gave a valley of quarries
     * and sawmills with no dairy anywhere in it.
     */
    const opening = world.planOpening();
    const inset = DISTRICT * 0.3;
    const clamp = (v: number): number => Math.max(inset, Math.min(DISTRICT - inset, v));
    renderer.camX = clamp(opening.x);
    renderer.camZ = clamp(opening.y);

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
      /*
       * These places were working before you arrived.
       *
       * Without it every store in the district is empty on day one, so the
       * contract board — which only offers what a place actually has spare —
       * offers nothing, and the opening screen is a pretty valley with no game
       * in it while you wait for a farm to fill a churn.
       */
      world.primeStock();

      /*
       * The van is chosen by the work, not the other way round.
       *
       * It was a Rigid 7.5t handed out regardless, and the opening was
       * unplayable: on this seed the only offer in reach was aggregate out of a
       * quarry, needing a tipper nobody owned and nobody could afford. One job,
       * refused, on the first screen.
       *
       * `openingVehicle` takes the cargo of the pair `planOpening` chose and
       * returns the cheapest thing that can carry it — so the district decides
       * what the first job is and the van follows, and the two cannot disagree
       * on any seed. For the milk run that is a two-tonne refrigerated van,
       * which is many small trips rather than one big one: a round, not a
       * haulage contract, which is the right texture for the first ten minutes.
       */
      const vanIndex = world.openingVehicle(opening.cargo);
      world.companies.cash[world.player] = world.content.balance.startingCash;

      /*
       * The yard, then the van in it.
       *
       * Its facilities are *derived from the vehicle*, not listed. A yard that
       * cannot take the only lorry that can do the only job is not a constraint,
       * it is a dead end — and hard-coding a chiller here only worked while the
       * opening happened to be a milk run. Everything beyond what the first van
       * needs is bought.
       */
      const yard = world.foundYard(
        Math.round(renderer.camX), Math.round(renderer.camZ), 'Marchford Yard',
      );
      if (yard >= 0 && vanIndex >= 0) {
        const v = world.content.vehicles[vanIndex];
        world.yards.add(yard, facilitiesFor({
          handling: v.handling as readonly string[], cls: v.class,
        }));
      }
      if (vanIndex >= 0) world.buyVehicleAtYard(vanIndex);
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

    /*
     * The fleet, straight out of the art pipeline.
     *
     * `veh_van_transit` for `van-transit`, and so on for all nine: the content
     * id *is* the model name with the hyphen swapped, which is not a
     * coincidence — content.md lists the fleet and `art/build_vehicles.py`
     * builds exactly that list. Deriving the filename rather than keeping a
     * table means the two cannot drift apart without the missing-model warning
     * saying so by name.
     *
     * Asynchronous, and the frame loop starts without waiting. A district with
     * no lorries in it for two hundred milliseconds is fine; a black screen
     * until the last glb arrives is not.
     */
    const modelNames = world.content.vehicles.map((v) => `veh_${v.id.replace(/-/g, '_')}`);
    void loadKit(modelNames).then((kit) => {
      if (kit.missing.length > 0) {
        console.warn(`[fleet] no model for: ${kit.missing.join(', ')}`);
      }
      const ordered = modelNames.map((n) => kit.models.get(n)).filter((m) => m !== undefined);
      if (ordered.length === modelNames.length) renderer.setFleet(ordered);
    });
    void loadKit(placeNames).then((kit) => {
      if (kit.missing.length > 0) {
        console.warn(`[places] no model for: ${kit.missing.join(', ')}`);
      }
      const ordered = placeNames.map((n) => kit.models.get(n)).filter((m) => m !== undefined);
      if (ordered.length === placeNames.length) {
        renderer.setPlaceModels(ordered);
        renderer.placeRevision++;
      }
    });

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
    let downX = 0;
    let downY = 0;
    const down = (e: PointerEvent): void => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      downX = e.clientX;
      downY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent): void => {
      if (!dragging) return;
      // Grab-and-pull, and the renderer owns the arithmetic because it is the
      // thing that knows where the camera is pointing.
      renderer.pan(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const up = (e: PointerEvent): void => {
      dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      /*
       * A click, not a drag.
       *
       * Four pixels of travel is the threshold, and it has to exist: panning is
       * a press-and-move on the same surface that selects, so without it every
       * pan ends by opening whatever place the pointer happened to stop over.
       */
      if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 4) return;
      const tile = renderer.pick(e.clientX, e.clientY, src);
      if (tile < 0) return;
      // The nearest business to where you clicked, within a couple of tiles.
      // Clicking a farmyard should open the farm, and the farmyard is several
      // tiles wide.
      const cx = tile % DISTRICT;
      const cz = Math.floor(tile / DISTRICT);
      let found = -1;
      let bestD = 9;
      for (let i = 0; i < world.sites.count; i++) {
        const at = world.siteAccessTile[i];
        if (at < 0 || !world.influence.usable(at)) continue;
        const dx = (at % DISTRICT) - cx;
        const dz = Math.floor(at / DISTRICT) - cz;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; found = i; }
      }
      if (found >= 0) setPanel({ k: 'place', site: found });
    };
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      const next = renderer.tilesAcross * (e.deltaY > 0 ? 1.12 : 1 / 1.12);
      // Bounded so a lorry never becomes unreadable, which is the number the
      // whole scale question resolves to.
      renderer.tilesAcross = Math.max(14, Math.min(70, next));
      fit();
    };
    /*
     * WASD and the arrows, held rather than tapped.
     *
     * A key set is the right shape for this instead of a handler that moves the
     * camera per keydown event: holding a key repeats at the operating system's
     * rate, which is slow, uneven, and different on every machine. Recording
     * what is *down* and moving in the frame loop gives smooth motion at a speed
     * this code chooses.
     *
     * Speed scales with the zoom, so a keypress crosses the same fraction of the
     * screen whether you are looking at a field or at the whole district.
     */
    const held = new Set<string>();
    const keyDown = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (PAN_KEYS.has(k)) {
        held.add(k);
        // Or the arrows scroll the page behind the canvas.
        e.preventDefault();
      }
    };
    const keyUp = (e: KeyboardEvent): void => { held.delete(e.key.toLowerCase()); };
    // Losing focus with a key down would leave the camera drifting for ever.
    const blur = (): void => held.clear();
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', blur);

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

      if (held.size > 0) {
        // Two thirds of a screen a second, which is brisk without overshooting.
        const step = renderer.tilesAcross * 0.66 * dt;
        let right = 0;
        let up = 0;
        if (held.has('a') || held.has('arrowleft')) right -= step;
        if (held.has('d') || held.has('arrowright')) right += step;
        if (held.has('w') || held.has('arrowup')) up += step;
        if (held.has('s') || held.has('arrowdown')) up -= step;
        if (right !== 0 || up !== 0) renderer.nudge(right, up);
      }
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
        src.vModel[n] = world.vehicles.type[i];
        n++;
      }
      src.vehicleCount = n;

      /*
       * Which buildings are visible.
       *
       * Recomputed every frame over a couple of hundred entries, which is
       * nothing, and it means a business appears the instant your influence
       * reaches it. That reveal is the fog of war doing its job — the district
       * grows outwards from your yard as you earn it, and nothing had to be
       * scripted for that to happen.
       */
      let pn = 0;
      for (const q of placed) {
        if (pn >= src.px.length) break;
        if (!world.influence.usable(q.tile)) continue;
        src.px[pn] = q.x;
        src.pz[pn] = q.z;
        src.pModel[pn] = q.model;
        src.pRot[pn] = q.rot;
        pn++;
      }
      /*
       * And your own yards, which are businesses too — design.md 4 — so they
       * are drawn the same way as everything else.
       *
       * Appended here rather than baked into `placed` because a yard can be
       * founded at any point in a game, and reading them off the world each
       * frame means a new one appears the moment it is bought with no
       * bookkeeping. Never fogged: a yard you own is always visible to you.
       */
      for (let y = 0; y < world.yards.count && pn < src.px.length; y++) {
        if (world.yards.owner[y] !== world.player) continue;
        src.px[pn] = world.yards.x[y] + 0.5;
        src.pz[pn] = world.yards.y[y] + 0.5;
        src.pModel[pn] = YARD_MODEL;
        src.pRot[pn] = 0;
        pn++;
      }
      if (pn !== src.placeCount) renderer.placeRevision++;
      src.placeCount = pn;
      /*
       * Open in the late afternoon, which is the light in the target frame.
       *
       * 0.46 of the way through the sun's turn, and it has to be derived rather
       * than picked: the day is now a full circle with a real night in it (see
       * `placeSun`), and the old offset of 0.62 — chosen back when the sun never
       * set — landed squarely in the middle of the night. The game opened in the
       * dark, which is a poor first frame for a game whose whole argument is how
       * it looks in the sun.
       */
      src.dayFraction = ((world.tick + TICKS_PER_DAY * 0.46) % TICKS_PER_DAY) / TICKS_PER_DAY;
      // One number, read by the renderer to paint the season and by the traffic
      // to decide who can move. There is deliberately not a second one.
      src.snow = world.snow;

      renderer.render(src);

      /*
       * The HUD, four times a second, by clock rather than by frame count.
       *
       * Every twentieth frame sounds equivalent and is not: a backgrounded tab
       * has its animation frames throttled to about one a second, so "every
       * twentieth frame" became every twenty seconds and the HUD sat at its
       * initial zeroes — which reads exactly like a game that has no money in
       * it. Anything the player reads should be paced by time, never by frames.
       */
      if (now - hudTick > 250) {
        hudTick = now;
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
    setLive({ world, renderer, src });
    setReady(true);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
      renderer.dispose();
    };
  }, []);

  return (
    <div className="app">
      <canvas ref={canvasRef} className="world" />
      {live && (
        <Markers
          world={live.world}
          renderer={live.renderer}
          onOpenSite={(site) => setPanel({ k: 'place', site })}
          onOpenYard={(yard) => {
            lookAt(live.world.yards.x[yard] + 0.5, live.world.yards.y[yard] + 0.5);
            setPanel({ k: 'yard', yard });
          }}
        />
      )}
      {live && <Alerts world={live.world} renderer={live.renderer} />}
      {live && panel.k === 'place' && (
        <Place world={live.world} site={panel.site} actions={placeActions} />
      )}
      {live && panel.k === 'vehicles' && (
        <Vehicles
          world={live.world}
          onBuy={buy}
          onClose={() => setPanel({ k: 'none' })}
        />
      )}
      {live && panel.k === 'yard' && (
        <Yard
          world={live.world}
          yard={panel.yard}
          onAdd={addFacility}
          onFit={fit}
          onClose={() => setPanel({ k: 'none' })}
        />
      )}
      <div className="hud">
        <span className="brand">Interchange</span>
        <span className="money">{money(hud.cash)}</span>
        <span>{hud.date}</span>
        <span className="dim">{hud.vehicles} out · {hud.free} idle</span>
        <button
          className="hud-btn"
          onClick={() => {
            if (!live || live.world.yards.count === 0) return;
            if (panel.k === 'yard') { setPanel({ k: 'none' }); return; }
            // And *go* there. A button named after a place that does not move
            // the camera to it is the thing that made the yard unfindable.
            lookAt(live.world.yards.x[0] + 0.5, live.world.yards.y[0] + 0.5);
            setPanel({ k: 'yard', yard: 0 });
          }}
        >Yard</button>
        <button
          className="hud-btn"
          onClick={() => setPanel(panel.k === 'vehicles' ? { k: 'none' } : { k: 'vehicles' })}
        >Vehicles</button>
      </div>
      {!ready && <div className="loading">Surveying the district…</div>}
    </div>
  );
}
