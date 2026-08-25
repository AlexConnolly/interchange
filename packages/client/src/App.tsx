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
  createWorld, Mode, NO_WAY, TICKS_PER_DAY, facilitiesFor, type World,
} from '@interchange/sim';
import { loadContent } from '@interchange/data';
import {
  Renderer, RoadClass, TILES_ACROSS_DEFAULT, RUN, loadKit, type RenderSource,
} from '@interchange/render';
import { Alerts, Earnings, Markers, Mine, money } from './Markers.tsx';
import { Ambient, areaDemand } from './ambient.ts';
import { Fleet, Yard } from './Fleet.tsx';
import { Planning } from './Planning.tsx';
import { Dock } from './Dock.tsx';
import { Owned, Contracts } from './Owned.tsx';
import { Status } from './Status.tsx';
import { Driver } from './Driver.tsx';
import { Place, type PlaceActions } from './Place.tsx';
import './style.css';

loadContent();

const DISTRICT = 128;

/**
 * The scatter models, in the order the source's `sModel` indexes them.
 *
 * Six, which is enough that a hedgerow does not repeat within a screen and few
 * enough that the whole set is six draw calls. The bare one earns its place by
 * being the only tree here whose shape says what month it is.
 */
const TREE_MODELS = [
  'tree_oak', 'tree_ash', 'tree_hawthorn', 'tree_pine', 'tree_autumn', 'tree_bare',
];

/**
 * What stands in a field, and which crop wants which.
 *
 * The point is that the prop *says the crop*. A gold field with stooks in it has
 * been harvested; a green one with sheep in it is grazing; a brown one with a
 * muck heap at the edge has been ploughed. Nothing else the renderer can do at
 * this size carries that information — a colour says "green", and three white
 * specks say "grazed".
 *
 * Indices run on from the trees because they share one scatter layer: to a draw
 * call a bale is a small tree.
 */
const PROP_MODELS = [
  'prop_bale_round', 'prop_bale_wrapped', 'prop_bale_stack',
  'prop_stook', 'prop_sheep', 'prop_cattle', 'prop_muck', 'prop_trough',
  'prop_lamp_post',
];

/** Index of the lamp post within `PROP_MODELS`. It is placed by its own rule. */
const PROP_LAMP = 8;

/** Crop indices, matching `Crop` in the sim's fields.ts. */
const CROP_PASTURE = 0;
const CROP_PASTURE_RICH = 1;
const CROP_MEADOW = 2;
const CROP_WHEAT = 3;
const CROP_WHEAT_RIPE = 4;
const CROP_PLOUGH = 5;

/**
 * Which props belong in which crop, as indices into `PROP_MODELS`.
 *
 * Grass gets stock and a trough; ripe wheat gets stooks and bales; a ploughed
 * field gets a heap and nothing else, because a field that has just been turned
 * over is empty and that emptiness is the point of it. Meadow gets bales,
 * because a meadow is what hay comes from.
 */
const PROPS_BY_CROP: Record<number, number[]> = {
  [CROP_PASTURE]: [4, 4, 5, 7],
  [CROP_PASTURE_RICH]: [5, 5, 4, 7],
  [CROP_MEADOW]: [0, 1, 2, 4],
  [CROP_WHEAT]: [0, 2],
  [CROP_WHEAT_RIPE]: [3, 3, 0, 1, 2],
  [CROP_PLOUGH]: [6],
};

/**
 * Ticks of simulation per real second.
 *
 * 13 gives a game day of 800 / 13 = 62 seconds. Slow enough that a lorry
 * crossing the frame is a journey rather than a blur, fast enough that a
 * fortnight of trading is a couple of minutes.
 */
