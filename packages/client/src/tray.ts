/**
 * The Build tray's pages, and which page a thing you can put up belongs on.
 *
 * ## Why there are six categories and not one list
 *
 * There was one page called Business with all sixteen on it. Getting them *visible*
 * took two wrapped rows — and two wrapped rows of sixteen renders is a catalogue.
 * "Rather than that big menu we have categories and a grouped menu? Would be a lot
 * cleaner." It is: a category page of six, and then two to six things on one row.
 * Nothing in the tray is ever more than one row deep again.
 *
 * ## The grouping is the content's, not invented
 *
 * `kind` already separates what comes out of the ground from what is made from it
 * from what is sold, and that is the same division a player is making when they go
 * looking. The one place it needs help is `extraction`, which holds three farms
 * *and* a quarry and a plantation — so the deposit splits it, because a farm sits on
 * farmland and the other two sit on stone and timber. Calling a quarry a farm to
 * keep the count at four would have been a tidier menu with a lie in it.
 *
 * ## The category buttons show a building, not a symbol
 *
 * A render of the most representative thing on the page, for the reason the tray
 * itself now shows renders: a glyph names a category and a picture shows you what
 * is behind the door. Roads is the exception and keeps its glyph, because a road is
 * not a model in the way a creamery is.
 */

/** Every page the tray can show. `cats` is the category page itself. */
export type TrayPage =
  | 'cats' | 'roads' | 'farms' | 'ground' | 'works' | 'trade' | 'parish';

export interface TrayCategory {
  page: TrayPage;
  label: string;
  /**
   * The industry whose render stands for the category, or `null` for a page that
   * has no buildings on it.
   */
  sample: string | null;
  /** The glyph, used when there is no render to show. */
  icon: string;
  /** What the tooltip says. */
  hint: string;
}

/**
 * The category page, in the order the ladder is climbed.
 *
 * Roads first because it is the cheapest thing in the game and the first thing
 * anybody builds. Then the land, then what is made from it, then what sells it, and
 * the parish last — which is also roughly the order a player unlocks them, since
 * the heavy end of Works and Trade wants approval they have not earned yet.
 */
export const TRAY_CATEGORIES: readonly TrayCategory[] = [
  {
    page: 'roads',
    label: 'Roads',
    sample: null,
    icon: 'track',
    hint: 'Lay and lift farm tracks on your own land',
  },
  {
    page: 'farms',
    label: 'Farms',
    sample: 'dairy-farm',
    icon: 'dairy-farm',
    hint: 'Dairy, arable and livestock — they need the right ground',
  },
  {
    page: 'ground',
    label: 'Pits & woods',
    sample: 'quarry',
    icon: 'quarry',
    hint: 'A quarry wants stone under it, a plantation wants timber',
  },
  {
    page: 'works',
    label: 'Works',
    sample: 'creamery',
    icon: 'creamery',
    hint: 'Somewhere to turn what the district grows into something worth more',
  },
  {
    page: 'trade',
    label: 'Trade',
    sample: 'distribution-centre',
    icon: 'distribution-centre',
    hint: 'Depots, shops and yards — the places that take goods in and sell them on',
  },
  {
    page: 'parish',
    label: 'Parish',
    sample: 'village-green',
    icon: 'village-green',
    hint: 'Build something for the parish, on land you own',
  },
];

/** Farmland, from `Deposit` in the simulation. Spelled out because the client
 *  does not import the sim's enums for one number. */
const FARMLAND = 9;

/**
 * Which page a placeable building is filed on.
 *
 * Total by construction: everything that is not one of the four known kinds lands
 * on `works`. That is deliberate and it is the second time this function has been
 * written for the same reason — a kind nobody has thought about yet showing up on
 * the wrong page is a small wrongness a player can still act on, where the same
 * kind matching no page at all is a building that is simply not in the game, with
 * nothing anywhere to say so. That is how the distribution centre went missing.
 */
export function trayPageFor(kind: string, deposit = 0): TrayPage {
  if (kind === 'amenity') return 'parish';
  if (kind === 'terminal') return 'trade';
  if (kind === 'extraction') return deposit === FARMLAND ? 'farms' : 'ground';
  return 'works';
}

/** The pages that hold buildings, for the tests and for the renderer's loop. */
export const BUILDING_PAGES: readonly TrayPage[] =
  ['farms', 'ground', 'works', 'trade', 'parish'];
