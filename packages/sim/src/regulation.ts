/**
 * The regulator. design.md §3.7, and the antagonist Phase 4 is gated on.
 *
 * The ownership economy has a shape that is good for the first three acts and
 * bad for the fourth. Owning the road somebody else drives on turns their cost
 * into your income, which is the whole design; but the same rule applied for a
 * century says that whoever gets there first owns the region, rivals die,
 * nobody is left to pay the tolls, and the map stops being interesting. R6 in
 * risks.md calls this the snowball.
 *
 * Two diegetic dampers already exist — traffic leaves a road that charges too
 * much, and an asset is valued on its earnings so a busy one is expensive to
 * buy. They are real but they are not enough, because they only bite a player
 * who is greedy rather than one who is simply winning.
 *
 * So from era five the authority grows teeth, which is what actually happened:
 * the Railway and Canal Traffic Acts, the Transport Act, and the competition
 * regimes that followed. A dominant operator acquires a regulator.
 *
 * The roadmap gates this phase on being regulated feeling *earned*. That rules
 * out a random hostile event, and it rules out a threshold the player cannot
 * see coming. So:
 *
 *   - dominance is measured on things the player already watches, namely how
 *     much of the region's way they own and how much of its carrying trade
 *     they do
 *   - it is measured over a long window, so one good year is not an offence
 *   - the response escalates, and every step is announced before the next
 *   - every step could have been avoided by not doing the thing that caused
 *     it, and can still be undone by selling or by charging less
 *
 * The escalation is deliberately slow. A regulator that moves in a season is a
 * random event wearing a costume.
 */

import { AUTHORITY, TICKS_PER_DAY } from './constants.ts';
import { Line, LINE_COUNT, type CompanyTable } from './economy.ts';
import { NONE, type AssetTable } from './network.ts';

/** No intervention below this share of the region's way, however profitable. */
export const DOMINANCE_TILES = 0.42;

/** Or this share of the region's carrying trade. */
export const DOMINANCE_TRADE = 0.55;

/** Days of sustained dominance before the regulator moves a step. */
export const PATIENCE_DAYS = 420;

/** Days of good behaviour before a step is relaxed again. */
export const REMISSION_DAYS = 300;

/** The era the authority gains its powers. The design's era table puts waste
 *  regulation in era five, and this arrives alongside it. */
export const REGULATOR_FROM_ERA = 5;

export const Intervention = {
  /** Nothing. Most companies live here forever. */
  None: 0,
  /** A competition referral: a letter, a deadline, and no penalty yet. */
  Referral: 1,
  /** Charges capped on everything the company owns. */
  ChargeCap: 2,
  /** Rivals may use its way at the capped rate whether it likes it or not. */
  OpenAccess: 3,
  /** The authority buys an asset at a fair price, for sale or not. */
  CompulsoryPurchase: 4,
} as const;
export type Intervention = (typeof Intervention)[keyof typeof Intervention];

export const INTERVENTION_NAMES = [
  'None', 'Competition referral', 'Charge cap', 'Open access', 'Compulsory purchase',
];

/** What a capped charge may be, per tile. Generous enough to stay a business,
 *  low enough that the monopoly stops paying for itself. */
export const CAPPED_CHARGE = 12;

export const MAX_REGULATED = 64;

export class RegulatorTable {
  /** Current step, per company. */
  readonly level = new Uint8Array(MAX_REGULATED);
  /** Ticks the company has been over a threshold without relief. */
  readonly pressure = new Int32Array(MAX_REGULATED);
  /** Ticks it has been under, which is what walks the level back down. */
  readonly relief = new Int32Array(MAX_REGULATED);
  /** Share of the region's way, as a percentage, for the panel. */
  readonly tileShare = new Uint8Array(MAX_REGULATED);
  /** Share of the region's carrying trade, likewise. */
  readonly tradeShare = new Uint8Array(MAX_REGULATED);
  /** When the current level was reached, so the interface can say "since". */
  readonly since = new Int32Array(MAX_REGULATED);
}

export interface RegulatorReport {
  /** Companies whose level changed this pass, and which way it went. */
  changed: { company: number; level: number; up: boolean }[];
  /** Assets taken into public ownership this pass. */
  purchased: number[];
}

/**
 * One pass, once a day.
 *
 * Measurement first, then a single step in one direction. Never more than one
 * step a day and never more than one per company, because a regulator that
 * escalates twice before the player has read the first letter is not an
 * antagonist, it is a bug.
 */
