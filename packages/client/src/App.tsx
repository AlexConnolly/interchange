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
  saveState, restoreState, DAYS_PER_MONTH,
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
import { Dock } from './Dock.tsx';
import { Icon } from './Icons.tsx';
import { Owned } from './Owned.tsx';
import { Contracts } from './Contracts.tsx';
import { Market } from './Market.tsx';
import { Land } from './Land.tsx';
import { powerLines, SPAN, WIRE_H } from './powerlines.ts';
import { isStream, isWet } from './water.ts';
import { Menu, SaveList, type MenuPage } from './Menu.tsx';
import {
  listSaves, writeSave, deleteSave, newId, AUTO_ID, type SaveSlot,
} from './saves.ts';
import {
  introAt, INTRO_LENGTH, INTRO_ACROSS, MENU_AT, type Intro,
} from './intro.ts';
import { Advisor, type Letter } from './advisor.ts';
import { Inbox, InboxButton, Toast } from './Inbox.tsx';
import { PLOT, groundHeightAt, type RGB } from '@interchange/render';

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
  // The grid, which passes through the district on its way somewhere else. Two
  // models because a span of wire is a fixed mesh exactly one pole-gap long -
  // see `powerlines.ts` for why the layout must never vary its step.
  'prop_pole', 'prop_span',
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

