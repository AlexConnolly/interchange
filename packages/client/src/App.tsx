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
  createWorld, Crop, Mode, NO_WAY, TICKS_PER_DAY, TileFlag, facilitiesFor,
  foliage, isWood, type World,
} from '@interchange/sim';
import { loadContent } from '@interchange/data';
import {
  CHUNK, Renderer, RoadClass, TILES_ACROSS_DEFAULT, TILES_ACROSS_OPENING,
  RUN, loadKit, type RenderSource,
} from '@interchange/render';
import { Alerts, Earnings, Markers, Mine, money } from './Markers.tsx';
import { Ambient, areaDemand } from './ambient.ts';
import { Grazing } from './grazing.ts';
import { eveningFor, litness, type Evening } from './evening.ts';
import { Sound, type Heard } from './sound.ts';
import { Farmwork, type FarmField } from './farmwork.ts';
import { syncAnchors } from './anchor.ts';
import {
  Settings, loadOptions, saveOptions, type Options,
} from './Settings.tsx';
import { Fleet, Upgrades, Yard } from './Fleet.tsx';
import { Planning } from './Planning.tsx';
import { Dock } from './Dock.tsx';
import { Icon } from './Icons.tsx';
import { Owned, Contracts } from './Owned.tsx';
import { Status } from './Status.tsx';
import { Driver } from './Driver.tsx';
import { Place, type PlaceActions } from './Place.tsx';
import './style.css';

loadContent();

const DISTRICT = 128;

/**
 * How many things the instanced scatter layer can hold: trees, field props and
 * street lamps together.
 *
 * One number for all three because they are one draw call per model, and the
 * passes that fill it are ordered by how much their absence hurts — see the note
 * above them.
 *
 * Seven thousand, up from eighteen hundred, and the whole of the increase is the
 * woods. A district is a tenth to a sixth woodland and a wood needs three or four
 * trees to the tile to close its canopy, which is four to five thousand trees on
 * its own — an order of magnitude more than the hedgerows ever wanted. Measured
 * across three seeds: 2,830, 3,542 and 4,741 trees of woodland.
 *
 * It is a district-wide figure, not a drawn one. What actually reaches the
 * renderer is filtered by influence every frame, so early on this is mostly
 * headroom.
 */
const SCATTER_MAX = 7000;

/**
 * Per-model instance capacity in the renderer's scatter batches.
 *
 * Separate from `SCATTER_MAX` because the two bound different things: that is
 * how many objects exist, this is how many of *one model* can be drawn. They
 * cannot be the same number without allocating the whole budget twenty times
 * over, and the split has to be generous rather than exact — a conifer wood is
 * one species by definition, so a single plantation sends a thousand instances
 * to `tree_pine` and none to anything else.
 */
const SCATTER_BATCH = 2600;

/**
 * One audio engine for the page.
 *
 * Outside the component because an `AudioContext` is a scarce resource — a
 * browser allows a handful per tab and then refuses — and React may mount a
 * component more than once. It is silent until `start()` is called from a user
 * gesture, which browsers require.
 */
const sound = new Sound();

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
 * The three at the front are the broadleaves, and the order above is load-bearing.
 *
 * A wood picks from a *slice* of the list rather than from all of it, because the
 * whole point of the two woodland types is that they do not share species: a
 * plantation is pines and nothing else, and an oak wood with a bare tree and an
 * autumn tree scattered through it in June is a wood in three seasons at once.
 * The hedgerows keep using the full set, where that variety is exactly right.
 */
const BROADLEAF_MODELS = 3;
const PINE = TREE_MODELS.indexOf('tree_pine');
/** The two the seasons swap in. They were in the set from the start, unused. */
const TREE_AUTUMN = TREE_MODELS.indexOf('tree_autumn');
const TREE_BARE = TREE_MODELS.indexOf('tree_bare');

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
  // The yard props. Everything above stands in a field; everything from here
  // stands *at a business*, and exists to answer what the place is.
  'prop_log_stack', 'prop_timber_stack', 'prop_stone_heap', 'prop_sacks',
  'prop_churns', 'prop_tank', 'prop_pallets', 'prop_pen',
  // Spring, and only spring. These two are the reason a scattered thing can have
  // a season at all: there is no colour that means "gone", so they have to leave.
  'prop_daffodils', 'prop_blossom',
];

/** Index of the lamp post within `PROP_MODELS`. It is placed by its own rule. */
const PROP_LAMP = 8;

/** The spring pair, placed by their own rule and gone for nine months. */
const PROP_DAFFODILS = PROP_MODELS.indexOf('prop_daffodils');
const PROP_BLOSSOM = PROP_MODELS.indexOf('prop_blossom');

/**
 * What stands in each trade's yard, by industry id.
 *
 * "There's really no way of working out what each business is without looking at
 * the icon. A livestock farm with no animals." Quite — and the building alone was
 * never going to carry it: at forty pixels a creamery and a feed mill are both a
 * shed with a silo, and the icon floating over them is a label, not a depiction.
 *
 * So each trade gets the objects that only it would have lying about. The rule for
 * choosing them is that they have to be identifiable *as silhouettes* — pale
 * cylinders on a stand for a dairy, round timber for forestry against sawn boards
 * for the sawmill, grey angular heaps for stone. A gate or a sign would be more
 * literal and completely invisible.
 *
 * Two or three each, because a yard with eight things in it reads as a scrapyard
 * whatever the things are.
 */
const P_BALE = 0;
const P_STOOK = 3;
const P_SHEEP = 4;
const P_CATTLE = 5;
const P_MUCK = 6;
const P_TROUGH = 7;
const P_LOGS = 9;
const P_TIMBER = 10;
const P_STONE = 11;
const P_SACKS = 12;
const P_CHURNS = 13;
const P_TANK = 14;
const P_PALLETS = 15;
const P_PEN = 16;

const YARD: Record<string, number[]> = {
  'dairy-farm': [P_CHURNS, P_CATTLE, P_MUCK],
  'arable-farm': [P_BALE, P_STOOK, P_SACKS],
  'livestock-farm': [P_PEN, P_SHEEP, P_CATTLE, P_TROUGH],
  creamery: [P_CHURNS, P_TANK, P_PALLETS],
  mill: [P_SACKS, P_PALLETS],
  brewery: [P_SACKS, P_TANK, P_PALLETS],
  quarry: [P_STONE, P_STONE, P_PALLETS],
  forestry: [P_LOGS, P_LOGS],
  sawmill: [P_LOGS, P_TIMBER, P_TIMBER],
  'concrete-plant': [P_STONE, P_TANK],
  terminal: [P_PALLETS, P_PALLETS, P_TIMBER],
  'builders-merchant': [P_TIMBER, P_PALLETS, P_SACKS],
  'filling-station': [P_TANK, P_PALLETS],
  abattoir: [P_PEN, P_TROUGH],
  'village-shop': [P_PALLETS, P_SACKS],
  'distribution-centre': [P_PALLETS, P_PALLETS, P_TIMBER],
};

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
  /*
   * No sheep or cattle in here any more — see `grazing.ts`.
   *
   * They were props, which is to say nailed down, and a field of livestock that
   * never moves reads as a field of ornaments. The troughs stay: a trough is
   * supposed to be nailed down.
   */
  [CROP_PASTURE]: [7],
  [CROP_PASTURE_RICH]: [7],
  [CROP_MEADOW]: [0, 1, 2],
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
  /** One vehicle, and what can be fitted to it. */
  | { k: 'upgrades'; vehicle: number }
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


/**
 * Keep something on screen for long enough to animate away.
 *
 * React unmounts the moment the condition goes false, which gives every panel in
 * the game an entrance and no exit — it grows out of the dock on the way in and
 * then disappears between two frames on the way out. That reads as a crash
 * rather than as a dismissal, and it is worst for the click-away, where clicking
 * the map is not obviously a *close* gesture and the movement is the only thing
 * that says what just happened.
 *
 * So the value is held after it closes, and a flag says it is on its way out.
 * `ms` has to match the CSS, and there is no way around that: the animation
 * lives in the stylesheet and the unmount lives here.
 */
