/**
 * The command model. architecture.md §2.
 *
 *   Command = { tick, issuer, kind, payload }
 *   applyCommand(state, command) -> void
 *
 * The UI never mutates state. It issues commands, queued to a future tick.
 * Rivals issue the same commands through the same path — which is why
 * design.md §2.5 can say rivals are not special and mean it. The command log
 * plus the seed fully determines the world, so a save is a few kilobytes, a
 * replay is free, and a bug report is reproducible.
 *
 * One consequence worth stating because it is easy to lose later: a junction
 * blueprint is a short command sequence, so blueprint sharing is nearly free.
 */

export const Cmd = {
  // --- time and camera ---------------------------------------------------
  SetSpeed: 1,
  /** Camera position, fed in as a command so the LOD rules can live in the
   *  sim without the renderer ever writing to sim state (rule 6). */
  Focus: 2,

  // --- fleet -------------------------------------------------------------
  BuyVehicle: 10,
  SellVehicle: 11,
  AssignVehicle: 12,
  UnassignVehicle: 13,
  RenameVehicle: 14,

  // --- services ----------------------------------------------------------
  CreateService: 20,
  DeleteService: 21,
  AddStop: 22,
  RemoveStop: 23,
  SetServiceActive: 24,
  RenameService: 25,

  // --- contracts ---------------------------------------------------------
  BidContract: 30,
  DropContract: 31,

  // --- construction (Act II) ---------------------------------------------
  BuildWay: 40,
  DemolishWay: 41,
  SetNodeControl: 42,
  BuildStation: 43,
  ApplyBlueprint: 44,

  // --- ownership (Act II) ------------------------------------------------
  BuyAsset: 50,
  SellAsset: 51,
  SetCharge: 52,
  ListAsset: 53,

  // --- access agreements (Act IV, and shared worlds) ---------------------
  /** a: the other company. b: rate as a percentage of the standard charge.
   *  c: 1 if you are the one granting it, 0 if you are asking. */
  OfferAgreement: 54,
  AcceptAgreement: 55,
  DeclineAgreement: 56,
  WithdrawAgreement: 57,

  // --- industry (Act III) ------------------------------------------------
  FoundIndustry: 60,
  DemolishSite: 61,
  /** Pay to restore the ground around a tile. design.md 2.3: the late game
   *  gets a redemption arc rather than only a ratchet. */
  Remediate: 62,
  /** Make more region. features.md 13: the one thing that edits the map. */
  Reclaim: 63,
  /** Rebuild a works to current practice. features.md 4. */
  Modernise: 64,

  // --- meta --------------------------------------------------------------
  GrantCharter: 70,
  DeclareBankrupt: 71,
  /** Regulation, design.md §3.7. Issued by the authority, not the player. */
  RegulateCharge: 72,
  CompulsoryPurchase: 73,
} as const;
export type Cmd = (typeof Cmd)[keyof typeof Cmd];

export interface Command {
  tick: number;
  issuer: number;
  kind: number;
  /** Four integer slots covers almost everything and keeps the log compact. */
  a: number;
  b: number;
  c: number;
  d: number;
  /** Only for the handful of commands that genuinely need more: a tile list
   *  for a road, a name, a blueprint. */
  data?: number[] | string;
}

export function cmd(
  tick: number, issuer: number, kind: number,
  a = 0, b = 0, c = 0, d = 0, data?: number[] | string,
): Command {
  return { tick, issuer, kind, a, b, c, d, data };
}

/**
 * The queue. Commands are held until their tick, then applied in a fixed
 * order: by tick, then issuer, then arrival sequence. The sequence number is
 * what makes two commands from the same issuer on the same tick apply in the
 * order they were made, on every machine, regardless of which arrived first
 * over the network.
 */
export class CommandQueue {
  private pending: (Command & { seq: number })[] = [];
  private seq = 0;
  /** The authoritative log. A save is this plus the seed. */
  readonly log: Command[] = [];

  /**
   * Queue a command, and record it in the log unless it is one the world will
   * regenerate for itself.
   *
   * A rival's decisions are a pure function of the seed and the world, so
   * logging them stores something the replay is going to work out again
   * anyway — and worse, then *does* work out again, applying every AI action
   * twice. That is precisely what happened: the save/replay check passed for
   * as long as the rival AI was too broken to act, and started failing the
   * moment it began issuing commands. architecture.md 2 says the command log
   * plus the seed determines the world; rivals are on the seed's side of that
   * sentence, not the log's.
   *
   * It also makes a save smaller, which is a nice-to-have rather than the
   * reason.
   */
  push(c: Command, record = true): void {
    this.pending.push({ ...c, seq: this.seq++ });
    if (record) this.log.push(c);
  }

  /** Load a log without re-issuing it — used when replaying a save. */
  loadLog(commands: readonly Command[]): void {
    for (const c of commands) {
      this.pending.push({ ...c, seq: this.seq++ });
      this.log.push(c);
    }
    this.sort();
  }

  private sort(): void {
    this.pending.sort((x, y) => x.tick - y.tick || x.issuer - y.issuer || x.seq - y.seq);
  }

  /** Everything due at or before `tick`, in canonical order. */
  drain(tick: number): Command[] {
    if (this.pending.length === 0) return EMPTY;
    this.sort();
    let n = 0;
    while (n < this.pending.length && this.pending[n].tick <= tick) n++;
    if (n === 0) return EMPTY;
    const out = this.pending.splice(0, n);
    return out;
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}

const EMPTY: Command[] = [];

/** Serialise the log compactly. A tick, issuer, kind and four small integers
 *  fit in a line of text; the data slot is rare enough to spell out. */
export function encodeLog(log: readonly Command[]): string {
  const out: string[] = [];
  for (const c of log) {
    let line = `${c.tick},${c.issuer},${c.kind},${c.a},${c.b},${c.c},${c.d}`;
    if (c.data !== undefined) {
      line += typeof c.data === 'string' ? `,s${c.data.replace(/[,\n]/g, ' ')}` : `,i${c.data.join(' ')}`;
    }
    out.push(line);
  }
  return out.join('\n');
}

export function decodeLog(text: string): Command[] {
  const out: Command[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const parts = line.split(',');
    const c: Command = {
      tick: +parts[0], issuer: +parts[1], kind: +parts[2],
      a: +parts[3], b: +parts[4], c: +parts[5], d: +parts[6],
    };
    if (parts.length > 7) {
      const raw = parts.slice(7).join(',');
      c.data = raw[0] === 's' ? raw.slice(1) : raw.slice(1).split(' ').filter(Boolean).map(Number);
    }
    out.push(c);
  }
  return out;
}
