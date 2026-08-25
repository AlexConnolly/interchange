/**
 * Rival companies. design.md §2.5, and D11.
 *
 * Rivals are **not special**. They are headless clients issuing exactly the
 * same commands a human issues, into exactly the same simulation, through
 * exactly the same queue. There is no AI-only action, no cheaper price, no
 * peeking at the player's routes. Difficulty is capital, planning horizon and
 * risk appetite.
 *
 * That has a property worth protecting: anything a rival can do, you can do.
 * If a rival does something clever, it is because the game genuinely permits
 * it — which means the AI is also a test of the design. Every time this file
 * could not express something, it was because the *game* could not express it,
 * and that was worth knowing.
 *
 * Personalities are a small set of weightings rather than distinct code paths:
 * an aggressive expander and an undercutter run the same decision list in the
 * same order and disagree about the numbers.
 *
 * D11 is the other half: no LLM anywhere near this. It is ordinary planning
 * code, and it is better for it — a bounded, tunable, testable opponent is
 * more fun than an unpredictable one, and it is the only kind that can exist
 * inside a deterministic lockstep tick.
 */

import { Cmd, cmd } from './commands.ts';
import { AUTHORITY, MAX_COMPANIES, Mode, TICKS_PER_DAY } from './constants.ts';
import { Charter, ContractState, Line, LINE_COUNT, MAX_STOPS, StopAction } from './economy.ts';
import { NONE } from './network.ts';
import type { Rng } from './rng.ts';
import { SiteState } from './sites.ts';
import type { World } from './world.ts';

/** How often a rival thinks, in days. Not every day: a company that reviews
 *  its entire strategy every morning is not a company. */
export const THINK_DAYS = 6;

interface Personality {
  /** 0..100. Willingness to spend down to the floor and to attack. */
  aggression: number;
  /** 0..100. How long an unprofitable service is given to come good. */
  horizon: number;
  /** 0..100. Cash buffer kept back, as a fraction of annual running costs. */
  thrift: number;
}

/**
 * One rival's turn.
 *
 * Every branch ends in `queue.push`, never in a direct mutation. That is not
 * fastidiousness: it is what makes rivals work in multiplayer unchanged, what
 * puts their decisions in the replay, and what guarantees they cannot do
 * something the command model does not permit.
 */
