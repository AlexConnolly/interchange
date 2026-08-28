# Goals

Live list. Each item states what is wrong or wanted, and what "done" means, so
neither of us has to remember. Struck through when finished, with the commit.

---

## ~~1. Bare trees look horrific~~ — done

**What.** Winter trees — the ones drawn without leaves — read as a mess of pink
sticks rather than as bare trees. They are the most numerous single object in the
district, so they set the tone of the whole picture for a quarter of the year.

**Done when.** Remodelled through the Blender pipeline in `art/` — never
hand-written geometry — and a winter screenshot at two zoom levels looks like
countryside.

---

## ~~2. Tractors drive through water~~ — done

**What.** The ambient farm machinery ignores water and drives across becks and
ponds. Reported twice now.

**Done when.** No tractor path crosses a tile below sea level, proven by a
headless probe that samples every tractor position over a long run rather than by
looking at a screenshot.

---

## ~~3. Zoom should move toward the pointer~~ — done

**What.** The wheel zooms about the centre of the screen, so zooming in on
something means zoom, drag, zoom, drag. Every map in the world zooms toward the
cursor.

**Done when.** The world point under the pointer stays under the pointer as the
wheel turns — near enough that it feels anchored rather than exactly, since the
camera is orthographic and pinned to a fixed elevation.

---

## ~~4. A placed business does not draw~~ — done

**What.** Building one reports success, takes the money and puts a marker with
the right icon on the map — and no building appears. A bug in the feature just
shipped: the simulation has the site, the renderer never got the model.

**Done when.** A business built on your own land is drawn, at its footprint,
immediately, and is still there after a reload of the scene.

---

## ~~5. Power lines~~ — done

**What.** Old-school single-pole timber power lines, the American kind: one wooden
pole, a crossarm, wires strung between. Running **across** the district and
connecting to the **edges** of the map, because the grid comes from somewhere
else and goes somewhere else — the district is a place the wires pass through.

**Rules.** Same as everything else in this world: generated from the world seed,
so the same seed gives the same lines every time. They are scenery, not a
network the player operates.

**Done when.** Lines cross the district edge to edge, poles are modelled through
the Blender pipeline, the layout is identical for a given seed and different for a
different one, and they route around water and towns rather than through them.

---

## ~~6. Contracts: two tabs, and a real breakdown behind each row~~ — done

**What.** The contracts screen is one flat list and answers almost nothing. It
should be two tabs.

**Available.** What is on offer, with anything you are *already assigned to*
filtered out — a list that keeps offering you work you have taken is a list you
stop reading. Each row says what it pays. Clicking one slides through to the
detail, where you pick a lorry and press **Assign to contract**.

**Active.** What you are running, and the numbers that actually matter: what it
pays, what it has paid you so far, and what that comes to per day. Clicking one
slides through to a full breakdown, where you can also **cancel** it.

**Done when.** Both tabs work, the sliding page-and-back is the same one the
place panel uses — not a second idiom — and the per-day figure is derived from
the run rather than guessed.

---

## ~~7. The opening~~ — done

**What.** The district takes a moment to be ready — a dozen GLB files to fetch and
bake, a heightmap to mesh, influence to resolve — and that moment was spent looking
at an empty field while things popped into it.

**Done when.** Ten seconds of coming down through cloud: three of solid overcast
with "Loading game...", four of descending from far outside the playing zoom as the
cloud clears, three of the interface sliding in from the edges it lives on. No
input until it ends. `?intro=0` skips it, which is what makes the game
photographable.

---

## ~~8. An advisor, as an inbox~~ — done

**What.** A tutorial that arrives as post rather than as a modal. A button beside
the money with a dot on it when something is unread; a toast out of the button
when a letter lands, showing who wrote and one trimmed line; a page of letters
behind it. The game can send one at any time.

**The point.** Nothing in this game is urgent, so a modal that stops the world to
explain the market is interrupting somebody who was enjoying themselves to tell
them a thing they would have found out anyway — but not explaining the planning
board means most people never find rung seven. A letter waits. It is still there
in ten minutes when you have run out of things to do.

**Who it is from.** Somebody, not the game. The first is from Tom Ashbury, who
left you the yard. A tip signed by a name is a tip you can be pleased to get; the
same words in a grey box are homework.

**Done when.** Letters fire once, on a predicate over the world, so they arrive
*because of what you did*. Verified end to end and unit-tested.

---

## ~~9. Saving, and a main menu~~ — done

**What.** A main menu — New game, Load game, Settings, Exit — and saving from the
cog. Saves list out of localStorage, auto-named from where you were in the game.
Autosave every game-month into its own slot. The intro plays on load as well as on
new.

**The format is a state dump, not a replay.** There was already a save system and
it did not work: it saves a *command log* and reloads by replaying it, which
depends on every player action going through the command queue, and none of them
do — `buyLand`, `placeSite`, `layTrackAt`, `acceptContract`, `cancelContract`,
`sellOnMarket`, `buyPlace` and `foundYard` have zero pushes between them. A replay
would rebuild the district as generated with the player having done nothing.

