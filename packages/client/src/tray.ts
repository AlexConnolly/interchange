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

import { money } from './format.ts';

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

/**
 * What is standing between you and a building, before you have aimed it.
 *
 * ## Why this exists
 *
 * Reported from play: "it was not obvious that I did not have enough influence."
 * It was not, and the reason is structural rather than a matter of wording. Every
 * refusal in the game arrives *after* a click — you choose the depot, you move the
 * cursor over your fields, and a red square tells you no, one tile at a time. A
 * player who has not yet worked out that approval is local, or that land beyond
 * their reach is simply not for sale, reads that as the tool being broken.
 *
 * So the three walls a building can be behind are named on the button itself, at
 * the earliest moment they can be known: before a spot has been chosen at all.
 *
 * ## Why it is advisory
 *
 * `canPlaceSite` is the authority and it answers about *one tile*. This answers
 * about the whole of what you hold, which is a different question and a coarser
 * one: the parish reading is sampled per tile rather than at each footprint's
 * centre, so a four-by-four depot standing on the edge of your holding may be
 * refused where this says the parish would have it. That is the right way for the
 * error to fall — this is here to stop a player hunting for a spot that does not
 * exist, not to promise them one.
 */
export interface Reach {
  /** What you have to spend, in pence. */
  cash: number;
  /** How much ground you hold at all, in tiles. */
  ownedTiles: number;
  /** The best the parish thinks of you anywhere you hold ground. */
  bestApproval: number;
}

export interface Blocker {
  /** One word, for the corner of the button. */
  badge: string;
  /** The whole of it, for the hint and the tooltip. */
  note: string;
}

/**
 * Every reason you cannot build this, or `null` when there is none.
 *
 * All of them rather than the first, because they are independent and a player
 * told only about the money will fix the money and meet the parish. The badge
 * takes the most fundamental — you cannot be refused for approval on ground you
 * do not hold — and the note carries the rest.
 */
export function blockerFor(
  reach: Reach,
  def: { approvalNeed: number },
  price: number,
): Blocker | null {
  const notes: string[] = [];
  let badge = '';
  if (reach.ownedTiles === 0) {
    badge = 'land';
    notes.push('You hold no ground yet. Buy a field, then build on it.');
  } else if (def.approvalNeed > 0 && reach.bestApproval < def.approvalNeed) {
    badge = 'parish';
    notes.push(
      `The parish wants ${def.approvalNeed} approval for this and thinks `
      + `${Math.floor(reach.bestApproval)} of you at best on ground you hold.`,
    );
  }
  if (reach.cash < price) {
    if (badge === '') badge = 'cash';
    /*
     * Both figures in full, and `money` rather than the tray's own `roughMoney`.
     *
     * The row rounds to "£30k" because it is for choosing between buildings, and
     * rounding here would produce the sentence "it costs £30k and you have £30k" —
     * which is the complaint this is answering, restated as an argument the player
     * cannot win. A refusal has to be checkable.
     */
    notes.push(`It costs ${money(price)} and you have ${money(reach.cash)}.`);
  }
  return badge === '' ? null : { badge, note: notes.join(' ') };
}