const TICKS_PER_SECOND = 13;

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
  | { k: 'vehicles' }
  | { k: 'planning' }
  | { k: 'driver'; vehicle: number }
  | { k: 'owned' }
  | { k: 'contracts' };

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
  const [hud, setHud] = useState({
    date: '', vehicles: 0, fps: 0, tris: 0, cash: 0, free: 0,
    dayFraction: 0, night: 0, weather: 0,
  });
  /*
   * Whether the last HUD refresh brought more money than the one before.
   *
   * Keyed on the value so React remounts the element and the CSS animation
   * actually replays — re-adding a class to a live node does not restart an
   * animation, which is the classic way this effect silently does nothing.
   */
  const lastCash = useRef(0);
  const paid = hud.cash > lastCash.current;
  lastCash.current = hud.cash;
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
  /*
   * Placing a depot: the one moment the map is an input rather than a display.
   *
   * A mode rather than a panel, because what you need on screen while choosing
   * where to put a building is *the district*, unobscured. A dialogue with a
   * coordinate picker in it would be the worst of both.
   */
  const [building, setBuilding] = useState(false);
  const [note, setNote] = useState('');
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((r) => r + 1), []);
  /*
   * The canvas listeners are registered once, in an effect with no deps, so they
   * close over the first render's state for ever. Anything they need to read
   * *now* goes through a ref. This is the standard trap with a long-lived
   * imperative listener next to React state, and the alternative — re-binding
   * every listener whenever build mode changes — costs more than it saves.
   */
  const buildingRef = useRef(false);
  buildingRef.current = building;
  const bumpRef = useRef(bump);
  bumpRef.current = bump;

  const buy = useCallback((yard: number, typeIndex: number): void => {
    if (!live) return;
    // Into that yard's empty bay, not into whichever yard happens to fit it.
    const r = live.world.buyVehicleAtYard(typeIndex, yard);
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
    // Glide, never cut. See `Renderer.flyTo`.
    live.renderer.flyTo(x, z);
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
    /*
     * Start in spring, not on the first of January.
     *
     * The calendar begins at day zero, which is 1 January, which is the deepest
     * point of the snow — so the game opened with the district under a foot of
     * it and the one van you own immobilised for want of tyres you could only
     * just afford. A seasonal mechanic has to arrive as something you were
     * warned about, not as the first thing that happens.
     *
     * Sixty days in is April. The first winter then lands about eight months
     * later, by which time there has been a summer to earn in and a November of
     * "No winter tyres" warnings to read.
     */
    world.tick = 60 * TICKS_PER_DAY;
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
      vId: new Int32Array(512),
      placeCount: 0,
      px: new Float32Array(320),
      pz: new Float32Array(320),
      pModel: new Uint8Array(320),
      pRot: new Float32Array(320),
      scatterCount: 0,
      sx: new Float32Array(1400),
      sz: new Float32Array(1400),
      sModel: new Uint8Array(1400),
      sRot: new Float32Array(1400),
      sScale: new Float32Array(1400),
      lampCount: 0,
      lx: new Float32Array(400),
      lz: new Float32Array(400),
      dayFraction: 0.62,
      snow: 0,
      dayNumber: 0,
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

    /*
     * The trees, laid out once and never again.
     *
     * Where they go matters more than how many. Three rules, and each one is a
     * thing you can see in the target frame:
     *
     *   **Along the field boundaries.** A hedgerow with an oak standing in it
     *   every fifty yards is the single most English thing in the picture, and
     *   it is what makes a hedge read as old rather than as planted last year.
     *
     *   **Thick on the rough grazing**, which is the crop the field generator
     *   uses for land nobody ploughs. Unenclosed, unimproved, and therefore
     *   where the scrub is.
     *
     *   **Thin in the fields themselves.** A handful, in the corners.
     *
     * Species come from a *coarse* hash — one dominant kind per eight-tile
     * block — so a copse is a copse of one thing rather than one of each. Salt
     * and pepper reads as noise; a stand of pines on one hillside reads as a
     * plantation, and the district gets somewhere to look.
     */
    interface Scattered { x: number; z: number; model: number; rot: number; scale: number }
    const trees: Scattered[] = [];
    /*
     * Where the street lamps are, kept separately as well as scattered.
     *
     * The scatter layer draws them; the renderer's pool of real lights needs to
     * know where they are, and a street lamp is the *most* worth a real light of
     * anything in the district — it is the main source on a road at night, and
     * unlike a window it has nothing else near it to borrow light from.
     */
    const lampPosts: { x: number; z: number }[] = [];
    {
      const parcel = world.terrain.fields.parcel;
      const crop = world.terrain.fields.crop;
      const height = world.terrain.height;
      // A hash, not an rng, so a tile always grows the same tree.
      const hash = (a: number, b: number): number => {
        let h = (a * 374761393 + b * 668265263) | 0;
        h = (h ^ (h >>> 13)) * 1274126177;
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
      };
      const boundary = (t: number, x: number, z: number): boolean => {
        const p = parcel[t];
        if (p < 0) return false;
        if (x > 0 && parcel[t - 1] !== p) return true;
        if (x + 1 < DISTRICT && parcel[t + 1] !== p) return true;
        if (z > 0 && parcel[t - DISTRICT] !== p) return true;
        if (z + 1 < DISTRICT && parcel[t + DISTRICT] !== p) return true;
        return false;
      };
      for (let z = 1; z < DISTRICT - 1 && trees.length < 1400; z++) {
        for (let x = 1; x < DISTRICT - 1 && trees.length < 1400; x++) {
          const t = z * DISTRICT + x;
          if (height[t] <= 0) continue;
          if (roadClass[t] >= 0) continue;
          const r = hash(x, z);
          // The rough grazing is scrub; the boundaries are hedgerow; the middle
          // of a worked field is nearly bare.
          const chance = crop[t] === 6 ? 0.22 : boundary(t, x, z) ? 0.09 : 0.007;
          if (r > chance) continue;
          // One dominant species per block of eight tiles.
          const local = hash(x >> 3, (z >> 3) + 4096);
          const stray = hash(x + 7919, z + 104729);
          const kind = stray < 0.22
            ? Math.floor(hash(x + 31, z + 17) * TREE_MODELS.length)
            : Math.floor(local * TREE_MODELS.length);
          trees.push({
            // Off the tile centre, or a hedgerow reads as a row of fenceposts.
            x: x + 0.18 + hash(x + 1, z) * 0.64,
            z: z + 0.18 + hash(x, z + 1) * 0.64,
            model: Math.min(TREE_MODELS.length - 1, Math.max(0, kind)),
            rot: hash(x + 3, z + 5),
            // A stand of identical trees is a wallpaper. Half again either way.
            scale: 0.78 + hash(x + 11, z + 13) * 0.55,
          });
        }
      }

      /*
       * And what is standing in the fields.
       *
       * A second pass rather than a branch in the first, because the rule is
       * different in kind: a tree goes on a boundary or in scrub, and a bale
       * goes *inside* a parcel, keyed off what is growing there. Mixing the two
       * would need the loop to carry both sets of conditions and neither would
       * be readable.
       *
       * Sparse — about one prop every twenty tiles of field — because the job is
       * to say what the crop is, not to fill the field. Three bales in a
       * ten-tile field reads as a field with bales in it; thirty reads as a
       * warehouse.
       */
      /*
       * Street lamps, and *where* is the whole design.
       *
       * In 1985 England a village street and a trunk road are lit and a country
       * lane is not — so lighting every road would flatten the one distinction
       * that makes a district read as a district. Two rules: within reach of a
       * settlement, or on the best class of road. A farm track is never lit, and
       * the dark stretch between two villages is the point of the lit ones.
       *
       * Every third tile, alternating sides, and each one turned so its arm
       * overhangs the carriageway — the model knows it leans along +X and
       * nothing else has to.
       */
      for (let z = 1; z < DISTRICT - 1 && trees.length < 1400; z++) {
        for (let x = 1; x < DISTRICT - 1 && trees.length < 1400; x++) {
          const t = z * DISTRICT + x;
          if (roadClass[t] < 0) continue;
          const trunk = roadClass[t] === RoadClass.Spine;
          let near = false;
          for (let tw = 0; tw < world.towns.count; tw++) {
            const dx = world.towns.x[tw] - x;
            const dz = world.towns.y[tw] - z;
            if (dx * dx + dz * dz < 100) { near = true; break; }
          }
          if (!near && !trunk) continue;
          // Every third tile along whichever way the road runs, so the spacing
          // is even and does not double up at a junction.
          const alongX = roadClass[t - 1] >= 0 || roadClass[t + 1] >= 0;
          const step = alongX ? x : z;
          if (step % 3 !== 0) continue;
          // Alternating sides, which is what a real street does and what stops a
          // long straight reading as a fence.
          const side = ((step / 3) | 0) % 2 === 0 ? 1 : -1;
          const offX = alongX ? 0 : side * 0.42;
          const offZ = alongX ? side * 0.42 : 0;
          // Turn the arm to overhang the road: it points along +X unrotated, so
          // the rotation is the direction from the post back to the centreline.
          const rot = Math.atan2(-offZ, -offX) / (Math.PI * 2);
          lampPosts.push({ x: x + 0.5 + offX, z: z + 0.5 + offZ });
          trees.push({
            x: x + 0.5 + offX,
            z: z + 0.5 + offZ,
            model: TREE_MODELS.length + PROP_LAMP,
            rot: ((rot % 1) + 1) % 1,
            scale: 1,
          });
        }
      }

      for (let z = 1; z < DISTRICT - 1 && trees.length < 1400; z++) {
        for (let x = 1; x < DISTRICT - 1 && trees.length < 1400; x++) {
          const t = z * DISTRICT + x;
          if (parcel[t] < 0) continue;
          if (roadClass[t] >= 0 || height[t] <= 0) continue;
          if (boundary(t, x, z)) continue;
          const list = PROPS_BY_CROP[crop[t]];
          if (list === undefined || list.length === 0) continue;
          const r = hash(x + 501, z + 733);
          if (r > 0.05) continue;
          const pick = list[Math.floor(hash(x + 61, z + 97) * list.length) % list.length];
          trees.push({
            x: x + 0.2 + hash(x + 7, z + 3) * 0.6,
            z: z + 0.2 + hash(x + 3, z + 7) * 0.6,
            model: TREE_MODELS.length + pick,
            rot: hash(x + 13, z + 17),
            scale: 0.85 + hash(x + 23, z + 29) * 0.4,
          });
        }
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
    /*
     * Where in the day the game opens, overridable from the address bar.
     *
     * 0.46 is the late afternoon of the target frame. `?time=0.85` starts at
     * night, which exists because checking anything about the dark — lamps,
     * cat's eyes, lit windows — otherwise means waiting out a four-minute day,
     * and a thing that is awkward to look at is a thing that stays broken.
     */
    const params = new URLSearchParams(window.location.search);
    const asked = Number(params.get('time'));
    const dayOffset = Number.isFinite(asked) && params.has('time')
      ? ((asked % 1) + 1) % 1
      : 0.46;

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
      if (vanIndex >= 0) world.buyVehicleAtYard(vanIndex, yard);
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
    /*
     * The nine content vehicles, then the two cars.
     *
     * The cars are not in the content because they are not for sale — they are
     * traffic. They go on the end of the same model list so the renderer needs
     * no second instancing path: to a draw call a car is a small lorry.
     */
    const modelNames = [
      ...world.content.vehicles.map((v) => `veh_${v.id.replace(/-/g, '_')}`),
      'veh_car_saloon', 'veh_car_estate',
    ];
    /*
     * What the traffic is made of, and it is not all cars.
     *
     * A road that exists to carry freight with nothing but private cars on it
     * looks wrong in a way that is hard to name — so the mix is two cars, a
     * transit, a rigid box lorry and an artic, weighted by repetition. Five
     * silhouettes is enough that a stretch of road does not read as a repeated
     * stamp.
     */
    const byId = (id: string): number =>
      Math.max(0, world.content.vehicles.findIndex((v) => v.id === id));
    const ambientModels = [
      modelNames.length - 2, modelNames.length - 2, modelNames.length - 2,
      modelNames.length - 1, modelNames.length - 1,
      byId('van-transit'), byId('van-transit'),
      byId('rigid-box'),
      byId('artic-box'),
    ];
    const townList = Array.from({ length: world.towns.count }, (_, t) => ({
      x: world.towns.x[t], y: world.towns.y[t], population: world.towns.population[t],
    }));
    const ambient = new Ambient({
      size: DISTRICT,
      isRoad: (t) => roadClass[t] >= 0,
      usable: (t) => world.influence.usable(t),
      // The same road A* the route preview uses. Traffic that routes rather than
      // wanders is the whole difference between going somewhere and milling
      // about — see ambient.ts.
      route: (from, to) => world.roadRoute(from, to),
      // Somewhere worth driving to: the businesses, and the settlements.
      places: () => {
        const out: number[] = [];
        for (let i = 0; i < world.sites.count; i++) {
          const t = world.siteAccessTile[i];
          if (t >= 0 && world.influence.usable(t)) out.push(t);
        }
        for (let t = 0; t < world.towns.count; t++) {
          const tile = world.towns.y[t] * DISTRICT + world.towns.x[t];
          if (world.influence.usable(tile)) out.push(tile);
        }
        return out;
      },
    }, ambientModels);
    void loadKit(modelNames).then((kit) => {
      if (kit.missing.length > 0) {
        console.warn(`[fleet] no model for: ${kit.missing.join(', ')}`);
      }
      const ordered = modelNames.map((n) => kit.models.get(n)).filter((m) => m !== undefined);
      if (ordered.length === modelNames.length) renderer.setFleet(ordered);
    });
    const scatterNames = [...TREE_MODELS, ...PROP_MODELS];
    void loadKit(scatterNames).then((kit) => {
      if (kit.missing.length > 0) {
        console.warn(`[scatter] no model for: ${kit.missing.join(', ')}`);
      }
      const ordered = scatterNames.map((n) => kit.models.get(n)).filter((m) => m !== undefined);
      if (ordered.length === scatterNames.length) renderer.setScatterModels(ordered);
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
    /*
     * One finger pans, two fingers pinch.
     *
     * Pointer events already gave touch the drag for free, which is why it was
     * easy to miss that there was no way to zoom at all on a phone: the wheel
     * handler is the only zoom in the game and a touchscreen has no wheel.
     *
     * Tracking a *map* of live pointers rather than a single one is what makes
     * both gestures fall out of the same three handlers. With one pointer down
     * it is a drag; the moment a second arrives the gesture becomes a pinch and
     * the drag stops, because a two-finger drag that also panned would fight the
     * zoom and neither would feel controlled. Lifting back to one finger resumes
     * panning from wherever that finger now is, so the transition does not jump.
     */
    const live = new Map<number, { x: number; y: number }>();
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;
    /** Distance between the two fingers when the pinch began, and the zoom then. */
    let pinchFrom = 0;
    let pinchTiles = 0;

    const spread = (): number => {
      const pts = [...live.values()];
      if (pts.length < 2) return 0;
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    };

    const down = (e: PointerEvent): void => {
      live.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (live.size >= 2) {
        // Second finger: stop panning and start pinching.
        dragging = false;
        pinchFrom = spread();
        pinchTiles = renderer.tilesAcross;
        return;
      }
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      downX = e.clientX;
      downY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };

    const move = (e: PointerEvent): void => {
      const held = live.get(e.pointerId);
      if (held) { held.x = e.clientX; held.y = e.clientY; }

      if (live.size >= 2) {
        const now = spread();
        if (pinchFrom > 8 && now > 8) {
          // Fingers apart means zoom in, which means *fewer* tiles across.
          const next = pinchTiles * (pinchFrom / now);
          renderer.tilesAcross = Math.max(14, Math.min(70, next));
          fit();
        }
        return;
      }
      if (!dragging) return;
      // Grab-and-pull, and the renderer owns the arithmetic because it is the
      // thing that knows where the camera is pointing.
      renderer.pan(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const up = (e: PointerEvent): void => {
      const wasPinching = live.size >= 2;
      live.delete(e.pointerId);
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (wasPinching) {
        /*
         * Coming out of a pinch. If one finger is still down, carry on panning
         * from where *it* is — reading the remaining pointer rather than the one
         * that left, or the map jumps by the width of the pinch on the next
         * move. And a pinch is never a click.
         */
        dragging = false;
        const rest = [...live.values()][0];
        if (rest) {
          dragging = true;
          lastX = rest.x;
          lastY = rest.y;
          downX = rest.x;
          downY = rest.y;
        }
        return;
      }
      dragging = false;
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
      if (buildingRef.current) {
        // Build mode: the click is a location, not a selection.
        const r = world.foundDepot(cx, cz, `Depot ${world.yards.count}`);
        if (r.site >= 0) {
          setBuilding(false);
          setNote('');
          bumpRef.current();
          setPanel({ k: 'place', site: r.site });
        } else {
          setNote(r.reason);
        }
        return;
      }
      if (found >= 0) {
        // Centre what you clicked. The panel anchors itself over the place, so
        // a business at the edge of the frame would otherwise open a panel half
        // off the screen.
        renderer.flyTo(world.sites.x[found] + 0.5, world.sites.y[found] + 0.5);
        setPanel({ k: 'place', site: found });
      }
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

    const cancel = (e: PointerEvent): void => {
      // A pointer the browser takes away — a system gesture, an incoming call —
      // never sends `pointerup`. Without this the map believes a finger is still
      // down and the next touch is read as the second half of a pinch.
      live.delete(e.pointerId);
      dragging = false;
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
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

      /*
       * How fast the world runs, and it was six times too fast.
       *
       * A game day was about ten seconds, which put a lorry across the screen in
       * eight — frantic, and not in a way that reads as busy. It reads as a
       * simulation being fast-forwarded, which is exactly what it was.
       *
       * `TICKS_PER_SECOND` gives a day of a little over a minute and a
       * twenty-six-tile haul of about a minute, which is the figure design.md
       * §9 asks for. Everything else follows from it because everything else is
       * expressed in ticks: production, upkeep, the contract board, the sun.
       * There is deliberately one number here rather than a speed for the
       * calendar and another for the vehicles — two would drift, and the day
       * *is* how long things take.
       */
      acc += dt * TICKS_PER_SECOND;
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
        src.vId[n] = i;
        n++;
      }
      // And the traffic, appended after the fleet. Scenery that moves, and the
      // difference between a road and a grey stripe. How much of it there is
      // depends on where you are looking: a lane by a hamlet is not the road
      // into the market town.
      ambient.demand = areaDemand(townList, renderer.camX, renderer.camZ, 22);
      n = ambient.step(
        dt, renderer.camX, renderer.camZ, renderer.tilesAcross * 0.8, n,
        src.vx, src.vz, src.vHeading, src.vLivery, src.vModel, src.vId,
      );
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
      /*
       * Businesses founded during play, which is depots.
       *
       * `placed` was built once at startup and a depot appears later, so it
       * would have no building at all — the classic shape of this bug, and the
       * same one that left the player's own yard invisible. Sites are scanned
       * each frame rather than appended on purchase because reading the world is
       * cheap at this size and cannot get out of step.
       */
      for (let i = 0; i < world.sites.count && pn < src.px.length; i++) {
        if (world.sites.owner[i] !== world.player) continue;
        if (!world.isDepot(i)) continue;
        const tile = world.siteAccessTile[i];
        if (tile < 0) continue;
        src.px[pn] = (tile % DISTRICT) + 0.5;
        src.pz[pn] = Math.floor(tile / DISTRICT) + 0.5;
        src.pModel[pn] = world.sites.def[i];
        src.pRot[pn] = 0;
        pn++;
      }
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

      // Trees, the same influence test. A wood beyond your reach is part of the
      // country you cannot touch, and leaving it out is what makes the boundary
      // read as a boundary rather than as a colour wash.
      let sn = 0;
      for (const q of trees) {
        if (sn >= src.sx.length) break;
        const tile = Math.round(q.z) * DISTRICT + Math.round(q.x);
        if (!world.influence.usable(tile)) continue;
        src.sx[sn] = q.x;
        src.sz[sn] = q.z;
        src.sModel[sn] = q.model;
        src.sRot[sn] = q.rot;
        src.sScale[sn] = q.scale;
        sn++;
      }
      src.scatterCount = sn;

      // And the street lamps, for the real-light pool. Filtered by influence
      // like everything else: a lit road you cannot reach is not lit.
      let ln = 0;
      for (const q of lampPosts) {
        if (ln >= src.lx.length) break;
        const tile = Math.round(q.z) * DISTRICT + Math.round(q.x);
        if (!world.influence.usable(tile)) continue;
        src.lx[ln] = q.x;
        src.lz[ln] = q.z;
        ln++;
      }
      src.lampCount = ln;
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
      src.dayFraction = ((world.tick + TICKS_PER_DAY * dayOffset) % TICKS_PER_DAY) / TICKS_PER_DAY;
      // One number, read by the renderer to paint the season and by the traffic
      // to decide who can move. There is deliberately not a second one.
      src.snow = world.snow;
      src.dayNumber = world.day;

      renderer.render(src, dt);

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
          dayFraction: src.dayFraction,
          night: renderer.night,
          weather: renderer.cloud,
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
      canvas.removeEventListener('pointercancel', cancel);
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
          hide={panel.k === 'place' ? panel.site : -1}
          onOpenSite={(site) => {
            lookAt(live.world.sites.x[site] + 0.5, live.world.sites.y[site] + 0.5);
            setPanel({ k: 'place', site });
          }}
          onOpenYard={(yard) => {
            lookAt(live.world.yards.x[yard] + 0.5, live.world.yards.y[yard] + 0.5);
            setPanel({ k: 'yard', yard });
          }}
        />
      )}
      {live && <Alerts world={live.world} renderer={live.renderer} />}
      {live && <Earnings world={live.world} renderer={live.renderer} />}
      {live && (
        <Mine
          world={live.world}
          renderer={live.renderer}
          onOpen={(vehicle) => setPanel({ k: 'driver', vehicle })}
        />
      )}
      {live && panel.k === 'driver' && (
        <Driver
          world={live.world}
          renderer={live.renderer}
          vehicle={panel.vehicle}
          onDrop={(v) => {
            if (live.world.dropVehicle(v)) { bump(); setPanel({ k: 'none' }); }
          }}
          onClose={() => setPanel({ k: 'none' })}
        />
      )}
      {live && panel.k === 'place' && (
        <Place
          world={live.world}
          renderer={live.renderer}
          site={panel.site}
          actions={placeActions}
        />
      )}
      {live && panel.k === 'vehicles' && (
        <Fleet
          world={live.world}
          onFit={fit}
          onGoToYard={(yard) => {
            lookAt(live.world.yards.x[yard] + 0.5, live.world.yards.y[yard] + 0.5);
            setPanel({ k: 'yard', yard });
          }}
          onClose={() => setPanel({ k: 'none' })}
        />
      )}
      {live && panel.k === 'owned' && (
        <Owned
          world={live.world}
          onGoSite={(site) => {
            lookAt(live.world.sites.x[site] + 0.5, live.world.sites.y[site] + 0.5);
            setPanel({ k: 'place', site });
          }}
          onGoYard={(yard) => {
            lookAt(live.world.yards.x[yard] + 0.5, live.world.yards.y[yard] + 0.5);
            setPanel({ k: 'yard', yard });
          }}
          onBuild={() => { setBuilding(true); setNote(''); setPanel({ k: 'none' }); }}
          onClose={() => setPanel({ k: 'none' })}
        />
      )}
      {live && panel.k === 'contracts' && (
        <Contracts
          world={live.world}
          onGoSite={(site) => {
            lookAt(live.world.sites.x[site] + 0.5, live.world.sites.y[site] + 0.5);
            setPanel({ k: 'place', site });
          }}
          onGoDriver={(vehicle) => setPanel({ k: 'driver', vehicle })}
          onClose={() => setPanel({ k: 'none' })}
        />
      )}
      {live && panel.k === 'planning' && (
        <Planning
          world={live.world}
          onFund={(pence) => { if (live.world.fundParish(pence).ok) bump(); }}
          onPropose={(works, from, to) => {
            const r = live.world.propose(works, from, to);
            if (r.ok) { bump(); setNote(''); } else setNote(r.reason);
          }}
          onClose={() => setPanel({ k: 'none' })}
        />
      )}
      {building && (
        <div className="build-hint">
          Click a spot beside a road to put a depot there
          {note !== '' && <b>{note}</b>}
        </div>
      )}
      {!building && note !== '' && <div className="build-hint"><b>{note}</b></div>}
      {live && panel.k === 'yard' && (
        <Yard
          world={live.world}
          renderer={live.renderer}
          yard={panel.yard}
          onAdd={addFacility}
          onFit={fit}
          onBuy={buy}
          onClose={() => setPanel({ k: 'none' })}
        />
      )}
      <div className="hud">
        {live && (
          <Status
            cash={hud.cash}
            date={hud.date}
            out={hud.vehicles}
            idle={hud.free}
            dayFraction={hud.dayFraction}
            night={hud.night}
            weather={hud.weather}
          />
        )}
      </div>
      {live && (
        <Dock
          items={[
            {
              key: 'owned',
              label: 'Business',
              icon: 'builders-merchant',
              on: panel.k === 'owned',
              onClick: () => setPanel(panel.k === 'owned' ? { k: 'none' } : { k: 'owned' }),
            },
            {
              key: 'fleet',
              label: 'Vehicles',
              icon: 'yard',
              on: panel.k === 'vehicles',
              onClick: () => setPanel(
                panel.k === 'vehicles' ? { k: 'none' } : { k: 'vehicles' },
              ),
            },
            {
              key: 'contracts',
              label: 'Contracts',
              icon: 'terminal',
              on: panel.k === 'contracts',
              onClick: () => setPanel(
                panel.k === 'contracts' ? { k: 'none' } : { k: 'contracts' },
              ),
            },
            /*
             * The parish appears when the parish would notice you, and not
             * before (planning.ts). Build is *not* here: it is one action inside
             * Businesses, because a permanent slot for a thing you do three
             * times in a game is a slot spent badly — and it read as a mode with
             * nothing behind it.
             */
            ...(live.world.planningOpen() ? [{
              key: 'parish',
              label: 'Parish',
              icon: 'village-shop',
              on: panel.k === 'planning',
              onClick: (): void => setPanel(
                panel.k === 'planning' ? { k: 'none' } : { k: 'planning' },
              ),
            }] : []),
          ]}
        />
      )}
      {!ready && <div className="loading">Surveying the district…</div>}
    </div>
  );
}
