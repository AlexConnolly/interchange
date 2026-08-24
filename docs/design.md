# Game design

Companion to [`decisions.md`](decisions.md). Everything here follows from D1–D4, D6, D7 and D10.

---

## 1. Structure: four acts, four charters

Progression is diegetic. You are granted **charters** by the regional authority, and each charter
is a licence to do a category of thing you could previously only pay someone else to do. One save
carries through all four, on the same map, so the awkward river crossing you bodged in 1874 is
still annoying you in 2031.

### Act I — Carrier (1860–1900)

You own vehicles, not infrastructure. Roads exist and they're bad. Industries exist and don't
care about you. You bid on haulage contracts and learn the hard arithmetic of the genre:
capacity, round-trip time, maintenance, and the fact that a full load out and an empty load back
is half a business.

- **Verb:** buy vehicles, assign routes, read a timetable
- **Length:** roughly two hours
- **Ships standalone.** This is Phase 1 and it is a complete game with a beginning and an end.

### Act II — Operator (1890–1950), construction charter

You may now lay road and rail. Depots, stations, signalling, gradients, gauge. The game becomes
topology — where the line goes matters more than what runs on it. The Junction Lab unlocks here,
and rivals start bidding against you for the same contracts.

- **Verb:** lay alignment, place nodes, shape junctions

### Act III — Industrialist (1930–2000), extraction charter

You may found industry. The three-network problem becomes the game: a mine produces nothing until
it has power, water and workers, and each is a different network you have to build. Processing
chains open — ore to smelter to steel to goods. Decay starts to bite, because an industry you
stop serving closes.

- **Verb:** site industry, run utilities, balance a supply chain

### Act IV — Developer (1980–2100), land charter

Towns, tourism, airports, deep-water ports, the energy transition, waste. You shape what the
region *is*, and rivals shape it against you.

- **Verb:** develop land, set the region's direction

---

## 2. Signature mechanics

### 2.1 The Junction Lab

The direct Freeways inheritance, and the soul of the game.

Alignments are placed on the grid. But any node where two or more meet can be opened into a
dedicated editor where you shape the interchange freehand: priority rules, signals, roundabout,
grade separation, slip roads, stacking. The simulation runs your junction with real vehicles at
higher cell resolution and reports **throughput, mean delay, and 95th-percentile queue length**.

- A rail junction with signalling is a genuinely different and harder puzzle than a road one, so
  the feature scales across acts rather than being spent in Act II.
- Junctions are saveable as **blueprints** and shareable between players. This is nearly free
  given the command-based architecture — a blueprint is a small command sequence.
- Protect this feature. When something has to be cut, it is not this.

### 2.2 Three networks over one map

Most games in this genre have one network. This has three, and they interact.

| Network | Carries | Built from |
|---|---|---|
| **Transport** | things and people | road, rail, sea, air |
| **Utility** | capacity | power grid, water pipeline |
| **Demand** | why anywhere is worth connecting | people, jobs, tourists, retail |

Almost every interesting decision touches at least two. A mine is the canonical example: it needs
power and water (utility) and workers within a commute (demand) before it produces anything at
all, and then needs a way to ship ore out (transport).

### 2.3 Extraction against amenity

The central tension, and it emerges from data rather than being scripted.

Every tile carries an **amenity value** in 0–100, derived from elevation variance, water
proximity, tree cover and coastline, reduced by proximity to industry (weighted by industry type
and age) and by transport noise (weighted by mode and traffic volume).

- Tourism industries earn against local amenity. Extraction industries emit an amenity penalty
  field with a radius and falloff.
- So: open a bauxite pit above a lake valley and the resort down the shore starts losing money,
  and you own both.
- **Remediation** exists in later eras — you can restore amenity, expensively and slowly. This
  gives the late game a redemption arc rather than only a ratchet.

Mechanically this stops "industrialise everything" from being the optimal strategy, by attaching
a real quantified cost to the obvious move. It also means the game has something to say without
ever having to say it.

### 2.4 Obsolescence

Eras retire your vehicles and, more importantly, your assumptions. A route that printed money
with steam is a liability once a rival runs diesel on a parallel alignment. Standing still is a
losing move — and the calendar is visible, so it's fair.

### 2.5 Rivals

