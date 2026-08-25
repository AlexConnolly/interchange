# Feature inventory

A complete list, checked against the original pitch. Phase tags refer to
[`roadmap.md`](roadmap.md).

---

## Gaps found in this review

Three things in the original pitch were under-specified in the first draft of the design and are
now written in properly. Recording them because they were nearly missed.

1. **"You bring people" was thin.** Passengers existed as a cargo type and nothing more. Moving
   *people* deserves to be a first-class system with its own vehicles, its own network shape
   (commuter flow is not freight flow), and its own failure modes. Now §2.
2. **"Even things like shopping" was thin.** Retail existed as a cargo called "goods". Shopping
   is actually a whole demand system — high street, retail park, last-mile e-commerce — and it is
   what makes towns feel alive rather than being cargo sinks. Now §6.
3. **Canals and pipelines were missing entirely.** "Boats" in era 1–2 means inland waterways, and
   they are among the most characterful infrastructure in the period. Oil and gas pipelines are
   likewise a whole transport mode that isn't vehicles. Both now in §1.

One more, from the art direction pass rather than the pitch:

4. **Industries need three visual states** (thriving / struggling / dead). That is a feature with
   modelling cost, not a polish item, and it has to be budgeted from the first industry.

---

## 1. Transport modes

| Feature | Phase | Notes |
|---|---|---|
| Road: lanes, surface classes, gradients | P1 | Dirt → macadam → tarmac → motorway across eras |
| Road vehicles: dray, lorry, artic, tanker, tipper | P1 | |
| Rail: alignment, gauge, gradient, curve radius | P2 | Radius limits are what make rail feel different from road |
| Rail: signalling, block and later moving-block | P2 | |
| Rail vehicles: loco + wagon rakes, multiple units | P2 | |
| Stations, depots, yards, interchanges | P2 | |
| **Canals and inland waterways** | P4 | Locks, barges, tow paths. Era 1–2 backbone |
| Sea: wharves, docks, deep-water ports, container terminals | P4 | |
| Sea vehicles: barge, coaster, bulk carrier, container ship, ferry | P4 | |
| Air: airstrip, airport, freight terminal, later drone pads | P4 | |
| Air vehicles: light freight, airliner, wide-body, cargo drone | P4 | |
| **Pipelines** for oil, gas, later hydrogen | P4 | A transport mode with no vehicles |
| Conveyors and inclines for short-haul bulk | P3 | Mine to processing, quarry to wharf |
| Cable car / aerial ropeway | Later | Mountain terrain and tourism; nice-to-have |

## 2. Passengers and mass transit

Was a gap. Now first-class.

| Feature | Phase | Notes |
|---|---|---|
| Commuter demand from home to work | P3 | Emerges from town and industry placement, not authored |
| Bus and coach services with stops and timetables | P2 | |
| Trams and later light rail / metro | P4 | Town-scale, high frequency |
| Commuter rail and park-and-ride | P4 | |
| Passenger comfort, journey time, reliability | P4 | People will not take a slow miserable route; they stay home or drive |
| Private car adoption from era 4 | P4 | The pressure that makes public transport a real fight |
| Airports as passenger gateways, not just freight | P4 | |
| Tourist flows distinct from commuters | P4 | Seasonal, amenity-seeking, higher spend |

## 3. Freight and cargo

| Feature | Phase | Notes |
|---|---|---|
| Cargo types across five tiers | P1 | See design.md §4.1 |
| Loading, unloading, transfer, dwell time | P1 | |
| Containerisation from era 5 | P4 | Transfer cost drops hard; changes the whole optimum |
| Refrigerated, hazardous, bulk, liquid handling | P3 | Requires matched vehicle and terminal |
| Mail and parcels | P2 | |
| Waste and spoil as negative cargo | P4 | You must remove it; dumping costs amenity, then legality |

## 4. Industry and supply chains

| Feature | Phase | Notes |
|---|---|---|
| Extraction industries | P3 | Mining, quarrying, forestry, fishing, agriculture, water |
| Processing industries with multi-input recipes | P3 | |
| Founding industry yourself | P3 | The extraction charter |
| Three-network requirement: power, water, labour | P3 | design.md §2.2 |
| Production scaling with supply satisfaction | P3 | |
| Decay and closure | P3 | design.md §4.3 |
| **Thriving / struggling / dead visual states** | P3 | Gap found in art review |
| Industry ageing and modernisation | P4 | |