export function stepRival(w: World, company: number, rng: Rng): void {
  if (w.companies.bankrupt[company]) return;
  const p: Personality = {
    aggression: w.companies.aggression[company],
    horizon: w.companies.horizon[company],
    thrift: w.companies.thrift[company],
  };
  const cash = w.companies.cash[company];
  const base = company * LINE_COUNT;
  const annualRunning = w.companies.ledgerYear[base + Line.RunningCosts] + 1;
  const buffer = (annualRunning * p.thrift) / 100;
  const spendable = cash - buffer;
  // Not recorded in the log: a replay re-runs this same function against the
  // same world and produces the same commands, so logging them would apply
  // every one of them twice. See CommandQueue.push.
  const issue = (kind: number, a = 0, b = 0, c = 0, d = 0, data?: number[] | string): void => {
    w.queue.push(cmd(w.tick + 2, company, kind, a, b, c, d, data), false);
  };

  /*
   * ---- 0. retrenchment --------------------------------------------------
   *
   * A company in debt is in a trap the rest of this file cannot see. Every
   * penny that comes in goes straight to the lender, so cash never rises,
   * `spendable` is never positive, and the company can neither buy its way out
   * nor invest its way out. Meanwhile the running costs of the fleet it
   * already has continue every single day. Left alone the arithmetic only ends
   * one way, and it did: all four companies bankrupt in nearly every run of
   * the sweep, always at the same nine thousand pounds, which is the floor
   * under the credit limit.
   *
   * The way out is the way a real business takes — sell the lorries and stop
   * the bleeding — and it has to override the rules below, both the one that
   * protects the last vehicle on a route and the grace period that gives a new
   * route time to prove itself. Neither of those matters to a company that
   * will not be here next year.
   */
  if (w.companies.debt[company] > 0 && cash <= 0) {
    let worst = NONE;
    let worstNet = Infinity;
    for (let v = 0; v < w.vehicles.count; v++) {
      if (!w.vehicles.alive[v] || w.vehicles.company[v] !== company) continue;
      const svc = w.vehicles.service[v];
      const net = svc === NONE
        ? -Infinity
        : (w.services.revenue[svc] - w.services.costs[svc]) / Math.max(1, w.services.vehicles[svc]);
      if (net < worstNet) {
        worstNet = net;
        worst = v;
      }
    }
    // Only if the fleet is not already earning its keep. A company that is
    // trading profitably and merely carrying a loan should keep its lorries
    // and pay the loan off with them.
    const income = w.companies.ledgerYear[base + Line.Haulage]
      + w.companies.ledgerYear[base + Line.ContractBonus];
    if (worst !== NONE && income < annualRunning) {
      issue(Cmd.SellVehicle, worst);
      return;
    }
  }

  // ---- 1. keep the fleet honest -----------------------------------------
  // An idle vehicle earns nothing and costs every day. How long one is
  // tolerated is the planning horizon.
  const deadAfter = 240;
  const idleGrace = 30 + (p.horizon / 100) * 200;
  let idle = 0;
  for (let v = 0; v < w.vehicles.count; v++) {
    if (!w.vehicles.alive[v] || w.vehicles.company[v] !== company) continue;
    if (w.vehicles.service[v] !== NONE) continue;
    idle++;
    if (idle > 1 && cash < buffer) {
      issue(Cmd.SellVehicle, v);
      return;
    }
  }
  void idleGrace;

  // ---- 2. a service that is losing money --------------------------------
  const mine: number[] = [];
  for (let s = 0; s < w.services.count; s++) {
    if (w.services.company[s] === company && w.services.active[s]) mine.push(s);
  }
  for (const s of mine) {
    // Judged on its own trading, and only once it has had time to do some.
    // Measuring age from `roundTrip` — which is zero until a vehicle has
    // completed a lap — made every new service instantly ancient and instantly
    // unprofitable, so every rival bought a lorry and sold it six days later,
    // a hundred and eleven times.
    /*
     * Do not judge a route before it has been round twice.
     *
     * A grace period in days alone is not enough when a round trip can be a
     * hundred and seventy-six of them: the route is condemned on its costs
     * before its first load has arrived anywhere. Companies bought a lorry,
     * sold it at a loss on the depreciation, bought another, and went bankrupt
     * doing it — three companies in every four.
     */
    const age = w.tick - w.services.created[s];
    const lap = w.services.roundTrip[s];
    if (age < idleGrace * TICKS_PER_DAY) continue;
    if (lap > 0 && age < lap * 2) continue;
    if (lap === 0 && w.services.tonnes[s] <= 0 && age < deadAfter * TICKS_PER_DAY) continue;
    const net = w.services.revenue[s] - w.services.costs[s];
    /*
     * Shrink a fleet, never sell the last of it.
     *
     * A vehicle sold fetches about half what it cost, so selling the only
     * lorry on a route and buying another next season is a forty-five per cent
     * loss taken for nothing. Companies did exactly that in a loop: a thousand
     * pounds of asset trading in year two against two hundred of haulage, and
     * bankrupt by year eight. A route down to one vehicle is either worth
     * running or worth closing, and closing it is handled below.
     */
    if (net < -w.services.costs[s] * 0.3 && w.services.vehicles[s] > 1) {
      // Shrink it rather than close it: a route that loses money with six
      // lorries can make money with two, and closing it throws away the
      // knowledge that the route exists.
      for (let v = 0; v < w.vehicles.count; v++) {
        if (w.vehicles.alive[v] && w.vehicles.company[v] === company && w.vehicles.service[v] === s) {
          issue(Cmd.SellVehicle, v);
          return;
        }
      }
    }
    /*
     * And give up on one that has stopped working entirely.
     *
     * Shrinking alone was not enough. A route can die for reasons the route
     * cannot fix — the works at the far end runs out of the other thing it
     * needs and stops accepting deliveries — and shrinking it to nothing still
     * leaves it occupying one of the three slots a company has. Four rivals
     * spent twenty years each holding three dead routes, unable to open a
     * fourth, watching a region full of full yards. A carrier gives up on a
     * customer that has stopped buying.
     */
    // Has it carried anything since the last review?
    const since = w.tick - w.services.markTick[s];
    if (since >= deadAfter * TICKS_PER_DAY) {
      const carried = w.services.tonnes[s] - w.services.tonnesMark[s];
      w.services.tonnesMark[s] = w.services.tonnes[s];
      w.services.markTick[s] = w.tick;
      if (carried <= 0 && net < 0) {
        issue(Cmd.DeleteService, s);
        return;
      }
    }
    if (age > deadAfter * TICKS_PER_DAY && w.services.vehicles[s] === 0 && net < 0) {
      issue(Cmd.DeleteService, s);
      return;
    }
  }

  // ---- 3. open a new route ----------------------------------------------
  /*
   * How many routes to run — appetite, not means.
   *
   * Tried scaling this with income, on the theory that a company doing well
   * should spread. It made every outcome worse: the sweep went from five runs
   * in six doubling their capital and a charter earned at twelve years, to
   * three in six and no charter at all. Capital is the binding constraint in
   * Act I, and a fourth route staffed by one dray earns less than a fourth
   * dray on a route that already works. The cap stays where temperament puts
   * it.
   */
  const wantServices = 1 + Math.floor((p.aggression / 100) * 5);
  if (mine.length < wantServices) {
    /*
     * People, or goods.
     *
     * An omnibus used to be the fallback for when no industrial pair could be
     * found, which meant it was never chosen at all — there is always some
     * works with stock somewhere — and passengers and mail sat in the dead
     * cargo list for the whole century. A carrier with a route or two already
     * running is exactly who would look at two towns and see a business, so it
     * is offered as an alternative rather than a consolation.
     */
    const preferPeople = mine.length >= 2 && rng.chance(2, 5);
    if (preferPeople) {
      const link = bestUnservedTownPair(w, rng);
      if (link) {
        issue(Cmd.CreateService, 0, 0, 0, 0, `${w.companies.names[company]} omnibus`);
        issue(Cmd.AddStop, -1, link.a, (255 << 2) | 1, StopAction.Exchange);
        issue(Cmd.AddStop, -1, link.b, (255 << 2) | 1, StopAction.Exchange);
        return;
      }
    }
    const pair = bestUnservedPair(w, company, rng);
    if (pair) {
      // -1 is "the service I just created". Predicting the id here is what
      // made four companies build each other's routes.
      issue(Cmd.CreateService, 0, 0, 0, 0, `${w.companies.names[company]} route`);
      issue(Cmd.AddStop, -1, pair.from, 255 << 2, StopAction.LoadFull);
      if (pair.onward !== NONE) {
        /*
         * Three stops, and the reason the region has more than one cargo in it.
         *
         * A two-stop run into a works is a bet that somebody else will collect
         * what the works makes. Nobody does — there are twelve routes in the
         * region and forty-seven industries — so the works fills, stops taking
         * deliveries, and the lorries queue at a closed gate until the company
         * is bankrupt. Coal escaped this only because a colliery can sell
         * straight to a town, which is why coal was nine tenths of everything
         * moved and sixteen other cargo types never moved at all.
         *
         * Carrying both halves fixes it without needing a second company to
         * cooperate: stone in, cement out, and the works keeps taking stone
         * because its yard keeps emptying. It is also just what a carrier
         * would do, having driven there anyway.
         */
        issue(Cmd.AddStop, -1, pair.to, 255 << 2, StopAction.Exchange);
        issue(Cmd.AddStop, -1, pair.onward, (255 << 2) | 1, StopAction.Unload);
      } else {
        issue(Cmd.AddStop, -1, pair.to, (255 << 2) | (pair.toIsTown ? 1 : 0), StopAction.Unload);
      }
      return;
    }
    const link = bestUnservedTownPair(w, rng);
    if (link) {
      issue(Cmd.CreateService, 0, 0, 0, 0, `${w.companies.names[company]} omnibus`);
      issue(Cmd.AddStop, -1, link.a, (255 << 2) | 1, StopAction.Exchange);
      issue(Cmd.AddStop, -1, link.b, (255 << 2) | 1, StopAction.Exchange);
      return;
    }
  }

  // ---- 4. more vehicles on whatever is working --------------------------
  if (mine.length > 0) {
    // A service with no vehicles gets one unconditionally. Judging it on its
    // returns first is circular — it cannot earn anything until something runs
    // on it — and that circle is why the first version of this file created
    // routes for twelve years and never bought a single lorry.
    /*
     * The first empty route this company can actually put something on.
     *
     * Two bugs met here. Picking the lowest-numbered empty service and
     * returning outright when no vehicle suited it froze the company for good:
     * one route the era had no vehicle for and it never bought a lorry for any
     * of its others, so four services, two thousand four hundred pounds and no
     * vehicles was the commonest state in the sweep. Filling *every* empty
     * route instead was worse — it spent the last pound on a fourth lorry and
     * all four companies went bankrupt in every run. Skip what cannot be
     * served, take the first that can, and leave the rest for when there is
     * money to run them.
     */
    let target = -1;
    let targetType = -1;
    for (const s of mine) {
      if (w.services.vehicles[s] !== 0 || w.services.stopCount[s] < 2) continue;
      const type = affordableVehicle(w, spendable, serviceHandling(w, s));
      if (type < 0) continue;
      target = s;
      targetType = type;
      break;
    }
    void annualRunning;

    if (target < 0) {
      let bestNet = -Infinity;
      for (const s of mine) {
        if (w.services.vehicles[s] >= 12) continue;
        // Do not buy a lorry the source cannot fill.
        if (!routeHasSpareSupply(w, s, 3)) continue;
        const net = w.services.revenue[s] - w.services.costs[s];
        const perVehicle = net / Math.max(1, w.services.vehicles[s]);
        if (perVehicle > bestNet) {
          bestNet = perVehicle;
          target = s;
        }
      }
      // An aggressive company buys into a route that is merely not losing; a
      // cautious one waits for it to prove itself.
      const threshold = (100 - p.aggression) * 40;
      if (bestNet <= threshold) target = -1;
    }

    if (target >= 0) {
      const first = target * MAX_STOPS;
      const stopSite = w.services.stopKind[first] === 0 ? w.services.stopTarget[first] : NONE;
      // The vehicle has to be able to carry what the route carries. Choosing
      // on capacity per pound alone picks the omnibus — the best ratio in era
      // one — and an omnibus at a colliery loads nothing, delivers nothing,
      // and is sold six days later for being unprofitable. A hundred and
      // twelve times.
      const bestType = targetType >= 0
        ? targetType
        : affordableVehicle(w, spendable, serviceHandling(w, target));
      if (bestType >= 0) {
        issue(Cmd.BuyVehicle, bestType, stopSite);
        issue(Cmd.AssignVehicle, -1, target);
        return;
      }
    }
  }

  // ---- 5. bid for work ---------------------------------------------------
  for (let k = 0; k < w.contracts.count; k++) {
    if (w.contracts.state[k] !== ContractState.Offered) continue;
    if (w.contracts.bids[k * MAX_COMPANIES + company] > 0) continue;
    if (!canServe(w, company, k)) continue;
    // The undercutter bids below the asking rate; the expander pays it. Both
    // are real strategies and the reliability weighting decides which wins.
    const discount = 1 - (p.aggression / 100) * 0.22;
    issue(Cmd.BidContract, k, Math.max(1, Math.round(w.contracts.rate[k] * discount)));
    return;
  }

  // ---- 6. ownership ------------------------------------------------------
  /*
   * A construction charter *is* the licence to own. Requiring era two on top
   * of it — a second gate meant to keep tolls away from a player who has not
   * met the idea yet — meant that in a thirty-year sweep, where era two
   * arrives in the last year, no rival ever bought a single tile of road. The
   * ownership spine, which is the thing this whole design is about, read as
   * inert because it had been switched off rather than because it failed.
   * A rival that has earned the charter has met the same bar the player does.
   */
  if (w.companies.charter[company] >= Charter.Construction) {
    // Buy the road you are paying the most to use. design.md §3.2: buy flips
    // a cost into an income, and the asset that costs you most is the one
    // worth the most to own.
    let bestAsset = NONE;
    let bestValue = 0;
    for (let a = 0; a < w.assets.count; a++) {
      if (w.assets.owner[a] === company) continue;
      if (w.assets.owner[a] !== AUTHORITY && !w.assets.forSale[a]) continue;
      const price = w.assets.valuation(a, w.content.balance.valuationPct);
      if (price > spendable) continue;
      // Weight by how much traffic it carries: an empty road is cheap and
      // worthless, and a busy one is expensive because it is worth having.
      const value = w.assets.passesPrev[a] * 100 - price * 0.02;
      if (value > bestValue) {
        bestValue = value;
        bestAsset = a;
      }
    }
    if (bestAsset !== NONE && bestValue > 0) {
      issue(Cmd.BuyAsset, bestAsset);
      return;
    }

    // And price what you own. The toll curve is the constraint: raise it and
    // traffic leaves, so an aggressive company probes upward and a cautious
    // one holds. Nobody here knows the curve; they discover it, as the player
    // does, by watching the passes fall.
    for (let a = 0; a < w.assets.count; a++) {
      if (w.assets.owner[a] !== company) continue;
      const passes = w.assets.passesPrev[a];
      const charge = w.assets.charge[a];
      if (passes > 40 && charge < 60 && rng.chance(p.aggression, 300)) {
        issue(Cmd.SetCharge, a, charge + 3);
        return;
      }
      if (passes < 6 && charge > 2 && rng.chance(60, 300)) {
        issue(Cmd.SetCharge, a, Math.max(0, charge - 3));
        return;
      }
    }
  }

  // ---- 7. dig ------------------------------------------------------------
  if (w.companies.charter[company] >= Charter.Extraction && rng.chance(p.aggression, 400)) {
    const found = bestFoundable(w, company, rng);
    if (found) issue(Cmd.FoundIndustry, found.def, found.tile);
  }
}

