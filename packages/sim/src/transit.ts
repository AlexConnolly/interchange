/**
 * Whether people actually take the bus. features.md §2.
 *
 * Four rows of that table are really one mechanism, and building them
 * separately would have produced four unrelated multipliers:
 *
 *   passenger comfort, journey time, reliability
 *   private car adoption from era 4
 *   commuter rail and park-and-ride
 *   airports as passenger gateways
 *
 * The note against the first says it plainly — *people will not take a slow
 * miserable route; they stay home or drive* — and the note against the second
 * says why it matters: the car is "the pressure that makes public transport a
 * real fight". So passengers are not a cargo that sits at a stop waiting to be
 * collected. They are a *choice*, and the number who choose you depends on how
 * good the service is against how good the alternative has become.
 *
 * Before era four the alternative is walking, and a bad service still beats
 * that for anything but the shortest journey. From era four the alternative is
 * a car, it improves every era, and a service that was adequate in 1930 loses
 * its traffic by 1970 without anybody doing anything to it. That is the fight.
 *
 * Park-and-ride falls out rather than being built: a town served by both road
 * and rail scores better than the sum of the two, because the combination is
 * what makes a commute work — drive to the station, take the train in. It is
 * one line here and it is the whole of the feature.
 */

import { MODE_COUNT, Mode } from './constants.ts';
import { NONE } from './network.ts';
import type { TownTable } from './sites.ts';

/** Below this, a service is not worth leaving the house for. */
export const MIN_USEFUL_QUALITY = 12;

/** The era the motor car becomes an ordinary thing to own. */
export const CAR_ERA = 4;

/**
 * How much of a town's travel the car takes when the alternative is hopeless,
 * per era from CAR_ERA onward. Ends just short of everything: even in 2100
 * some people cannot drive, and a town with no service at all still has them.
 */
const CAR_CEILING = [0, 0, 0, 0.45, 0.62, 0.74, 0.82, 0.88];

export interface TransitContext {
  era: number;
  /** How many services call at this town with something that carries people,
   *  and what their round trips are. */
  serviceCount: (town: number) => number;
  /** Mean round trip of those services, in ticks. Shorter is better, and it
   *  is the single best proxy for both journey time and how often a bus
   *  actually turns up. */
  meanRoundTrip: (town: number) => number;
  /** Which modes reach this town with a passenger service. */
  modes: (town: number) => number;
  /** A reference round trip, against which a service is judged good or slow. */
  referenceRoundTrip: number;
}

/**
 * Score the service at every town, 0..100.
 *
 * Three things, and they are the three the feature table names. Frequency,
 * from how many services call. Journey time, from how long their round trips
 * are — a route that takes a season is not a commute whatever else is true of
 * it. And the combination bonus, which is park-and-ride.
 */
export function scoreTransit(towns: TownTable, ctx: TransitContext): void {
  for (let t = 0; t < towns.count; t++) {
    const services = ctx.serviceCount(t);
    if (services === 0) {
      towns.transitQuality[t] = 0;
      continue;
    }
    // Frequency: the second service is worth much more than the fifth.
    const frequency = Math.min(60, Math.round(60 * (1 - Math.pow(0.55, services))));

    // Journey time, against a reference. A route at the reference scores
    // about half; twice as fast approaches full marks; four times as slow is
    // worth almost nothing.
    const lap = ctx.meanRoundTrip(t);
    const speed = lap <= 0 ? 0
      : Math.max(0, Math.min(30, Math.round(30 * (ctx.referenceRoundTrip / (lap + ctx.referenceRoundTrip)) * 2)));

    /*
     * And the modes. Road alone is a bus; rail alone is a station somebody has
     * to reach; both together is a commute, and that combination is worth more
     * than either part — which is what park-and-ride means and the whole of
     * why it is listed as a feature.
     */
    const modes = ctx.modes(t);
    const hasRoad = (modes & (1 << Mode.Road)) !== 0;
    const hasRail = (modes & (1 << Mode.Rail)) !== 0;
    const hasAir = (modes & (1 << Mode.Air)) !== 0;
    let combination = 0;
    if (hasRoad && hasRail) combination += 10;
    // An airport is a gateway rather than a commute: it adds reach, not
    // frequency, so it is worth less here than a station and never nothing.
    if (hasAir) combination += 4;

    towns.transitQuality[t] = Math.max(0, Math.min(100, frequency + speed + combination));
  }
}

/**
 * The share of a town's travel that goes by car rather than by anybody's
 * service.
 *
 * Zero before the motor car, and after it a function of how bad the
 * alternative is. A town with an excellent service keeps most of its traffic
 * even in 2100; a town with nothing loses nearly all of it — and the loss is
 * not a penalty applied to the operator, it is people making a reasonable
 * decision, which is why it reads as pressure rather than as a tax.
 */
export function carShare(era: number, quality: number): number {
  const ceiling = CAR_CEILING[Math.max(0, Math.min(CAR_CEILING.length - 1, era))] ?? 0.88;
  if (ceiling <= 0) return 0;
  const good = Math.max(0, Math.min(1, quality / 100));
  // Quadratic, so the last stretch of quality is worth more than the first:
  // going from hopeless to poor saves few journeys, and going from good to
  // excellent saves many.
  return ceiling * (1 - good * good);
}

/** A bitmask of the modes that reach a town, for the score above. */
export function modeMask(towns: TownTable, town: number, has: (mode: number) => boolean): number {
  let mask = 0;
  for (let m = 0; m < MODE_COUNT; m++) if (has(m)) mask |= 1 << m;
  void towns;
  void town;
  return mask;
}

export { NONE };