function useLeaving<T>(value: T, open: boolean, ms: number): [T, boolean] {
  const [shown, setShown] = useState(value);
  const [leaving, setLeaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);

  /*
   * Adjusted during render, not in an effect, and that is the whole of it.
   *
   * The first version set `leaving` from an effect, which is a frame too late:
   * effects run *after* the commit, and the commit that closes the panel is the
   * one that unmounts it. The condition holding the panel on screen was itself
   * derived from `leaving`, so on the closing render `leaving` was still false,
   * the panel went, and the effect then set a flag on nothing. Measured with a
   * MutationObserver: the class never appeared at all on a click-away.
   *
   * Setting state during render re-runs this component before anything is
   * committed, so `leaving` is true in the *same* commit that `open` goes false.
   * This is React's documented way of adjusting state when an input changes, and
   * it is the only version of this that is not a race.
   */
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setShown(value); setLeaving(false); } else setLeaving(true);
  } else if (open && value !== shown) {
    // Switching straight from one panel to another: swap, do not animate.
    setShown(value);
  }

  useEffect(() => {
    if (!leaving) return undefined;
    const id = window.setTimeout(() => setLeaving(false), ms);
    return () => { window.clearTimeout(id); };
  }, [leaving, ms]);

  // Never both: reopening inside the window must not leave the exit class on.
  return [shown, leaving && !open];
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
   * What is drawn, which lags what is open by the length of the exit animation.
   * `panel` stays the truth — the dock button un-lights the instant you press it
   * — and only the panel itself is held back.
   */
  const panelOpen = panel.k !== 'none';
  const [shownPanel, panelLeaving] = useLeaving(panel, panelOpen, 120);
  const showPanel = panelOpen || panelLeaving;
  /*
   * Placing a depot: the one moment the map is an input rather than a display.
   *
   * A mode rather than a panel, because what you need on screen while choosing
   * where to put a building is *the district*, unobscured. A dialogue with a
   * coordinate picker in it would be the worst of both.
   */
  const [building, setBuilding] = useState(false);
  const [options, setOptions] = useState<Options>(loadOptions);
  const [paused, setPaused] = useState(false);
  const [, pauseLeaving] = useLeaving(paused, paused, 140);

  /*
   * The book, opened and shut.
   *
   * Driven from the state rather than from the buttons, because far too many
   * things open a panel: a dock button, a marker on the map, a row in a list, a
   * yard, the cog. Watching the one thing they all change is one effect instead
   * of a rule every one of them has to remember.
   *
   * `claimPress` rather than `oneShot`, so the page turn that the press itself
   * queued is replaced rather than layered under this.
   */
  const wasShowing = useRef(false);
  const showing = panelOpen || paused;
  useEffect(() => {
    if (showing === wasShowing.current) return;
    wasShowing.current = showing;
    sound.claimPress(showing ? 'open' : 'close', showing ? 0.5 : 0.45);
  }, [showing]);
  /**
   * The frame loop reads both of these through refs.
   *
   * It is set up once, in an effect with no dependencies, and closing over the
   * state directly would freeze it at whatever it was on the first frame — the
   * pause would never take and the volume slider would move nothing. A ref is
   * the standard way across that boundary and the only one that does not mean
   * tearing the loop down and rebuilding it every time a setting changes.
   */
  const pausedRef = useRef(false);
  const optionsRef = useRef(options);
  pausedRef.current = paused;
  optionsRef.current = options;
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
  /**
   * The road tool: laying track, taking it up, or neither.
   *
   * A mode rather than a panel, like the depot placement it sits beside — what
   * you need on screen while choosing where a road goes is *the district*, and a
   * dialogue over the top of it is the one thing that cannot help.
   */
  const [tool, setTool] = useState<'none' | 'lay' | 'lift'>('none');
  // So the tray can animate out rather than vanish, the same way panels do.
  const [, toolLeaving] = useLeaving(tool, tool !== 'none', 150);
  const buildingRef = useRef(false);
  buildingRef.current = building;
  const toolRef = useRef<'none' | 'lay' | 'lift'>('none');
  toolRef.current = tool;
  /**
   * How fast the day runs. One, two or four.
   *
   * Worth having now rather than earlier because the game has grown things that
   * take a *season*: fields that want ploughing in October, a hedge that comes
   * into leaf in April, a contract that pays over weeks. Watching for those at
   * one minute to the hour was fine when the loop was a lorry going back and
   * forth; it is not fine when the thing you are waiting for is a harvest.
   */
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1);
  speedRef.current = speed;
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
    supply: useCallback((from: number, to: number, cargo: number, vehicle?: number): void => {
      if (!live) return;
      if (live.world.supply(from, to, cargo, vehicle ?? -1)) bump();
    }, [live, bump]),
    endRun: useCallback((service: number): void => {
      if (!live) return;
      if (live.world.endRun(service)) bump();
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

  /*
   * Push the options into the two systems that own them, and to disk.
   *
   * One effect rather than three, because they are one decision as far as the
   * player is concerned and splitting them would mean three writes to
   * `localStorage` for one click on a segmented control.
   */
  useEffect(() => {
    sound.setMuted(!options.sound);
    sound.setLevels(options.music, options.effects);
    live?.renderer.setVfx(options.vfx);
    saveOptions(options);
  }, [options, live]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

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

    /*
     * The district seed. 1985, the year, and it stays that way.
     *
     * I moved it twice while chasing other things — once because 1985's district
     * generates no creamery, so with no buyer for milk the opening job falls
     * through to timber and the ladder reads four minutes instead of twelve, and
     * once more to find a map with visible water. Both were defensible and both
     * were wrong: this is the district that has been played, and "the initial
     * world seed is great, let's keep that for the first game" settles it.
     *
     * So the balance argument has to be won somewhere other than here.
     */
    const world = createWorld({
      seed: 1985, size: DISTRICT, townCount: 3, companyCount: 1,
    });
    world.dayOffset = dayOffset;
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
    /*
     * Day sixty is April. `?day=200` starts in high summer, `?day=280` in the
     * snow — the same affordance as `?time` and `?rain`, and for the third time
     * the same reason: the farming year takes sixteen hours to go round, so
     * looking at August means either an override or an afternoon.
     */
    const askedDay = Number(params.get('day'));
    world.tick = (params.has('day') && Number.isFinite(askedDay)
      ? Math.max(0, Math.floor(askedDay))
      : 60) * TICKS_PER_DAY;
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
      /*
       * The flag the terrain has been setting since the beginning and nothing
       * has ever read.
       *
       * Road tiles are deliberately *not* excluded: a stream does not stop at a
       * bridge, it goes under it. The road surface is drawn over the top and the
       * water shows either side of the parapets, which is the whole of how a
       * bridge is drawn — see `buildRoads`.
       */
      isStream: (t) => (world.terrain.flags[t] & TileFlag.River) !== 0
        && world.terrain.height[t] > 0,
      isYard: (t) => yardTiles.has(t),
      ownedLand: (t) => ownedParcels.has(world.terrain.fields.parcel[t]),
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
      vStopped: new Uint8Array(512),
      vMotor: new Uint8Array(512),
      placeCount: 0,
      px: new Float32Array(320),
      pz: new Float32Array(320),
      pModel: new Uint8Array(320),
      pRot: new Float32Array(320),
      pLamp: new Float32Array(320 * 3),
      scatterCount: 0,
      sx: new Float32Array(SCATTER_MAX),
      sz: new Float32Array(SCATTER_MAX),
      sModel: new Uint8Array(SCATTER_MAX),
      sRot: new Float32Array(SCATTER_MAX),
      sScale: new Float32Array(SCATTER_MAX),
      sSheds: new Uint8Array(SCATTER_MAX),
      lampCount: 0,
      lx: new Float32Array(400),
      lz: new Float32Array(400),
      dayFraction: 0.62,
      snow: 0,
      leaf: 1,
      spring: 0,
      autumn: 0,
      leafiness: 1,
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

    interface Placed {
      x: number; z: number; model: number; rot: number; tile: number; evening: Evening;
    }
    const trees: Scattered[] = [];
    /**
     * Take the scenery off a tile a road has just gone over.
     *
     * The scatter is laid out once at startup and never touched again, which is
     * exactly right for trees and exactly wrong the moment the player can put a
     * road through one. Splicing rather than rebuilding, because the list is
     * thousands long and a road is one tile.
     */
    const clearScatterAt = (tile: number): void => {
      const tx = tile % DISTRICT;
      const tz = Math.floor(tile / DISTRICT);
      for (let i = trees.length - 1; i >= 0; i--) {
        if (Math.floor(trees[i].x) !== tx || Math.floor(trees[i].z) !== tz) continue;
        trees.splice(i, 1);
      }
    };

    /**
     * Fill a business's yard with the things that say what it is.
     *
     * Placed on the ring of tiles around the building rather than on it, and
     * never on a road: a yard is the ground beside the shed, and a pallet in the
     * middle of the lane is worse than no pallet at all. Deterministic from the
     * site's own tile, so a business looks the same every time you come back to
     * it — a yard that rearranged itself would be the houses-change-every-day
     * complaint all over again.
     */
    const fillYard = (tile: number, industry: string): void => {
      const want = YARD[industry];
      if (!want) return;
      const bx = tile % DISTRICT;
      const bz = Math.floor(tile / DISTRICT);
      let h = ((tile * 2654435761) ^ 0x5f2d) >>> 0;
      const rnd = (): number => {
        h = (h * 1664525 + 1013904223) >>> 0;
        return ((h >>> 8) & 0xffff) / 0x10000;
      };
      /*
       * The ring, in a fixed order, shuffled by the tile.
       *
       * A fixed order alone would put every trade's first prop on the same side
       * of every building in the district, which reads as a template. Shuffling
       * the *ring* rather than the props keeps each yard's contents stable while
       * making no two yards face the same way.
       */
      const ring: [number, number][] = [
        [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1],
      ];
      for (let i = ring.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [ring[i], ring[j]] = [ring[j], ring[i]];
      }
      let put = 0;
      for (const [dx, dz] of ring) {
        if (put >= want.length) break;
        const x = bx + dx;
        const z = bz + dz;
        if (x < 0 || z < 0 || x >= DISTRICT || z >= DISTRICT) continue;
        const at = z * DISTRICT + x;
        if (roadClass[at] >= 0) continue;
        if (world.terrain.height[at] <= 0) continue;
        trees.push({
          // Off centre, so a yard is not a grid of objects.
          x: x + 0.25 + rnd() * 0.5,
          z: z + 0.25 + rnd() * 0.5,
          model: TREE_MODELS.length + want[put],
          rot: rnd(),
          // Barely varied. These are manufactured things and a pallet twice the
          // size of the next pallet reads as a mistake, where a tree does not.
          scale: 0.92 + rnd() * 0.16,
        });
        put++;
      }
    };

    const placed: Placed[] = [];
    /*
     * The world seed, so two districts light up differently.
     *
     * Reading it back off the world rather than keeping the literal, because the
     * seed is the world's property and a copy of it here would be one more thing
     * to keep in step.
     */
    const seed = world.config.seed;

    /*
     * One building per business, set back from the lane it is reached by.
     *
     * It used to be drawn *on* its access tile, and the access tile is by
     * definition the tile the road reaches — so every business in the game was
     * standing in the middle of the carriageway. The models are between one and
     * two tiles across, so the road went straight through the building, and
     * "vehicles are driving through buildings" was true of every farm, dairy and
     * yard in the district. Moving the vehicles onto the road, which was a real
     * bug of its own, could never have fixed this one.
     *
     * A full tile off the road centre, which clears the widest model's near edge
     * from the lane, and set the *long* axis of the building along the road
     * rather than into it — which is both what stops the far edge reaching back
     * across the verge and how buildings actually sit on a street. The direction
     * to move is toward the site's own ground, away from the tarmac.
     */
    const OFF_ROAD = 1.0;
    /*
     * The tiles a business is standing on, so the renderer does not pave them.
     *
     * Only the dead ends. A business on a through lane has traffic going past it
     * and the lane belongs there; a business at the end of a stub laid purely to
     * reach it is standing in its own yard, and painting tarmac under the barn is
     * what "roads are going through buildings" was.
     */
    /*
     * Which parcels are yours, refreshed when the answer can have changed.
     *
     * Recomputed on `landRevision` rather than every frame, because it walks
     * every site and yard — and the ground mesh is cached per chunk anyway, so a
     * fresher answer than the mesh would be a lie either way. Buying a business
     * bumps the revision; so does laying a track on it.
     */
    let ownedParcels = new Set<number>();
    let landAt = -1;
    let marksAt = '';
    let hedgeAt = -1;

    const yardTiles = new Set<number>();
    /*
     * Mark a tile as built on, and drop the chunk so the tarmac goes.
     *
     * Businesses are known at startup and can be collected in one pass, but a
     * yard or a depot can be founded at any point in a game — and the road mesh
     * for a chunk is built once and cached, so simply adding to the set would
     * change nothing until something else happened to invalidate it. Hence the
     * drop, and hence the guard: without it this would rebuild the same chunk
     * sixty times a second for the rest of the game.
     */
    const claimYard = (tile: number): void => {
      if (yardTiles.has(tile)) return;
      let arms = 0;
      for (const d of [1, -1, DISTRICT, -DISTRICT]) if (roadClass[tile + d] >= 0) arms++;
      if (arms > 1) return;
      yardTiles.add(tile);
      renderer.dropChunkAt(tile % DISTRICT, Math.floor(tile / DISTRICT));
    };
    /*
     * Where a building goes, given the road tile it is reached from.
     *
     * Shared, because the three things that need it were three separate pieces
     * of code and only one of them had it. Businesses were moved off the road
     * back when lorries were driving through them; the player's own yards and
     * depots were drawn dead centre on their access tile with no offset at all
     * and no rotation either — so the lane went straight through the base, which
     * is both the most-looked-at building in the game and the one the player
     * built themselves.
     */
    const offRoad = (tile: number, ownX: number, ownZ: number): {
      x: number; z: number; rot: number;
    } => {
      const ax = tile % DISTRICT;
      const az = Math.floor(tile / DISTRICT);
      // Which way the road runs here, from whichever neighbours carry one.
      const eastWest = (roadClass[tile + 1] >= 0 || roadClass[tile - 1] >= 0);
      // And which way is off it: toward the site's own ground, or failing that
      // the first neighbour that is not road.
      let dx = 0;
      let dz = 0;
      if (eastWest) {
        dz = Math.sign(ownZ - az) || 1;
        if (roadClass[tile + dz * DISTRICT] >= 0) dz = -dz;
      } else {
        dx = Math.sign(ownX - ax) || 1;
        if (roadClass[tile + dx] >= 0) dx = -dx;
      }
      return {
        x: ax + 0.5 + dx * OFF_ROAD,
        z: az + 0.5 + dz * OFF_ROAD,
        /*
         * Frontage along the road, with a half-turn either way from the tile so
         * a street is not a row of identical orientations. The models are built
         * deeper than they are wide, so their long axis is Z: a road running
         * east-west therefore needs a quarter turn to lay that axis along it.
         */
        rot: ((eastWest ? 0.25 : 0) + ((tile * 2654435761) % 2) * 0.5) % 1,
      };
    };
    for (let i = 0; i < world.sites.count; i++) {
      const tile = world.siteAccessTile[i];
      if (tile < 0) continue;
      const at = offRoad(tile, world.sites.x[i], world.sites.y[i]);
      placed.push({
        x: at.x,
        z: at.z,
        model: world.sites.def[i],
        rot: at.rot,
        tile,
        evening: eveningFor(at.x, at.z, seed),
      });
      let arms = 0;
      for (const d of [1, -1, DISTRICT, -DISTRICT]) if (roadClass[tile + d] >= 0) arms++;
      if (arms <= 1) yardTiles.add(tile);
      fillYard(tile, world.content.industries[world.sites.def[i]].id);
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
        placed.push({
          x: x + 0.5,
          z: z + 0.5,
          model,
          rot: Math.floor(rand() * 4) / 4,
          tile,
          evening: eveningFor(x + 0.5, z + 0.5, seed),
        });
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
    interface Scattered {
      x: number; z: number; model: number; rot: number; scale: number;
      /** When it is there at all. Absent means always. */
      season?: (f: { leaf: number; spring: number; autumn: number }) => boolean;
    }
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
      /*
       * Is this tile under water?
       *
       * Both kinds, which is the point. Every scatter pass tested `height <= 0`,
       * which is the *sea* — and a river is carved down into land that is still
       * well above sea level, so it passed the test and grew oaks in the middle
       * of the water. Standing in a stream is the sort of thing that reads as
       * broken from any distance, and the flag saying so was already there.
       */
      const wet = (t: number): boolean =>
        height[t] <= 0
        || ((world.terrain.flags[t] & TileFlag.River) !== 0 && height[t] > 0);

      const boundary = (t: number, x: number, z: number): boolean => {
        const p = parcel[t];
        if (p < 0) return false;
        if (x > 0 && parcel[t - 1] !== p) return true;
        if (x + 1 < DISTRICT && parcel[t + 1] !== p) return true;
        if (z > 0 && parcel[t - DISTRICT] !== p) return true;
        if (z + 1 < DISTRICT && parcel[t + DISTRICT] !== p) return true;
        return false;
      };
      /*
       * One buffer, three passes, and they are deliberately not equal.
       *
       * All three draw from the same instanced scatter layer, so all three spend
       * the same `SCATTER_MAX` slots, and a pass that runs once the budget is
       * gone places nothing at all. That is a silent failure, and it happened:
       * the lamp pass used to run last, the trees and the field props between
       * them came to exactly the cap, and every street lamp in the district
       * disappeared — the posts, and with them the pool of real lights that
       * follows the posts. Nothing errored. The villages just went dark.
       *
       * So the order here *is* the priority, and structure goes first. A street
       * lamp is infrastructure: it says which roads a village lights, it is the
       * main source on a road at night, and one missing is a hole in the world.
       * A tree is scenery — a district with nine hundred looks like a district
       * with a thousand. When the two compete it is the scenery that should
       * lose, and running the lamps first is the whole of the mechanism.
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
      for (let z = 1; z < DISTRICT - 1 && trees.length < SCATTER_MAX; z++) {
        for (let x = 1; x < DISTRICT - 1 && trees.length < SCATTER_MAX; x++) {
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

      for (let z = 1; z < DISTRICT - 1 && trees.length < SCATTER_MAX; z++) {
        for (let x = 1; x < DISTRICT - 1 && trees.length < SCATTER_MAX; x++) {
          const t = z * DISTRICT + x;
          if (wet(t)) continue;
          if (roadClass[t] >= 0) continue;
          const wood = isWood(crop[t]);
          /*
           * How many trees stand on this tile.
           *
           * Woodland is the only case that puts down more than one, and it has to:
           * a wood is a *canopy*, and a canopy at one tree per tile is an orchard.
           * Three with a fourth on most tiles closes it over at this scale, which
           * is what makes a wood a dark mass with a hard edge rather than a patch
           * of dark ground with trees standing about on it.
           */
          const r = hash(x, z);
          let many: number;
          if (wood) {
            many = 3 + (hash(x + 41, z + 43) < 0.6 ? 1 : 0);
          } else {
            // The rough grazing is scrub; the boundaries are hedgerow; the middle
            // of a worked field is nearly bare.
            const chance = crop[t] === 6 ? 0.22 : boundary(t, x, z) ? 0.09 : 0.007;
            many = r > chance ? 0 : 1;
          }
          for (let k = 0; k < many && trees.length < SCATTER_MAX; k++) {
            /*
             * Which tree, and a wood is not a random mixture.
             *
             * A plantation is one species — that is the definition of a plantation
             * and the reason it looks the way it does — so a conifer wood is pines
             * with nothing else in it at all. A broadleaf wood is mixed, but mixed
             * within a block, which is what the existing "one dominant species per
             * eight tiles" already gives: a stand of oak running into a stand of
             * ash reads as a real wood, where a per-tree lottery reads as noise.
             */
            const local = hash(x >> 3, (z >> 3) + 4096);
            const stray = hash(x + 7919 + k * 131, z + 104729 + k * 977);
            let kind: number;
            if (crop[t] === Crop.Conifer) {
              kind = PINE;
            } else if (wood) {
              kind = stray < 0.30
                ? Math.floor(hash(x + 31 + k * 17, z + 17 + k * 29) * BROADLEAF_MODELS)
                : Math.floor(local * BROADLEAF_MODELS);
            } else {
              kind = stray < 0.22
                ? Math.floor(hash(x + 31, z + 17) * TREE_MODELS.length)
                : Math.floor(local * TREE_MODELS.length);
            }
            trees.push({
              // Off the tile centre, or a hedgerow reads as a row of fenceposts.
              // Several to a tile need the whole tile, or a wood reads as clumps.
              x: x + 0.12 + hash(x + 1 + k * 53, z + k * 61) * 0.76,
              z: z + 0.12 + hash(x + k * 71, z + 1 + k * 83) * 0.76,
              model: Math.min(TREE_MODELS.length - 1, Math.max(0, kind)),
              rot: hash(x + 3 + k * 7, z + 5 + k * 11),
              // A stand of identical trees is a wallpaper. Half again either way.
              // Woodland runs taller and tighter: trees in a wood are drawn up by
              // their neighbours, and the variation between them is smaller.
              scale: wood
                ? 0.92 + hash(x + 11 + k * 13, z + 13 + k * 17) * 0.42
                : 0.78 + hash(x + 11, z + 13) * 0.55,
            });
          }
        }
      }

      /*
       * Spring, on the banks.
       *
       * On field boundaries and verges, which is exactly where they grow: a
       * daffodil is a hedge-bank flower and a blackthorn *is* the hedge. Placed
       * in their own pass rather than folded into the tree loop, because the
       * rule is different in kind — a tree wants to be anywhere along a
       * boundary, and these want to be on the *road* side of one, where the
       * mower and the plough have never been.
       *
       * Thin. Twelve daffodil clumps and a handful of blackthorn in a district
       * is enough that the eye finds them; thirty would be municipal planting.
       */
      for (let z = 1; z < DISTRICT - 1 && trees.length < SCATTER_MAX; z++) {
        for (let x = 1; x < DISTRICT - 1 && trees.length < SCATTER_MAX; x++) {
          const t = z * DISTRICT + x;
          if (wet(t) || roadClass[t] >= 0) continue;
          if (!boundary(t, x, z)) continue;
          // Beside a lane, which is where a verge is.
          let byRoad = false;
          for (const d of [1, -1, DISTRICT, -DISTRICT]) {
            if (roadClass[t + d] >= 0) byRoad = true;
          }
          if (!byRoad) continue;
          const r = hash(x + 811, z + 977);
          if (r > 0.16) continue;
          const blossoms = r < 0.045;
          trees.push({
            x: x + 0.24 + hash(x + 5, z + 9) * 0.52,
            z: z + 0.24 + hash(x + 9, z + 5) * 0.52,
            model: TREE_MODELS.length + (blossoms ? PROP_BLOSSOM : PROP_DAFFODILS),
            rot: hash(x + 19, z + 23),
            /*
             * Much bigger than a daffodil, and that is the honest answer.
             *
             * The model is authored at flower scale, and at flower scale it is
             * four pixels across from this camera — which is correct and useless:
             * a real daffodil is invisible from four hundred feet. A clump has to
             * be about a third of a tile before the eye finds the yellow, and
             * finding the yellow is the entire purpose of it. The same trade the
             * sheep make, which are boxes the size of a small car.
             */
            scale: (blossoms ? 3.4 : 4.6) + hash(x + 29, z + 31) * 1.1,
            /*
             * Out with the leaves, and *before* them.
             *
             * Daffodils and blackthorn both flower on bare wood — that is the
             * whole point of them, and the reason March is worth looking at. So
             * the window is the arrival of spring rather than the presence of
             * leaf: strongest while the canopy is still coming, gone by the time
             * it is full.
             */
            season: (f) => f.spring > 0.18,
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
      for (let z = 1; z < DISTRICT - 1 && trees.length < SCATTER_MAX; z++) {
        for (let x = 1; x < DISTRICT - 1 && trees.length < SCATTER_MAX; x++) {
          const t = z * DISTRICT + x;
          if (parcel[t] < 0) continue;
          if (roadClass[t] >= 0 || wet(t)) continue;
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

    /*
     * Which fields can be worked, and where a tractor gets into each.
     *
     * One pass over the map for the bounds, then for each parcel the *road tile
     * nearest it* and a point just inside the field beside that road. That pair
     * is the gateway — the tractor drives the lanes to the road tile and then
     * straight across the boundary — and it is all the "gates and paths towards
     * all the fields" that is actually needed, with no geometry at all.
     *
     * Only arable, and only fields big enough to be worth a pass or two: a
     * tractor working a strip two tiles wide reads as a tractor stuck in a hedge.
     */
    const workable: FarmField[] = [];
    {
      const parcel = world.terrain.fields.parcel;
      const bounds = new Map<number, { x0: number; z0: number; x1: number; z1: number }>();
      for (let z = 0; z < DISTRICT; z++) {
        for (let x = 0; x < DISTRICT; x++) {
          const p2 = parcel[z * DISTRICT + x];
          if (p2 < 0) continue;
          const b = bounds.get(p2);
          if (!b) bounds.set(p2, { x0: x, z0: z, x1: x, z1: z });
          else {
            if (x < b.x0) b.x0 = x;
            if (x > b.x1) b.x1 = x;
            if (z < b.z0) b.z0 = z;
            if (z > b.z1) b.z1 = z;
          }
        }
      }
      const crops = world.terrain.fields.crop;
      for (const [p2, b] of bounds) {
        if (b.x1 - b.x0 < 3 || b.z1 - b.z0 < 3) continue;
        // Not a wood. Woodland is a parcel like any other so that it gets an id
        // and a colour, which means it turns up here looking exactly like a large
        // field — and a combine driving up and down inside a forest is the sort of
        // thing that is funny once.
        if (isWood(crops[b.z0 * DISTRICT + b.x0])
          || isWood(crops[Math.round((b.z0 + b.z1) / 2) * DISTRICT
            + Math.round((b.x0 + b.x1) / 2)])) continue;
        // The nearest road tile to the field's edge, searched outward from the
        // bounding box. Bounded, because a field with no road within six tiles is
        // one no tractor is getting to.
        let road = -1;
        let entryX = 0;
        let entryZ = 0;
        let bestD = Infinity;
        for (let z = Math.max(0, b.z0 - 6); z <= Math.min(DISTRICT - 1, b.z1 + 6); z++) {
          for (let x = Math.max(0, b.x0 - 6); x <= Math.min(DISTRICT - 1, b.x1 + 6); x++) {
            const t = z * DISTRICT + x;
            if (roadClass[t] < 0) continue;
            const cx = Math.max(b.x0, Math.min(b.x1, x));
            const cz = Math.max(b.z0, Math.min(b.z1, z));
            const d = (cx - x) ** 2 + (cz - z) ** 2;
            if (d < bestD) {
              bestD = d;
              road = t;
              // A point a tile inside the field from the road, which is the
              // gateway. Clamped into the bounds so it is never outside the
              // field it is supposed to be the way into.
              entryX = Math.max(b.x0 + 0.5, Math.min(b.x1 + 0.5, cx + 0.5));
              entryZ = Math.max(b.z0 + 0.5, Math.min(b.z1 + 0.5, cz + 0.5));
            }
          }
        }
        if (road < 0 || bestD > 25) continue;
        workable.push({ parcel: p2, ...b, road, entryX, entryZ });
      }
    }

    /*
     * Start fetching the audio now, not on the first click.
     *
     * Playing needs a gesture; downloading and decoding never did. See
     * `prepare` — this is most of the twenty seconds the first sound used to
     * take, because the clock did not start until the player touched something.
     */
    sound.prepare();

    const renderer = new Renderer(canvas);
    const farmwork = new Farmwork({
      size: DISTRICT,
      usable: (t) => world.influence.usable(t),
      route: (from, to) => world.roadRoute(from, to),
      work: (tile) => world.workField(tile),
      needsWork: (tile) => world.fieldNeedsWork(tile),
      rank: (t) => (t >= 0 && t < roadClass.length ? roadClass[t] : -1),
      job: (tile) => world.fieldJob(tile),
      farms: () => {
        const out: { tile: number; x: number; z: number }[] = [];
        for (let i = 0; i < world.sites.count; i++) {
          const ind = world.content.industries[world.sites.def[i]];
          // Any farm. Which farm and what it grows is deliberately not checked:
          // the point is a worked district, and a rule nobody can see only costs.
          if (ind.deposit !== 9) continue;
          const tile = world.siteAccessTile[i];
          if (tile < 0 || !world.influence.usable(tile)) continue;
          out.push({ tile, x: world.sites.x[i], z: world.sites.y[i] });
        }
        return out;
      },
      fields: () => workable.filter(
        (f) => world.influence.usable(f.road)
          && Math.abs((f.x0 + f.x1) / 2 - renderer.camX) < 70,
      ),
    });

    // `?rain=1` for a downpour, `?rain=0.4` for a shower. See `forceRain`.
    if (params.has('rain')) {
      const r = Number(params.get('rain'));
      if (Number.isFinite(r)) renderer.forceRain = Math.max(0, Math.min(1, r));
    }
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
    /*
     * `?at=x,z` to open somewhere else, in tiles.
     *
     * Alongside `?time`, `?day` and `?rain`: the four things you need to be able
     * to force in order to photograph a given moment. Without it, checking that a
     * tractor works a field in the way it should means waiting for one to pick a
     * field the opening shot happens to contain.
     */
    /*
     * `?vfx=off`, `?vfx=low`, `?vfx=high` — the picture settings, forceable.
     *
     * Alongside the other overrides, and it earns its place for the same reason
     * they do: the only honest way to judge a grade is to flip it on and off on
     * the *same frame*, and a URL does that where a menu cannot.
     */
    const askedVfx = params.get('vfx');
    if (askedVfx === 'off' || askedVfx === 'low' || askedVfx === 'high') {
      setOptions((o) => ({ ...o, vfx: askedVfx }));
    }

    const at = params.get('at');
    if (at) {
      const [ax, az] = at.split(',').map(Number);
      if (Number.isFinite(ax) && Number.isFinite(az)) {
        renderer.camX = clamp(ax);
        renderer.camZ = clamp(az);
      }
    }

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
       * And put the fields at the right stage of the year *now*.
       *
       * `stepSeason` runs on a day boundary, and the first one is a whole game
       * day away — four real minutes — so without this the opening frame shows
       * whatever the generator happened to paint rather than what the month
       * calls for. Starting in July and looking at ploughed earth is the kind of
       * wrong that is invisible in the code and obvious on screen.
       */
      world.stepSeason();

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
      /*
       * The bank, and a way to open it for a look.
       *
       * `?happyHour=1500000` starts you with a million and a half instead of
       * eleven and a half thousand. A query parameter rather than a change to
       * `balance.json` on purpose: the starting figure is the first number of a
       * ladder measured in real minutes — a second van at about ten — and half
       * the tests in the sim are anchored to it, so making it adjustable for an
       * afternoon's look at the ownership loop must not quietly retune the
       * opening for everybody. In pounds, because that is what the game shows.
       *
       * Named the way it is because a URL is not private. `?cash=` on a link
       * anybody can read is an invitation and a spoiler at the same time; this
       * one at least has to be known about before it can be used.
       */
      const askedCash = Number(params.get('happyHour'));
      world.companies.cash[world.player] = Number.isFinite(askedCash) && askedCash > 0
        ? Math.round(askedCash * 100)
        : world.content.balance.startingCash;

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
    renderer.tilesAcross = TILES_ACROSS_OPENING;
    /*
     * `?across=` to force the zoom, in tiles across the frame.
     *
     * After the opening framing, not before it. The first version of this was
     * before and was silently overwritten, which made a measurement of the zoom
     * behaviour read as if the feature did not work when what did not work was
     * the way of asking for it.
     */
    const askedAcross = Number(params.get('across'));
    if (params.has('across') && Number.isFinite(askedAcross)) {
      renderer.tilesAcross = Math.max(14, Math.min(70, askedAcross));
    }

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
      // The farm machinery, last and in a known order — see MACHINES.
      'veh_tractor', 'veh_tractor_drill', 'veh_tractor_sprayer', 'veh_combine',
    ];
    /**
     * Which model index draws which machine.
     *
     * Derived from the end of the list rather than searched by name, because the
     * list *is* the loading order and anything that disagreed with it would draw
     * a combine where a car should be. Counting back from the end is ugly and it
     * is the only version that cannot drift.
     */
    const MACHINES = {
      plough: modelNames.length - 4,
      drill: modelNames.length - 3,
      sprayer: modelNames.length - 2,
      combine: modelNames.length - 1,
    };
    const CAR_SALOON = modelNames.length - 6;
    const CAR_ESTATE = modelNames.length - 5;

    /*
     * And the livestock, appended *after* the constants above are worked out.
     *
     * Those count back from the end of the list, so anything added to the end
     * before they are computed moves a combine to where a car should be. Adding
     * here rather than in the literal is the whole of why this is three lines
     * further down than it looks like it should be.
     *
     * They are the same two models the scatter has always used for sheep and
     * cattle — a prop and a vehicle are the same thing to a draw call, and the
     * only reason these are in the fleet list is that the fleet list is what gets
     * per-frame positions.
     */
    const SHEEP_MODEL = modelNames.length;
    const CATTLE_MODEL = modelNames.length + 1;
    modelNames.push('prop_sheep', 'prop_cattle');

    /** Every model that is a farm machine, for the engine note. */
    const FARM_MODELS = new Set<number>([
      MACHINES.plough, MACHINES.drill, MACHINES.sprayer, MACHINES.combine,
    ]);
    /**
     * How big each model sounds, 0 for the smallest and 1 for an artic.
     *
     * From the vehicle's own length in cells, which is the closest thing the
     * content has to a size — a Transit is one and an artic is four. Built once,
     * because it is a property of the model list and not of the frame.
     *
     * Cars and farm machinery are not in the content's vehicle list at all, so
     * they are given figures by hand: a car is the lightest thing on the road, a
     * tractor sits between a van and a lorry, and a combine is the biggest engine
     * in the district and should sound like it.
     */
    const BULK = new Float32Array(modelNames.length);
    {
      let widest = 1;
      for (const v of world.content.vehicles) widest = Math.max(widest, v.cells);
      for (let i = 0; i < world.content.vehicles.length; i++) {
        BULK[i] = (world.content.vehicles[i].cells - 1) / Math.max(1, widest - 1);
      }
      BULK[CAR_SALOON] = 0;
      BULK[CAR_ESTATE] = 0.05;
      BULK[MACHINES.plough] = 0.45;
      BULK[MACHINES.drill] = 0.45;
      BULK[MACHINES.sprayer] = 0.4;
      BULK[MACHINES.combine] = 0.9;
    }
    /*
     * Livestock, which needs to know where the grass is and nothing else.
     *
     * `grazeable` is the whole interface: grass, no road, not water. The road
     * test is the one that matters — a cow standing in the lane is funny once and
     * then it is a bug — and it reads the same live `roadClass` the rest of the
     * client does, so laying a track through a field moves the animals off it.
     *
     * Built here rather than beside the other ambient systems because it needs
     * the two model indices above, which cannot exist until the fleet list is
     * settled.
     */
    const grazing = new Grazing({
      size: DISTRICT,
      grazeable: (t) => {
        if (t < 0 || t >= DISTRICT * DISTRICT) return false;
        if (roadClass[t] >= 0) return false;
        const h = world.terrain.height[t];
        if (h <= 0) return false;
        if ((world.terrain.flags[t] & TileFlag.River) !== 0) return false;
        const c = world.terrain.fields.crop[t];
        return c === CROP_PASTURE || c === CROP_PASTURE_RICH || c === CROP_MEADOW;
      },
      usable: (t) => world.influence.usable(t),
      sheepModel: SHEEP_MODEL,
      cattleModel: CATTLE_MODEL,
    });

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
      CAR_SALOON, CAR_SALOON, CAR_SALOON,
      CAR_ESTATE, CAR_ESTATE,
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
      rank: (t) => (t >= 0 && t < roadClass.length ? roadClass[t] : -1),
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
      if (ordered.length === scatterNames.length) {
        renderer.setScatterModels(ordered, SCATTER_BATCH);
      }
    });
    /*
     * The birds, loaded as their own pair.
     *
     * Not in the scatter kit, though they are props by every other measure: the
     * scatter layer is for things that never move, and its whole update rule is
     * "rebuild when influence grows and never again". A flock moves every frame
     * and needs its own two meshes; putting it in the scatter would either make
     * that layer rebuild sixty times a second or leave the birds nailed to a
     * field.
     */
    void loadKit(['prop_bird_up', 'prop_bird_down']).then((kit) => {
      const u = kit.models.get('prop_bird_up');
      const d = kit.models.get('prop_bird_down');
      if (u && d) renderer.setBirdModels(u, d);
      else console.warn(`[birds] no model for: ${kit.missing.join(', ')}`);
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
      if (toolRef.current !== 'none') {
        /*
         * The road tool: the click is a tile, and nothing else on the map is
         * selectable while it is up. Deliberately — a tool that sometimes opened
         * a farm instead of laying a road would be a tool nobody trusted.
         */
        const r = toolRef.current === 'lay'
          ? world.layTrackAt(world.player, tile)
          : world.liftTrackAt(world.player, tile);
        if (r.ok) {
          /*
           * Anything standing on it goes with it. "It removes anything in its
           * way" — trees, bales, sheep, whatever the scatter put there. They are
           * client-side scenery, so the sim neither knows nor needs to.
           */
          if (toolRef.current === 'lay') clearScatterAt(tile);
          setNote('');
          bumpRef.current();
        } else {
          setNote(r.reason);
        }
        return;
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
        return;
      }
      /*
       * Clicked on nothing: put away whatever was open.
       *
       * A panel that can only be closed by finding its little cross is a panel
       * you have to *aim* at to be rid of, and the ground is the biggest target
       * on the screen. Clicking away from a thing is how every map in the world
       * dismisses the thing.
       */
      setPanel({ k: 'none' });
      setNote('');
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
    /*
     * Audio starts on the first touch of anything, and clicks come from one
     * listener rather than from every button.
     *
     * A browser will not begin audio without a gesture, and a context created
     * before one sits in `suspended` and silently never plays. Hanging the start
     * off the first pointer or key event anywhere means it happens whatever the
     * player does first.
     *
     * The click is delegated on the document for the same reason a dozen
     * components should not each remember to make a noise: `closest('button')`
     * catches the dock, the panels, the markers and anything added later, and
     * a control that should be silent can opt out with `data-quiet`.
     */
    const wake = (e: Event): void => {
      void sound.start();
      const el = (e.target as HTMLElement | null)?.closest?.('button');
      if (el && !el.hasAttribute('data-quiet') && !el.hasAttribute('disabled')) {
        sound.press(el.classList.contains('primary') ? 'confirm' : 'click', 0.5);
      }
    };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);

    // Escape opens the menu, and closes it. One key, both ways: a menu that
    // needs a different gesture to leave than to enter is a menu people get
    // stuck in.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      /*
       * Unless there is a tool in hand, in which case Escape puts *that* down.
       *
       * Escape means "out of what I am in", and what you are in is the road
       * tool, not the game. Pausing instead would be the one key that skipped a
       * level on the way out, and would leave you still holding the tool behind
       * the menu.
       */
      if (toolRef.current !== 'none') {
        setTool('none');
        setNote('');
        return;
      }
      setPaused((was) => !was);
    };
    window.addEventListener('keydown', onKey);

    /*
     * And a right-click puts it down too.
     *
     * The gesture everybody tries first, because every editor since about 1993
     * has meant "stop doing that" by it, and the only one that needs no aiming
     * at all — the ✕ is thirty pixels and this is the whole screen. The browser's
     * own menu is suppressed only while a tool is in hand; the rest of the time
     * a right-click on the page behaves as the page normally would.
     */
    const onContext = (e: MouseEvent): void => {
      if (toolRef.current === 'none') return;
      e.preventDefault();
      setTool('none');
      setNote('');
    };
    window.addEventListener('contextmenu', onContext);

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('wheel', wheel, { passive: false });

    // Reused every frame: allocating thirty objects sixty times a second to hand
    // the same information to the mixer is pure garbage.
    const heard: Heard[] = [];
    /** The camera's keyboard velocity, in tiles a second. */
    const panVel = { x: 0, y: 0 };
    let season = -1;

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const frames: number[] = [];
    let hudTick = 0;

    let blamed = false;
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop);
      try {
        body(now);
      } catch (err) {
        /*
         * One report, then carry on.
         *
         * An exception thrown inside a `requestAnimationFrame` callback does not
         * stop the loop — the next frame was scheduled on the first line — so
         * the symptom is not a crash. It is a canvas frozen on its last good
         * frame with an interface still at its initial values, which looks
         * exactly like a rendering bug and is not one. Saying so once is the
         * difference between ten minutes and an hour.
         */
        if (!blamed) {
          blamed = true;
          console.error('[frame] threw, and the loop is now a still image', err);
        }
      }
    };

    const body = (now: number): void => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;

      /*
       * Keyboard panning, with a bit of weight to it.
       *
       * The old version applied the full speed on the frame a key went down and
       * none on the frame it came up, so the camera started and stopped like a
       * light switch — which at two thirds of a screen a second is a lurch in
       * both directions. It was already frame-rate independent; what it was not
       * was *smooth*, and those are different complaints.
       *
       * A velocity that chases the keys instead. Roughly a fifth of a second to
       * reach full speed and the same to stop, which is short enough to feel
       * direct and long enough that the first and last moments of a pan are not
       * a jolt. Diagonals are normalised, or holding two keys goes forty per cent
       * faster than holding one.
       */
      let wantX = 0;
      let wantY = 0;
      if (held.has('a') || held.has('arrowleft')) wantX -= 1;
      if (held.has('d') || held.has('arrowright')) wantX += 1;
      if (held.has('w') || held.has('arrowup')) wantY += 1;
      if (held.has('s') || held.has('arrowdown')) wantY -= 1;
      const wantLen = Math.hypot(wantX, wantY);
      if (wantLen > 0) {
        const top = renderer.tilesAcross * 0.66;
        wantX = (wantX / wantLen) * top;
        wantY = (wantY / wantLen) * top;
      }
      const ease = Math.min(1, dt * 9);
      panVel.x += (wantX - panVel.x) * ease;
      panVel.y += (wantY - panVel.y) * ease;
      // Below a hundredth of a tile a second it has stopped; letting it creep
      // on forever would fight the mouse for the rest of the session.
      if (Math.abs(panVel.x) < 0.01) panVel.x = 0;
      if (Math.abs(panVel.y) < 0.01) panVel.y = 0;
      if (panVel.x !== 0 || panVel.y !== 0) {
        renderer.nudge(panVel.x * dt, panVel.y * dt);
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
      /*
       * Paused: the world stops, the frame does not.
       *
       * Skipping the render as well would be the obvious reading of "pause" and
       * the wrong one — the district behind the menu would freeze on its last
       * frame and the camera would stop answering the mouse, so the game would
       * look like it had crashed rather than like it was waiting. And the
       * accumulator is *cleared* rather than left to fill: on resume, a build-up
       * of ticks would be spent in one frame and the lorries would jump.
       */
      if (pausedRef.current) {
        acc = 0;
      } else {
        /*
         * Speed multiplies the tick rate here, and the renderer's world clock
         * over there — see `timeScale` in `scene.ts`.
         *
         * Both, and it has to be both. This started as a multiplier on the tick
         * rate alone, on the reasoning that scaling the whole frame would make
         * the camera pan four times as fast, which is not what anybody means by
         * fast-forward. True about the camera and wrong about everything else:
         * the simulation ran four times as fast while every drawn thing kept
         * easing toward it at real-time rates, so the lorries trailed behind
         * their own positions and the smoke, the mist and the birds carried on as
         * though nothing had changed. What needed separating was *world* time
         * from *interface* time, not simulation from rendering.
         *
         * The 40-tick ceiling below stays where it is deliberately. It is there
         * so a stall cannot be paid back in one enormous frame, and a fast-forward
         * that outruns the machine should *fall behind* rather than freeze while
         * it catches up.
         */
        acc += dt * TICKS_PER_SECOND * speedRef.current;
        // The same clock the hidden-tab timer uses. The frame loop is the one
        // advancing it while the tab is visible, so it says so.
        simAt = now;
        let ran = 0;
        while (acc >= 1 && ran < 40 * speedRef.current) {
          world.step();
          acc -= 1;
          ran++;
        }
        if (ran > 0) world.project();
      }

      /*
       * The clock, before anything that reads it.
       *
       * This used to be set after the vehicles and the buildings were packed,
       * which was harmless while nothing depended on it — and stopped being
       * harmless the moment the buildings needed to know the hour to decide
       * whether their lights were on. A frame's worth of lag on a lighting
       * decision is invisible; the habit of computing a value after its readers
       * is not.
       */
      // The world owns the clock now — it decides who is allowed to drive, and
      // two of them drifting apart would be a yard shut at noon for no reason.
      src.dayFraction = world.dayFraction;

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
        // Standing at a stop rather than travelling. `link === -1` is how the
        // traffic model says "not on a road right now", which is exactly the
        // condition the renderer must not ease through.
        src.vStopped[n] = world.vehicles.link[i] === -1 ? 1 : 0;
        n++;
      }
      // And the traffic, appended after the fleet. Scenery that moves, and the
      // difference between a road and a grey stripe. How much of it there is
      // depends on where you are looking: a lane by a hamlet is not the road
      // into the market town.
      /*
       * And far less of it at night.
       *
       * "It feels weird that cars are all through the night" — and it is: a lane
       * in 1985 at two in the morning has nothing on it. Down to a twelfth at the
       * darkest, which leaves the occasional set of headlamps crossing the
       * district rather than a stream, and makes those headlamps worth watching.
       */
      /*
       * The world clock, for the things in the world.
       *
       * The traffic and the tractors are simulated here rather than in the sim —
       * they are scenery, and scenery that costs the economy nothing — so they
       * were stepped on the raw frame time and did not notice fast-forward at
       * all. At 4x the lorries and the smoke sped up and the cars kept crawling
       * along at their own pace, which reads as the district being full of
       * traffic that has nothing to do with the district. Same multiplier the
       * renderer's own world clock uses; see `timeScale` in `scene.ts`.
       */
      const wdt = dt * (pausedRef.current ? 0 : speedRef.current);
      const awake = 1 - renderer.night * 0.92;
      ambient.demand = areaDemand(townList, renderer.camX, renderer.camZ, 22) * awake;
      const fleetEnd = n;
      n = ambient.step(
        wdt, renderer.camX, renderer.camZ, renderer.tilesAcross * 0.8, n,
        src.vx, src.vz, src.vHeading, src.vLivery, src.vModel, src.vId,
      );
      // Tractors, after the traffic. They share the vehicle arrays so they get
      // instanced drawing, headlamps at dusk, motion smoothing and engine sound
      // without any of those systems knowing tractors exist.
      /*
       * What time the farms think it is. Zero on the dial is six in the morning,
       * which is where `HOUR` puts it and why the lit arc is one unbroken piece.
       */
      farmwork.hour = (src.dayFraction * 24 + 6) % 24;
      n = farmwork.step(
        wdt, MACHINES, n,
        src.vx, src.vz, src.vHeading, src.vLivery, src.vModel, src.vId,
      );
      // Traffic and tractors manage their own standing about, so the renderer
      // should ease them normally.
      for (let k = fleetEnd; k < n; k++) src.vStopped[k] = 0;
      /*
       * Everything written so far burns diesel. The livestock below does not.
       *
       * Marked in one place at the boundary rather than by each system as it
       * writes its own rows: "everything before the animals" is a single fact,
       * and stating it once is harder to get wrong than four systems each
       * remembering to. See `vMotor` in scene.ts for what goes wrong without it —
       * sheep with headlamps and an exhaust plume.
       */
      const engines = n;
      for (let k = 0; k < engines; k++) src.vMotor[k] = 1;

      // And the livestock, which is the slowest thing in the district by a long
      // way and the only one that is not going anywhere.
      n = grazing.step(
        wdt, renderer.camX, renderer.camZ, n,
        src.vx, src.vz, src.vHeading, src.vLivery, src.vModel, src.vId,
      );
      for (let k = engines; k < n; k++) {
        src.vMotor[k] = 0;
        src.vStopped[k] = 0;
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
        // What its windows are burning, if anything. Zero is off, and off
        // multiplies the emissive window *and* the pool of light it throws to
        // nothing in one go.
        const lit = litness(q.evening, src.dayFraction);
        src.pLamp[pn * 3] = q.evening.colour[0] * lit;
        src.pLamp[pn * 3 + 1] = q.evening.colour[1] * lit;
        src.pLamp[pn * 3 + 2] = q.evening.colour[2] * lit;
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
        const at = offRoad(tile, world.sites.x[i], world.sites.y[i]);
        src.px[pn] = at.x;
        src.pz[pn] = at.z;
        src.pModel[pn] = world.sites.def[i];
        src.pRot[pn] = at.rot;
        claimYard(tile);
        // A depot runs at night. That is what a depot is for.
        src.pLamp[pn * 3] = 1;
        src.pLamp[pn * 3 + 1] = 0.80;
        src.pLamp[pn * 3 + 2] = 0.50;
        pn++;
      }
      for (let y = 0; y < world.yards.count && pn < src.px.length; y++) {
        if (world.yards.owner[y] !== world.player) continue;
        // A yard's access is its own tile, like a business's — see `foundYard`.
        const tile = world.yards.y[y] * DISTRICT + world.yards.x[y];
        const at = offRoad(tile, world.yards.x[y], world.yards.y[y]);
        src.px[pn] = at.x;
        src.pz[pn] = at.z;
        src.pModel[pn] = YARD_MODEL;
        src.pRot[pn] = at.rot;
        claimYard(tile);
        // A yard of yours is lit all night: somebody is always on shift, and it
        // is also the one building on the map you need to be able to find in the
        // dark.
        src.pLamp[pn * 3] = 1;
        src.pLamp[pn * 3 + 1] = 0.78;
        src.pLamp[pn * 3 + 2] = 0.46;
        pn++;
      }
      if (pn !== src.placeCount) renderer.placeRevision++;
      src.placeCount = pn;

      // Trees, the same influence test. A wood beyond your reach is part of the
      // country you cannot touch, and leaving it out is what makes the boundary
      // read as a boundary rather than as a colour wash.
      /*
       * The year, for the trees. From the sim, like the snow, so the leaves and
       * the calendar cannot disagree.
       */
      const leafy = foliage(world.day);
      src.leaf = leafy.leaf;
      /*
       * The same number again, for the ground mesh rather than the material.
       *
       * The hedges are *built* differently by season — thinner and gappy out of
       * leaf — so `buildHedges` needs the figure at build time, where a uniform
       * is no use to it. Bumping the season revision when it crosses the
       * threshold is what gets the chunks rebuilt; see below.
       */
      src.leafiness = leafy.leaf;
      src.spring = leafy.spring;
      src.autumn = leafy.autumn;
      /*
       * Which tree model each broadleaf is drawn as, this week.
       *
       * The set has had `tree_autumn` and `tree_bare` in it from the beginning
       * and nothing ever asked for them: the species was chosen once at startup
       * and drawn in July green in January. Swapping here rather than at layout
       * costs nothing — the list is walked every frame anyway to filter it by
       * influence — and it means the district turns and comes back without any
       * bookkeeping at all.
       *
       * The shader tints and shrinks the canopy either side of these swaps (see
       * `litMaterial`), so what the swap has to do is only the *shape*: a bare
       * oak is not a green oak in brown, it is a different silhouette. The
       * crossfade is the shrink; this is the frame it hands over on.
       *
       * Conifers are exempt, obviously, and are the reason a winter district
       * still has something green in it.
       */
      const dressed = (model: number): number => {
        if (model >= BROADLEAF_MODELS) return model;
        if (leafy.leaf < 0.22) return TREE_BARE;
        if (leafy.autumn > 0.45) return TREE_AUTUMN;
        return model;
      };
      let sn = 0;
      for (const q of trees) {
        if (sn >= src.sx.length) break;
        const tile = Math.round(q.z) * DISTRICT + Math.round(q.x);
        if (!world.influence.usable(tile)) continue;
        /*
         * Out of season, out of the district.
         *
         * Daffodils are the reason this exists: a spring flower has to be *gone*
         * for the other nine months, and there is no colour that means gone. The
         * window is a property of the scattered thing, so the rule lives with
         * whatever put it there rather than in a list of special cases here.
         */
        if (q.season !== undefined && !q.season(leafy)) continue;
        src.sx[sn] = q.x;
        src.sz[sn] = q.z;
        src.sModel[sn] = dressed(q.model);
        /*
         * Whether this one drops leaves, which is a fact about the *species* and
         * not about the mesh it is currently drawn as — see `sSheds`. A conifer
         * never does; a bare oak in December still is one, and is why the answer
         * cannot be read off the swapped model.
         */
        src.sSheds[sn] = q.model < BROADLEAF_MODELS ? 1 : 0;
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

      // One number, read by the renderer to paint the season and by the traffic
      // to decide who can move. There is deliberately not a second one.
      src.snow = world.snow;
      src.dayNumber = world.day;

      /*
       * The fields have changed: rebuild the ground they are in.
       *
       * Watched rather than pushed, because the simulation must not know a
       * renderer exists — the same rule the earnings queue follows. A counter
       * the client compares is the whole interface.
       *
       * What is rebuilt depends on how much moved. A tractor turning over a tile
       * behind it is a handful of tiles a second and must cost one chunk; a
       * change of season is every field in the county and is cheaper to rebuild
       * whole than to enumerate. The threshold is where those two costs cross,
       * and the list of tiles is what tells them apart.
       */
      /*
       * Whose land is whose, when it changes.
       *
       * A whole rebuild rather than a tile list: buying a business changes two or
       * three parcels at once and a parcel is dozens of tiles spread over
       * several chunks, so enumerating them costs more than redrawing. It happens
       * a handful of times in a game.
       */
      /*
       * The blue marks, which are the tool's whole interface.
       *
       * Recomputed only when something that could change the answer changes —
       * the tool, the camera tile, or the roads — because it asks `trackHere` of
       * every tile in view and the answer is stable while you sit still. Bounded
       * by the frame rather than by the district: nobody can build off screen.
       */
      // Through the ref, not the captured state: this closure was made once and
      // `tool` in it is whatever it was at mount. The classic trap next to a
      // long-lived listener, and the reason `toolRef` exists at all.
      const nowTool = toolRef.current;
      const marksNow = `${nowTool}:${world.landRevision}:${Math.round(renderer.camX)}`
        + `:${Math.round(renderer.camZ)}:${Math.round(renderer.tilesAcross)}`;
      if (marksNow !== marksAt) {
        marksAt = marksNow;
        const list: number[] = [];
        if (nowTool !== 'none') {
          const owned = world.ownedParcels(world.player);
          const half = Math.ceil(renderer.tilesAcross * 0.62);
          const cx0 = Math.round(renderer.camX);
          const cz0 = Math.round(renderer.camZ);
          for (let z = cz0 - half; z <= cz0 + half; z++) {
            for (let x = cx0 - half; x <= cx0 + half; x++) {
              if (x < 0 || z < 0 || x >= DISTRICT || z >= DISTRICT) continue;
              const t = z * DISTRICT + x;
              const okHere = nowTool === 'lay'
                ? world.trackHere(world.player, t, owned).ok
                : world.liftHere(world.player, t, owned).ok;
              if (okHere) list.push(t);
            }
          }
        }
        renderer.showMarks(
          list,
          // Blue to lay, red to lift. Two tools, two answers, no label needed.
          nowTool === 'lift' ? [0.86, 0.34, 0.32] : [0.34, 0.62, 0.92],
          src,
        );
      }

      /*
       * Rebuild the ground when the hedges would be built differently.
       *
       * The hedge geometry is a function of the leaf, and the ground mesh is
       * cached per chunk — so without this the hedges are whatever they were when
       * the chunk was first built and the season never reaches them. Quantised to
       * six steps across the year rather than watched continuously, because a
       * rebuild is the expensive operation here and six of them a year is
       * nothing; the material's tint carries the movement in between.
       *
       * Deliberately not folded into the crop revision. That fires monthly on a
       * different clock, and tying one to the other would mean a hedge waiting
       * for a field to be ploughed before it lost its leaves.
       */
      const hedgeStep = Math.round(leafy.leaf * 6);
      if (hedgeStep !== hedgeAt) {
        hedgeAt = hedgeStep;
        renderer.dropChunks();
      }

      if (world.landRevision !== landAt) {
        landAt = world.landRevision;
        ownedParcels = world.ownedParcels(world.player);
        /*
         * And re-read the roads.
         *
         * `roadClass` is the client's own copy, built once at startup and handed
         * to the renderer — which is fine for a district whose roads never
         * change and was quietly wrong the moment one could. Nothing laid during
         * play was ever drawn: not a track from the road tool, and not the lane
         * the parish agrees to widen at the top of the ladder, which changed the
         * simulation while the picture stayed exactly as it was.
         */
        for (let i = 0; i < roadClass.length; i++) {
          roadClass[i] = layer.cls[i] !== NO_WAY ? roadClassOf(layer.cls[i], wayNames) : -1;
        }
        renderer.dropChunks();
      }
      if (world.seasonRevision !== season) {
        season = world.seasonRevision;
        const dirty = world.dirtyFields;
        if (dirty.size === 0 || dirty.size > 900) {
          renderer.dropChunks();
        } else {
          // Chunk keys, not tiles: a field is many tiles inside one chunk, and
          // dropping the same chunk forty times would rebuild it forty times.
          const chunks = new Set<number>();
          for (const t of dirty) {
            const x = t % DISTRICT;
            const z = (t / DISTRICT) | 0;
            const key = ((z / CHUNK) | 0) * DISTRICT + ((x / CHUNK) | 0);
            if (chunks.has(key)) continue;
            chunks.add(key);
            renderer.dropChunkAt(x, z);
          }
        }
        dirty.clear();
      }

      // The same number the tick rate uses, so the picture and the simulation
      // run at one speed rather than two.
      renderer.timeScale = pausedRef.current ? 0 : speedRef.current;
      renderer.render(src, dt);

      /*
       * The sound, after the render, because it wants the camera the frame was
       * actually drawn with.
       *
       * The listener sits at the point the camera is *looking at* rather than
       * where it is: the camera is four hundred feet up and forty degrees back,
       * and putting the ears there would attenuate everything to nothing. What
       * the player is looking at is what they should be able to hear.
       */
      sound.listenAt(
        renderer.camX, renderer.camY, renderer.camZ, renderer.audioBasis(),
      );
      heard.length = 0;
      for (let i = 0; i < src.vehicleCount; i++) {
        const model = src.vModel[i];
        heard.push({
          id: src.vId[i],
          x: src.vx[i],
          z: src.vz[i],
          /*
           * Which engine it has, by where its model sits in the list.
           *
           * The order is the content's lorries, then the two cars, then the
           * tractor — so the two cars are third- and second-from-last and the
           * tractor is last. Reading it off the index is ugly and it is also the
           * only place in the client that needs to know, which is why it has not
           * earned a table of its own.
           */
          bulk: BULK[model] ?? 0.5,
          engine: FARM_MODELS.has(model)
            ? 'tractor'
            : (model === CAR_SALOON || model === CAR_ESTATE)
              ? 'petrol'
              : 'diesel',
        });
      }
      /*
       * How wide the frame is, against the framing the game opens at.
       *
       * One number, and it is what makes zooming in sound like walking closer.
       * Normalised against the *opening* zoom rather than the reference one so
       * that `zoom` is 1 where the player spends most of their time — otherwise
       * every distance in the mix is inflated by forty per cent before anything
       * else happens.
       */
      const zoom = renderer.tilesAcross / TILES_ACROSS_OPENING;
      sound.engines(heard, renderer.camX, renderer.camZ, zoom);
      sound.maybeHorn(heard, renderer.camX, renderer.camZ, now, zoom);
      // Wind always, a little more of it when it is blowing up; rain only when
      // it is actually raining.
      sound.ambientLevel('wind', 0.10 + renderer.cloud * 0.16);
      sound.ambientLevel('rain', renderer.rain * 0.55);
      /*
       * Music by season, crossfaded.
       *
       * `snow` is the obvious signal and the wrong one: it is zero for eight
       * months, so the winter track would appear only in the fortnight either
       * side of Christmas. What is wanted is the *half of the year*, which is a
       * cosine of the date — coldest in January, warmest in July — so the two
       * pieces trade places gradually across spring and autumn.
       */
      const yearAt = (world.day % 288) / 288;
      const winterness = 0.5 + 0.5 * Math.cos(yearAt * Math.PI * 2);
      sound.music(winterness, 0.42);

      /*
       * The HUD, four times a second, by clock rather than by frame count.
       *
       * Every twentieth frame sounds equivalent and is not: a backgrounded tab
       * has its animation frames throttled to about one a second, so "every
       * twentieth frame" became every twenty seconds and the HUD sat at its
       * initial zeroes — which reads exactly like a game that has no money in
       * it. Anything the player reads should be paced by time, never by frames.
       */
      /*
       * And the HTML pinned to the world, right after the camera moved.
       *
       * Last thing in the frame and not a moment earlier: everything above may
       * have moved the camera — a drag, a fly-to, the easing that follows one —
       * and a marker projected before that has moved is a marker one frame
       * behind, which is exactly the jumping this replaced.
       */
      syncAnchors(canvas.parentElement as HTMLElement, (wx, wy, wz) => renderer.project(wx, wy, wz));

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
    /*
     * ---- and it keeps running when you look away -------------------------
     *
     * "I think the game pauses (or i dont earn money) when i switch tab." Quite
     * right, and completely: the world was stepped only inside the frame loop,
     * and a browser stops calling `requestAnimationFrame` the moment a tab goes
     * to the background. Every lorry stopped mid-lane, no load was delivered and
     * no money was earned for as long as you were reading something else. Come
     * back and it carried on from exactly where it was, so nothing looked wrong
     * — the clock simply had not moved.
     *
     * That is the wrong behaviour for a game about a business running. So while
     * the tab is hidden the world is driven off a timer instead, stepped by the
     * wall clock rather than by frames. Two mechanisms, one clock: `simAt` is the
     * moment the world was last advanced to, and both the timer and the frame
     * loop advance it to now — so whichever runs, time passes exactly once.
     *
     * Catching up is affordable to the point of being free. A tick measured at
     * 3.5 microseconds, so a minute away is four milliseconds of arithmetic and
     * an hour is a quarter of a second — which is why this can simply be honest
     * about the elapsed time instead of quietly rounding it down. Background
     * timers are throttled hard (a second, and after a while a minute), and that
     * does not matter here: there is nothing to draw, so a minute's worth of
     * ticks in one callback is the same thing as sixty callbacks of one second.
     */
    let simAt = performance.now();
    /** Advance the world to now, in whole ticks. Returns nothing to draw. */
    const advance = (): void => {
      const now = performance.now();
      // Four hours, which is about a second of arithmetic. A tab left open for a
      // week should not spend a minute of the machine catching up on a fortnight
      // of milk nobody was there to sell.
      const secs = Math.min(4 * 3600, (now - simAt) / 1000);
      simAt = now;
      if (pausedRef.current) return;
      let ticks = Math.floor(secs * TICKS_PER_SECOND * speedRef.current);
      while (ticks-- > 0) world.step();
    };
    const hidden = window.setInterval(() => {
      if (document.visibilityState === 'hidden') advance();
    }, 500);
    /*
     * And on the way back, before the first frame.
     *
     * The interval is not a guarantee — a browser is entitled to stop firing it
     * altogether for a tab that has been hidden a long time, or on battery — so
     * the wall clock is read once more the moment the tab is visible again. If
     * the timer did its job this catches up nothing, because `simAt` is already
     * up to date. If the timer was suspended, this is what covers the gap.
     */
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        advance();
        // The frame loop measures `dt` from its own last timestamp, which is now
        // however long ago the tab was hidden. Without this the first frame back
        // would hand every eased thing in the renderer a quarter-second step.
        last = performance.now();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    raf = requestAnimationFrame(loop);
    setLive({ world, renderer, src });
    setReady(true);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(hidden);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('resize', fit);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('contextmenu', onContext);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
      renderer.dispose();
    };
  }, []);

  return (
    <div
      className={`app${panelLeaving ? ' panel-leaving' : ''}`
        + `${pauseLeaving ? ' pause-leaving' : ''}`}
    >
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
      {live && showPanel && shownPanel.k === 'driver' && (
        <Driver
          world={live.world}
          renderer={live.renderer}
          vehicle={shownPanel.vehicle}
          onDrop={(v) => {
            if (live.world.dropVehicle(v)) { bump(); setPanel({ k: 'none' }); }
          }}
          onClose={() => setPanel({ k: 'none' })}
        />
      )}
      {live && showPanel && shownPanel.k === 'place' && (
        <Place
          world={live.world}
          renderer={live.renderer}
          site={shownPanel.site}
          actions={placeActions}
        />
      )}
      {live && showPanel && shownPanel.k === 'vehicles' && (
        <Fleet
          world={live.world}
          onOpenVehicle={(vehicle) => setPanel({ k: 'upgrades', vehicle })}
          onClose={() => setPanel({ k: 'none' })}
        />
      )}
      {live && showPanel && shownPanel.k === 'upgrades' && (
        <Upgrades
          world={live.world}
          vehicle={shownPanel.vehicle}
          onFit={fit}
          onGoToYard={(yard) => {
            lookAt(live.world.yards.x[yard] + 0.5, live.world.yards.y[yard] + 0.5);
            setPanel({ k: 'yard', yard });
          }}
          onClose={() => setPanel({ k: 'vehicles' })}
        />
      )}
      {live && showPanel && shownPanel.k === 'owned' && (
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
      {live && showPanel && shownPanel.k === 'contracts' && (
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
      {live && showPanel && shownPanel.k === 'planning' && (
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
      {(tool !== 'none' || toolLeaving) && (
        /*
         * The tools, in a tray that rises out of the dock.
         *
         * It was two text buttons, a sentence and a "Done" in a wide cream
         * strip — a dialog wearing a toolbar's clothes, and it looked nothing
         * like the dock two inches below it that does exactly the same job.
         * Same glass, same corner radius, same icon-over-label buttons, so
         * pressing Roads reads as the dock *growing a row* rather than as
         * another piece of furniture arriving.
         *
         * And no "Done", because there was never anything to be done with. A
         * mode you are in until you say otherwise ends the way modes end: an
         * ✕, Escape, or a right-click on the district — the last being the one
         * people reach for first, and the only one that needs no aiming.
         */
        <div className={`tools${tool === 'none' || toolLeaving ? ' tools-leaving' : ''}`}>
          <button
            className={`tool-btn ${tool === 'lay' ? 'on' : ''}`}
            onClick={() => { setTool('lay'); setNote(''); }}
            title="Lay a mud track on your own land, joining an existing road"
          >
            <Icon id="track" size={20} />
            <span>Track</span>
          </button>
          <button
            className={`tool-btn ${tool === 'lift' ? 'on' : ''}`}
            onClick={() => { setTool('lift'); setNote(''); }}
            title="Take up a track you laid"
          >
            <Icon id="pick" size={20} />
            <span>Remove</span>
          </button>
          <span className="tool-rule" />
          <button
            className="tool-x"
            onClick={() => { setTool('none'); setNote(''); }}
            aria-label="Put the tool down"
            title="Put the tool down (Esc, or right-click)"
          >&times;</button>
        </div>
      )}
      {building && (
        <div className="build-hint">
          Click a spot beside a road to put a depot there
          {note !== '' && <b>{note}</b>}
        </div>
      )}
      {!building && note !== '' && <div className="build-hint"><b>{note}</b></div>}
      {live && showPanel && shownPanel.k === 'yard' && (
        <Yard
          world={live.world}
          renderer={live.renderer}
          yard={shownPanel.yard}
          onAdd={addFacility}
          onFit={fit}
          onBuy={buy}
          onClose={() => setPanel({ k: 'none' })}
        />
      )}
      {(paused || pauseLeaving) && (
        <Settings
          options={options}
          onChange={setOptions}
          onResume={() => setPaused(false)}
        />
      )}
      <div className="hud">
        {live && (
          <Status
            cash={hud.cash}
            date={hud.date}

            dayFraction={hud.dayFraction}
            night={hud.night}
            speed={speed}

            onSpeed={setSpeed}
            onMenu={() => { void sound.start(); setPaused(true); }}
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
             * Roads, which is a *tool* rather than a screen.
             *
             * The one dock item that does not open a panel over the district,
             * because what you need on screen while deciding where a road goes is
             * the district. Pressing it puts marks on every tile you may work on
             * and turns the map into the interface; pressing it again puts the map
             * back. That is also why it can afford a permanent slot where "build a
             * depot" could not: a depot is three clicks in a whole game, and a
             * road tool is something you come back to every time you buy a field.
             */
            {
              key: 'roads',
              label: 'Roads',
              icon: 'terminal',
              on: tool !== 'none',
              onClick: () => {
                setPanel({ k: 'none' });
                setBuilding(false);
                setNote('');
                setTool(tool === 'none' ? 'lay' : 'none');
              },
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
