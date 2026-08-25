/**
 * Access agreements. design.md §3.6, and the Phase 5 line about them falling
 * out of the ownership spine.
 *
 * They do fall out of it, but not for free, and the shape is the interesting
 * part. §3.10 lists differential rates — cheaper for allies, punitive for one
 * rival — as an open question, "enormously characterful, possibly too fiddly,
 * and a griefing vector in multiplayer". That is the right worry and it has a
 * clean answer: **an agreement can only ever make passage cheaper, and both
 * sides have to sign it.**
 *
 * Both halves matter. Opt-in on both sides means nobody can have terms imposed
 * on them, so there is nothing to grief with. And a floor of the standard rate
 * means the characterful half survives — "use my line at half price and I will
 * use your port at half price" is a deal two players can strike and a deal an
 * AI can offer — while the punitive half, which is the part that would have
 * been a weapon, simply does not exist. You cannot single somebody out for a
 * worse rate; the worst anybody pays is what everybody pays.
 *
 * That is also why this is a Phase 5 feature rather than a Phase 2 one. In a
 * single-player region an agreement is a mild convenience. Between two people
 * it is the thing design.md means by *entangling* them: it turns "I use your
 * line; you use my port" from a description into a contract, and it makes the
 * standing threat of a buyout land differently when the person who would buy
 * you out is also the person whose port you depend on.
 */

import { TICKS_PER_YEAR } from './constants.ts';

export const MAX_AGREEMENTS = 64;

export const AgreementState = {
  /** Proposed by one side, waiting on the other. */
  Offered: 0,
  Active: 1,
  Declined: 2,
  Expired: 3,
  /** Ended early by whoever granted it. */
  Withdrawn: 4,
} as const;
export type AgreementState = (typeof AgreementState)[keyof typeof AgreementState];

export const AGREEMENT_STATE_NAMES = ['Offered', 'Active', 'Declined', 'Expired', 'Withdrawn'];

/** The best terms anybody may be given: free passage. */
export const MIN_RATE_PCT = 0;

/** And the worst: exactly what everybody else pays. An agreement is a
 *  concession, never a penalty — see the note above about griefing. */
export const MAX_RATE_PCT = 100;

/** How long a deal runs before it has to be renewed. Long enough to plan a
 *  network around, short enough that it is a relationship rather than a
 *  permanent feature of the map. */
export const DEFAULT_TERM_YEARS = 10;

/** And how long an unanswered offer stays on the table. */
export const OFFER_YEARS = 2;

export class AgreementTable {
  count = 0;
  readonly state = new Uint8Array(MAX_AGREEMENTS);
  /** Who owns the way, and therefore who is granting the terms. */
  readonly grantor = new Int16Array(MAX_AGREEMENTS);
  /** Who gets to use it more cheaply. */
  readonly beneficiary = new Int16Array(MAX_AGREEMENTS);
  /** Percentage of the standard charge the beneficiary pays. */
  readonly ratePct = new Int32Array(MAX_AGREEMENTS);
  /** Who proposed it, which decides who has to answer. */
  readonly proposer = new Int16Array(MAX_AGREEMENTS);
  readonly offeredTick = new Int32Array(MAX_AGREEMENTS);
  readonly startTick = new Int32Array(MAX_AGREEMENTS);
  readonly endTick = new Int32Array(MAX_AGREEMENTS);

  private free: number[] = [];

  alloc(): number {
    if (this.free.length > 0) return this.free.pop() as number;
    if (this.count >= MAX_AGREEMENTS) return -1;
    return this.count++;
  }

  release(id: number): void {
    this.free.push(id);
  }

  /** The live agreement covering this pair, if there is one. */
  find(grantor: number, beneficiary: number): number {
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] !== AgreementState.Active) continue;
      if (this.grantor[i] === grantor && this.beneficiary[i] === beneficiary) return i;
    }
    return -1;
  }

  /** Everything either side of a company's dealings, for the interface. */
  involving(company: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] === AgreementState.Declined) continue;
      if (this.grantor[i] === company || this.beneficiary[i] === company) out.push(i);
    }
    return out;
  }
}

export interface AgreementReport {
  /** Offers that lapsed unanswered, and terms that ran their course. */
  lapsed: number[];
  ended: number[];
}

/**
 * Age the agreements, once a day.
 *
 * An unanswered offer lapses rather than sitting on the board for a century,
 * and a term ends rather than becoming a permanent feature of the map that
 * nobody remembers agreeing to. Both need renewing deliberately, which is what
 * makes them a relationship.
 */
