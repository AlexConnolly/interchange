# Cut

Everything removed, why, and what it would cost to bring back.

This document exists so that cutting is reversible and so that nothing is lost
by being left out. A cut recorded here is a decision; a cut that is merely
forgotten is a hole.

Read it before proposing anything. Most good ideas are already in it.

---

## Cut, and unlikely to come back

| | Why |
|---|---|
| **All eras but one** | The whole 1860–2100 span and everything it carried: horses, steam, canals, containerisation, e-commerce, electrification, air freight, drones. **The largest cut in the project.** Eras multiplied content eightfold, produced a class of bug nothing else could, and carried a standing art-coherence risk — all to deliver a sense of advancement that the purchase ladder delivers better. `decisions.md` D7. |
| **AI rival companies** | The direct instruction, and correct twice over. With rivals the district changes constantly for reasons that are not the player's, which is fatal to a building game — and the job they were actually doing, paying tolls, is done better and for a tenth of the cost by background traffic as a flow. 1,216 lines. |
| **Regulation and antitrust** | Escalating intervention against a dominant operator. Needs rivals to be unfair to. |
| **Access agreements** | Negotiated discounts between two companies. Needs two companies. |
| **Multiplayer, shared worlds, the relay** | A building game about your own district. The whole `server/` package, the client session layer, and — the real prize — the deterministic-lockstep constraint on every line of simulation code. |
| **Compulsory purchase, differential tolls, insolvency as a world event** | All of them existed to make rent-seeking between companies interesting. A toll on background traffic needs none of them. |
| **Canals, sea, air** | Canal freight was finished by 1985. The others need a bigger map. |
| **Photo mode** | |
| **Twelve of the twenty cargoes** | Folded away or replaced by nine specific 1985 jobs. Nine of the originals had never been carried once in a hundred and forty years of measured play. |

## Closed, not queued

Two things left the queue rather than sitting in it, and both were closed by the
era decision.

**Canals: out for good.** Under a Victorian framing they were the best available
addition — the incumbent 1860 network, and a turnpike-and-canal district makes
the buy-or-build decision genuinely rich. In 1985 canal freight is finished. The
question is closed rather than deferred.

**Amenity: in, not deferred.** It came *off* this list. When the top of the
ladder is deciding where things go, siting industry without a downside is not a
decision, so amenity is core rather than optional. It is also exactly the right
decade — 1985 is when every district in England was having that argument.

## Cut, and first in the queue to return

Roughly in order of what each adds per unit of complexity.

| | Why it was cut | Cost to restore |
|---|---|---|
| **Rail you build from nothing** | Rail is something you *buy* — one branch line, hired, then bought, then extended. A second network to design, path, balance and build is a project, not a purchase | High. The largest possible future addition, and the shape of the game does not need it. |
| **Passengers as a business** | The district has passenger traffic, but as part of the background flow rather than as something you operate | Moderate. Bus deregulation in 1986 makes it the most era-appropriate expansion available. |
| **Weather with teeth** | Snow shutting a hill road is a decision you made in advance; a bill arriving on a Tuesday is not | Low. Keep only the half that makes a route choice matter. |
| **Contracts** | Bidding, deadlines, penalties, reliability. Paperwork around a route that either pays or does not | Moderate, and only ever as *offers you can refuse*, never as a task list. |
| **Settlement character** | Flavour on a demand basket — market town, dormitory, industrial | Low, and it was written and tested. Genuinely nice; not load-bearing. |
| **Power and water networks** | Two more connected-component problems on top of the one that matters | Moderate. Only if an industry needing power creates a real siting decision. |
| **Land reclamation** | Building new ground out of shallow water | Low. Wrong scale for one district. |

## Cut, and probably right to stay cut

| | Note |
|---|---|
| **Four acts and four charters over 240 years** | Replaced by five purchases over ten. Charters gated by licence; the ladder gates by what you can afford, which needs no separate system. |
| **Four world sizes up to 1024²** | One size, 256², about 8 km square. |
| **Fourteen towns** | Five settlements and four yards. On a 384 map with fourteen towns, most were places you had never been. |
| **Labour catchment / commute modelling** | A third network for an effect the growth model already approximates. |
| **Most overlays** | Congestion, ownership and amenity survive. The rest went with their systems. |
| **Objectives system** | The ladder is the objective, and each rung is one sentence. |
| **The 25,000-vehicle stress harness** | Sized for a district ten times larger than the one being built. |
| **20× game speed** | Dropped so the sun can run on the game clock at every speed instead of on a separate one. |

---

## The two lessons

**Ownership was nearly cut, and should not have been.** In the previous pass I
demoted it from the spine to a cost structure, on the evidence that rent was
8.76% of income for most of the design's complexity. The evidence was right and
the conclusion was wrong: the idea was fine, the *payer* was the problem. I had
assumed only a simulated rival could pay a toll. Traffic can, and a flow does it
for a tenth of the code. See `decisions.md` D14.

The transferable part is not about ownership. It is that when a good mechanic
appears to need an expensive subsystem, the question is whether that subsystem
is the only thing that could fill the hole. Usually it is not.

**Scope collapse was predicted, in writing, and happened anyway.** The old risk
register had it at High: *"R3 — Scope collapse; eighteen months in, nothing
playable."* Its mitigation was "act-based shipping; every phase ends in a
complete game" — the right answer, not followed, because phases were treated as
gates to pass rather than as products to finish.

Every item on this list was added by somebody reasonable for a stated reason,
and most of the reasons were good. That is how a spec reaches a hundred and
thirty-three features: not carelessness, but a run of individually defensible
additions with nobody counting.

So the rule is a closed list. `design.md` has six systems. Anything else comes
here first and waits for somebody to argue it out.
