/**
 * The authority builds its own road. features.md §12: "should be genuinely
 * frightening."
 *
 * This is the other half of the ownership spine, and the half that keeps the
 * first half honest. Owning the road somebody drives on turns their cost into
 * your income; the toll curve already means charging too much drives traffic
 * away; and design.md §3.7 adds a regulator for the player who is simply
 * winning. What none of those cover is the ordinary, historically commonplace
 * case: a turnpike on a busy corridor charges what the traffic will bear for
 * twenty years, and eventually the county builds a road beside it.
 *
 * That is the frightening one, because unlike regulation it does not care how
 * dominant you are. It cares that a corridor is important and that using it is
 * expensive, which are the two things that make a toll asset valuable in the
 * first place. Every pound of what makes the asset worth owning is also what
 * puts it on the authority's list.
 *
 * Three properties make it fair rather than merely punishing.
 *
 * It is slow, and it is announced. A scheme is proposed, sits in consultation
 * for years, and only then gets built — and the proposal names the corridor,
 * so a player who does not want the competition has time to drop the charge
 * and make the scheme not worth building.
 *
 * It withdraws. If the charge comes down while the scheme is in consultation,
 * the case for it evaporates and the authority drops it, because the case was
 * never "this operator is bad", it was "this passage is dear".
 *
 * And it competes rather than confiscating. The private road is still there
 * and still yours. What you have lost is the ability to price as though there
 * were no alternative — which, once there is an alternative, you have genuinely
 * lost.
 */

import { AUTHORITY, TICKS_PER_DAY } from './constants.ts';
import { NONE, type AssetTable } from './network.ts';

/** Charge per tile above which the authority starts taking an interest. Below
 *  it, a private road is a service; above it, it is a bottleneck. */
export const DEAR_CHARGE = 26;

/** And how much traffic makes a corridor matter enough to spend public money
 *  on. A dear road nobody uses is nobody's problem. */
export const BUSY_PASSES = 260;

/** Years a scheme sits in consultation before the diggers arrive. Long, on
 *  purpose: the player has to have time to see it coming and respond. */
export const CONSULTATION_YEARS = 6;

/** The authority does not do this before it has the money or the appetite.
 *  Era three is the municipal era in the design's table. */
export const PUBLIC_WORKS_FROM_ERA = 3;

export const SchemeState = {
  None: 0, Proposed: 1, Built: 2, Withdrawn: 3,
} as const;
export type SchemeState = (typeof SchemeState)[keyof typeof SchemeState];

export const MAX_SCHEMES = 24;

export class SchemeTable {
  count = 0;
  readonly state = new Uint8Array(MAX_SCHEMES);
  /** The private asset whose charge provoked it. */
  readonly against = new Int32Array(MAX_SCHEMES).fill(NONE);
  /** Where the public road would run. */
  readonly fromTile = new Int32Array(MAX_SCHEMES);
  readonly toTile = new Int32Array(MAX_SCHEMES);
  readonly proposedTick = new Int32Array(MAX_SCHEMES);
  readonly opensTick = new Int32Array(MAX_SCHEMES);

  open(against: number, from: number, to: number, tick: number, opens: number): number {
    if (this.count >= MAX_SCHEMES) return NONE;
    const id = this.count++;
    this.state[id] = SchemeState.Proposed;
    this.against[id] = against;
    this.fromTile[id] = from;
    this.toTile[id] = to;
    this.proposedTick[id] = tick;
    this.opensTick[id] = opens;
    return id;
  }
}

export interface PublicWorksReport {
  /** Schemes proposed this pass. */
  proposed: number[];
  /** Schemes whose consultation has ended and which should now be built. */
  build: number[];
  /** Schemes dropped because the case for them went away. */
  withdrawn: number[];
}

/**
 * One pass, once a year.
 *
 * Annual because the whole mechanism is measured in years: a scheme takes six
 * of them to come to anything, and a body that reconsidered its capital
 * programme every morning would not be an authority, it would be a mood.
 */
export function stepPublicWorks(
  schemes: SchemeTable,
  assets: AssetTable,
  era: number,
  tick: number,
  ticksPerYear: number,
  /** Where an asset runs from and to, or null if it cannot be surveyed. */
  endpointsOf: (asset: number) => { from: number; to: number } | null,
): PublicWorksReport {
  const out: PublicWorksReport = { proposed: [], build: [], withdrawn: [] };
  if (era < PUBLIC_WORKS_FROM_ERA) return out;

  // ---- schemes already in hand -----------------------------------------
  for (let i = 0; i < schemes.count; i++) {
    if (schemes.state[i] !== SchemeState.Proposed) continue;
    const asset = schemes.against[i];
    // The case has gone: the operator dropped the charge, sold up, or the
    // corridor went quiet. Withdraw, because the scheme was never about them.
    const stillDear = asset !== NONE
      && assets.owner[asset] !== AUTHORITY
      && assets.charge[asset] >= DEAR_CHARGE
      && assets.passesPrev[asset] >= BUSY_PASSES / 2;
    if (!stillDear) {
      schemes.state[i] = SchemeState.Withdrawn;
      out.withdrawn.push(i);
      continue;
    }
    if (tick >= schemes.opensTick[i]) {
      schemes.state[i] = SchemeState.Built;
      out.build.push(i);
    }
  }

  // ---- and whether to start another ------------------------------------
  // One at a time. A public works programme that opens six schemes in a year
  // is not an antagonist, it is a natural disaster.
  let live = 0;
  for (let i = 0; i < schemes.count; i++) if (schemes.state[i] === SchemeState.Proposed) live++;
  if (live > 0) return out;

  let worst = NONE;
  let worstCase = 0;
  for (let a = 0; a < assets.count; a++) {
    if (assets.owner[a] === AUTHORITY) continue;
    if (assets.charge[a] < DEAR_CHARGE) continue;
    if (assets.passesPrev[a] < BUSY_PASSES) continue;
    // Already the subject of a scheme, live or built.
    let taken = false;
    for (let i = 0; i < schemes.count; i++) {
      if (schemes.against[i] === a && schemes.state[i] !== SchemeState.Withdrawn) { taken = true; break; }
    }
    if (taken) continue;
    // What the travelling public is paying to use it. This is the case for
    // the scheme, and it is exactly the number that makes the asset a good
    // investment — which is the point.
    const cost = assets.charge[a] * assets.passesPrev[a];
    if (cost > worstCase) {
      worstCase = cost;
      worst = a;
    }
  }
  if (worst === NONE) return out;
  const ends = endpointsOf(worst);
  if (!ends) return out;

  const id = schemes.open(
    worst, ends.from, ends.to, tick, tick + CONSULTATION_YEARS * ticksPerYear,
  );
  if (id !== NONE) out.proposed.push(id);
  return out;
}

export { TICKS_PER_DAY };