export function stepAgreements(table: AgreementTable, tick: number): AgreementReport {
  const out: AgreementReport = { lapsed: [], ended: [] };
  for (let i = 0; i < table.count; i++) {
    if (table.state[i] === AgreementState.Offered
      && tick - table.offeredTick[i] > OFFER_YEARS * TICKS_PER_YEAR) {
      table.state[i] = AgreementState.Expired;
      out.lapsed.push(i);
    } else if (table.state[i] === AgreementState.Active && tick >= table.endTick[i]) {
      table.state[i] = AgreementState.Expired;
      out.ended.push(i);
    }
  }
  return out;
}

/**
 * What a company pays to cross an asset, given who owns it.
 *
 * Returns the charge unchanged when there is no deal, which is the ordinary
 * case and has to stay the fast one — this is consulted on every link entry
 * by every vehicle in the region.
 */
export function agreedCharge(
  table: AgreementTable, owner: number, payer: number, charge: number,
): number {
  if (owner === payer || table.count === 0) return charge;
  const id = table.find(owner, payer);
  if (id < 0) return charge;
  return Math.round((charge * table.ratePct[id]) / 100);
}

/**
 * Propose terms. Returns the agreement, or -1 if the proposal is not one the
 * rules allow.
 *
 * Either side may propose: an owner offering a discount, or a haulier asking
 * for one. Which of the two it is decides who has to answer, and that is the
 * whole of the negotiation — there is no haggling, because a counter-offer is
 * just another proposal.
 */
export function propose(
  table: AgreementTable,
  proposer: number,
  grantor: number,
  beneficiary: number,
  ratePct: number,
  tick: number,
  termYears = DEFAULT_TERM_YEARS,
): number {
  if (grantor === beneficiary) return -1;
  if (proposer !== grantor && proposer !== beneficiary) return -1;
  // Never worse than the standing rate. This is the line that removes the
  // griefing vector 3.10 worries about: an agreement is a concession.
  if (ratePct < MIN_RATE_PCT || ratePct > MAX_RATE_PCT) return -1;
  // One live arrangement per pair, so terms cannot be stacked or confused.
  for (let i = 0; i < table.count; i++) {
    if (table.state[i] !== AgreementState.Active && table.state[i] !== AgreementState.Offered) continue;
    if (table.grantor[i] === grantor && table.beneficiary[i] === beneficiary) return -1;
  }
  const id = table.alloc();
  if (id < 0) return -1;
  table.state[id] = AgreementState.Offered;
  table.grantor[id] = grantor;
  table.beneficiary[id] = beneficiary;
  table.ratePct[id] = ratePct;
  table.proposer[id] = proposer;
  table.offeredTick[id] = tick;
  table.startTick[id] = 0;
  table.endTick[id] = tick + termYears * TICKS_PER_YEAR;
  return id;
}

/** Whoever did not propose it is the one who has to answer. */
export function mustAnswer(table: AgreementTable, id: number): number {
  return table.proposer[id] === table.grantor[id] ? table.beneficiary[id] : table.grantor[id];
}

export function accept(table: AgreementTable, id: number, by: number, tick: number, termYears = DEFAULT_TERM_YEARS): boolean {
  if (id < 0 || id >= table.count) return false;
  if (table.state[id] !== AgreementState.Offered) return false;
  if (mustAnswer(table, id) !== by) return false;
  table.state[id] = AgreementState.Active;
  table.startTick[id] = tick;
  table.endTick[id] = tick + termYears * TICKS_PER_YEAR;
  return true;
}

export function decline(table: AgreementTable, id: number, by: number): boolean {
  if (id < 0 || id >= table.count) return false;
  if (table.state[id] !== AgreementState.Offered) return false;
  if (mustAnswer(table, id) !== by) return false;
  table.state[id] = AgreementState.Declined;
  table.release(id);
  return true;
}

/**
 * End a live agreement early.
 *
 * Only the grantor may, and that asymmetry is deliberate: the concession is
 * theirs to give and theirs to stop. A beneficiary who wants out can simply
 * stop using the way, which costs them nothing.
 */
export function withdraw(table: AgreementTable, id: number, by: number): boolean {
  if (id < 0 || id >= table.count) return false;
  if (table.state[id] !== AgreementState.Active) return false;
  if (table.grantor[id] !== by) return false;
  table.state[id] = AgreementState.Withdrawn;
  table.release(id);
  return true;
}
