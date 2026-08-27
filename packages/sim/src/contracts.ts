/**
 * Contracts: somebody offering you work.
 *
 * This is the interaction. Not a route editor — a route editor is a tool, and a
 * contract is a thing that happens *to* you, which is far more legible and much
 * less to explain. Click a farm, it says what it wants moving and what it pays,
 * put a truck on it.
 *
 * The previous draft cut contracts as "paperwork" and put a stop-list editor in
 * their place, which was exactly backwards, and it is worth being clear about
 * why so it does not come back:
 *
 *   A route editor asks the player to *design*, which needs them to already
 *   understand distance, capacity, vehicle handling and where the demand is. A
 *   contract asks them to *judge one offer*, which needs none of that on the
 *   first click and teaches all of it by the fifth.
 *
 * Under the hood a contract is still two places and a vehicle, so accepting one
 * makes an ordinary two-stop service. The player never sees the word service.
 *
 * The other rule here is that a contract must be **inside your influence**
 * (influence.ts). That is what makes the fog do its job: the only work you can
 * see is work you could actually take, so there is never an offer you have to
 * be told you cannot have.
 */

import { NONE } from './network.ts';

export const MAX_CONTRACT_OFFERS = 24;

export const ContractState = {
  /** On the board, waiting for the player. */
  Offered: 0,
  /** Accepted, and a vehicle is running it. */
  Running: 1,
  /** Accepted, but nothing is assigned to it. */
  Idle: 2,
  /** Gone: withdrawn by the offerer, or given up by the player. */
  Closed: 3,
} as const;
export type ContractState = (typeof ContractState)[keyof typeof ContractState];

export class ContractBoard {
  count = 0;
  readonly state = new Uint8Array(MAX_CONTRACT_OFFERS).fill(ContractState.Closed);
  /** Site indices. A contract is two places, always. */
  readonly from = new Int32Array(MAX_CONTRACT_OFFERS).fill(NONE);
  readonly to = new Int32Array(MAX_CONTRACT_OFFERS).fill(NONE);
  readonly cargo = new Int32Array(MAX_CONTRACT_OFFERS).fill(NONE);
  /** Pence per load. */
  readonly pay = new Int32Array(MAX_CONTRACT_OFFERS);
  /** Straight-line tiles, for the panel. Not the driven distance — the point of
   *  showing it is "is this near me", not "how long exactly". */
  readonly distance = new Int32Array(MAX_CONTRACT_OFFERS);
  /** The service created when it was accepted, so the vehicle has somewhere to
   *  be assigned. NONE while merely offered. */
  readonly service = new Int32Array(MAX_CONTRACT_OFFERS).fill(NONE);
  /** How many loads have been delivered under it. The only progress number the
   *  player needs. */
  readonly delivered = new Int32Array(MAX_CONTRACT_OFFERS);
  readonly offeredTick = new Int32Array(MAX_CONTRACT_OFFERS);
  /**
   * What this contract has actually paid, in pence, since it was taken on.
   *
   * The rate per tonne was the only money on a contract, and a rate is a promise
   * rather than a result: two jobs at the same rate pay differently because one
   * is a longer round trip, one has a lorry that keeps waiting at a full yard,
   * and one was taken three weeks earlier. "How much you've made so far" is the
   * question a haulier asks about work in hand, and nothing in the game could
   * answer it.
   */
  readonly earned = new Int32Array(MAX_CONTRACT_OFFERS);
  /** The tick it was taken on, so what it earns can be read per day. */
  readonly tookTick = new Int32Array(MAX_CONTRACT_OFFERS);

  private free: number[] = [];

  alloc(): number {
    if (this.free.length > 0) return this.free.pop() as number;
    if (this.count >= MAX_CONTRACT_OFFERS) return NONE;
    return this.count++;
  }

  release(id: number): void {
    this.state[id] = ContractState.Closed;
    this.service[id] = NONE;
    this.free.push(id);
  }

  /** Everything currently on offer at a place, for its panel. */
  offersAt(site: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] === ContractState.Offered && this.from[i] === site) out.push(i);
    }
    return out;
  }

  /**
   * Does this place have anything worth a pin above it — or, given a cargo, an
   * offer of *that* already?
   *
   * The per-cargo form is why this takes an argument. Blocking a second offer per
   * *site* meant a place that makes two things could only ever offer one of them:
   * an arable farm grows grain and produce, grain is always the bigger heap, so
   * produce was never once offered anywhere in the district on any seed. The
   * village shop it feeds could therefore never be supplied by contract.
   */
  hasOffer(site: number, cargo = -1): boolean {
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] !== ContractState.Offered) continue;
      if (this.from[i] !== site) continue;
      if (cargo >= 0 && this.cargo[i] !== cargo) continue;
      return true;
    }
    return false;
  }

  live(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] !== ContractState.Closed) out.push(i);
    }
    return out;
  }
}

