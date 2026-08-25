# Content

Everything in the game. The test for this document is that you can hold it in
your head.

The previous draft had twenty-odd cargoes, forty-four vehicles, eight eras and
five modes. Most of it never moved: a sweep of ten 140-year runs found nine
cargoes that were reachable and had never once been carried, and the whole
industrial economy was four per cent of tonnage.

---

## Modes

**Road**, always. **Rail**, when you can afford it — and rail is something you
*buy*, never something you build from nothing.

The district has one branch line, contracting, with a freight terminal on it.
You meet it three times:

| | What you do | Rung |
|---|---|---|
| **Hire** | Pay a fee per wagon to send freight down somebody else's line | 3 |
| **Buy** | Take the line off them. Your fee stops; other people's freight starts paying you | 4 |
| **Extend** | Lay new track to somewhere the line never went | 5 |

That is one asset carrying three acts and needing no new systems, and it is
historically exact for 1985 — branch lines were being disposed of and private
operators were picking them up.

It also answers "different modes" cheaply. A second mode you have to design,
path, balance and build from scratch is a project. A second mode you buy,
already laid, already connected, is a purchase decision — which is what every
rung on the ladder is supposed to be.

**Cut:** canals, sea, air. Canal freight was gone by 1985; the other two need a
bigger map.

## Cargo

Nine, and every one is a recognisable job rather than an abstraction.

| Cargo | From | To | Note |
|---|---|---|---|
| **Milk** | dairy farms | creamery | **Perishable.** The opening job. Cold, urgent, every day. |
| **Dairy** | creamery | shops, terminal | Butter, cheese, bottled milk. Perishable, less urgently. |
| **Grain** | arable farms | mill | |
| **Feed** | mill | dairy farms | The return load. A route that carries both is the first thing a player discovers on their own. |
| **Aggregate** | quarry | concrete plant, roadworks | Heavy, cheap, endless. Your own roadbuilding consumes it. |
| **Timber** | forestry | sawmill | |
| **Sawn timber** | sawmill | builders' merchants, terminal | |
| **Parcels** | terminal, depot | every settlement | Light, valuable, always available. The reliable earner. |
| **Fuel** | terminal | filling stations, farms | Tanker work. Specialist vehicle, good margin. |

Nine cargoes, five specialist bodies (reefer, tipper, tanker, flatbed, box).
The body a load needs is the reason your fleet has to be a fleet.

### Chains

Four, all two-step, and one of them loops:

```
milk       ->  creamery      ->  dairy
grain      ->  mill          ->  feed  ->  back to the farms
timber     ->  sawmill       ->  sawn timber
aggregate  ->  concrete plant ->  (your own construction)
```

The grain/feed loop is deliberately the second thing you meet. It teaches the
three-stop route without a tutorial saying so.

Aggregate feeding your own construction is the small closed circle that makes
Act II satisfying: the quarry run pays for the road, and the road is built out
of what the quarry run carried.

---

## Vehicles

Nine. Each is the right answer to something, stated in a line.

| Vehicle | Body | Why you would buy it |
|---|---|---|
| Transit van | box | Cheapest thing that moves a load. Parcels, small loads, anywhere. |
| Refrigerated van | reefer | The opening vehicle. Small milk runs. |
| Rigid 7.5t | box | The first real lorry. Goes down a lane a bigger one cannot. |
| Rigid tipper | tipper | Aggregate, and it can tip. |
| Rigid tanker | tanker | Milk in bulk, and fuel. |
| Artic + reefer | reefer | Volume dairy work once the creamery is worth it. |
| Artic + box | box | Trunk work to the terminal. |
| Artic + flatbed | flatbed | Timber and sawn timber. |
| Artic + tipper | tipper | Quarry at scale. Ruins a lane. |

The progression is not chronological, it is **capability against access**. The
big earners cannot get everywhere, and the places they cannot get are the
places you will end up building a road to. That tension replaces obsolescence
as the reason your fleet changes.

Vehicles wear. Maintenance is a running cost, breakdowns block the cell the
vehicle is standing in, and a neglected fleet is a queue waiting to happen.
Nothing becomes worthless because time passed.

---

### One thing the way classes do *not* have

**Minimum curve radius is zero on every road class.** It is a railway concept:
a train has a fixed wheelbase and cannot take a tight bend, and a lorry can.
Carrying it over from the old rail content quietly refused every attempt to lay
a road or a dual carriageway, on perfectly flat ground, because a six-tile
straight run could not satisfy a radius of three hundred and twenty.

Gradient is the constraint that matters and it does the job: a farm track climbs
what a dual carriageway will not, which is the whole reason a big earner cannot
get everywhere.

## Yards

Four you can own, and their positions are the whole of the second act.

| Yard | Where | Opens |
|---|---|---|
| **Marchford** | your starting yard, by the farms | the milk run, grain |
| **Aldbridge** | the market town | parcels, dairy distribution, the terminal |
| **Colt Hill** | by the quarry and the sawmill | aggregate and timber, which are heavy and hate distance |
| **Nether Cross** | the far side of the hills | the hamlet, and everything the hills made uneconomic |

Each has a purchase price, an upkeep, a number of bays that caps the fleet based
there, and a catchment. Nether Cross is deliberately the last one that makes
sense and the one that changes the map most.

## The district

| | |
|---|---|
| Region | 256 × 256 tiles, about 8 km square |
| Settlements | 5 — Aldbridge (market town), Marchford, Colt Hill, Wend (villages), Nether Cross (hamlet) |
| Industry at start | ~10 |
| Grows to | ~18, plus whatever you site in Act III |
| Terrain | one river valley, one range of hills, one map edge that is "the rest of the country" |
| Rail | one branch line and a freight terminal, both for sale eventually |

Five settlements is the number that makes the district knowable. The old setting
had fourteen towns on a 384 map, so most of them were places you had never been.

Aldbridge is clearly the largest and clearly the destination. Nether Cross is
clearly too small to be worth serving — until you make it worth serving, which
is the top of the ladder in one sentence.

### A concrete opening

The game starts here, deliberately specific:

> **Marchford Farm to the creamery at Aldbridge.** Five miles of lane. One
> refrigerated van, on hire purchase. £48 a collection, three collections a
> week, and the milk will not wait.

Everything the player needs to learn is in that job: collect, deliver, get
paid, watch the clock, notice the lane through Aldbridge is narrow.

---

## Balance

Everything tunable stays JSON. The headless sweep harness stays — it is the
only reason the previous draft's problems were findable, and it is what
measured rent at 8.76%, found nine dead cargoes, and caught the bug that
emptied every region of vehicles by 1940.

The signals worth measuring now:

| Signal | Target |
|---|---|
| Time to first profitable route | Under 10 real minutes |
| Time to affording your first built road | 1–2 game years |
| Population growth attributable to the player | With no rivals, this is simply growth |
| Queue length at the busiest junction | Must bind. If it never queues, the building system is decorative |
| Loads spoiled per month | Non-zero early, near zero once the player has learned |
| Dead cargo | Zero out of nine |
| Amenity spread across settlements | Should widen in Act III. If every village ends the same, siting is not a decision |
| Share of income from tolls by Act III | 20–40%. The old draft managed 8.76% with four AI companies to charge |
| Background traffic diverted at the revenue-maximising toll | Non-trivial. If nobody ever diverts, the toll curve is flat and the decision is fake |
| Yards owned at the end | 3 of 4 typical. If it is always 4, they are too cheap; if always 1, the catchment penalty is too weak |