/** The grid. Both placed by the power-line layout rather than scattered. */
const PROP_POLE = PROP_MODELS.indexOf('prop_pole');
const PROP_SPAN = PROP_MODELS.indexOf('prop_span');

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
  | { k: 'contracts' }
  | { k: 'inbox' }
  | { k: 'market' };

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
  const [tool, setTool] = useState<'none' | 'lay' | 'lift' | 'land' | 'place'>('none');
  /*
   * Which page of the build tray is showing.
   *
   * Two levels, because the tray now holds two unrelated kinds of building and a
   * single flat row of everything would be eleven buttons wide and mean nothing.
   * `cats` is the choice between them; `roads` and `works` are the things
   * themselves. Closed is closed.
   *
   * Kept apart from `tool` on purpose: the tray is *where you are in the
   * interface* and the tool is *what is in your hand*, and they change at
   * different moments. Going back to the categories should not silently drop the
   * lorry you were about to place, and closing the tray should.
   */
  const [buildAt, setBuildAt] = useState<'closed' | 'cats' | 'roads' | 'works'>('closed');
  /** Which business is in hand, as an index into the industry content. */
  const [placeDef, setPlaceDef] = useState(-1);
  /*
   * What the page is doing: sitting in the menu, or running a world.
   *
   * The game used to begin the moment the page loaded, which cannot survive saves
   * existing — there has to be a moment before the world is made where you can
   * choose not to make a new one. So this is the thing the setup effect depends on,
   * and `null` means "no world yet".
   *
   * A `load` carries the slot rather than a flag, because the world has to be
   * *restored into* as it is created; there is no point in the sequence where a
   * generated world is handed over and patched afterwards without the opening
   * sequence having already run over the top of the save.
   */
  const [boot, setBoot] = useState<
    { kind: 'new' } | { kind: 'load'; slot: SaveSlot } | null
  >({ kind: 'new' });
  /*
   * Whether the player has actually started playing.
   *
   * Separate from `boot`, and the separation is the whole redesign. The world is
   * built the moment the page loads — *behind the menu* — and held at altitude with
   * the last of the cloud over it. So the menu is not a screen in front of the
   * game, it is the district seen from the air before you land, and "New game"
   * releases the descent rather than starting a load.
   *
   * Which also means New game is instant. The loading happened while you were
   * reading the menu, which is the one screen nobody minds waiting on.
   */
  const [started, setStarted] = useState(false);
  const startedRef = useRef(false);
  const [menuPage, setMenuPage] = useState<MenuPage>('main');
  /** Which save list the pause menu is showing, if any. */
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState('');

  /**
   * Write the world into a slot.
   *
   * The facts for the name are gathered here rather than in `saves.ts`, because
   * this is the only place that has a World — and the naming is a *presentation*
   * decision that belongs with the storage. Two halves, each where it can see what
   * it needs.
   */
  const putSave = useCallback((id: string, auto: boolean): boolean => {
    if (!live) return false;
    const w = live.world;
    let fleet = 0;
    for (let v = 0; v < w.vehicles.count; v++) {
      if (w.vehicles.alive[v] && w.vehicles.company[v] === w.player) fleet++;
    }
    let places = 0;
    for (let i = 0; i < w.sites.count; i++) {
      if (w.sites.owner[i] === w.player) places++;
    }
    /*
     * The season, off the world's own `month` rather than recomputed.
     *
     * The first version did its own arithmetic on the day count and said "Summer"
     * over a clock reading March — because it rounded into the quarter rather than
     * flooring, and because it assumed the year began at the season rather than in
     * January. Two mistakes to make where the World already has a `month` getter
     * doing it correctly for the date display.
     *
     * Months 2, 3 and 4 are spring: March, April, May. That is the one thing the
     * mapping has to get right, and it is the one thing a reader can check.
     */
    const season = Math.floor((((w.month - 2) % 12) + 12) % 12 / 3);
    /*
     * The company, or the yard it works out of.
     *
     * Worldgen names the player's company "Your company", which is the right thing
     * on a heads-up display and a useless thing at the top of a save list — every
     * save would be called the same. The yard has a real name, so a save is named
     * after the place rather than after a placeholder.
     */
    let firm = w.companies.names[w.player] ?? '';
    if (firm === '' || firm === 'Your company') {
      let yardName = '';
      for (let y = 0; y < w.yards.count; y++) {
        if (w.yards.owner[y] === w.player) { yardName = w.yards.names[y] ?? ''; break; }
      }
      firm = yardName.replace(/ Yard$/, ' Haulage') || 'Haulage';
    }
    const out = writeSave(id, saveState(w), {
      company: firm,
      year: w.year,
      season,
      cash: w.companies.cash[w.player],
      fleet,
      places,
    }, advisor.current.saved(), auto);
    if (!out.ok) setSaveNote(out.reason);
    return out.ok;
  }, [live]);
  /*
   * The opening, which is a picture rather than a mode.
   *
   * Only the three things React has to know about are state: whether to say we
   * are loading, whether the interface may show, and whether it is over. The
   * camera and the cloud are written straight to the renderer from the frame loop
   * — sixty re-renders a second of the whole tree to animate a descent is the
   * mistake this client has already made twice.
   */
  const [intro, setIntro] = useState<{ label: boolean; ui: boolean; done: boolean }>(
    { label: true, ui: false, done: false },
  );
  /** The same, for the handlers, which must not close over a stale copy. */
  const introDone = useRef(false);
  /** The cloud layer, whose opacity the frame loop drives directly. */
  const skyRef = useRef<HTMLDivElement | null>(null);
  /** The frame loop needs to autosave and cannot see the callback directly. */
  const autoSave = useRef<() => void>(() => {});

  /*
   * The advisor, and it lives in a ref because it is not a value — it is a thing
   * that accumulates. Its `letters` array is mutated in place, so React is told
   * about changes by a counter rather than by identity: a new array every time a
   * tip fired would be a copy of the whole inbox for no reason.
   */
  const advisor = useRef(new Advisor());
  /** Bumped whenever the inbox changes, purely to make React look again. */
  const [post, setPost] = useState(0);
  /** The letter currently sliding out of the button, if any. */
  const [toast, setToast] = useState<Letter | null>(null);
  const toastTimer = useRef(0);
  /*
   * And the last values pushed into state, so the frame loop can tell whether
   * anything actually changed. Without it the loop would call `setIntro` sixty
   * times a second with an equal object and re-render the tree every frame — which
   * is the exact cost this design exists to avoid.
   */
  const introRef = useRef<Intro | { label: boolean; ui: boolean; done: boolean }>(
    { label: true, ui: false, done: false },
  );
  // So the tray can animate out rather than vanish, the same way panels do.
  /* Whether the *road tray* is up, which is not the same as whether a tool is in
     hand: the land tool has its own panel and no tray. */
  /* Whether the build tray is up. It is its own thing now rather than a
     consequence of holding a tool: you can have the tray open and nothing in
     hand, which is what the category page *is*. */
  const [, trayLeaving] = useLeaving(buildAt, buildAt !== 'closed', 150);
  const toolRef = useRef<'none' | 'lay' | 'lift' | 'land' | 'place'>('none');
  /** The business in hand, for the frame loop and the click handler. */
  const placeDefRef = useRef(-1);
  /** Which page the tray is on, for the keyboard and right-click handlers. */
  const buildRef = useRef<'closed' | 'cats' | 'roads' | 'works'>('closed');
  /** The tile under the pointer while a road tool is in hand, or -1. */
  const hoverRef = useRef(-1);
  toolRef.current = tool;
  placeDefRef.current = placeDef;
  introDone.current = intro.done;
  startedRef.current = started;
  autoSave.current = () => { putSave(AUTO_ID, true); };
  buildRef.current = buildAt;
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
    // Nothing to build while the menu is up. The effect re-runs when it is not.
    if (!boot) return;
    /**
     * Where the menu's slow drift circles.
     *
     * Declared up here rather than beside the drift because the *camera framing*
     * happens a thousand lines earlier than the frame loop does, and this has to be
     * in scope for both.
     */
    const menuHome = { x: 0, z: 0 };

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
    /*
     * A load takes its seed from the file, because the terrain is a pure function
     * of it — the save carries no heightmap and rebuilding the wrong district would
     * put every road and every field somewhere else.
     */
    const world = createWorld(boot.kind === 'load'
      ? boot.slot.state.config
      : { seed: 1985, size: DISTRICT, townCount: 3, companyCount: 1 });
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
      // See `water.ts`: the same function the tractors ask, so what is drawn as
      // water and what is driven on cannot disagree again.
      isStream: (t) => isStream(world.terrain.flags[t], world.terrain.height[t]),
      isYard: (t) => yardTiles.has(t),
      /*
       * Land of yours, both kinds. A parcel that came with a business, and a block
       * you bought outright — see `land.ts` for why those are separate ideas. The
       * renderer does not care which; it wants to know whose field it is drawing.
       */
      ownedLand: (t) => ownedParcels.has(world.terrain.fields.parcel[t])
        || world.ownsLandAt(t),
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
      sPitch: new Float32Array(SCATTER_MAX),
      sStretch: new Float32Array(SCATTER_MAX).fill(1),
      sLift: new Float32Array(SCATTER_MAX),
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
     * How many businesses the district came with.
     *
     * `placed` is built once, here, and anything founded during play is therefore
     * not in it. The frame loop draws the rest by index, and this is the line
     * between the two - one number rather than a per-site test, because "was it
     * here when the world was made" is exactly what the index means.
     */
    const bornWith = world.sites.count;

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
     * Tell the simulation where the village is.
     *
     * The buildings are laid out here — once, at startup, because a place is a
     * place — so the simulation has no way to know where anybody's house stands,
     * and it has to: without this you could buy the ground under somebody's
     * cottage. Registered rather than computed, which only works *because* the
     * layout is fixed; if houses ever moved this would be a cache with no
     * invalidation.
     *
     * Village buildings only. A business or a yard is a thing the simulation
     * already knows the position and the owner of, so it can decide about those
     * itself — and it decides differently, because buying the ground under your
     * *own* works is exactly the case that should be allowed.
     */
    world.registerBuildings(
      placed.filter((q) => q.model >= VILLAGE_FIRST).map((q) => q.tile),
    );

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
      /** Tilt along its own length, for a wire that has to reach the next pole. */
      pitch?: number;
      /** And how much longer it has to be to get there. */
      stretch?: number;
      /** And how far off the ground it starts, for one that starts on a pole. */
      lift?: number;
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

    /*
     * The grid, laid out before anything else that stands in a field.
     *
     * First because it has right of way. A power line is surveyed across country
     * and everything else was put in afterwards - so the poles choose their
     * ground and the trees, bales and troughs below simply avoid whatever is
     * already claimed. Doing it the other way round would give a line that jinks
     * round a hay bale, which is not how the electricity board works.
     */
    const poles = powerLines({
      size: DISTRICT,
      height: (t) => world.terrain.height[t] ?? -1,
      builtUp: (x, z) => {
        // Round settlements rather than through them. A distribution line does
        // cross a village in life, but it crosses it along the street, and the
        // street is where every other piece of furniture in this game already is.
        for (let t = 0; t < world.towns.count; t++) {
          const dx = world.towns.x[t] - x;
          const dz = world.towns.y[t] - z;
          if (dx * dx + dz * dz < 100) return true;
        }
        /*
         * And round the buildings, which the first version did not do: a line
         * ran straight through a farmhouse roof. Towns were the only thing it
         * avoided, and a farm is not in a town — that is rather the point of a
         * farm.
         *
         * A four-tile berth, because a business is up to four tiles across and
         * the wires have to clear the yard rather than the tile the marker sits
         * on.
         */
        for (let i = 0; i < world.sites.count; i++) {
          const dx = world.sites.x[i] - x;
          const dz = world.sites.y[i] - z;
          if (dx * dx + dz * dz < 20) return true;
        }
        for (let y = 0; y < world.yards.count; y++) {
          const dx = world.yards.x[y] - x;
          const dz = world.yards.y[y] - z;
          if (dx * dx + dz * dz < 16) return true;
        }
        return false;
      },
    }, world.config.seed);
    /** Tiles the grid has taken, so nothing else is scattered onto a pole. */
    const poleTiles = new Set<number>();
    for (const q of poles) {
      poleTiles.add(Math.floor(q.z) * DISTRICT + Math.floor(q.x));
    }

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
          /*
           * And not on a pole. The grid was surveyed first — see the layout above
           * — so it has right of way, and a tree growing through a crossarm is the
           * one way this could look worse than having no lines at all.
           */
          if (poleTiles.has(t)) continue;
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
     * And the grid into the scatter, one pole and one span each.
     *
     * Appended after the trees so a pole is never hidden inside a copse, and
     * pushed as ordinary scattered things because that is exactly what they are:
     * fixed geometry, one transform each, drawn by the same instanced batch as a
     * hay bale. Nothing in the renderer has to learn that power lines exist.
     *
     * The span rotates to the run and the pole does not. A pole is symmetrical
     * about its own crossarm only if the arm is square to the wires - which it is,
     * by construction in `pole()` - so the pole *does* need the rotation too, or
     * every crossarm in the district would face north.
     */
    for (const q of poles) {
      /*
       * `TREE_MODELS.length +` is not optional, and leaving it off is a silent
       * bug rather than a loud one. Trees and props share one scatter layer and
       * one index space: props start where the trees end. Written without the
       * offset, `PROP_POLE` (9) addressed a *tree* slot, which lands on
       * `prop_stook` — so the district got a line of corn stooks marching across
       * it from edge to edge and no power lines at all. Nothing threw, and a stook
       * in a field looks like a stook in a field.
       */
      /*
       * The renderer's yaw runs the other way round from a world bearing.
       *
       * A Y-rotation of theta sends +X to `(cos theta, 0, -sin theta)` — the Z is
       * negated — so pointing a model along a world direction `(dx, dz)` wants
       * `theta = atan2(-dz, dx)`, which is minus the bearing. The same
       * quarter-turn family of mistakes that once drew every lorry in the game
       * broadside to its own direction of travel.
       *
       * `run` stays a plain world bearing, because that is what is testable and
       * what the layout means; the conversion lives here, beside the renderer
       * that needs it.
       */
      const yaw = q.run < 0 ? 0 : (1 - q.run) % 1;
      trees.push({
        x: q.x,
        z: q.z,
        model: TREE_MODELS.length + PROP_POLE,
        rot: yaw,
        scale: 1,
      });
      if (q.run >= 0 && q.toX !== undefined && q.toZ !== undefined) {
        /*
         * The wire, aimed exactly.
         *
         * "We need an EXACT calculation distance and angle." Right — and the
         * exactness comes from the *model* being built for it rather than from
         * arithmetic here being cleverer. `span()` puts its wires at the model
         * origin running along +X, so this reduces to: put the origin on this
         * pole's insulator, aim +X at the next pole's insulator, and stretch to
         * the distance between them. Three numbers, no fudge, and the far end
         * cannot miss because nothing is being corrected for.
         *
         * `groundHeightAt` rather than the raw heightmap value, and this is the
         * subtle half. The scatter layer places every instance at
         * `groundHeightAt(x, z)` — a bilinear sample of the four corners — so
         * that is the height the poles are actually standing at. Reading
         * `terrain.height[tile]` here instead would compute the rise between two
         * heights that neither pole is at, and the wires would miss by the
         * interpolation difference: small, everywhere, and exactly the sort of
         * near-miss that reads as "often overlapping".
         */
        const ay = groundHeightAt(src, q.x, q.z) + WIRE_H;
        const by = groundHeightAt(src, q.toX, q.toZ) + WIRE_H;
        const dx = q.toX - q.x;
        const dz = q.toZ - q.z;
        const flat = Math.hypot(dx, dz);
        const rise = by - ay;
        const reach = Math.hypot(flat, rise);
        trees.push({
          x: q.x,
          z: q.z,
          model: TREE_MODELS.length + PROP_SPAN,
          rot: yaw,
          scale: 1,
          /*
           * `asin(rise / reach)`, which is the angle whose sine is the rise over
           * the hypotenuse — and it is `asin` rather than `atan2` because of how
           * the two rotations compose: `Ry(yaw) * Rz(pitch)` sends +X to
           * `(cos p cos y, sin p, -cos p sin y)`, so the Y component *is*
           * `sin p`. Solving for the pitch from the vertical component is the
           * whole derivation.
           */
          pitch: reach > 1e-6 ? Math.asin(rise / reach) : 0,
          stretch: reach / SPAN,
          lift: WIRE_H,
        });
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
      /*
       * Dry land, and it took two goes: the first read `height > 0`, which is sea
       * level, and a beck round here is a channel cut into ground well above it.
       * See `water.ts` for the measurement and for why both this and `isStream`
       * now come out of the same function.
       */
      dry: (t) => t >= 0 && t < DISTRICT * DISTRICT
        && !isWet(world.terrain.flags[t], world.terrain.height[t]),
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
    menuHome.x = renderer.camX;
    menuHome.z = renderer.camZ;
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
    /*
     * The opening sequence — a yard, a van, and the first job — happens only for a
     * new game.
     *
     * A load has all of that in it already, and running this over the top would
     * found a *second* yard and buy a *second* van on top of whatever the player
     * had. Which is the shape of the bug: the save would restore perfectly and the
     * game would then hand you a present you did not ask for and could not
     * explain.
     */
    if (boot.kind === 'load') {
      /*
       * Restored here, before anything reads the world.
       *
       * After `createWorld` because the terrain has to exist — the save has no
       * heightmap in it, only the seed — and before the camera, the scatter and the
       * frame loop, all of which take their answers from the world as they find it.
       * A restore after any of those is a restore into a client that has already
       * decided where the trees are.
       */
      restoreState(world, boot.slot.state);
      /*
       * And the post, which is client state and so is not in `state.ts`.
       *
       * Only the *ids* — which letters have arrived, and which have been read. The
       * bodies live in `POST` and putting them in every save file would be a copy
       * of the game's own text going stale the moment a word of it changed. So a
       * loaded inbox is rebuilt from the ids against the current text, which also
       * means a rewritten letter reads correctly in an old save.
       *
       * Without this, every load would deliver Tom Ashbury's handover letter
       * again — the sort of small wrongness that makes a save feel fake.
       */
      advisor.current.restore(boot.slot.post.had, boot.slot.post.read, world.tick);
    } else {
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
    /*
     * Where the descent is aiming. The intro starts far outside this and comes
     * down to it; without an intro this is simply where the game opens.
     */
    let openingAcross = TILES_ACROSS_OPENING;
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
      openingAcross = renderer.tilesAcross;
    }
    /*
     * `?intro=0` to skip it, which is not a convenience — it is what makes the
     * game photographable. Every screenshot tool in `packages/tools` opens the
     * page, waits, and shoots; with a ten-second cinematic in front of it, half of
     * them would be photographing cloud. The skip is off by default and on for
     * anything automated.
     */
    const wantsIntro = params.get('intro') !== '0';
    /*
     * `?introAt=3.5` holds the opening at one instant, which is the only way to
     * photograph it.
     *
     * The same family as `?time` and `?day`: a hook that exists because the thing
     * it freezes cannot otherwise be checked. A headless browser on software GL
     * runs this scene at about three frames a second, and a screenshot takes
     * several seconds to capture — so every attempt to shoot a ten-second sequence
     * by waiting and firing arrived somewhere else entirely, which is how a solid
     * band across the middle of the picture went out the door.
     */
    const heldAt = Number(params.get('introAt'));
    const holding = params.has('introAt') && Number.isFinite(heldAt);
    let introClock = wantsIntro ? 0 : INTRO_LENGTH;
    /** The frame timestamp the opening began on. -1 until the first frame. */
    let introStart = -1;
    /*
     * The last game-month an autosave was written for. Starts at -1 and the first
     * crossing only *records* the month rather than saving, so loading a game does
     * not immediately overwrite the autosave with a copy of itself.
     */
    let lastAuto = -1;
    if (wantsIntro) renderer.tilesAcross = INTRO_ACROSS;
    else setIntro({ label: false, ui: true, done: true });

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
      if (!introDone.current) return;
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

      /*
       * What a track would look like if you laid it here.
       *
       * The blue marks say *where* you may build and say nothing about what
       * building there would do — "it's not obvious what it does". A ghost of the
       * actual track, joined to the road it would join, answers that before the
       * click rather than after it: you can see the stub reach out from the lane
       * and decide whether that is the approach you wanted.
       *
       * Kept in a ref rather than in state because it changes with the pointer,
       * and sixty re-renders a second of the whole overlay is the thing this
       * client has been bitten by twice.
       */
      hoverRef.current = toolRef.current === 'lay' || toolRef.current === 'lift'
        || toolRef.current === 'place'
        ? renderer.pick(e.clientX, e.clientY, src)
        : -1;

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
      if (toolRef.current === 'place') {
        /*
         * Building one. The preview and this call ask the *same* question of the
         * simulation, which is what stops a green square from refusing when
         * pressed.
         */
        const def = placeDefRef.current;
        const r = def >= 0
          ? world.placeSite(def, tile)
          : { ok: false, reason: 'Nothing chosen.', site: -1 };
        if (r.ok) {
          // The footprint is now a building site, so whatever the scatter had
          // standing there goes - same rule as laying a track through a hedge.
          for (const t of world.footprintTiles(def, tile)) clearScatterAt(t);
          setNote('');
          bumpRef.current();
          setPanel({ k: 'place', site: r.site });
        } else {
          setNote(r.reason);
        }
        return;
      }
      if (toolRef.current === 'land') {
        // The land panel owns the map while it is up: it lays its own catcher
        // over the district and the price chips are the only targets.
        return;
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
      /*
       * There was a depot-placing mode here, and it is gone with the row that
       * turned it on.
       *
       * It hard-coded one building — a distribution centre — dropped beside a road
       * from a list in the Business panel. The Build tray does all of it properly
       * now: any business, on land you own, at its own footprint, with a green or
       * red preview before you commit. Two ways to build, one of them worse, is one
       * too many.
       */
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
      // Not while the opening is running: the descent owns the camera, and a wheel
      // event fighting it would be two things animating one number.
      if (!introDone.current) return;
      const was = renderer.tilesAcross;
      const next = was * (e.deltaY > 0 ? 1.12 : 1 / 1.12);
      // Bounded so a lorry never becomes unreadable, which is the number the
      // whole scale question resolves to.
      renderer.tilesAcross = Math.max(14, Math.min(70, next));
      /*
       * And it zooms toward the pointer, not toward the middle of the screen.
       *
       * Zooming about the centre means every approach to something is zoom, drag,
       * zoom, drag - "when someone zooms it should be somewhat towards the mouse's
       * current position too, no?" - and every map anybody has used for twenty
       * years works the other way.
       *
       * The maths is one line and exact for this camera. The view is orthographic
       * at a fixed elevation, so screen offsets from the centre scale linearly
       * with `tilesAcross`: if the scale changes by k, the point under the cursor
       * stays under the cursor when the camera centre moves to
       * `W + k * (C - W)`. No iteration, no easing, no drift.
       *
       * Clamped afterwards, which does mean the anchor slips at the edges of the
       * district - and it should. The alternative is letting the camera leave the
       * map to honour the pointer, and a view of the void is worse than a zoom
       * that pulls slightly off target in the last few tiles.
       */
      const k = renderer.tilesAcross / was;
      if (k !== 1) {
        const at = renderer.pickPoint(e.clientX, e.clientY);
        if (at) {
          const inset = renderer.tilesAcross * 0.3;
          const hold = (v: number): number => Math.max(
            inset, Math.min(DISTRICT - inset, v),
          );
          renderer.camX = hold(at.x + (renderer.camX - at.x) * k);
          renderer.camZ = hold(at.z + (renderer.camZ - at.z) * k);
        }
      }
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
      if (!introDone.current) return;
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
      if (!introDone.current) return;
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
      /*
       * Escape steps *out one level* rather than straight to the menu, because
       * that is what "out of what I am in" means when there are levels: put the
       * thing in your hand down, then go back to the categories, then shut the
       * tray, then pause. A key that skipped from holding a creamery to the pause
       * menu would leave you still holding it behind the veil.
       */
      if (toolRef.current !== 'none') {
        setTool('none');
        setNote('');
        return;
      }
      if (buildRef.current !== 'closed') {
        setBuildAt(buildRef.current === 'cats' ? 'closed' : 'cats');
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
      if (toolRef.current === 'none' && buildRef.current === 'closed') return;
      e.preventDefault();
      setTool('none');
      setBuildAt('closed');
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
       * The opening, if it is still running.
       *
       * The camera and the veil are written straight to the renderer here rather
       * than held in React state, because they change every frame and a descent
       * animated through re-renders would re-render the whole tree sixty times a
       * second. Only the three facts the interface needs — the label, whether the
       * furniture may show, and whether input is allowed — go into state, and each
       * of them changes exactly once.
       *
       * Off the **wall clock**, not off accumulated `dt`, and that distinction is
       * the difference between a ten-second opening and a thirteen-second one.
       * `dt` is clamped at a quarter of a second — rightly, for everything else —
       * so a machine running at four frames a second accumulates one second of
       * simulated time per real second and anything slower loses time it never
       * gets back. Measured in the headless browser at about three frames a
       * second, "Loading game" was still up at seven and a half real seconds
       * against a four-second budget.
       *
       * Which is the honest reading anyway: the intro is a fixed ten seconds of a
       * player's life, and it should be exactly that on a slow machine as on a
       * fast one. A slow machine simply sees fewer frames of the descent, which is
       * the correct thing for it to lose.
       */
      /*
       * The toast, taken away on the wall clock.
       *
       * Not a `setTimeout`, because the game can be paused and a notice that
       * expired behind a pause menu is a notice nobody saw. Checked here, where
       * time only passes when the frame loop is running.
       */
      /*
       * The autosave: once a game-month, into its own slot.
       *
       * On the *game* clock rather than a real timer, so it fires at the same
       * points in a game however fast it is being run — and so a player who sits
       * paused for an hour does not accumulate a dozen identical saves.
       *
       * Its own slot, which manual saves never touch. A browser tab is easy to
       * close by accident and this game is played in long sittings; the whole point
       * is to make that survivable, and it would not be if it could quietly replace
       * something the player had chosen to keep.
       */
      if (introDone.current) {
        const month = Math.floor(world.tick / (TICKS_PER_DAY * DAYS_PER_MONTH));
        if (month > lastAuto) {
          if (lastAuto >= 0) autoSave.current();
          lastAuto = month;
        }
      }
      if (toastTimer.current > 0 && now > toastTimer.current) {
        toastTimer.current = 0;
        setToast(null);
      }
      if (introClock < INTRO_LENGTH || holding || !startedRef.current) {
        /*
         * Held at `MENU_AT` for as long as the menu is up, and released from there
         * the instant it is not — `introStart` is set so that the elapsed time
         * *begins* at the hold point rather than at zero, which is what makes the
         * descent continue from where the menu was looking rather than jumping back
         * into cloud.
         */
        if (!startedRef.current) {
          introStart = now - MENU_AT * 1000;
          introClock = MENU_AT;
        } else {
          if (introStart < 0) introStart = now;
          introClock = holding ? heldAt : (now - introStart) / 1000;
        }
        /*
         * The diorama: the island turns while you read the menu.
         *
         * This is the whole of the redesign in three lines. The district is
         * surrounded by sea, so from a hundred and fifty tiles up it is a model
         * floating in cloud with nothing round it — and a model that *turns* stops
         * being a wide shot and becomes an object on a table. A still frame of a
         * beautiful district still reads as a screenshot.
         *
         * Slow: a full turn in about two and a half minutes. Fast enough that you
         * can see it moving, slow enough that nothing appears to be scrolling and
         * you are never waiting for it to come back round.
         *
         * Centred on the middle of the map rather than on the opening yard, because
         * a diorama is centred on *itself*. The play camera takes over the moment
         * the descent starts.
         */
        if (!startedRef.current) {
          renderer.spin = (now / 1000) * 0.042;
          renderer.camX = DISTRICT / 2;
          renderer.camZ = DISTRICT / 2;
        } else if (renderer.spin !== 0) {
          /*
           * And it rights itself as you fall in.
           *
           * Eased to the play angle over the first couple of seconds of the
           * descent, which reads as the model turning to face you — and it has to
           * be finished well before the ground gets close, because the mesh is
           * built for one angle and a furrow seen from the wrong side is visible
           * from about forty tiles down.
           */
          const shortest = ((renderer.spin + Math.PI) % (Math.PI * 2)
            + Math.PI * 2) % (Math.PI * 2) - Math.PI;
          renderer.spin = Math.abs(shortest) < 0.002
            ? 0
            : shortest * (1 - Math.min(1, dt * 1.6));
          renderer.camX += (menuHome.x - renderer.camX) * Math.min(1, dt * 1.4);
          renderer.camZ += (menuHome.z - renderer.camZ) * Math.min(1, dt * 1.4);
        }
        const at = introAt(introClock, openingAcross);
        renderer.tilesAcross = at.across;
        /*
         * And closer than that on the menu, because the sea is not the subject.
         *
         * At the descent's 156 tiles the island sat in a great deal of empty water,
         * with a heavy navy wedge in the corner and the low-poly sea reading as
         * teeth along the edge. At 118 the parish fills the frame and the water is
         * a margin round it, which is what a model on a table looks like.
         *
         * *After* the line above rather than before it, which is where it was and
         * why the first attempt changed nothing: the intro writes the zoom every
         * frame, so an override has to be the last word.
         */
        if (!startedRef.current) renderer.tilesAcross = 118;
        fit();
        /*
         * The cloud, written straight to the element's style.
         *
         * Not through React, because it changes every frame and this is a
         * ten-second animation; and not through the renderer's own cloud deck,
         * which is what the first attempt did and was simply the wrong mechanism.
         * That deck is a 260-unit plane in *ground space* — sized for the seventy
         * tiles the wheel stops at — so at a hundred and thirty-two tiles out it
         * came out as a clipped rectangle floating in the middle of the frame:
         * "you put a blue square over the screen? it doesn't even fit."
         *
         * A screen-space layer cannot be clipped, cannot be the wrong size, and
         * cannot be looked past. Which is what "you are inside the cloud" needs to
         * be: not an object in the world, but the whole view.
         */
        if (skyRef.current) {
          /*
           * On the menu the cloud is *framing* the diorama, not hiding it.
           *
           * `introAt(MENU_AT)` gives 0.29, which was chosen to be mid-descent —
           * and at that strength the island is fogged rather than floating: the
           * whole picture washes out to pale grey and you cannot read a field.
           * A tenth is enough to soften the edges into white so the model has
           * nothing round it, which is the entire trick of a diorama.
           */
          skyRef.current.style.opacity = String(startedRef.current ? at.veil : 0.06);
        }
        if (at.label !== introRef.current.label
          || at.ui !== introRef.current.ui
          || at.done !== introRef.current.done) {
          introRef.current = { label: at.label, ui: at.ui, done: at.done };
          setIntro(introRef.current);
        }
      }

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
       * Everything founded during play, which is depots *and* built businesses.
       *
       * This read `if (!world.isDepot(i)) continue;`, and the comment above it
       * named the bug it was fixing: "`placed` was built once at startup and a
       * depot appears later, so it would have no building at all — the classic
       * shape of this bug". Then building businesses arrived and walked into the
       * identical trap one category wider. A creamery you built took your money,
       * got a marker with the right icon, and drew nothing: "it says they're
       * placed, with icon, then nothing?"
       *
       * The lesson is that the test was about the wrong thing. Whether a site is
       * a depot has no bearing on whether the startup pass saw it; whether it
       * existed at startup does, and that is what the index says. So the test is
       * now the honest one, and the next kind of building cannot be forgotten
       * because there is nothing left to remember.
       *
       * Scanned each frame rather than appended on purchase because reading the
       * world is cheap at this size and cannot get out of step - which is the
       * same reasoning that was already right here.
       */
      for (let i = bornWith; i < world.sites.count && pn < src.px.length; i++) {
        const tile = world.sites.tile[i];
        if (tile < 0) continue;
        if (world.sites.owner[i] !== world.player && !world.influence.usable(tile)) continue;
        /*
         * On its own footprint, not off a road.
         *
         * A generated business is placed by frontage - pushed off the lane it
         * stands on - because that is what makes a village look like a village.
         * One you built is placed by *you*, on a square you were shown in green,
         * and it belongs in the middle of that square. Anything else moves the
         * building away from the ground the player just bought and paid to build
         * on, which they would rightly read as a bug.
         */
        const n = world.footprintOf(world.sites.def[i]);
        src.px[pn] = (tile % DISTRICT) + n / 2;
        src.pz[pn] = Math.floor(tile / DISTRICT) + n / 2;
        src.pModel[pn] = world.sites.def[i];
        // Square to the world. A works on your own land has no street to face.
        src.pRot[pn] = ((tile * 2654435761) % 4) * 0.25;
        claimYard(tile);
        // Lit, because it is yours and you need to find it in the dark.
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
        /*
         * Only a span ever sets these, and it has to, because a wire is the one
         * scattered thing whose job is to *reach* something rather than to stand
         * where it is put. Everything else takes the flat defaults.
         */
        src.sPitch[sn] = q.pitch ?? 0;
        src.sStretch[sn] = q.stretch ?? 1;
        src.sLift[sn] = q.lift ?? 0;
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

      /*
       * What would happen if you pressed the button here.
       *
       * In the frame loop rather than in React because it follows the pointer, and
       * it costs nothing to call every frame: `showPlots` compares a key and
       * returns immediately when the hover has not moved.
       *
       * This replaced a field of blue dots marking every legal tile in view. The
       * dots described the *rules* — a scattering of places the game would accept —
       * and said nothing about what pressing the button would do, which is the only
       * thing anybody wants to know while holding a tool.
       *
       * So: one square under the pointer, green where it will work and red where it
       * will not, and the green includes the road tile it would join, because the
       * join is the half a player is actually judging.
       *
       * A refusal shows *something* rather than nothing, which is the other half of
       * what was missing. An unmarked tile could mean "not allowed here" or "the
       * tool is not really on", and those are indistinguishable when the answer is
       * an absence.
       */
      {
        const hover = hoverRef.current;
        const held = toolRef.current;
        if ((held === 'lay' || held === 'lift') && hover >= 0) {
          const ok = held === 'lay'
            ? world.trackHere(world.player, hover).ok
            : world.liftHere(world.player, hover).ok;
          const tiles = [hover];
          if (ok && held === 'lay') {
            for (const d of [1, -1, DISTRICT, -DISTRICT]) {
              if (roadClass[hover + d] >= 0) { tiles.push(hover + d); break; }
            }
          }
          renderer.showPlots([{
            tiles,
            wash: ok ? PLOT.yesWash : PLOT.noWash,
            edge: ok ? PLOT.yesEdge : PLOT.noEdge,
          }], src);
        } else if (held === 'place' && placeDefRef.current >= 0) {
          /*
           * Placing a business: your own ground in blue, and the footprint under
           * the cursor in green or red.
           *
           * Two regions rather than one, and they answer different questions. The
           * blue is *where you could put something* - the whole of your land, so
           * the answer to "have I anywhere for this" is on screen before you go
           * hunting for it. The square is *what would happen here*, at the exact
           * size of the building, which is the only honest preview: a one-tile
           * marker for a three-tile works would be a promise the click could not
           * keep.
           *
           * The owned ground is recomputed every frame, which sounds wasteful and
           * is not - it is a walk over the parcels you hold, and it means buying a
           * field mid-placement lights it up immediately.
           */
          const owned = world.landOwnedTiles();
          const regions: { tiles: readonly number[]; wash: RGB; edge: RGB }[] = [];
          if (owned.length > 0) {
            regions.push({ tiles: owned, wash: PLOT.ownWash, edge: PLOT.ownEdge });
          }
          if (hover >= 0) {
            const ok = world.canPlaceSite(world.player, placeDefRef.current, hover).ok;
            regions.push({
              tiles: world.footprintTiles(placeDefRef.current, hover),
              wash: ok ? PLOT.yesWash : PLOT.noWash,
              edge: ok ? PLOT.yesEdge : PLOT.noEdge,
            });
          }
          renderer.showPlots(regions, src);
        } else if (held !== 'land') {
          renderer.showPlots([], src);
        }
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
        /*
         * Engines only, which is the third thing the livestock broke.
         *
         * They ride in the vehicle arrays, so they were being handed engine
         * voices — and there are forty-eight of them, nearly stationary, so they
         * won the nearest-first contest and held the whole pool. The engine you
         * could hear was a sheep at a fixed distance, which is why the sound
         * stopped tracking the lorry you were watching: "the tractor noises don't
         * seem to be distant from the camera any more". The distance model was
         * fine. It was aimed at the wrong things.
         */
        if (src.vMotor[i] === 0) continue;
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
        /*
         * Has anything arrived? Asked on the hud tick — four times a second —
         * rather than every frame, because a letter that turns up a quarter of a
         * second late is a letter that turned up on time, and the predicates walk
         * the fleet and the sites.
         *
         * And not until the opening is over, which is a bug fix rather than a
         * nicety. The first letter's predicate is `() => true`, so it fired on the
         * very first hud tick and started its seven-second toast — while the
         * interface that toast hangs off does not exist until the descent ends at
         * seven seconds. Measured with the intro held at 7.2, 8.5 and 9.8 seconds:
         * no toast at any of them. Tom Ashbury's letter was arriving to an empty
         * room every single time.
         *
         * Waiting for the player to have controls is better pacing anyway: the
         * post comes as you take the wheel, not while you are still in cloud.
         */
        if (introDone.current) {
          let stranded = false;
          let holding = false;
          let places = 0;
          const cargoes = world.content.cargo.length;
          for (let i = 0; i < world.sites.count; i++) {
            if (world.sites.owner[i] !== world.player) continue;
            places++;
            if (world.siteStranded(i)) stranded = true;
            for (let c = 0; c < cargoes; c++) {
              if (world.sites.stock[i * cargoes + c] > 8) holding = true;
            }
          }
          let fleet = 0;
          for (let v = 0; v < world.vehicles.count; v++) {
            if (world.vehicles.alive[v] && world.vehicles.company[v] === world.player) fleet++;
          }
          const fresh = advisor.current.check({
            tick: world.tick,
            fleet,
            places,
            fields: world.landOwned().length,
            delivered: world.companies.delivered[world.player],
            cash: world.companies.cash[world.player],
            /* The parish counting you as one of their own, which is the thing
               the letter about it was really about. See `refreshStanding`. */
            boardOpen: world.standing > 0,
            stranded,
            holdingStock: holding,
          });
          if (fresh.length > 0) {
            setPost((n) => n + 1);
            /*
             * A chaffinch, once, however many letters arrived.
             *
             * `oneShot` rather than `press`, which exists to be superseded by
             * whatever a click turned out to mean — nothing superseded this,
             * because nobody clicked. Flat rather than positional: the post does
             * not come from a place on the map.
             *
             * Quiet on purpose. This is the only sound in the game that fires
             * unprompted, and a notice louder than the thing you were listening to
             * is a notice you resent by the fourth one.
             */
            sound.oneShot('bird', 0.55);
            /*
             * The last of them gets the toast. More than one letter arriving in the
             * same quarter-second is possible and stacking notices for it would be
             * a pile-up over the money; the inbox has the rest and the dot says so.
             */
            setToast(fresh[fresh.length - 1]);
            toastTimer.current = performance.now() + 7000;
          }
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
    /*
     * A handle on the running game, for measuring it from outside.
     *
     * Because "how does it look" and "what is it actually doing" have been the
     * two hardest questions in this project and screenshots keep answering the
     * first one wrongly — a headless browser on software GL renders this scene at
     * about three frames a second, so the shutter opens seconds after the state
     * it was meant to catch. Every workaround so far has been a new URL parameter
     * that sets one thing up, and there are five of them now.
     *
     * One handle instead. A driver can arrange whatever state the picture needs
     * with the same calls the interface uses, which means the picture is of the
     * real thing rather than of a fixture built to resemble it.
     *
     * Not hidden behind a build flag, on the same reasoning as `?happyHour=`: a
     * single-player game on a machine whose console is already open loses nothing
     * by admitting the state is there.
     */
    (window as unknown as { interchange: unknown }).interchange = { world, renderer };
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
    /*
     * `boot` is the dependency, and it is the whole of the menu working.
     *
     * This was `[]` — run once, on mount — which was right when the game began the
     * instant the page loaded. With a menu in front of it the effect now returns
     * early with no world, and an empty dependency list means it never runs again:
     * pressing New game hid the menu and left the survey screen up for ever.
     *
     * Nothing else belongs in here. Every other value the effect reads is either a
     * ref or a `useCallback`, deliberately, because a re-run tears down the WebGL
     * context and rebuilds the district — which is correct for starting a game and
     * catastrophic for changing the sound volume.
     */
  }, [boot]);

  return (
    <div
      className={`app${panelLeaving ? ' panel-leaving' : ''}`
        + `${pauseLeaving ? ' pause-leaving' : ''}`
        /*
         * A tool in hand means the map is the tool's, and *nothing* on it is
         * selectable. The canvas handler has always said so - "a tool that
         * sometimes opened a farm instead of laying a road would be a tool
         * nobody trusted" - and it could not enforce it, because the map markers
         * are DOM buttons floating over the canvas and take their clicks before
         * the canvas ever sees them. Measured: with a creamery in hand, a click
         * meant for a field opened the yard whose marker happened to be under the
         * pointer.
         *
         * On the root rather than on the markers, because the same is true of
         * every anchored thing over the district and will be true of the next one.
         */
        + `${tool === 'none' ? '' : ' tool-held'}`}
    >
      <canvas ref={canvasRef} className="world" />
      {/*
        * Not during the opening. A marker is interface, and the descent should be
        * country — a dozen labelled pins over a district seen from four thousand
        * feet is a map, and the whole point of coming down through the cloud is
        * that you are arriving somewhere rather than opening a document.
        */}
      {live && intro.ui && (
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
          onClose={() => setPanel({ k: 'none' })}
        />
      )}
      {live && showPanel && shownPanel.k === 'inbox' && (
        <Inbox
          advisor={advisor.current}
          tick={live.world.tick}
          ticksPerDay={TICKS_PER_DAY}
          onClose={() => { setPost((n) => n + 1); setPanel({ k: 'none' }); }}
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
          onTake={(contract, vehicle) => {
            if (live.world.acceptContract(contract, live.world.player, vehicle)) {
              setNote('');
              bump();
            } else {
              setNote('That could not be taken on.');
            }
          }}
          onCancel={(contract) => {
            const r = live.world.cancelContract(contract);
            if (r.ok) { setNote(''); bump(); } else setNote(r.reason);
          }}
          /* The same call the sourcing screen makes, because it is the same act:
             a task has one control and it is the lorry. */
          onEndTask={(service) => { if (live.world.endRun(service)) bump(); }}
          onClose={() => setPanel({ k: 'none' })}
        />
      )}
      {live && tool === 'land' && (
        <Land
          world={live.world}
          renderer={live.renderer}
          src={live.src}
          camX={live.renderer.camX}
          camZ={live.renderer.camZ}
          tilesAcross={live.renderer.tilesAcross}
          onBought={bump}
        />
      )}

      {(buildAt !== 'closed' || trayLeaving) && (
        /*
         * The build tray: one row above the dock, two pages deep.
         *
         * It was a road tray and nothing else, and roads turned out to be one kind
         * of building among two. Rather than a second dock item for businesses -
         * the dock is a budget, not a list - the tray grew a page: press Build and
         * you choose *what sort* of thing, press that and the same row fills with
         * the things themselves, with a chevron back to the choice.
         *
         * One row rather than a nested menu because the row is already the right
         * shape: it is the dock having grown, same glass, same corner radius, same
         * icon-over-label buttons. Going a level deeper should look like the row
         * turning a page, which is what the slide does.
         *
         * And no "Done", because there was never anything to be done with. A mode
         * you are in until you say otherwise ends the way modes end: an X, Escape,
         * or a right-click on the district - the last being the one people reach
         * for first, and the only one that needs no aiming.
         */
        <div className={`tools${buildAt === 'closed' ? ' tools-leaving' : ''}`}>
          {buildAt !== 'cats' && (
            /* Back to the categories. On the left, because that is where back is,
               and it leaves whatever is in hand alone: changing your mind about
               which page you are reading is not changing your mind about the
               creamery. */
            <button
              className="tool-back"
              onClick={() => setBuildAt('cats')}
              aria-label="Back to what you can build"
              title="Back"
            >&lsaquo;</button>
          )}
          {/*
            * Keyed by the page, so React replaces the row rather than editing it
            * and the slide runs. Without the key the same DOM element would have
            * its children swapped, the animation would not restart, and the page
            * would change with no motion at all.
            */}
          <div className={`tool-page page-${buildAt}`} key={buildAt}>
            {buildAt === 'cats' && (
              <>
                <button
                  className={`tool-btn ${tool === 'lay' || tool === 'lift' ? 'on' : ''}`}
                  onClick={() => { setBuildAt('roads'); setTool('lay'); setNote(''); }}
                  title="Lay and lift farm tracks on your own land"
                >
                  <Icon id="track" size={20} />
                  <span>Roads</span>
                </button>
                <button
                  className={`tool-btn ${tool === 'place' ? 'on' : ''}`}
                  onClick={() => { setBuildAt('works'); setTool('none'); setNote(''); }}
                  title="Build a business on land you own"
                >
                  <Icon id="creamery" size={20} />
                  <span>Business</span>
                </button>
              </>
            )}
            {buildAt === 'roads' && (
              <>
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
              </>
            )}
            {buildAt === 'works' && live && (
              /*
               * Every business, and the row scrolls rather than wrapping.
               *
               * Sixteen of them will not fit across the district and a grid of
               * sixteen tiles would be a catalogue rather than a tool row. A strip
               * that scrolls keeps the tray one row high, which is what makes it
               * read as the dock having grown rather than as a panel arriving.
               */
              live.world.content.industries.map((def, i) => (
                <button
                  key={def.id}
                  className={`tool-btn ${tool === 'place' && placeDef === i ? 'on' : ''}`}
                  onClick={() => {
                    setPlaceDef(i);
                    setTool('place');
                    setNote('');
                  }}
                  title={`${def.name} - ${def.footprint} by ${def.footprint} tiles`}
                >
                  <Icon id={def.id} size={20} />
                  <span>{def.name}</span>
                </button>
              ))
            )}
          </div>
          <span className="tool-rule" />
          <button
            className="tool-x"
            onClick={() => { setBuildAt('closed'); setTool('none'); setNote(''); }}
            aria-label="Close the build tray"
            title="Close (Esc, or right-click)"
          >&times;</button>
        </div>
      )}
      {/*
        * Whatever the last tool refused to do, in words.
        *
        * There was a second version of this above it carrying the depot mode's
        * instruction — "click a spot beside a road" — and it went with the mode.
        * What is left is the refusal, which every tool still needs: the green and
        * red square says *whether*, and this says *why not*.
        */}
      {note !== '' && <div className="build-hint"><b>{note}</b></div>}
      {live && showPanel && shownPanel.k === 'market' && (
        <Market
          world={live.world}
          onClose={() => setPanel({ k: 'none' })}
          onSold={bump}
        />
      )}
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
      {/*
        * The menu, instead of the game rather than over it.
        *
        * The canvas is still mounted behind — it has to be, or the setup effect has
        * no element to attach to — but it is blank until a world exists, and the
        * menu is opaque. That is simpler than tearing the canvas down and putting it
        * back, and it means starting a game is one state change rather than a
        * remount race.
        */}
      {!started && menuPage && (
        <Menu
          page={menuPage}
          onPage={setMenuPage}
          /*
           * Nothing is rebuilt. The world under the menu *is* the new game — same
           * seed, opening sequence already run — so starting one is releasing the
           * camera, not creating anything.
           */
          onNew={() => { setMenuPage(null); setStarted(true); }}
          onLoad={(slot) => {
            setMenuPage(null);
            setStarted(true);
            setLive(null);
            setReady(false);
            setBoot({ kind: 'load', slot });
          }}
          settings={(
            <Settings
              options={options}
              onChange={setOptions}
              onResume={() => setMenuPage('main')}
              inline
            />
          )}
        />
      )}
      {(paused || pauseLeaving) && (
        <Settings
          options={options}
          onChange={setOptions}
          onResume={() => { setPaused(false); setSaving(false); setSaveNote(''); }}
          /*
           * Saving lives in the pause menu because that is where the cog goes, and
           * the cog is what the player reaches for. "Click cog, save game, bosh."
           */
          saves={saving ? (
            <SaveList
              slots={listSaves().filter((sl) => !sl.auto)}
              onPick={(sl) => {
                if (putSave(sl.id, false)) {
                  setSaving(false);
                  setPaused(false);
                }
              }}
              onDelete={(sl) => { deleteSave(sl.id); setSaveNote(''); }}
              newRow={() => {
                if (putSave(newId(), false)) {
                  setSaving(false);
                  setPaused(false);
                }
              }}
            />
          ) : undefined}
          note={saveNote}
          onSave={() => { setSaveNote(''); setSaving(true); }}
          onQuit={() => {
            /*
             * Back to the menu, and the world goes with it. `boot` to null unmounts
             * the setup effect, whose cleanup disposes the renderer — so there is
             * no second WebGL context left holding a district nobody can see.
             */
            setPaused(false);
            setSaving(false);
            setLive(null);
            setReady(false);
            setStarted(false);
            setBoot({ kind: 'new' });
            setMenuPage('main');
          }}
        />
      )}
      {/*
        * "Loading game...", for the first four seconds.
        *
        * Over the cloud rather than over the district, because for those seconds
        * there *is* no district to obscure — which is the whole reason the opening
        * is shaped this way. It leaves before the descent ends, so the last thing
        * you see before the interface arrives is only countryside.
        */}
      {/*
        * The cloud you come down through.
        *
        * Six soft masses over a flat overcast, drifting at different speeds and
        * scales, which is the cheapest thing that reads as depth: a single wash is
        * a grey screen, and two layers moving at one speed is a grey screen with a
        * pattern on it. Behind the loading text and in front of everything else.
        */}
      {!intro.done && (
        <div className="sky" ref={skyRef}>
          <span className="sky-a" />
          <span className="sky-b" />
          <span className="sky-c" />
        </div>
      )}
      {intro.label && (
        /*
         * `say` rather than `loading`, and the rename is the bug fix.
         *
         * There is already a `.loading` — the survey screen, a full-bleed blue
         * page shown before the world exists — and this reused the class name.
         * The old rule's `background: #bcd0e0` and `bottom: 0` survived, because a
         * later rule only overrides the properties it actually names: so the words
         * arrived wearing a solid blue rectangle half the height of the frame,
         * sitting on top of the cloud. "You put a blue square over the screen?"
         * Quite. It was the old loading screen, in the wrong shape.
         */
        <div className="say">
          <span>Loading game</span>
          <span className="say-dots"><i /><i /><i /></span>
        </div>
      )}
      <div className={`hud${intro.ui && !intro.done ? ' hud-in' : ''}`}>
        {live && intro.ui && (
          <Status
            cash={hud.cash}
            date={hud.date}
            dayFraction={hud.dayFraction}
            speed={speed}
            onSpeed={setSpeed}
            onMenu={() => { void sound.start(); setPaused(true); }}
            inbox={(
              <>
                <InboxButton
                  unread={advisor.current.unread}
                  on={panel.k === 'inbox'}
                  onClick={() => {
                    setToast(null);
                    toastTimer.current = 0;
                    setPanel(panel.k === 'inbox' ? { k: 'none' } : { k: 'inbox' });
                  }}
                />
                {/*
                  * The toast hangs off the button rather than floating on its own,
                  * which is what makes it read as coming *out of* the inbox — and
                  * is why it is passed in here rather than rendered beside the hud.
                  */}
                {toast && panel.k !== 'inbox' && (
                  <Toast
                    letter={toast}
                    onOpen={() => {
                      advisor.current.markRead(toast.id);
                      setToast(null);
                      toastTimer.current = 0;
                      setPost((n) => n + 1);
                      setPanel({ k: 'inbox' });
                    }}
                  />
                )}
              </>
            )}
          />
        )}
      </div>
      {live && intro.ui && (
        <Dock
          fresh={!intro.done}
          items={[
            /*
             * Build, first in the dock, and a *tool* rather than a screen.
             *
             * First because it is the only item that changes the district rather
             * than telling you about it. Everything to its right opens a panel and
             * closes again leaving the parish exactly as it was; this one lays road
             * and puts up buildings. Reading order in the dock is now roughly
             * "what can I change" then "what have I got", which is the order those
             * two questions actually get asked in.
             *
             * The one dock item that does not open a panel over the district,
             * because what you need on screen while deciding where a thing goes is
             * the place it is going. It was "Roads" and it held one kind of
             * building; it holds two now, and the tray it opens is where the
             * choosing happens rather than here - the dock is a budget of eight
             * controls, and spending two of them on "roads" and "businesses"
             * separately would be spending them on the same idea twice.
             */
            {
              key: 'build',
              label: 'Build',
              icon: 'track',
              // The tray being open, not a tool being in hand: you can be on the
              // category page with nothing selected and the dock should still show
              // where you are.
              on: buildAt !== 'closed',
              onClick: () => {
                setPanel({ k: 'none' });
                setNote('');
                /*
                 * Open on the categories, or shut. A dock button should always be
                 * able to say "this one now" - the version of this that read
                 * `tool === 'none' ? ... : 'none'` turned *everything* off when
                 * pressed with another tool in hand, and the dock went dark.
                 */
                if (buildAt === 'closed') {
                  setBuildAt('cats');
                  /*
                   * And nothing in hand, because the category page *is* nothing in
                   * hand. Without this, pressing Build while buying land opened the
                   * tray on top of the land panel and left the land tool live -
                   * two tools at once, and the map taking clicks for the wrong
                   * one. A control that changes mode has to end every other mode.
                   */
                  setTool('none');
                } else {
                  setBuildAt('closed');
                  setTool('none');
                }
              },
            },
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
             * The market, which is the one screen that is not about vehicles.
             *
             * It earns a permanent slot because it answers a question the player
             * has continuously once they own anything that produces: what is all
             * this stock worth, and when do I want the money. Everything else in
             * the dock is a place or a vehicle; this is the ledger of things you
             * are holding.
             */
            {
              key: 'market',
              label: 'Market',
              icon: 'builders-merchant',
              on: panel.k === 'market',
              onClick: () => setPanel(
                panel.k === 'market' ? { k: 'none' } : { k: 'market' },
              ),
            },
            /*
             * Land, which like Roads is a *tool* rather than a screen — and for
             * the same reason, more strongly. What you are choosing when you buy
             * land is *where*, and where is the map. A list of plots could not put
             * the question at all: the whole of it is what the square is next to.
             */
            {
              key: 'land',
              label: 'Land',
              icon: 'quarry',
              on: tool === 'land',
              onClick: () => {
                setPanel({ k: 'none' });
                setNote('');
                // The build tray goes with it, for the same reason Build puts the
                // land tool down: one mode at a time.
                setBuildAt('closed');
                setTool(tool === 'land' ? 'none' : 'land');
              },
            },
            /*
             * There was a Parish item here and there is not one now.
             *
             * It opened a screen whose whole content was a number and some things
             * to spend it on, and the complaint about it was exact: "I don't like
             * that it only allows you to influence, not do." Both halves of it
             * moved somewhere better — the road works are in Build, where the rest
             * of the changing-the-district lives, and the number is at the top of
             * the screen where it can gate things without being visited.
             *
             * Which also settles "why does my friend have a Parish tab and I
             * don't?" for good, by there being no such tab for anybody.
             */
          ]}
        />
      )}
      {!ready && <div className="loading">Surveying the district…</div>}
    </div>
  );
}