/**
 * A producer and somewhere for it to go that nobody is already running.
 *
 * Towns count as destinations, and they matter more than they look. A
 * processing site is a *conditional* sink: it takes coal only while it has
 * somewhere to put its coke, so a two-stop service into one stalls the moment
 * its output backs up, and the lorries queue at a gate that will not open. A
 * town is an unconditional sink — people burn the coal — so a route into one
 * keeps running. Rivals that only ever served industry-to-industry spent
 * thirty years running services with eighty-day round trips.
 */
function bestUnservedPair(
  w: World, company: number, rng: Rng,
): { from: number; to: number; toIsTown: boolean; onward: number } | null {
  // Keyed by site *and cargo*, not site alone. A gasworks that already receives
  // coal is the best coke origin on the map precisely because it receives coal,
  // and penalising it for being "served" is how a whole processing tier stayed
  // dead: nothing ever collected the second tier's output, so the first tier
  // backed up and the lorries queued at a gate that would not open.
  const servedOut = new Set<number>();
  const servedIn = new Set<number>();
  const carried = new Float64Array(w.content.cargo.length);
  for (let s = 0; s < w.services.count; s++) {
    if (!w.services.active[s]) continue;
    for (let k = 0; k < w.services.stopCount[s]; k++) {
      const i = s * MAX_STOPS + k;
      if (w.services.stopKind[i] !== 0) continue;
      const t = w.services.stopTarget[i];
      if (w.services.stopAction[i] === StopAction.Unload) servedIn.add(t);
      else servedOut.add(t);
    }
    const c = w.services.company[s];
    for (let k = 0; k < carried.length; k++) carried[k] += w.movedByCargo[c * carried.length + k];
  }
  let totalCarried = 0;
  for (let k = 0; k < carried.length; k++) totalCarried += carried[k];

  let best: { from: number; to: number; toIsTown: boolean; onward: number } | null = null;
  let bestScore = 0;
  for (let a = 0; a < w.sites.count; a++) {
    if (!w.sites.connected(a) || w.sites.state[a] === SiteState.Dead) continue;
    const outs = w.content.industries[w.sites.def[a]].recipe.outputs;
    for (const id of Object.keys(outs)) {
      const ci = w.content.cargoIndex.get(id);
      if (ci === undefined) continue;
      const stock = w.sites.stockOf(a, ci);
      if (stock <= 0) continue;
      // A cargo nobody carries is worth more than another lorry-load of the one
      // everybody does — both because the margin is better with no competition
      // and because a region where four companies all haul coal is a duller
      // region than one where they specialise.
      /*
       * How much better an untouched cargo looks than a crowded one.
       *
       * Deliberately mild. A reciprocal curve, giving an untouched cargo seven
       * times the pull of a crowded one, made everything worse: coal went up
       * to ninety-two per cent of tonnage and only one company in six doubled
       * its capital. The reason is worth writing down, because it is the shape
       * of the whole problem. Coal does not dominate because the rivals like
       * it; it dominates because a colliery sells to a *town*, and a town is
       * the only sink that cannot stall. Bullying a company onto stone or
       * grain sends it to a works that stops accepting the moment its own
       * output backs up, so the company goes broke and its coal route is the
       * one that survives to be counted. The answer is the chain route below,
       * not a bigger thumb on this scale.
       */
      const crowding = totalCarried > 0 ? carried[ci] / totalCarried : 0;
      const rarity = 1.6 - crowding;
      // Capped. A colliery with four hundred tonnes at the pithead is not four
      // hundred times the prospect of a farm with ten; it is a route with a
      // full load waiting, and so is the farm. Uncapped, the stockpile term
      // swamped everything else and every company in the region hauled coal
      // and nothing else — a hundred per cent of tonnage on one cargo.
      const waiting = Math.min(stock, 30);
      const originPenalty = servedOut.has(a) ? 400 : 0;
      /*
       * A pit is worth far more than a works, as an origin.
       *
       * A cement works has cement in the yard and looks like just as good a
       * customer as a colliery with coal in the yard. It is not. A colliery
       * digs coal out of the ground and never stops; a works makes cement only
       * while somebody brings it stone, and in a region with a dozen routes
       * nobody does — so it runs through its opening stock, produces thirty
       * tonnes, and stops for ever. A harness playing the "obvious" opening
       * move against a works loses nine hundred pounds in twelve years; the
       * same move against a pit makes eleven hundred. Every rival in the sweep
       * was making the losing version of that choice, which is most of why the
       * pacing report said most companies never get going.
       *
       * A works is still worth serving once its own supply is arranged, which
       * is what the chain terms below are for. It is just never the place to
       * start.
       */
      const fromGround = w.sites.isExtraction(a) ? 2.6 : 1;
      // A works that already receives deliveries is a works with something
      // coming out of it. Collecting from one completes a chain, and a
      // completed chain is what keeps the first half of it running.
      const chain = servedIn.has(a) ? 1.5 : 1;

      if (w.townDemandFor(ci) > 0) {
        for (let t = 0; t < w.towns.count; t++) {
          if (w.towns.nodeOf(t, Mode.Road) === NONE) continue;
          const d = Math.hypot(w.sites.x[a] - w.towns.x[t], w.sites.y[a] - w.towns.y[t]);
          if (d < 6 || d > 90) continue;
          const score = (waiting * 10 + w.towns.population[t] * 0.03) * rarity * chain * fromGround - d
            - originPenalty + rng.int(60);
          if (score > bestScore) {
            bestScore = score;
            best = { from: a, to: t, toIsTown: true, onward: NONE };
          }
        }
      }
      for (let b = 0; b < w.sites.count; b++) {
        if (b === a || !w.sites.connected(b) || w.sites.state[b] === SiteState.Dead) continue;
        if (w.content.industries[w.sites.def[b]].recipe.inputs[id] === undefined) continue;
        /*
         * Can this works actually use what we would bring it?
         *
         * A glassworks takes coal, but only alongside sand, and if nobody in
         * the region hauls sand then coal delivered there is coal tipped into
         * a yard that will never empty. The rivals did exactly this: a route
         * from a colliery to a glassworks with no sand, three drays parked at
         * the gate, and twenty years of fodder bills. Requiring the *other*
         * inputs to be in stock is the difference between a customer and a
         * building that happens to list your cargo.
         */
        const appetite = appetiteFor(w, b, id);
        if (appetite <= 0) continue;
        // A works whose output has somewhere to go is worth far more than one
        // whose has not, because the second kind stops accepting.
        const onwardBonus = onwardTownFor(w, b) !== NONE ? 1.6 : 1;
        const d = Math.hypot(w.sites.x[a] - w.sites.x[b], w.sites.y[a] - w.sites.y[b]);
        if (d < 6 || d > 90) continue;
        // A destination whose own output is already collected will keep taking
        // deliveries; one whose output has nowhere to go will not.
        const drains = servedOut.has(b) ? 1.35 : 1;
        /*
         * A works that already takes deliveries is the best destination on the
         * map, not the worst.
         *
         * This carried a penalty, on the reasonable-sounding grounds that
         * somebody else is already serving it. But a works needs *every* input
         * before it produces anything, and there are twelve routes in this
         * region against forty-seven industries, so almost every works spends
         * its life stopped for want of one thing. The lorries bringing the
         * other thing then fill its yard, it stops accepting, and the route
         * dies. Penalising the second supplier guaranteed there was never a
         * second supplier: every industrial route in the game eventually
         * failed and the only survivors were omnibuses.
         */
        const completesChain = servedIn.has(b) ? 2.4 : 1;
        const score = waiting * 10 * rarity * drains * chain * onwardBonus * appetite * completesChain * fromGround
          - originPenalty + rng.int(60);
        if (score > bestScore) {
          bestScore = score;
          best = { from: a, to: b, toIsTown: false, onward: onwardTownFor(w, b) };
        }
      }
    }
  }
  void company;
  return best;
}

