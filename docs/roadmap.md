# Roadmap

Seven phases. **Every one ends in something playable.** That is the organising principle and the
only real defence against the way projects in this genre die.

No dates — they'd be fiction until we know available hours. Relative weight is noted instead.

---

## Phase 0 — Spikes

*Small. Throwaway code, real answers.*

The five hardest things, proven before anything is built on them.

1. **Determinism replay harness** green across Chrome, Firefox, Safari and Android.
2. **25,000 instanced vehicles** holding 60 fps with the ortho camera.
3. **Hierarchical pathfinding** over a million-tile graph inside 2 ms — including the per-company
   cost-graph multiplier from D14, which is the part most likely to bite.
4. **Chunked terrain streaming** at region scale.
5. **The art spike.** Port the modelling library, measure the foreshortening constant for our
   camera, settle the camera elevation, and take one lorry all the way through the loop to a
   silhouette at 14 pixels.

**Gate:** all five green, or the design changes. Cheaper to change it here than anywhere else.

---

## Phase 1 — Act I, shipped

*Substantial. This is a real game.*

One generated region. Roads only. Horse and steam vehicles. Contracts, money, interest,
insolvency. Local saves. Congestion overlay. Click any vehicle and see its job.

Critically, **access charges are in from the start** — you pay to use roads you don't own and you
cannot do anything about it. That ache is the whole setup for Act II.

A complete two-hour game with a beginning and an end, in front of real players.

**Gate:** strangers play it twice.

---

## Phase 2 — Rail, ownership, and the Junction Lab

*Substantial.*

Construction charter. Track laying, stations, signalling, gradients, bridges, tunnels, cut and
fill. Buses.

**The ownership spine goes live:** you can buy infrastructure, set your own charges, feel the toll
curve, and build bypasses. Ownership overlay. Income-mix reporting so the arc starts showing in
the numbers.

The **Junction Lab** — the piece most worth getting right — plus blueprints, replays and
timelapse, which are nearly free here.

Accounts and cloud saves land here, on a save format that is already tiny. (Or in Phase 1 if Act
I ships publicly — see O6.)

**Gate:** players share junction screenshots, and the first toll a rival pays you feels as good
as it should.

---

## Phase 3 — Industry, utilities, people

*The largest phase.*

Extraction charter. Founding industries, processing chains, the power grid, water networks,
decay, industry visual states. Conveyors. Commuter demand and labour catchment. Eras one to three
with real obsolescence. Grid wheeling charges bring utilities into the ownership system.

The economy stops being a contract board and becomes a machine.

**Gate:** the balance sweep finds no dominant strategy, and no dead cargo types.

---

## Phase 4 — The full region

*Large.*

Land charter. Sea, air, canals, pipelines. Ports, airports, ferries. Towns, tourism, amenity and
remediation. Retail and last-mile. Trams and commuter rail. Seasons and weather. Events.

Rivals become genuine competitors — including buying infrastructure you depend on — and
**regulation** arrives as the antagonist for a dominant player.

**Gate:** losing to a rival feels fair, and being regulated feels earned.

---

## Phase 5 — Shared worlds

*Small — the expensive work was paid for in Phase 0.*

Lockstep multiplayer. Co-operative first, competitive second. Access agreements between players,
which fall straight out of the ownership spine. Spectating and late join.

**Gate:** zero desyncs over a full era run.

---

## Phase 6 — Scale and launch

*Substantial.*

Full 1860–2100 era run. The generated asset library at volume. Onboarding, telemetry, performance
budgets per device tier, accessibility, colourblind-safe liveries. Release.

**Gate:** ship.

---

## What can be cut

Stated now, while it's cheap to be honest.

- **Cuttable:** cable cars, land reclamation, photo mode, share issue, localisation, modding
  documentation, era 8.
- **Cuttable under protest:** canals, weather, competitive multiplayer.
- **Not cuttable:** the Junction Lab, the ownership spine, the determinism core, industry visual
  states. Cutting any of these produces a different and worse game.