## 5. Utilities

| Feature | Phase | Notes |
|---|---|---|
| Power generation: coal, hydro, wind, solar, nuclear, gas | P3 | |
| Transmission grid with capacity and losses | P3 | |
| Grid wheeling charges | P3 | Ownership spine applies to utilities too |
| Water: reservoirs, abstraction, treatment, desalination | P3 | |
| Water pipelines and irrigation | P3 | |
| Drought and demand events | P4 | |
| Grid storage and renewables intermittency | P4 | Era 7 makes this a real puzzle |

## 6. Retail and shopping

Was a gap. "Even things like shopping" from the pitch.

| Feature | Phase | Notes |
|---|---|---|
| Town commercial demand for goods and food | P3 | |
| High street retail, tied to town centre access | P4 | |
| Retail parks, tied to road access and parking | P4 | Competes with high street; a real planning tension |
| Last-mile delivery and e-commerce from era 6 | P4 | Demand shifts from shops to doorsteps; freight pattern inverts |
| Retail as an amenity contributor | P4 | A town with no shops is a town people leave |

## 7. Tourism and amenity

| Feature | Phase | Notes |
|---|---|---|
| Amenity field derived from terrain | P4 | design.md §2.3 |
| Industry and traffic degrade amenity | P4 | |
| Resorts, heritage sites, ski, coastal | P4 | |
| Visitor demand driven by amenity x access x accommodation | P4 | |
| Seasonality | P4 | |
| Remediation to restore amenity | P4 | Era 7; the late-game redemption arc |

## 8. Towns and population

| Feature | Phase | Notes |
|---|---|---|
| Town growth from access, jobs, goods, services | P3 | |
| Town shrinkage when unserved | P3 | |
| Zoning influence rather than direct control | P4 | You are not a city builder; you shape conditions |
| Labour catchment by commute time | P3 | The demand network |
| Town character: industrial, market, resort, dormitory | P4 | |

## 9. Ownership and access charges

The spine — design.md §3.

| Feature | Phase | Notes |
|---|---|---|
| Every fixed asset has an owner | P1 | In P1 the owner is always someone else |
| Access charges paid per use | P1 | The ache that makes the charter a reward |
| Buying infrastructure | P2 | |
| Setting your own charges | P2 | |
| The toll curve — traffic responds to price | P2 | Primary snowball damper |
| Bypass construction | P2 | |
| Asset valuation as a multiple of earnings | P2 | Secondary damper |
| Compulsory purchase, both directions | P4 | |
| Regulation: open access, charge caps, referrals | P4 | Era 5+; the antagonist for a dominant player |
| Asset auctions on insolvency | P4 | |
| Differential rates per company | Open | design.md §3.10 — possible griefing vector |

## 10. Finance

| Feature | Phase | Notes |
|---|---|---|
| Cash, running costs, loans, interest | P1 | |
| Insolvency | P1 | |
| Profit and loss by route, asset and cargo | P1 | The genre demands real reporting |
| Income mix reporting: operating vs rent | P2 | Where the arc becomes visible |
| Depreciation and asset book value | P2 | |
| Bonds or share issue | Later | Only if the economy needs another lever |

## 11. Contracts, objectives and events

| Feature | Phase | Notes |
|---|---|---|
| Generated haulage contracts with deadlines and penalties | P1 | |
| Competitive bidding against rivals | P2 | |
| Reliability history affecting awards | P2 | Being cheap and late stops working |
| Generated objectives and milestones | P3 | |
| Disruption events: flood, strike, fuel price, boom | P4 | |
| Charter progression gates | P1 | |

## 12. Rivals and regulation

| Feature | Phase | Notes |
|---|---|---|
| AI companies as ordinary command-issuing clients | P4 | Full behaviour; a stub exists earlier for bidding |
| Personality weightings | P4 | Expander, camper, undercutter |
| Rivals buying infrastructure you depend on | P4 | |
| The authority building competing public infrastructure | P4 | Should be genuinely frightening |