/** What a service actually needs to carry, as handling classes. */
function serviceHandling(w: World, service: number): Set<string> {
  const out = new Set<string>();
  for (let k = 0; k < w.services.stopCount[service]; k++) {
    const i = service * MAX_STOPS + k;
    if (w.services.stopAction[i] === StopAction.Unload) continue;
    if (w.services.stopKind[i] === 1) {
      /*
       * A town is a place cargo is picked up from, not only delivered to: it
       * makes passengers and it makes post. Skipping town stops here meant an
       * omnibus route reported that it needed to handle nothing at all, so the
       * company bought the best capacity-per-pound vehicle in the era — a
       * horse dray — and parked it outside a coaching inn for a century. It is
       * why passengers and mail never moved a single tonne in any sweep.
       */
      for (let c = 0; c < w.content.cargo.length; c++) {
        if (w.townProduces(c) && w.content.cargo[c].fromEra <= w.era) {
          out.add(w.content.cargo[c].handling);
        }
      }
      continue;
    }
    if (w.services.stopKind[i] !== 0) continue;
    const site = w.services.stopTarget[i];
    const outs = w.content.industries[w.sites.def[site]].recipe.outputs;
    for (const id of Object.keys(outs)) {
      const ci = w.content.cargoIndex.get(id);
      if (ci !== undefined) out.add(w.content.cargo[ci].handling);
    }
  }
  return out;
}