export interface OfferContext {
  tick: number;
  siteCount: number;
  /** Where a site is, for distance and for the influence test. */
  siteTile: (site: number) => number;
  siteX: (site: number) => number;
  siteY: (site: number) => number;
  /** Can the player work here at all? */
  usable: (tile: number) => boolean;
  /** What this site has spare, as (cargo, tonnes) — the reason it wants a
   *  haulier. */
  /** Every cargo this place has spare, not merely its fullest shed. */
  surpluses: (site: number) => { cargo: number; tonnes: number }[];
  /** Somewhere that wants this cargo. */
  buyerFor: (cargo: number, notSite: number) => number;
  /** Pence a load, given the cargo and the distance. */
  rate: (cargo: number, distance: number) => number;
  /**
   * Could anything the player owns carry this?
   *
   * The board's first duty is to contain a job the player can actually take.
   * Without this the opening board was a quarry offering aggregate — which
   * needs a tipper the player neither owned nor could afford — so the first
   * thing the game did was show you one job and refuse to let you do it.
   */
  canCarry: (cargo: number) => boolean;
}

/**
 * Put work on the board.
 *
 * Deliberately few at a time. Twenty-four offers is a job board; four is a
 * decision. The old draft had a contract system that generated six a fortnight
 * and it read as a chore list, which is the failure mode this whole design is
 * trying to avoid.
 */
export function offerContracts(
  board: ContractBoard, ctx: OfferContext, want: number,
): number {
  let live = 0;
  for (let i = 0; i < board.count; i++) {
    if (board.state[i] === ContractState.Offered) live++;
  }
  let made = 0;

  /*
   * Two passes: work you can do, then everything else.
   *
   * The first pass only offers cargo something in your fleet can carry, so the
   * board always leads with a job you can take. The second fills the remaining
   * slots with anything, because a job you *cannot* do yet is not noise — it is
   * the reason to buy a tipper, and seeing the aggregate work sitting there is
   * how you learn that a tipper is a thing you might want.
   *
   * Order matters and only in one direction. Leading with work you can do is the
   * difference between a game that starts and a game that shows you one offer
   * and refuses it.
   */
  /*
   * Where the scan starts, and it must not always be site zero.
   *
   * The board holds six offers and a district holds twenty-odd places, so the
   * scan fills up long before it reaches the end — and starting from the same end
   * every time meant the same handful of low-numbered sites owned the board for
   * the whole game. Measured: fifty offers across three seeds drew on three
   * cargoes out of thirteen, and a village shop never once appeared as a
   * destination.
   *
   * Advancing the start with the clock gives every place its turn without
   * remembering anything, and the board becomes a rolling view of the district
   * rather than a fixed window onto the first five things the generator happened
   * to place.
   */
  const spin = ctx.siteCount > 0
    ? Math.floor(ctx.tick / 1000) % ctx.siteCount
    : 0;
  for (let pass = 0; pass < 2 && live + made < want; pass++) {
    for (let step = 0; step < ctx.siteCount && live + made < want; step++) {
      const site = (spin + step) % ctx.siteCount;
      const tile = ctx.siteTile(site);
      // Only inside the influence area. The fog and the job board are the same
      // mechanism seen twice: what you can see is what you can take.
      if (!ctx.usable(tile)) continue;
      /*
       * Every cargo the place has spare, not just its biggest heap.
       *
       * It used to ask for one — the fullest shed — and skip the site entirely if
       * it already had an offer. Which is fine for a works that makes one thing
       * and silently wrong for anything that makes two: an arable farm grows grain
       * *and* produce, grain is always the bigger heap, and so produce was never
       * offered anywhere in the district on any seed. The village shop that eats
       * it could not be supplied by contract at all, which is the sort of gap that
       * looks like a content problem and is a loop bound.
       */
      for (const spare of ctx.surpluses(site)) {
        if (live + made >= want) break;
        if (spare.tonnes <= 0) continue;
        if (board.hasOffer(site, spare.cargo)) continue;
        if (pass === 0 && !ctx.canCarry(spare.cargo)) continue;
        const buyer = ctx.buyerFor(spare.cargo, site);
        if (buyer === NONE) continue;
        if (!ctx.usable(ctx.siteTile(buyer))) continue;

        const dx = ctx.siteX(buyer) - ctx.siteX(site);
        const dy = ctx.siteY(buyer) - ctx.siteY(site);
        const distance = Math.round(Math.sqrt(dx * dx + dy * dy));
        if (distance < 3) continue;

        const id = board.alloc();
        if (id === NONE) break;
        board.state[id] = ContractState.Offered;
        board.from[id] = site;
        board.to[id] = buyer;
        board.cargo[id] = spare.cargo;
        board.distance[id] = distance;
        board.pay[id] = ctx.rate(spare.cargo, distance);
        board.service[id] = NONE;
        board.delivered[id] = 0;
        board.earned[id] = 0;
        board.tookTick[id] = 0;
        board.offeredTick[id] = ctx.tick;
        made++;
      }
    }
  }
  return made;
}