**Generic, walked rather than named.** A hand-written serialiser is a list of what
somebody remembered, and the failure is silent: a field added to a table next month
loads a world subtly unlike the one saved. So it walks the tables, and `stateHash`
plus a round-trip test is what makes that trustworthy.

---

## ~~10. Contracts and tasks~~ — done

**Where it came from.** Reported from a real game: "my tipper is definitely going
between my livestock farm and the abattoir but the business doesn't seem to know
about the vehicle anymore — it's just... doing stuff." Buying the place a contract
delivers to closes the contract, correctly, and leaves the lorry running,
deliberately. The comment on that code claimed "the player does not have to notice
that anything happened". They noticed. Measured: £75,206 earned before the
purchase, £0 in the twenty days after, lorry still driving, work listed nowhere.

**"A contract is a task, but a task is not a contract."** So a task is *derived*,
not stored: a service of yours with no contract attached. Nothing new to save,
nothing to keep in step, and the conversion becomes a rename rather than a
disappearance — `world.tasks()`.

**Measured in tonnes, not money.** A delivery into a place you own pays nothing at
the moment of unloading, which is right — it is your own shelf, and the money is
made later when the shop sells. Printing £0/day next to a lorry running flat out
would be arithmetically true and a lie about whether the run is working. So
`taskCarried` reports what it moved.

**One list, a chip to say which.** Tasks sit in the Active tab beside contracts
rather than in a third tab, because they answer the same question — what is my
fleet doing. Named on the sourcing row too, which is where tasks are born and
never used to say so.

### Three bugs the pictures found

- **`created` was never stamped.** Two of three `services.alloc` callers omitted
  the tick, so every run reported existing since the beginning of the world: a task
  started that afternoon said "78 days on this run" and divided its tonnage by
  seventy-eight, understating the rate fourfold.
- **The ledger's second row was clipped.** `.bubble-body` is a flex column with a
  max height and a flex item shrinks by default: a two-row grid measuring 51px a row
  was handed a 63px box, and `overflow: hidden` ate the rest. Every cell reported
  the right text at the right size and half of them were invisible — the *contract*
  page had been printing two of its four figures for as long as it had had four.
- **`board.delivered` was set to zero and incremented nowhere.** Every contract in
  the game printed "0 loads", next to an earnings total in the tens of thousands.
  Counted at the payment site now, and outside the `pence > 0` test, because a load
  into a place you own is still a load run.

And a fourth that was only a misreading, which is its own lesson: `.needs
b::before` puts a middot in front of the figures, and when the row wrapped it
started line two — "· £62,252 so far" reads as a *minus*, so a contract earning
sixty-two thousand looked like one losing it. The figures have their own line now.

---

## ~~11. Approval: tie actions to impact~~ — done

**The objection.** "I'm a bit iffy with parish. I don't like that it only allows
you to influence, not do." Approval was a currency — be useful, watch a number
rise, spend it on permission to widen a lane or on the board agreeing you belong.
A mechanic whose only output is permission to ask for a favour.

**Turned inside out.** Approval is not spent and not bought. It is a *consequence*
of what you build and a *gate* on what you build next, and it is **local**.

- Every building carries a signed `approvalImpact` over an `approvalRadius`,
  summed into a coarse field. Shop +9, green +12, park +16; depot −22, terminal
  −20, abattoir −20.
- `approvalNeed` gates placement **where you are standing**. At rest (30) the
  parish will have a shop, a farm or a green; a creamery wants 35, an abattoir 52,
  a depot 55.
- Doing the job stays the baseline: deliveries and stocked shelves lift the
  district-wide part; the drift pulls it back.

**Its own number, not the amenity penalty**, because pollution and unpopularity
are different things and the two clearest cases disagree: a quarry is the worst
amenity penalty in the game and sits where nobody lives; a distribution centre has
an amenity penalty of 2 and is the most resented building in the parish.

**The move the old design could not express**, measured on seed 1985: creamery
refused at rest → a village green four tiles off → local approval 30.0 to
37.9 → creamery allowed. Improve a neighbourhood, earn the right to industrialise
it.

**Gone.** `fundParish`, `levyGain`, `Works`, `propose`, `planningOpen`, the Parish
tab, and "ask to be counted" — a button costing £9,000 and 22 points of approval,
bought with the thing it granted. Standing is derived now: a town that thinks well
enough of you counts you, and stops when you stop deserving it.

**New.** Village green, park and playing field on an `amenity` kind — its own kind
rather than a terminal with an empty recipe, because half the simulation asks a
site what it wants and the honest answer for a park is nothing, road access
included. Models through the Blender pipeline: 264, 628 and 340 tris.