Rival firms are **not special**. They are headless clients issuing exactly the same commands a
human issues, into exactly the same simulation. Difficulty is capital, planning horizon and risk
appetite — never a cheat.

This has a nice property: anything a rival can do, you can do. If a rival does something clever,
it's because the game genuinely permits it.

Personalities are a small set of weightings — aggressive expander, route camper, undercutter —
rather than distinct code paths.

---

## 3. Ownership, access charges, and the buy / build / bypass triangle

**The spine of the game.** This is what makes the four acts one continuous story rather than four
modes bolted together, and it is the system most other systems should hang off.

### 3.1 Everything has an owner

Every piece of fixed infrastructure — road, bridge, tunnel, rail alignment, station, depot,
wharf, runway, canal lock, pipeline, transmission line — has an owner and an **access charge**.

- The regional authority owns everything nobody else does. Public roads are the default, and
  public roads are bad.
- Using someone else's infrastructure costs you money: per vehicle, per tonne, or per unit,
  depending on the asset class.
- Owning it means you stop paying **and** everyone else's traffic starts paying you.

### 3.2 The triangle

Whenever you face an access cost you have exactly three moves. This is fractal — it applies
identically to one bridge and to an entire trunk corridor.

| Move | Cost now | Effect |
|---|---|---|
| **Pay** | Low | Bleeds forever, and someone else sets the rate |
| **Buy** | High | Flips a cost into an income; you now set the rate |
| **Bypass** | Highest | Denies the owner their revenue and strands their asset |

Three genuinely live options at every scale, every time. That is a better decision structure than
anything else in this document.

### 3.3 The toll curve, which is what stops the snowball

Set your charge; traffic responds. Too high and rivals route around you or build a bypass, and
your expensive asset strands with no traffic on it. So revenue is charge x volume, and volume
falls as charge rises — a curve the player *feels* rather than reads.

Two dampers, both diegetic:

1. **Traffic leaves.** The curve above. Gouging is self-punishing.
2. **Price follows earnings.** Purchase price is a multiple of the asset's recent revenue, so a
   profitable road is expensive precisely *because* it is profitable. You cannot cheaply buy your
   way into a money printer.

### 3.4 It is historically accurate, which is why it feels right

None of this is invented. Turnpike trusts, railway running powers and track access charges (still
exactly how UK rail works), port dues, airport landing fees, canal tolls, electricity
transmission and wheeling charges, water abstraction licences. Infrastructure economics has
always been this game.

### 3.5 What it does to each act

- **Act I** — you can only pay. You own no infrastructure and cannot. The access-charge line on
  your P&L is a permanent ache, and it is the thing that makes the construction charter feel like
  a reward rather than a menu unlock.
- **Act II** — you can build, therefore own, therefore charge. First tolls collected. The moment
  a rival's lorry pays you is the best moment in the game.
- **Act III** — utility networks join the same system. Grid wheeling charges, water transfer
  charges. Now the three networks share one economic language.
- **Act IV** — your income mix shifts from operating to rent. **The arc is visible in your income
  statement**: Act I is 100% haulage, Act IV might be 60% access charges. That is the
  haulier-to-magnate story told in numbers, with no narration required.

### 3.6 It is what makes rivals and multiplayer work

A rival buying the bridge your whole northern operation depends on is a real attack — and a fair
one, because you could have bought it.

In shared worlds this is the thing that **entangles** players rather than merely racing them. I
use your line; you use my port. Co-operation and competition stop being separate modes and become
the same system: access agreements, reciprocal deals, deliberate mutual dependency, and the
standing threat of a buyout. Pure contract-racing multiplayer would have been thin. This isn't.

### 3.7 Regulation and the natural monopoly problem

If you own everything, rivals die, nobody pays you tolls, and the region stagnates. The mechanic
is self-limiting, which is good, but it also earns you an antagonist.

From era 5 the authority gains teeth: **forced open access, charge caps, compulsory purchase for
public benefit, and competition referrals**. A dominant player acquires a regulator. This is
historically accurate, mechanically necessary, and gives Act IV an opponent that isn't just
another company.

Compulsory purchase cuts both ways — you can be on the receiving end, and you can lobby for it
against someone else.

### 3.8 Insolvency stops being a game-over screen

A failed company's assets go to auction. Bankruptcy becomes an event in the world that other
players and rivals respond to, rather than a modal dialog. Including yours.