export function stepRegulator(
  reg: RegulatorTable,
  assets: AssetTable,
  companies: CompanyTable,
  era: number,
  tick: number,
  valuationPct: number,
  onPurchase: (asset: number, from: number, price: number) => void,
): RegulatorReport {
  const out: RegulatorReport = { changed: [], purchased: [] };

  // ---- measure ----------------------------------------------------------
  let regionTiles = 0;
  const tilesBy = new Float64Array(companies.count);
  for (let a = 0; a < assets.count; a++) {
    const t = assets.tiles[a];
    regionTiles += t;
    const o = assets.owner[a];
    if (o !== AUTHORITY && o >= 0 && o < companies.count) tilesBy[o] += t;
  }

  let regionTrade = 0;
  const tradeBy = new Float64Array(companies.count);
  for (let c = 0; c < companies.count; c++) {
    const base = c * LINE_COUNT;
    const v = companies.ledgerYear[base + Line.Haulage]
      + companies.ledgerYear[base + Line.AccessCharged];
    tradeBy[c] = v;
    regionTrade += v;
  }

  for (let c = 0; c < companies.count && c < MAX_REGULATED; c++) {
    const tileShare = regionTiles > 0 ? tilesBy[c] / regionTiles : 0;
    const tradeShare = regionTrade > 0 ? tradeBy[c] / regionTrade : 0;
    reg.tileShare[c] = Math.round(tileShare * 100);
    reg.tradeShare[c] = Math.round(tradeShare * 100);
    const dominant = tileShare > DOMINANCE_TILES || tradeShare > DOMINANCE_TRADE;

    if (era < REGULATOR_FROM_ERA || companies.bankrupt[c]) {
      /*
       * Powers the authority does not have yet. Pressure still accumulates in
       * the era before, at a quarter rate: a company that spent the whole of
       * Act III buying the region should not get a clean sheet on the day the
       * Act comes in, but it was not against the rules at the time and the
       * first letter should still take a while to arrive.
       */
      if (era === REGULATOR_FROM_ERA - 1 && dominant) reg.pressure[c] += TICKS_PER_DAY / 4;
      continue;
    }

    if (dominant) {
      reg.pressure[c] += TICKS_PER_DAY;
      reg.relief[c] = 0;
    } else {
      reg.relief[c] += TICKS_PER_DAY;
      reg.pressure[c] = Math.max(0, reg.pressure[c] - TICKS_PER_DAY);
    }

    if (dominant && reg.pressure[c] >= PATIENCE_DAYS * TICKS_PER_DAY
      && reg.level[c] < Intervention.CompulsoryPurchase) {
      reg.level[c]++;
      reg.pressure[c] = 0;
      reg.since[c] = tick;
      out.changed.push({ company: c, level: reg.level[c], up: true });
    } else if (!dominant && reg.relief[c] >= REMISSION_DAYS * TICKS_PER_DAY && reg.level[c] > 0) {
      // Behave, and it is lifted a step at a time. A regulator that never lets
      // go turns one decision in 1980 into a permanent tax, and the player
      // stops believing their choices matter.
      reg.level[c]--;
      reg.relief[c] = 0;
      reg.since[c] = tick;
      out.changed.push({ company: c, level: reg.level[c], up: false });
    }

    // ---- apply ----------------------------------------------------------
    if (reg.level[c] >= Intervention.ChargeCap) {
      for (let a = 0; a < assets.count; a++) {
        if (assets.owner[a] !== c) continue;
        if (assets.charge[a] > CAPPED_CHARGE) assets.charge[a] = CAPPED_CHARGE;
      }
    }
    if (reg.level[c] >= Intervention.CompulsoryPurchase && tick % (TICKS_PER_DAY * 120) === 0) {
      /*
       * The busiest thing they own, because that is the one the region depends
       * on and the one the referral was about. Bought at the same valuation
       * anybody else would pay: this is a purchase, not a seizure, and the
       * difference matters both morally and mechanically — a player who is
       * compulsorily purchased is not ruined, they are bought out, and they
       * still have the money to go and do something else with it.
       */
      let busiest = NONE;
      let busiestPasses = -1;
      for (let a = 0; a < assets.count; a++) {
        if (assets.owner[a] !== c) continue;
        if (assets.passesPrev[a] > busiestPasses) {
          busiestPasses = assets.passesPrev[a];
          busiest = a;
        }
      }
      if (busiest !== NONE) {
        onPurchase(busiest, c, assets.valuation(busiest, valuationPct));
        out.purchased.push(busiest);
      }
    }
  }
  return out;
}

/**
 * What this asset may charge for passage.
 *
 * Open access is the step where the regulator stops asking. Below it an asset
 * is private property and its owner sets the price; at it, the way becomes
 * common carriage at the capped rate, which is what forced open access means
 * and what the Acts actually did.
 */
export function accessChargeFor(reg: RegulatorTable, assets: AssetTable, asset: number): number {
  const owner = assets.owner[asset];
  if (owner === AUTHORITY || owner < 0 || owner >= MAX_REGULATED) return assets.charge[asset];
  if (reg.level[owner] >= Intervention.OpenAccess) {
    return Math.min(assets.charge[asset], CAPPED_CHARGE);
  }
  return assets.charge[asset];
}