## 13. Terrain and construction

| Feature | Phase | Notes |
|---|---|---|
| Procedural region generation per seed | P1 | |
| Cut and fill, embankments, cuttings | P2 | Visible and characterful — art-direction.md §11 |
| Bridges and viaducts | P2 | |
| Tunnels | P2 | |
| Land reclamation | P4 | |
| Terrain as a cost, not a paint tool | P2 | Moving earth is expensive and permanent |

## 14. Time, eras and technology

| Feature | Phase | Notes |
|---|---|---|
| Game calendar with pause and speed controls | P1 | |
| Eight eras, 1860–2100 | P6 | Two eras in P1–P3, full run by P6 |
| Vehicle obsolescence and replacement | P3 | |
| Tech availability on the calendar | P3 | |
| Era transition events | P4 | Containerisation and e-commerce both invert the optimum |

## 15. Weather and seasons

| Feature | Phase | Notes |
|---|---|---|
| Seasons affecting land palette | P4 | |
| Seasonal tourism demand | P4 | |
| Snow closing mountain routes | P4 | |
| Weather as atmosphere only, never obscuring information | P4 | art-direction.md §13 |

## 16. The Junction Lab

| Feature | Phase | Notes |
|---|---|---|
| Freehand junction editor | P2 | design.md §2.1 |
| Priority, signals, roundabouts, grade separation | P2 | |
| Live throughput, delay and queue readout | P2 | |
| Higher-resolution simulation inside the editor | P2 | |
| Rail junction signalling puzzles | P2 | |
| Junction blueprints, saveable and shareable | P2 | Nearly free given command architecture |

## 17. Information and overlays

| Feature | Phase | Notes |
|---|---|---|
| Congestion heatmap | P1 | |
| Ownership overlay | P2 | Essential once the spine exists |
| Amenity field overlay | P4 | |
| Catchment and commute-time overlay | P3 | |
| Power and water network overlays | P3 | |
| Cargo flow ribbons | P2 | |
| Statistics and graphs over time | P2 | The genre demands them |
| Vehicle inspection — click any vehicle, see its job | P1 | A direct payoff of agent-based simulation |

## 18. Multiplayer and social

| Feature | Phase | Notes |
|---|---|---|
| Lockstep shared worlds | P5 | |
| Co-operative worlds | P5 | Ships first |
| Competitive worlds | P5 | |
| Access agreements between players | P5 | Falls out of the ownership spine |
| Spectating and late join | P5 | |
| Blueprint sharing | P2 | Works single-player too |

## 19. Capture

Nearly free consequences of the deterministic core — worth listing so they don't get treated as
expensive.

| Feature | Phase | Notes |
|---|---|---|
| Replays | P2 | A save *is* a replay |
| Timelapse of a whole region 1860–2100 | P2 | Marketing asset for nothing |
| Photo mode | P4 | |

## 20. Meta

| Feature | Phase | Notes |
|---|---|---|
| Local saves and autosave | P1 | |
| Accounts and cloud saves | P2 | Or P1 if Act I ships publicly — see O6 |
| Onboarding | P1 | Act I *is* the tutorial; that was the point of the arc |
| Settings, key rebinding | P1 | |
| Touch and compact layout | P1 | Pointer abstraction from day one |
| Colourblind-safe livery and semantic palettes | P2 | Non-negotiable given the livery system |
| Telemetry | P2 | |
| Localisation | Later | |
| Modding via the data schema | P3 | Falls out of data-driven content |

---

## Explicitly out of scope

Saying no now is cheaper than saying no later.

- **City building at the building level.** You influence towns; you do not place houses. That is
  a different game and it would swamp this one.
- **First-person or free camera.** The orthographic camera is a design constraint, not a
  limitation to be escaped.
- **Combat, sabotage, crime.** Competition is economic. There is no other kind here.
- **Real-world map import.** Attractive, endless, and it fights procedural balance.
- **LLM agents inside the simulation.** D11. Closed.
- **Vehicle interiors, passenger individuals.** Passengers are flows with properties, not
  entities. The agent budget belongs to vehicles.