### 3.9 Technical consequence — flag for architecture

Route cost now includes access charges, which means **every company sees a different cost graph**
and routes are company-specific. Pathfinding results must be cached per company and invalidated
on ownership change, charge change, or network edit. Noted in
[`architecture.md`](architecture.md); it is the main reason the routing cache is keyed by company
rather than shared.

### 3.10 Open questions

- Can you charge *differential* rates — cheaper for allies, punitive for one rival? Enormously
  characterful, possibly too fiddly, and a griefing vector in multiplayer.
- Are assets bought at a formula price, or at auction, or by negotiation with the owner?
- Can infrastructure be leased rather than sold?
- Does the authority ever build competing public infrastructure to discipline you? (I think yes,
  and it should be terrifying.)

---

## 4. Economy

### 4.1 Cargo tiers

All of this is data, defined in JSON against a schema. See
[`content-and-balance.md`](content-and-balance.md).

**Extraction** — coal, iron ore, bauxite, stone/aggregate, sand, timber, crude oil, water, fish,
grain, livestock, lithium *(era 6+)*

**Processing** — coke, steel, aluminium, cement, planks, paper, refined fuel, chemicals, food,
textiles, glass, batteries *(era 7+)*

**Terminal** — goods, electronics, luxury goods, retail stock

**Passenger class** — passengers, mail, tourists

**Networked, not hauled** — electricity, water, data *(era 6+)*

**Negative** — waste and spoil. You must *remove* these, and from era 5 dumping carries an
amenity and later a regulatory cost.

### 4.2 Example chains

```
coal + iron ore          -> steel works      -> steel
bauxite + electricity    -> smelter          -> aluminium
timber                   -> sawmill          -> planks       -> goods
crude oil                -> refinery         -> fuel + chemicals
grain + livestock        -> food processing  -> food
steel + chemicals        -> factory          -> goods
steel + aluminium + electronics -> vehicle plant (era 5+)

amenity + access + accommodation -> resort   -> visitors -> spend
```

Note that the smelter consumes **electricity**, a networked resource, not a hauled one. That is
the join between the transport game and the utility game, and it should be introduced early in
Act III because it's the moment the two systems visibly become one.

### 4.3 Decay

Industries carry a rolling service-satisfaction rate.

1. Below threshold for N weeks, production falls.
2. Below a second threshold, the industry closes.
3. Closure is recoverable within a grace period — this matters, because permanent loss for a
   temporary lapse is punishing rather than tense.

Towns shrink if goods, food or passenger demand goes unserved.

### 4.4 Contracts

Generated with cargo, origin, destination, rate, volume, deadline and penalty. You bid; rivals
bid; awarded on price weighted by **reliability history**, which is a persistent stat. Being
cheap and late is a strategy that stops working.

---

## 5. Eras

Eight eras. Dates are when tech becomes *available*, not when it becomes correct to use.

| # | Years | Name | Opens |
|---|---|---|---|
| 1 | 1860–1890 | Horse and rail | Horse dray, canal barge, early steam locomotive |
| 2 | 1890–1920 | Steam | Steam lorry, mainline steam, coastal steamer |
| 3 | 1920–1950 | Combustion | Diesel lorry, diesel-electric loco, early aviation, tarmac |
| 4 | 1950–1975 | Motorway | Articulated lorry, motorways, jet freight, grade separation |
| 5 | 1975–2000 | Container | Containerisation, electrified rail, deep-water ports, waste regulation |
| 6 | 2000–2030 | Logistics | E-commerce demand, last-mile, high-speed rail, telemetry, lithium |
| 7 | 2030–2065 | Transition | Electric fleets, hydrogen, renewables, grid storage, remediation |
| 8 | 2065–2100 | Autonomous | Autonomous convoys, maglev, drone freight, closed-loop recycling |

---

## 6. Scoring

No single score. You are measured on four axes and you cannot max all four:

- **Tonnage** — raw volume moved
- **Population served** — how much of the region has decent access
- **Prosperity** — regional economic output
- **Environment** — aggregate amenity, emissions, waste handled

The endgame is a profile, not a number. A player who maxed tonnage and gutted the environment and
a player who built a beautiful low-throughput region should both feel they played well, and
should be able to argue about it.
