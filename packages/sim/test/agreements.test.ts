/**
 * Access agreements, and the one rule that makes them safe.
 *
 * design.md §3.10 lists differential rates as an open question — "enormously
 * characterful, possibly too fiddly, and a griefing vector in multiplayer" —
 * and the resolution is that an agreement may only ever make passage cheaper
 * and both sides have to sign it. Most of what follows is that sentence,
 * checked, because it is the difference between a feature and a weapon.
 */

import { describe, expect, it } from 'vitest';
import {
  AgreementTable, AgreementState, propose, accept, decline, withdraw,
  agreedCharge, stepAgreements, mustAnswer, MAX_RATE_PCT, OFFER_YEARS,
  DEFAULT_TERM_YEARS, TICKS_PER_YEAR,
} from '../src/index.ts';

describe('proposing', () => {
  it('lets an owner offer a discount', () => {
    const t = new AgreementTable();
    const id = propose(t, 1, 1, 2, 50, 0);
    expect(id).toBeGreaterThanOrEqual(0);
    expect(t.state[id]).toBe(AgreementState.Offered);
    // The owner proposed, so the haulier is the one who has to answer.
    expect(mustAnswer(t, id)).toBe(2);
  });

  it('lets a haulier ask for one', () => {
    const t = new AgreementTable();
    const id = propose(t, 2, 1, 2, 50, 0);
    expect(id).toBeGreaterThanOrEqual(0);
    // The haulier asked, so the owner is the one who has to answer.
    expect(mustAnswer(t, id)).toBe(1);
  });

  it('refuses terms worse than everybody else gets', () => {
    /*
     * The whole griefing vector in one assertion. There is no way to single a
     * rival out for a punitive rate, because the worst anybody can be made to
     * pay is the posted charge.
     */
    const t = new AgreementTable();
    expect(propose(t, 1, 1, 2, MAX_RATE_PCT + 1, 0)).toBe(-1);
    expect(propose(t, 1, 1, 2, 400, 0)).toBe(-1);
    expect(propose(t, 1, 1, 2, -10, 0)).toBe(-1);
  });

  it('refuses a proposal from somebody who is not party to it', () => {
    const t = new AgreementTable();
    expect(propose(t, 3, 1, 2, 50, 0)).toBe(-1);
  });

  it('refuses an agreement with yourself, and two at once for a pair', () => {
    const t = new AgreementTable();
    expect(propose(t, 1, 1, 1, 50, 0)).toBe(-1);
    expect(propose(t, 1, 1, 2, 50, 0)).toBeGreaterThanOrEqual(0);
    expect(propose(t, 1, 1, 2, 20, 0)).toBe(-1);
  });
});

describe('answering', () => {
  it('takes effect only when the other side accepts', () => {
    const t = new AgreementTable();
    const id = propose(t, 1, 1, 2, 40, 0);
    // Nothing changes while it is merely on the table.
    expect(agreedCharge(t, 1, 2, 100)).toBe(100);
    expect(accept(t, id, 2, 10)).toBe(true);
    expect(agreedCharge(t, 1, 2, 100)).toBe(40);
  });

  it('cannot be accepted by the side that proposed it', () => {
    const t = new AgreementTable();
    const id = propose(t, 1, 1, 2, 40, 0);
    expect(accept(t, id, 1, 10)).toBe(false);
    expect(agreedCharge(t, 1, 2, 100)).toBe(100);
  });

  it('can be declined, and then the pair is free to try again', () => {
    const t = new AgreementTable();
    const first = propose(t, 1, 1, 2, 40, 0);
    expect(decline(t, first, 2)).toBe(true);
    expect(propose(t, 1, 1, 2, 70, 0)).toBeGreaterThanOrEqual(0);
  });

  it('lapses if nobody answers', () => {
    const t = new AgreementTable();
    const id = propose(t, 1, 1, 2, 40, 0);
    const later = (OFFER_YEARS + 1) * TICKS_PER_YEAR;
    const report = stepAgreements(t, later);
    expect(report.lapsed).toContain(id);
    expect(accept(t, id, 2, later)).toBe(false);
  });
});

describe('living with one', () => {
  it('applies only to the pair it was struck between', () => {
    const t = new AgreementTable();
    const id = propose(t, 1, 1, 2, 25, 0);
    accept(t, id, 2, 0);
    expect(agreedCharge(t, 1, 2, 200)).toBe(50);
    // Not to a third company, and not in the other direction.
    expect(agreedCharge(t, 1, 3, 200)).toBe(200);
    expect(agreedCharge(t, 2, 1, 200)).toBe(200);
  });

  it('never charges an owner for their own way, deal or no deal', () => {
    const t = new AgreementTable();
    expect(agreedCharge(t, 1, 1, 200)).toBe(200);
  });

  it('runs out, and has to be renewed deliberately', () => {
    const t = new AgreementTable();
    const id = propose(t, 1, 1, 2, 25, 0);
    accept(t, id, 2, 0);
    const later = DEFAULT_TERM_YEARS * TICKS_PER_YEAR + 1;
    const report = stepAgreements(t, later);
    expect(report.ended).toContain(id);
    expect(agreedCharge(t, 1, 2, 200)).toBe(200);
  });

  it('can be ended early by the side that granted it, and only that side', () => {
    const t = new AgreementTable();
    const id = propose(t, 1, 1, 2, 25, 0);
    accept(t, id, 2, 0);
    // The concession is the grantor's to give and theirs to stop. A
    // beneficiary who wants out simply stops using the way.
    expect(withdraw(t, id, 2)).toBe(false);
    expect(withdraw(t, id, 1)).toBe(true);
    expect(agreedCharge(t, 1, 2, 200)).toBe(200);
  });

  it('allows free passage, which is what a reciprocal deal looks like', () => {
    const t = new AgreementTable();
    const a = propose(t, 1, 1, 2, 0, 0);
    accept(t, a, 2, 0);
    const b = propose(t, 2, 2, 1, 0, 0);
    accept(t, b, 1, 0);
    expect(agreedCharge(t, 1, 2, 500)).toBe(0);
    expect(agreedCharge(t, 2, 1, 500)).toBe(0);
  });
});