**The dial**, top right beside the clock. A face, not a bar: a bar says "fill me",
and a haulier at thirty and one at ninety are both playing correctly. Clicking it
lists what you have built and what each is doing, then the towns one by one —
which is how a player learns approval is a *place*.

### Bugs the probes and the pictures found

- `raised` landed in `foundIndustry` instead of `placeSite`, so the field was empty
  everywhere and every impact read as zero. It also has to be player-only, or
  buying a going concern makes you answer for somebody else's decision.
- The field summed over integer cell offsets while the reasons list used exact tile
  distances — a green gave 4.0 to the dial and 3.1 to the explanation of it. Both
  measure from the cell centre now.
- Radii of 6–11 tiles are 1.5–2.75 cells on a 4-tile grid: a step, not a gradient.
  Doubled.
- `approvalForBuild` is one call, because the gate measures at the footprint centre
  and anything asking at the cursor asks about the north-west corner — a tile and a
  half out, enough to show a green preview that refuses the click.
- **Five even bands put the resting 30 in the fourth one**, so every new game opened
  with the parish pulling a face at a player who had done nothing. `parish.ts` and
  its test exist for that alone.
- The park icon was two crowns over two trunks and read as **two people** at 20px —
  on the map marker too. It is a tree inside railings now.
- Placed buildings cleared scatter on their footprint only, so a playing field in a
  wood came up inside a thicket. The ring goes too, the same ground the
  "too close to another works" rule already reserves.

---

## ~~12. The parish has to notice a first van~~ — done

**The complaint.** "If I do something great early game there's no scale — it gives
me maybe +1%. Nothing. Surely early game that impacts more?"

**It gave nothing, not +1%.** Measured on seed 1985: a load was worth 0.055 and a
flat drift took 0.16 a day, so standing still cost **2.9 loads a day** — and a
working first van on the opening contract runs **2.50**. Approval sat at exactly
30.00 for a whole game year while the haulier earned £925,000.

**The drift was as much to blame as the rate.** A flat drag has two failure modes
and no good one: below it you are pinned at the floor and nothing registers, above
it you climb until something else stops you. It is a proportional decay now — two
per cent of the distance a day, a fifty-day time constant — so any gain at all lifts
you off the floor and the number settles at `rest + gain/decay`.

**And a load is divided by the size of the fleet.** What the parish registers is not
how many loads you shifted but how much of *you* they saw doing it. One van running
the village milk is your whole business and a visible part of the parish's week; the
same run from a twenty-lorry firm is a rounding error to both. Which answers the
request from the other end — nothing is made deliberately generous to a beginner, it
is that a beginner's one lorry genuinely *is* their whole operation.

**The curve now**, one van, seed 1985: 30 → **38.4 in the first month**, 44.6 at two,
50.8 at four, settling near 54. And when the lorry stopped working around day 216 it
fell to 42 and climbed back when it resumed — which is the half a flat drift could
never do.

**The design decision this makes, stated rather than stumbled into:** approval
measures how well you serve, not how big you are. A four-lorry firm doing four times
the work is regarded the same as the one van; four lorries queued on one milk run
manage 3.33 loads a day between them and are regarded *less*. Growing is rewarded
everywhere else in this game; here it is neutral, and what separates a large operator
from a small one is what they have **built**, which is the local half of the field —
and that is what keeps the build gates meaningful for the whole game rather than
until somebody gets rich.

---

## Standing rules, for anything on this list

- **Nothing whose visibility matters may be animated through opacity.** Third time
  this bit: the build tray sat invisible for half a second after opening, and the
  contract page rendered its header with a completely blank body under it while the
  DOM was correct. A CSS animation advances on *frames*, and the frame clock here
  belongs to a WebGL scene that can drop to a few a second. Entrances have no fill
  mode, exits keep `both`, and entrances slide rather than fade.

- **Models come from the pipeline.** `art/` and Blender, never hand-written
  geometry.
- **Audio comes from real clips.** Never synthesised on the fly.
- **Measure, do not reason.** A screenshot has misled this project repeatedly:
  software GL at three frames a second cannot accumulate a particle plume, and a
  mid-animation frame looks like a bug. Probe it.
- **`foundCost` in the content is not the price.** `SITE_PRICE_SCALE` is 8, so a
  village green with `foundCost: 600000` costs £47,120 to build and not £6,000. I
  asserted the content figure as a price twice before checking — once here and once
  in a commit message. The tray reads `foundPriceBase`, which is the real thing.
- **Balance anchor.** A second van at about 8 real minutes on seed 1985, checked
  with `packages/tools/src/probe.ts` after anything that touches the economy.
- **`window.interchange` is the handle.** `{ world, renderer }` on the running
  page, so a driver can arrange whatever state a picture needs with the same calls
  the interface uses. It replaced a growing pile of one-shot URL parameters, and it
  is how three of the four bugs above were found: measure the DOM, not the pixels.
