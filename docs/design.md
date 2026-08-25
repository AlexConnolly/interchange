# Design

Six systems. If something is not one of these, or does not directly serve one
of them, it is not in the game.

---

## 0. The north star

**Every action you take must visibly change the district, quickly, and it must
be obvious that it was you.**

That is the test for every feature here and every feature proposed later. It is
also the diagnosis of what went wrong before: four AI companies meant the
district changed constantly for reasons that were not yours, and nineteen
feature categories meant any single decision you made was a rounding error.

---

## 1. The ladder

The whole progression, in the order the player meets it:

```
buy trucks  ->  buy yards  ->  hire other modes  ->  buy infrastructure  ->  build it
   user ------------------------------------>  owner ------------->  producer
```

Every rung is a **purchase**, and every rung changes what the binding
constraint is. That is the design in one line: you are never solving the same
problem twice, and you are never solving it by doing more of what worked last
time.

| Rung | The constraint before | The constraint after |
|---|---|---|
| Trucks | you have no capacity | your yard is too far from the work |
| Yards | your yard is too far from the work | your best routes are congested |
| Modes | congestion on the road | the line costs you a fee per wagon |
| Buy infrastructure | you pay to use everything | you own it, and it needs maintaining |
| Build infrastructure | what exists is the wrong shape | you decide the shape |

The old draft had four acts and eight eras and no answer to "what is the
problem right now". This table is that answer.

---

## 2. Yards

**The yard is the unit of expansion**, and this is the structural idea the
previous draft was missing entirely.

- A yard is a site you own. Vehicles are based there, serviced there, and
  return there.
- A yard has a **catchment**. A route whose ends are far from any yard costs
  more to run — empty running, driver hours, a fitter who has to drive out.
- Buying a second yard does not make your existing routes better. It opens work
  you could not previously reach at a price that worked.
- Yards cost to buy and cost to keep.

That makes expansion a *geographic* decision rather than a numeric one. "Buy a
yard at Aldbridge" is legible in a way "increase capacity by 20%" never is, and
it puts a map decision at the centre of the second act.

A yard is also where the fleet becomes visible. Two trucks in a yard is a
picture; two trucks in a spreadsheet is not.

---

## 3. Routing

A **service** is a list of stops. Vehicles based at a yard run it.

- Two stops is the normal case: collect here, deliver there.
- Three is the useful case, and the district rewards it — grain to the mill and
  feed back is not clever, it is what any operator does.
- Payment is per load, by distance actually travelled and what the load is
  worth.

**Perishable loads.** Milk and dairy have hours, not days. One field on a cargo,
not a system, and it does more work than any other number in the game: it makes
the opening job matter, it makes congestion hurt immediately rather than
eventually, and it gives a reason to prefer a shorter route that is not merely
arithmetic.

**Cut:** contracts, bidding, deadlines, penalties, reliability ratings,
objectives. A route that pays is its own reward.

---

## 4. Traffic that is not yours

The most important thing in this rewrite, and the thing that makes rung 4 work
without AI companies.

**The district has its own traffic.** Farmers' vans, other people's lorries,
buses, private cars. It is modelled as a **flow on each way**, not as agents: a
volume with an origin and destination distribution, which responds to what a
way costs and how congested it is.

This is cheap — no fleets, no decisions, no bankruptcies, no per-company
pathfinding — and it delivers three things nothing else does:

**It makes a toll worth collecting.** You cannot charge rent to nobody. The old
draft's answer was four AI companies and roughly two thousand lines of rival
logic, regulation and access agreements; and when it was finally measured, rent
was **8.76% of income**. A flow pays the toll for a fraction of the cost.

**It gives the toll a self-balancing curve.** Raise the charge and the flow
diverts or stays home; lower it and it comes back. There is a revenue-maximising
price and it moves as the district grows. That is the mechanic the old design
wanted (its §3.3) and it works better against a demand curve than against
agents, because a curve cannot go bankrupt or behave stupidly.

**It makes congestion honest.** The lane through the village is busy because it
is a village. Your sixth truck is the straw, not the whole load. That is truer,
and it means the queue you have to solve is not one you can solve by simply
running fewer vehicles.

Your own vehicles cross your own ways free. That is the whole of "buying it
turns a cost into an income".

---

## 5. Traffic and junctions

Vehicles are individually simulated. They occupy cells on a way, queue at
junctions, and a junction has finite capacity. Background flow occupies the same
capacity.

This is what makes building interesting rather than decorative. Without it a
road is a line and more vehicles is always better. With it, the junction where
three of your routes meet is where the network fails, and it fails visibly — a
queue is the information, not a warning icon.

The fix is always a decision with a price: a wider way, a different route, a
bypass round the village, grade separation, or fewer vehicles running better.

The junction editor is a first-class screen. You lay out approaches, priorities
and separation, and watch traffic run through it.

**Kept in full.** This is where the game is.

---

## 6. Building and owning

### Owning

Every way has an owner. At the start that is the council, and you pay per
crossing. You can **pay**, **buy**, or **build**.

Buying is rung 4 and it is the pivot of the game: the road you have been paying
to use starts paying you, because most of the traffic on it was never yours.
Valuation is a multiple of what it earns, so a way is expensive exactly when it
is worth having.

