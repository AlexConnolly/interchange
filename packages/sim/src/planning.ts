/**
 * Approval, and the planning board. design.md §3's last rung.
 *
 * The ladder ends "I move milk" → "I can influence the world to get a better
 * road in place", and this is that turn. It is the one rung where the player
 * stops being a customer of the district and starts being able to change it.
 *
 * Three rules, and the third is the one that makes it work.
 *
 * **Approval is what the parish thinks of you**, 0 to 100. It rises when you
 * serve the place — deliveries into its shops and works — and when you put money
 * into it. It is not a currency and it is not a tech tree: it is a number that
 * gates one specific kind of action.
 *
 * **A proposal is a piece of infrastructure**, and it costs money *and*
 * approval. The money is ordinary. The approval is what makes it a different
 * mechanic from buying a lorry: you cannot get it in an afternoon and you cannot
 * get it by being rich, only by having been useful for a while.
 *
 * **And nobody cares about it until they do.** This is the part the design is
 * emphatic about — "nobody cares about your approval rating until the further
 * along you get" — so there is no approval anywhere in the interface until the
 * player owns enough to be a presence. Showing it on day one would make the
 * first ten minutes a game about a bar filling up, which is the opposite of a
 * milk round.
 */

/** What a proposal is asking the board for. */
export const Works = {
  /** Widen an existing way along a route: a lane becomes a proper road. */
  Widen: 0,
  /** Cut a new way where there is none, between two places you own. */
  NewRoad: 1,
  /** Nothing physical: the board simply agrees you belong here, and your
   *  influence grows. Cheap in money, dear in approval. */
  Standing: 2,
} as const;
export type Works = (typeof Works)[keyof typeof Works];

/**
 * How much approval each kind of works needs before the board will hear it.
 *
 * Widening is the cheap one because it is an improvement to something that
 * already exists and somebody already wanted. A new road through somebody's
 * fields is dearer. Standing is dearest of all: you are asking to be treated as
 * part of the place rather than as a haulier passing through, and no amount of
 * money buys that.
 */
export const WORKS_APPROVAL: Record<number, number> = {
  [Works.Widen]: 35,
  [Works.NewRoad]: 55,
  [Works.Standing]: 72,
};

export const WORKS_NAMES: Record<number, string> = {
  [Works.Widen]: 'Widen the road',
  [Works.NewRoad]: 'Cut a new road',
  [Works.Standing]: 'Ask to be counted',
};

/**
 * Below this the whole thing is hidden.
 *
 * Measured in vehicles, because design.md §4 says a vehicle is the unit of
 * measurement for the entire game — so "how big are you" is a fleet count and
 * not a cash figure or a site count. Four is about the point where a player has
 * a yard with something in every bay and has started to look at the second
 * yard, which is exactly when "could the road be better" becomes a thought they
 * would have on their own.
 */
export const PLANNING_FROM_VEHICLES = 4;

/**
 * What a pound buys in goodwill, and it deliberately buys less the more you
 * spend.
 *
 * A flat rate would make approval a purchase, and then the last rung of the
 * ladder is just another price — which is the failure mode this whole design
 * keeps walking away from. Diminishing returns mean money can carry you part of
 * the way and never all of it: past about sixty, funding the parish is nearly
 * worthless and the only thing that still moves the number is doing the job.
 */
export function levyGain(approval: number, pence: number): number {
  const pounds = pence / 100;
  /*
   * Measured, not guessed. The first version had this at pounds/100 and
   * sixty thousand pounds took approval from thirty to a hundred — so the last
   * rung of the ladder was for sale, at about the price of three lorries.
   *
   * At /2500 the same sixty thousand buys about eight points from a standing
   * start and under three from sixty, which is the shape wanted: money opens
   * the door and cannot walk you through it.
   */
  const resistance = 1 + Math.pow(Math.max(0, approval) / 34, 2.1);
  return (pounds / 2500) / resistance;
}

/**
 * Approval drifts back toward indifference.
 *
 * Without this the number is a ratchet: every delivery you ever made counts for
 * ever, and by the second year it is pinned at a hundred and stops being a
 * constraint. Drifting means standing still costs you, slowly, which is what
 * makes it worth topping up — and it means a player who stops serving the parish
 * eventually loses the standing they bought.
 *
 * Toward 30 rather than 0, because a haulier nobody has heard of is not hated.
 */
export const APPROVAL_REST = 30;
export const APPROVAL_DRIFT_PER_DAY = 0.16;

/** What one delivered load into the parish is worth. Small on purpose: this is
 *  meant to accumulate over months of running, not over an afternoon. */
export const APPROVAL_PER_LOAD = 0.055;

/**
 * And what a day of keeping the village supplied is worth, per place you own
 * that serves it, scaled by how full its shelves are.
 *
 * Read against the drift, which is 0.16 a day: a well-stocked shop nets a little
 * under half a point a week, so owning one and keeping it supplied carries you
 * from indifference to the board's hardest threshold in about ten months of game
 * time. That is the intended shape of this rung — the shop is what makes
 * approval start to move at all, and it is slow enough that it is a season's
 * work rather than a purchase. Set it much lower and the drift eats it, which is
 * where it started; much higher and the shop *is* the planning board.
 */
export const PARISH_PER_DAY = 0.3;