/**
 * How badly does this works want another delivery of `cargo`?
 *
 * Returns zero if the answer is "not at all", and more than one if this is the
 * cargo it is actually short of.
 *
 * The first version of this refused any works that was missing a *different*
 * input, on the reasoning that a works with no sand will not burn your coal.
 * True, and it forbade the single most valuable route in the region: the sand.
 * With every rival refusing to supply a starved works, every industrial route
 * in the game eventually died — the destination filled with the one input it
 * had, stopped accepting, and got closed — until the only services left
 * anywhere were omnibuses between towns, and mail was forty per cent of all
 * tonnage moved.
 *
 * So the test is about room and about balance, not about perfection. A works
 * that has everything except this is the best customer on the map. A works
 * already brimming with this and short of everything else is the worst.
 */
function appetiteFor(w: World, site: number, cargo: string): number {
  const ci = w.content.cargoIndex.get(cargo);
  if (ci === undefined) return 0;
  const room = w.sites.roomFor(site, ci);
  if (room <= 0) return 0;
  const inputs = w.content.industries[w.sites.def[site]].recipe.inputs;
  const mine = inputs[cargo];
  if (mine === undefined) return 0;

  let others = 0;
  let othersStocked = 0;
  for (const other of Object.keys(inputs)) {
    if (other === cargo) continue;
    const oi = w.content.cargoIndex.get(other);
    if (oi === undefined) continue;
    // A works that needs something the era has not invented is not a customer.
    if (w.content.cargo[oi].fromEra > w.era) return 0;
    others++;
    if (w.sites.stockOf(site, oi) >= inputs[other]) othersStocked++;
  }
  if (others === 0) return 1;
  // Everything else in the yard and a gap where this should be: the works is
  // stopped for want of precisely what we would bring.
  const ready = othersStocked / others;
  const shortHere = w.sites.stockOf(site, ci) < mine ? 1 : 0;
  return 0.35 + ready * (shortHere ? 1.65 : 0.65);
}