The same object escalates. The branch line is met three times: first you **pay**
a fee per wagon to send freight down somebody else's line; then you **buy** the
line and the fee stops and other people's freight starts paying you; then you
**extend** it to somewhere it never went. One asset, three acts, no new systems.

Maintenance is the counterweight. An owned way decays and costs to keep, and a
derelict way earns nothing and is visibly derelict.

### Building

Laying way across terrain, and the terrain fighting back.

- Gradient limits, and they bite. A loaded artic on a 1-in-8 lane is a problem.
- Cuttings and embankments, priced by earth moved.
- Bridges, culverts, and the occasional tunnel.
- Junction geometry, because a T-junction onto an A-road is not free.

The terrain is generated with a real erosion pass — stream-power incision and
talus — so it has valleys that drain and ridges that are ridges. **The valleys
are the natural routes, so the map argues about where a road should go before
you have drawn one.**

Four classes of way, no more: farm track, lane, road, dual carriageway.

---

## 7. Growth and amenity

### Growth

The payoff. The district responds to being served.

**Settlements** have a basket of things they want, sized to population,
part-supplied locally and the rest arriving by road. Serve one and it grows.
Neglect one and it shrinks. A well-served village becomes a town.

This already works in the simulation — a settlement fed everything it asked for
grew from 2,712 to 88,248 over a century. What it has never done is happen
*because of the player*, because four AI carriers were doing the serving badly.
Now there is only you.

**Industry** needs inputs delivered and output collected. Both and it runs,
expands, and a second one opens. Starve it and it closes. Chains are two steps
at most.

**Feedback has to be fast.** Growth is visible within a game month, in the world
rather than in a panel: the buildings change and the street gets longer.

### Amenity

An industrial estate next to a village is worth money and costs the village
something. A quarry is worth more and costs more. A bypass takes the lorries out
of the high street and puts them past somebody's garden.

This is **in**, not deferred. In a game whose top rung is deciding where things
go, siting industry without a downside is not a decision. Amenity is a field
over the map — industry lowers it in a radius, traffic lowers it along a way —
and a settlement's growth and its basket both respond.

One system, already written, 217 lines. It is the counterweight that stops rung
5 being a shopping list.

---

## 8. One era, and what it bought

The game is 1985 to 1995. One decade, one visual language, one vehicle set.

This is the largest cut in the project and most of the previous draft's
difficulty was downstream of spanning 240 years.

**It removed content multiplication.** Forty-four vehicles becomes nine. Three
building languages become one.

**It removed a whole class of bug.** Era-gated baskets, so a town wanted
electronics in 1860 and its satisfaction capped at 70%. Rates flat across eight
eras while vehicle costs rose tenfold, so every region had no vehicles by year
80. Starting capital fixed at 1860 levels, so nobody founded after era three
could buy anything. All era bugs, all now impossible.

**It removed the art coherence risk**, which the old register rated Medium:
*"eight eras of assets drift in style."*

**It removed the obsolescence cliff.** Vehicles wear out and break down; they
do not become worthless because a decade turned.

Eras were carrying the sense of advancement. That job now belongs to the ladder,
which is what the game was always actually about. The old draft spent its whole
budget on the wrong axis.

### On the calendar, honestly

Cutting history makes the time problem smaller. It does not solve it.

Any transport game has a contradiction: a vehicle must take tens of seconds to
make a journey you can watch, and a calendar must advance fast enough for
progression. Realistic road speeds make those incompatible by two orders of
magnitude. The old draft's answer was a document apologising for it.

The answer here is to **stop showing the player a unit they can do arithmetic
with.**

- The player-facing unit is the **week**. Accounts are monthly.
- There is no day in the interface. A day exists in the simulation as a bucket
  for daily rates and nowhere else.
- Three collections a week is a real haulage pattern, so what the player *can*
  see is not absurd.
- Speeds are shown in mph as flavour, never beside a duration.

| | Value | Real time at 1× |
|---|---|---|
| Tile | 32 m — unchanged, so existing art scale holds | |
| District | 256 × 256, about 8 km square | |
| Tick | 20 Hz | |
| Day | 800 ticks — a rate bucket, never shown | 40 s |
| Week | 6 days | 4 min |
| Month | 4 weeks | 16 min |
| Year | 12 months | 3¼ h |
| Campaign | 10 years | 32 h, or 6½ h at 5× |
| Speeds | 1×, 2×, 5×. No 20×. | |

**The sun, and what dropping 20× did and did not fix.** A game day is forty real
seconds at 1× and eight at 5×, so a sun coupled directly to the calendar is a
real day at the slowest speed and a flicker at the quickest. Dropping 20× made
that better and not well: eight seconds is still not a day.

So the sun tracks the game clock with a floor on how long a cycle may take —
forty seconds, which is exactly a game day at 1×. At 1× and 2× the sun *is* the
game's day. At 5× it falls behind the date and keeps moving at a watchable rate.
Because no day is ever printed, there is nothing on screen for it to contradict,
and art.md §8 is what licenses it: light is mood and never information.