/**
 * A town that wants what this works makes, near enough to be worth the leg.
 */
function onwardTownFor(w: World, site: number): number {
  const outs = w.content.industries[w.sites.def[site]].recipe.outputs;
  let best = NONE;
  let bestD = 62;
  for (const id of Object.keys(outs)) {
    const ci = w.content.cargoIndex.get(id);
    if (ci === undefined || w.townDemandFor(ci) <= 0) continue;
    if (w.content.cargo[ci].fromEra > w.era) continue;
    for (let t = 0; t < w.towns.count; t++) {
      if (w.towns.nodeOf(t, Mode.Road) === NONE) continue;
      const d = Math.hypot(w.sites.x[site] - w.towns.x[t], w.sites.y[site] - w.towns.y[t]);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
  }
  return best;
}

/**
 * Two towns near enough for an omnibus, that nobody already runs between.
 *
 * A town pair is the one route in the game that cannot stall on a full yard.
 * Passengers and mail are made by every town and wanted by every other, in
 * both directions, so an omnibus pays on the way back — which is why it is
 * what a carrier with nothing better to haul should be running.
 */
function bestUnservedTownPair(w: World, rng: Rng): { a: number; b: number } | null {
  const linked = new Set<number>();
  for (let s = 0; s < w.services.count; s++) {
    if (!w.services.active[s]) continue;
    for (let k = 0; k < w.services.stopCount[s]; k++) {
      const i = s * MAX_STOPS + k;
      if (w.services.stopKind[i] === 1) linked.add(w.services.stopTarget[i]);
    }
  }
  let best: { a: number; b: number } | null = null;
  let bestScore = 0;
  for (let a = 0; a < w.towns.count; a++) {
    if (w.towns.nodeOf(a, Mode.Road) === NONE) continue;
    for (let b = a + 1; b < w.towns.count; b++) {
      if (w.towns.nodeOf(b, Mode.Road) === NONE) continue;
      const d = Math.hypot(w.towns.x[a] - w.towns.x[b], w.towns.y[a] - w.towns.y[b]);
      if (d < 5 || d > 55) continue;
      let score = (w.towns.population[a] + w.towns.population[b]) * 0.02 - d + rng.int(40);
      if (linked.has(a)) score -= 120;
      if (linked.has(b)) score -= 120;
      if (score > bestScore) {
        bestScore = score;
        best = { a, b };
      }
    }
  }
  return best;
}

/**
 * Is there cargo piled up at the origin waiting for a lorry?
 *
 * The obvious test — fleet throughput against the source's production rate —
 * does not work, because throughput is vehicles times capacity over the round
 * trip, and adding a vehicle to a saturated route lengthens the round trip by
 * about as much as the extra vehicle adds. The ratio barely moves, the test
 * never trips, and the company buys lorries until the running costs bury it:
 * nineteen vehicles earning less than fourteen did.
 *
 * A stockpile is the honest signal and the one a real haulier would use. If
 * there is a queue at the pithead, another dray has something to carry. If
 * there is not, it will join the others waiting for the shift to end.
 */
function routeHasSpareSupply(w: World, service: number, capacity: number): boolean {
  const first = service * MAX_STOPS;
  if (w.services.stopKind[first] !== 0) return true;
  const site = w.services.stopTarget[first];
  const outs = w.content.industries[w.sites.def[site]].recipe.outputs;
  let waiting = 0;
  for (const id of Object.keys(outs)) {
    const ci = w.content.cargoIndex.get(id);
    if (ci !== undefined) waiting += w.sites.stockOf(site, ci);
  }
  return waiting >= capacity * 3;
}

function affordableVehicle(w: World, spendable: number, handling: Set<string>): number {
  const year = w.year;
  const era = w.era;
  let best = -1;
  let bestValue = 0;
  w.content.vehicles.forEach((v, i) => {
    if (v.era > era || year >= v.obsoleteYear) return;
    if (v.mode !== 'road' && v.mode !== 'rail') return;
    if (v.cost > spendable) return;
    if (handling.size > 0 && !v.handling.some((h) => handling.has(h))) return;
    /*
     * Earnings per pound of running cost — not capacity per pound.
     *
     * A horse omnibus is quoted at eighteen and a horse dray at three, so on
     * raw capacity the omnibus is six times the vehicle for less money and a
     * company buys nothing else. But eighteen is eighteen *seats*, and a seat
     * pays about a tenth of what a tonne of freight pays. Ranking on capacity
     * alone had companies filling their yards with omnibuses and going
     * bankrupt three times in every four in the sweep. Weighting it is the
     * same sum a player does at the depot: what will it earn, against what
     * will it cost to keep.
     */
    let weight = 0;
    for (const h of v.handling) {
      if (handling.size > 0 && !handling.has(h)) continue;
      const wgt = w.rateWeightFor(h);
      if (wgt > weight) weight = wgt;
    }
    if (weight === 0) weight = 1;
    const value = (v.capacity * weight) / Math.max(1, v.runningCost);
    if (value > bestValue) {
      bestValue = value;
      best = i;
    }
  });
  return best;
}

/** Does this company run a service that could actually fulfil the contract? */
function canServe(w: World, company: number, contract: number): boolean {
  const cargo = w.contracts.cargo[contract];
  const to = w.contracts.toSite[contract];
  const toIsTown = w.contracts.toIsTown[contract] === 1;
  for (let s = 0; s < w.services.count; s++) {
    if (w.services.company[s] !== company || !w.services.active[s]) continue;
    /*
     * And something to carry it with.
     *
     * A service is a plan, not a fleet. Bidding on the strength of a route
     * with no vehicles on it meant companies that had already sold everything
     * they owned kept winning work they could not possibly do, and paying the
     * late penalty on all of it: one company ran up fourteen hundred pounds of
     * penalties in a single year without a lorry to its name, having stopped
     * trading eight years earlier.
     */
    if (w.services.vehicles[s] <= 0) continue;
    let hasDestination = false;
    let hasOrigin = false;
    for (let k = 0; k < w.services.stopCount[s]; k++) {
      const i = s * MAX_STOPS + k;
      const isTown = w.services.stopKind[i] === 1;
      const target = w.services.stopTarget[i];
      if (isTown === toIsTown && target === to) hasDestination = true;
      if (!isTown && w.services.stopKind[i] === 0) {
        const outs = w.content.industries[w.sites.def[target]].recipe.outputs;
        const name = w.content.cargo[cargo]?.id;
        if (name && outs[name] !== undefined) hasOrigin = true;
      }
    }
    if (hasDestination && hasOrigin) return true;
  }
  return false;
}

function bestFoundable(w: World, company: number, rng: Rng): { def: number; tile: number } | null {
  const era = w.era;
  const candidates: { def: number; tile: number }[] = [];
  for (let tries = 0; tries < 40 && candidates.length < 4; tries++) {
    const x = rng.range(4, w.config.size - 5);
    const y = rng.range(4, w.config.size - 5);
    const tile = y * w.config.size + x;
    const deposit = w.terrain.deposit[tile];
    for (let d = 0; d < w.content.industries.length; d++) {
      const ind = w.content.industries[d];
      if (ind.fromEra > era || ind.foundCost <= 0) continue;
      if (ind.deposit > 0 && ind.deposit !== deposit) continue;
      if (ind.deposit === 0 && deposit === 0 && rng.chance(3, 4)) continue;
      if (w.canFound(company, d, tile) !== '') continue;
      candidates.push({ def: d, tile });
      break;
    }
  }
  return candidates.length > 0 ? candidates[rng.int(candidates.length)] : null;
}

export { Mode };
