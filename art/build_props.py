# -*- coding: utf-8 -*-
# What is standing in the fields.
#
#   blender --background --python art/build_props.py
#
# "There's loads of fields, but there's nothing in the fields. None of them have
# harvests in them, none of them have ploughing. They don't look like real
# farms." Half of that was the crop assignment, which was random and is now tied
# to the farms. The other half is this: an empty green rectangle is a lawn, and
# what makes it a field is the stuff left standing in it.
#
# Six props, and the choice is about what reads at forty pixels from four hundred
# feet. Not a plough or a gate — you cannot see them. Round bales throw a shadow
# and sit in a line; a stook is a pale dot in a gold field; sheep are three white
# specks that say *grazing* faster than any shade of green can.
#
# Budget is the tree budget, for the tree reason: these are drawn hundreds of
# times, so their cost is the only one that is really multiplied.
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import lib  # noqa: E402

STRAW = (0.784, 0.678, 0.400, 1)
STRAW_DARK = (0.647, 0.541, 0.310, 1)
WRAP = (0.878, 0.882, 0.867, 1)
FLEECE = (0.878, 0.867, 0.831, 1)
HIDE = (0.290, 0.220, 0.176, 1)
HIDE_PALE = (0.878, 0.855, 0.808, 1)
SOIL = (0.478, 0.353, 0.243, 1)
TIMBER = (0.478, 0.360, 0.243, 1)

# The yard palette. Everything below stands *at a business* rather than in a
# field, and it exists to answer "what is this place?" from four hundred feet
# without reading the icon over it — "a livestock farm with no animals", which is
# fair, and true of every other trade too. A quarry with no stone in the yard is
# a shed.
LOG = (0.494, 0.376, 0.259, 1)
LOG_END = (0.780, 0.686, 0.522, 1)
SAWN = (0.847, 0.769, 0.612, 1)
STONE = (0.616, 0.604, 0.573, 1)
STONE_PALE = (0.714, 0.706, 0.678, 1)
SACK = (0.784, 0.741, 0.639, 1)
CHURN = (0.792, 0.812, 0.824, 1)
TANK = (0.855, 0.863, 0.855, 1)
PALLET = (0.639, 0.518, 0.361, 1)
CRATE = (0.549, 0.400, 0.271, 1)
HURDLE = (0.600, 0.510, 0.384, 1)
# A bird, seen from above against a field. Dark, because that is all a bird is
# at this distance: the underside is never lit and the silhouette is the whole
# animal.
BIRD = (0.278, 0.290, 0.318, 1)

# Spring. Two of the three or four things in an English hedge bank that are
# visible from four hundred feet, which is the only test that matters here.
DAFFODIL = (0.949, 0.808, 0.235, 1)
DAFFODIL_LEAF = (0.353, 0.510, 0.259, 1)
BLOSSOM = (0.973, 0.925, 0.933, 1)


def _paint(obj, rgba, name, rough=0.85):
    obj.data.materials.append(lib.material(name, rgba, rough=rough))
    return obj


def bale_round():
    """A round bale, lying on its side.

    A cylinder on its axis, which is eight triangles of silhouette and the most
    recognisable object in an English field. The end cap is a slightly darker
    straw so the roll direction reads.
    """
    o = lib.cyl('bale', 0.055, 0.055, 0.075, loc=(0, 0, 0.055),
                rot=(0, math.pi / 2, 0), segments=8)
    _paint(o, STRAW, 'straw')
    return [o]


def bale_wrapped():
    """The same bale in plastic. White, which at this size is the point: a line
    of them across a green field is the strongest mark a field can carry."""
    o = lib.cyl('balew', 0.052, 0.052, 0.072, loc=(0, 0, 0.052),
                rot=(0, math.pi / 2, 0), segments=8)
    _paint(o, WRAP, 'wrap', rough=0.45)
    return [o]


def bale_stack():
    """Square bales, stacked three and two. What is left at the edge of a field
    after harvest, and it reads as *work having happened*."""
    made = []
    for i, (x, z) in enumerate([(-0.05, 0.03), (0.0, 0.03), (0.05, 0.03),
                                (-0.025, 0.09), (0.025, 0.09)]):
        o = lib.box('stack%d' % i, (0.048, 0.062, 0.055), loc=(x, 0, z))
        _paint(o, STRAW if i % 2 == 0 else STRAW_DARK, 'straw%d' % (i % 2))
        made.append(o)
    return made


def stook():
    """Sheaves leaned together. Anachronistic for 1985 and kept anyway, because
    a gold field with pale cones standing in it is the single most legible
    'this has been harvested' the renderer can draw at this size."""
    made = []
    for i in range(3):
        a = i / 3 * math.tau
        o = lib.cyl('stook%d' % i, 0.030, 0.008, 0.11,
                    loc=(math.cos(a) * 0.016, math.sin(a) * 0.016, 0.055),
                    rot=(math.sin(a) * 0.22, -math.cos(a) * 0.22, 0), segments=5)
        o.location.z += 0.012
        _paint(o, STRAW, 'straw')
        made.append(o)
    return made


def sheep():
    """Three sheep, as a group.

    One sheep is a speck and reads as dirt. Three in a loose cluster read as a
    flock, and grouping them into one model means one instance instead of three —
    so the field can be covered in them for the price of a third of the draws.
    """
    # No heads and no chamfer. A sheep is two pixels: the head was thirty-six
    # triangles of something nobody can see, on the model drawn most often in
    # the game. Three pale boxes at slightly different sizes and angles read as
    # a flock, and that is all a flock has to do.
    made = []
    for i, (x, y, s, a) in enumerate([(0.0, 0.0, 1.0, 0.2), (0.07, 0.04, 0.9, -0.6),
                                      (0.03, -0.07, 0.85, 1.1)]):
        b = lib.box('ewe%d' % i, (0.040 * s, 0.024 * s, 0.021 * s),
                    loc=(x, y, 0.019), rot=(0, 0, a))
        _paint(b, FLEECE, 'fleece')
        made.append(b)
    return made


def cattle():
    """Two cows. Bigger, browner, and lying down half the time in real life —
    which is not modelled, because at this size a standing cow and a lying one
    are the same four pixels and only one of them looks deliberate."""
    made = []
    for i, (x, y) in enumerate([(0.0, 0.0), (0.09, 0.05)]):
        b = lib.box('cow%d' % i, (0.062, 0.030, 0.030), loc=(x, y, 0.020))
        _paint(b, HIDE if i == 0 else HIDE_PALE, 'hide%d' % i)
        made.append(b)
        h = lib.box('cowhead%d' % i, (0.020, 0.016, 0.016),
                    loc=(x + 0.038, y, 0.024))
        _paint(h, HIDE, 'hide')
        made.append(h)
    # No legs. Sixteen boxes of leg on a model four pixels tall, and it was
    # three quarters of the triangle count.
    return made


def muck_heap():
    """A heap at the edge of a ploughed field. Unromantic, and it is the detail
    that makes a farm read as a working one rather than a model village."""
    o = lib.cyl('heap', 0.075, 0.012, 0.045, loc=(0, 0, 0.022), segments=7)
    _paint(o, SOIL, 'soil', rough=0.95)
    return [o]


def trough():
    """A water trough with a rail beside it. Small, and it is what a field of
    grass has in the corner."""
    made = [_paint(lib.box('trough', (0.075, 0.028, 0.018), loc=(0, 0, 0.012)),
                   (0.545, 0.557, 0.573, 1), 'galv', rough=0.5)]
    for i, x in enumerate((-0.055, 0.055)):
        made.append(_paint(lib.box('post%d' % i, (0.011, 0.011, 0.055),
                                   loc=(x, 0.045, 0.028)), TIMBER, 'timber'))
    made.append(_paint(lib.box('rail', (0.125, 0.009, 0.010),
                               loc=(0, 0.045, 0.048)), TIMBER, 'timber'))
    return made


# Sodium. Not a stylistic choice — a 1985 English street lamp is low-pressure
# sodium, which is the most saturated orange any lamp has ever been, and the
# reason a photograph of a town at night in that decade is unmistakable. Getting
# it wrong (a modern white LED) would date the district by forty years in one
# colour.
SODIUM = (1.0, 0.50, 0.09, 1.0)
SODIUM_DIM = (0.30, 0.13, 0.02, 1.0)
POST = (0.286, 0.298, 0.318, 1)


def lamp_post():
    """A street lamp, with the light it throws.

    The head overhangs **+X**, and the pool of light on the ground goes the same
    way, so the client places one by pointing +X at the road. That is the whole
    interface: a lamp knows which way it leans and nothing else needs to.

    Tall — about half the height of a cottage. A street lamp that scaled honestly
    against a symbolic tile would be a pin, and the thing that makes a lit road
    read as a lit road from above is the *spacing of the pools*, which needs the
    lamp high enough to throw one.
    """
    made = []
    h = 0.44
    made.append(_paint(lib.box('lp_post', (0.017, 0.017, h), loc=(0, 0, h / 2)),
                       POST, 'lamppost', rough=0.6))
    # The arm, and a slight droop at the end of it. A straight bracket reads as
    # a flagpole; a bent one reads as a street lamp even at four pixels.
    made.append(_paint(lib.box('lp_arm', (0.105, 0.013, 0.011),
                               loc=(0.046, 0, h - 0.006)), POST, 'lamppost'))
    lit = lib.material(lib.LAMP + '_na', SODIUM, emissive=3.2, rough=0.3)
    halo = lib.material(lib.LAMP + '_nah', SODIUM_DIM, emissive=1.0, rough=0.4)
    # Bigger than the fitting would be, on the same argument as the vehicle
    # lamps: at playing zoom a truthfully sized lantern is two pixels, and a
    # lamp post whose lamp you cannot see is a dark stick.
    lamp = lib.box('lp_head', (0.075, 0.052, 0.030), loc=(0.098, 0, h - 0.020))
    lamp.data.materials.append(lit)
    made.append(lamp)
    glow = lib.box('lp_halo', (0.165, 0.125, 0.098), loc=(0.098, 0, h - 0.022))
    glow.data.materials.append(halo)
    made.append(glow)

    # And the pool it throws, centred under the head and reaching across the
    # road. Same overlapping-strip trick as the windows and the headlamps.
    steps = 5
    reach = 0.48
    for i in range(steps):
        f = i / steps
        g = (i + 1) / steps
        bright = (1 - g) ** 2.2
        mat = lib.material(lib.LAMP + '_np%d' % i,
                           # Dimmer and narrower than the first go: with a real
                           # sodium light also on the nearest posts, a wide drawn
                           # pool on top of it turned the whole village into one
                           # yellow blob rather than a row of pools.
                           (0.21 * bright, 0.10 * bright, 0.018 * bright, 1.0),
                           emissive=1.0, rough=0.6)
        # A ring rather than a cone: a lamp lights the ground all round its foot,
        # brightest under the head. Two strips a step, one each side.
        for sx in (-1, 1):
            mid = 0.098 + sx * reach * (f + g) / 2
            span = reach * (g - f) * 1.34
            o = lib.box('lp_pool%d%d' % (i, sx), (span, 0.30 * (1.1 - 0.5 * g), 0.004),
                        loc=(mid, 0, 0.006))
            o.data.materials.append(mat)
            made.append(o)
    return made


def log_stack():
    """Round timber in the round, stacked. Forestry and the sawmill.

    Read from the *ends*: a pale disc against a dark side is what says log rather
    than beam, so the ends get their own lighter material and the cylinders lie
    across the view. Three on two is the smallest stack that reads as a stack.
    """
    made = []
    for i, (x, z) in enumerate([(-0.036, 0.018), (0.0, 0.018), (0.036, 0.018),
                                (-0.018, 0.052), (0.018, 0.052)]):
        o = lib.cyl('log%d' % i, 0.018, 0.018, 0.150,
                    loc=(x, 0, z), rot=(math.pi / 2, 0, 0), segments=7)
        _paint(o, LOG, 'log')
        made.append(o)
    for i, side in enumerate((-1, 1)):
        c = lib.box('logend%d' % i, (0.100, 0.006, 0.070),
                    loc=(0, side * 0.076, 0.035))
        _paint(c, LOG_END, 'logend')
        made.append(c)
    return made


def timber_stack():
    """Sawn boards, banded. The palest thing in any yard, which is the point:
    against a dark log stack twenty yards away it says the difference between the
    wood going in and the wood coming out."""
    made = []
    for i in range(4):
        o = lib.box('board%d' % i, (0.170, 0.075, 0.014),
                    loc=(0, 0, 0.010 + i * 0.017))
        _paint(o, SAWN if i % 2 == 0 else STRAW, 'sawn%d' % (i % 2))
        made.append(o)
    return made


def stone_heap():
    """Crushed stone, tipped. Angular where a muck heap is rounded — the quarry
    and the concrete plant both want grey, and grey in a green district is
    already unusual enough to carry the meaning."""
    made = []
    o = lib.cyl('heapstone', 0.088, 0.020, 0.056, loc=(0, 0, 0.027), segments=6)
    _paint(o, STONE, 'stone', rough=0.95)
    made.append(o)
    b = lib.box('block0', (0.038, 0.034, 0.026), loc=(0.075, -0.045, 0.013),
                rot=(0, 0, 0.4))
    _paint(b, STONE_PALE, 'stonepale', rough=0.95)
    made.append(b)
    return made


def sacks():
    """A pallet of sacks. The mill and the village shop: bagged goods, which is
    what both of them actually move."""
    made = []
    p = lib.box('sackpal', (0.110, 0.080, 0.012), loc=(0, 0, 0.006))
    _paint(p, PALLET, 'pallet')
    made.append(p)
    for i, (x, y) in enumerate([(-0.030, -0.020), (0.030, -0.020),
                                (-0.030, 0.020), (0.030, 0.020), (0.0, 0.0)]):
        # No chamfer. It cost more triangles than the sacks did, on a model
        # whose whole silhouette is four pale lumps on a pallet.
        o = lib.box('sack%d' % i, (0.048, 0.036, 0.026),
                    loc=(x, y, 0.012 + (0.026 if i == 4 else 0)))
        _paint(o, SACK, 'sack')
        made.append(o)
    return made


def churns():
    """Milk churns on a stand at the gate. The single most recognisable object in
    English dairying, and the reason a dairy farm should never be mistaken for an
    arable one: pale cylinders in a row, at the roadside, waiting for the lorry."""
    made = []
    st = lib.box('churnstand', (0.130, 0.052, 0.010), loc=(0, 0, 0.026))
    _paint(st, TIMBER, 'timber')
    made.append(st)
    for i in range(4):
        o = lib.cyl('churn%d' % i, 0.017, 0.013, 0.044,
                    loc=(-0.048 + i * 0.032, 0, 0.053), segments=7)
        _paint(o, CHURN, 'churn', rough=0.45)
        made.append(o)
    return made


def tank():
    """An upright tank. The creamery, the filling station and the concrete plant
    all have one, and at this size a tall pale cylinder beside a shed is as
    industrial as the district gets."""
    made = []
    o = lib.cyl('tank', 0.048, 0.048, 0.130, loc=(0, 0, 0.065), segments=9)
    _paint(o, TANK, 'tank', rough=0.4)
    made.append(o)
    cap = lib.cyl('tankcap', 0.050, 0.036, 0.020, loc=(0, 0, 0.138), segments=9)
    _paint(cap, STONE_PALE, 'tankcap', rough=0.5)
    made.append(cap)
    return made


def pallets():
    """Stacked pallets and a crate. Builders' merchant, terminal, distribution
    centre: the yards whose whole trade is *things in transit*, and a pallet is
    what that looks like when it is standing still."""
    made = []
    for i in range(3):
        o = lib.box('pal%d' % i, (0.100, 0.076, 0.011),
                    loc=(0, 0, 0.006 + i * 0.014))
        _paint(o, PALLET, 'pallet')
        made.append(o)
    c = lib.box('crate', (0.070, 0.060, 0.058), loc=(0.090, 0.030, 0.029),
                chamfer=0.004)
    _paint(c, CRATE, 'crate')
    made.append(c)
    return made


def pen():
    """A hurdle pen. Livestock and the abattoir — the animals are the giveaway
    but they wander, and a pen is the part of a stock farm that stays put."""
    made = []
    for i, (x, y, lx, ly) in enumerate([
        (0, -0.070, 0.150, 0.008), (0, 0.070, 0.150, 0.008),
        (-0.075, 0, 0.008, 0.140), (0.075, 0, 0.008, 0.140),
    ]):
        r = lib.box('hurdle%d' % i, (lx, ly, 0.006), loc=(x, y, 0.034))
        _paint(r, HURDLE, 'hurdle')
        made.append(r)
        b = lib.box('hurdlelow%d' % i, (lx, ly, 0.006), loc=(x, y, 0.016))
        _paint(b, HURDLE, 'hurdle')
        made.append(b)
    for i, (x, y) in enumerate([(-0.075, -0.070), (0.075, -0.070),
                                (-0.075, 0.070), (0.075, 0.070)]):
        o = lib.box('penpost%d' % i, (0.012, 0.012, 0.046), loc=(x, y, 0.023))
        _paint(o, TIMBER, 'timber')
        made.append(o)
    return made


def _bird(name, droop):
    """One bird, wings at a given droop. Two boxes and a body.

    Six triangles of wing either side and nothing else. A bird crossing this
    district is four pixels across, so everything except the *shape of the
    outline* is wasted — no head, no tail feathers, no colour beyond dark. What
    reads at four pixels is the shallow V, and that is the only thing modelled.

    `droop` is what makes it flap. There is no skeletal animation anywhere in
    this project and there is not going to be for one bird, so the flap is two
    models and the renderer alternates between them — which is how every
    hand-drawn bird in every game before about 1996 worked, and it still reads
    better at this size than a smooth interpolation would.
    """
    made = []
    body = lib.box('%sbody' % name, (0.030, 0.008, 0.007), loc=(0, 0, 0),
                   chamfer=0.003)
    _paint(body, BIRD, 'bird')
    made.append(body)
    for i, side in enumerate((-1, 1)):
        # Swept back a little as well as up or down, because a wing held square
        # to the body reads as an aeroplane.
        w = lib.box('%swing%d' % (name, i), (0.020, 0.038, 0.005),
                    loc=(-0.004, side * 0.038, droop * 0.020),
                    rot=(side * droop * 0.7, 0, 0))
        _paint(w, BIRD, 'bird')
        made.append(w)
    return made


def bird_up():
    """Wings above the body: the top of the stroke."""
    return _bird('up', 1.0)


def bird_down():
    """And the bottom of it. Not symmetrical with `bird_up` on purpose — a
    gull's downstroke goes much less far below the body than the upstroke goes
    above it, and two frames that mirror each other read as a metronome."""
    return _bird('dn', -0.45)


def daffodils():
    """A clump of daffodils on a bank.

    Yellow is the whole model. At this scale a daffodil is one pixel and the
    only thing that survives is *that there is yellow there in March* — so it is
    six little boxes on stalks rather than anything shaped like a flower, and the
    stalks are there because a clump of yellow with no green under it reads as
    litter.

    Six, and no chamfer, because the first version was eleven chamfered ones and
    came out at 616 triangles against a 180 budget — on a model that will be
    drawn a hundred times over a verge. The budget is the whole reason it exists:
    at this size the chamfer was rounding a corner nobody can see, three hundred
    times.

    Clumped rather than spread, because that is how they actually grow: a verge
    with daffodils on it has patches of fifty and then nothing for twenty yards,
    and a hedge bank evenly dotted with yellow reads as planting rather than as
    spring.
    """
    made = []
    spots = [(0.000, 0.000), (0.028, 0.016), (-0.024, 0.022),
             (0.016, -0.028), (-0.032, -0.014), (0.038, -0.010)]
    for i, (x, y) in enumerate(spots):
        stem = lib.box('daffstem%d' % i, (0.004, 0.004, 0.030),
                       loc=(x, y, 0.015))
        _paint(stem, DAFFODIL_LEAF, 'daffleaf')
        made.append(stem)
        head = lib.box('daffhead%d' % i, (0.012, 0.012, 0.011),
                       loc=(x, y, 0.035))
        _paint(head, DAFFODIL, 'daffodil', rough=0.6)
        made.append(head)
    return made


def blossom():
    """A blackthorn in flower: white where every other bush is green.

    March and April, before the leaves are out, which is exactly why it is worth
    having — it is the one thing in the district that can be *pale* while the
    trees are still bare, and it puts something in the hedgerows in the six
    weeks when they are otherwise sticks.
    """
    made = []
    trunk = lib.box('blossomstem', (0.012, 0.012, 0.055), loc=(0, 0, 0.028))
    _paint(trunk, TIMBER, 'timber')
    made.append(trunk)
    for i, (x, y, z, r) in enumerate([
        (0.000, 0.000, 0.082, 0.054), (0.030, 0.018, 0.066, 0.036),
        (-0.026, 0.022, 0.068, 0.032),
    ]):
        o = lib.box('blossom%d' % i, (r, r, r * 0.78), loc=(x, y, z),
                    chamfer=r * 0.34)
        _paint(o, BLOSSOM, 'blossom', rough=0.7)
        made.append(o)
    return made


# ---------------------------------------------------------------- power lines
#
# The American kind, deliberately: one timber pole, a crossarm, wires strung
# between. Not a lattice pylon. A steel pylon is a landmark and would dominate a
# district whose tallest thing is a farmhouse; a wooden pole is *furniture*, and
# furniture is what the grid should be here. The line crosses the map from side to
# side because the grid comes from somewhere else and goes somewhere else - the
# district is a place the wires pass through, not a place they serve.
#
# Two models, and the split is what makes a run possible at all. The renderer
# draws scatter as instanced geometry: one mesh, many transforms, no per-instance
# shape. A wire between two arbitrary points needs its own length and its own
# angle, which the transform can give it - but only if the mesh is built so that
# the transform means something exact.
#
# ## The three numbers that have to agree
#
# `POLE_SPAN`, `POLE_WIRE_H` and `WIRE_Y` are shared with `powerlines.ts`, which
# computes where each span goes. They are the whole interface between the model
# and the layout, and getting any of them wrong is invisible in the source and
# obvious on screen - which is exactly what happened: "the cables don't line up
# correctly on the model itself, they are offset", and "they do not connect
# correctly to the other side, often overlapping."
#
# So the span is built to make the maths trivial rather than to look tidy in
# Blender. Its wires start at the model **origin** and run along **+X**, which
# means the client can place one by putting its origin exactly on a pole's
# insulator and rotating +X onto the direction of the next pole's insulator. No
# offset to rotate, nothing to correct for, and the far end lands where it is
# supposed to by construction.
POLE_SPAN = 3.0
POLE_H = 0.62

# The crossarm, stated once and used to derive everything above it.
ARM_Z = POLE_H - 0.028
ARM_HALF = 0.010
INS_H = 0.026

# Where the wires actually attach: the top of the insulators.
#
# This is the number that was wrong. `WIRE_Z` used to be `POLE_H - 0.045`, an
# independent guess, which put the cables 0.053 *below* the insulator tops - so
# every wire in the district ran through the middle of the crossarm it was
# supposed to be sitting on. Derived now, so it cannot drift again.
POLE_WIRE_H = ARM_Z + ARM_HALF + INS_H

# Where the three wires sit across the run. Shared with the layout only so that
# nothing else has to guess how wide the arm is.
WIRE_Y = (-0.115, 0.0, 0.115)
TIMBER = (0.435, 0.357, 0.286, 1)
WIRE = (0.212, 0.196, 0.184, 1)
INSULATOR = (0.706, 0.741, 0.729, 1)


def pole():
    """One timber pole with a crossarm, standing along the run.

    The run is **+X**, the same convention the lamp post uses for which way it
    leans, so the client places one by pointing +X at the next pole. The crossarm
    therefore lies across Y, which is what puts the wires side by side rather than
    one behind another.

    Taller than a street lamp and shorter than an oak. That ordering is the whole
    of the scale decision: a power line has to clear the hedges and read across a
    field, and it must not compete with the trees for the skyline, because the
    trees are what this district is supposed to be about.
    """
    made = []
    made.append(_paint(lib.cyl('pl_pole', 0.027, 0.020, POLE_H,
                               loc=(0, 0, POLE_H / 2), segments=5),
                       TIMBER, 'pl_timber', rough=0.9))
    # The crossarm. Square-sawn, because it is, and it is the one part of this
    # whose silhouette says "power line" rather than "post".
    made.append(_paint(lib.box('pl_arm', (0.026, 0.275, ARM_HALF * 2),
                               loc=(0, 0, ARM_Z)),
                       TIMBER, 'pl_timber', rough=0.9))
    # And a knee brace each side, which is the detail that stops the arm reading
    # as a plus sign nailed to a stick.
    for sy in (-1, 1):
        o = lib.box('pl_brace%d' % (sy > 0), (0.012, 0.070, 0.010),
                    loc=(0, sy * 0.048, POLE_H - 0.070),
                    rot=(sy * 0.62, 0, 0))
        made.append(_paint(o, TIMBER, 'pl_timber', rough=0.9))
    # Three insulators, pale on purpose: they are the only light-coloured thing on
    # the pole and they are what makes the arm legible against a dark hedge. Their
    # tops are `POLE_WIRE_H`, which is where the wires attach.
    for i, y in enumerate(WIRE_Y):
        made.append(_paint(lib.cyl('pl_ins%d' % i, 0.013, 0.010, INS_H,
                                   loc=(0, y, POLE_WIRE_H - INS_H / 2), segments=4),
                           INSULATOR, 'pl_insulator', rough=0.35))
    return made


def span():
    """The wires for one pole-gap, sagging, running +X from the model origin.

    **At height zero**, and that is the whole design of this mesh. The client puts
    the origin exactly on one pole's insulator and rotates +X onto the direction of
    the next pole's insulator; with the wires at the origin there is no vertical
    offset for that rotation to swing about, so the far end arrives exactly on the
    far insulator at every angle. The previous version built them at the insulator
    *height* instead, so aiming the model tilted that offset too and the ends missed
    by more the steeper the ground - "they do not connect correctly to the other
    side, often overlapping."

    Three wires, three segments each, and the segments exist only to make the sag
    a curve rather than a fold. Real conductors sag a great deal more than this at
    forty metres; a truthful sag at playing zoom reads as slack cable about to be
    stood on, so it is flattened to a suggestion.

    Deliberately thicker than a wire, and no thicker than the pole. At twenty-two
    tiles across the screen a truthfully sized conductor is well under a pixel and
    simply is not there - the same argument as the street lamp's oversized lantern.
    But there is a ceiling on that: at 0.022 the conductors were *thicker than the
    pole holding them up*, so a run read as three dark planks laid across a field
    with an occasional stick under them. A wire has to be the thinnest thing in the
    assembly or it stops being a wire.
    """
    made = []
    mat = lib.material('pl_wire', WIRE, rough=0.55)
    segs = 3
    sag = 0.055
    for i, y in enumerate(WIRE_Y):
        for k in range(segs):
            a = k / segs
            b = (k + 1) / segs
            # A parabola through the gap, zero at both ends so the wire meets both
            # insulators exactly and dips between them.
            za = -sag * 4 * a * (1 - a)
            zb = -sag * 4 * b * (1 - b)
            mx = (a + b) / 2 * POLE_SPAN
            mz = (za + zb) / 2
            dx = (b - a) * POLE_SPAN
            dz = zb - za
            o = lib.box('pl_wire%d_%d' % (i, k),
                        (math.hypot(dx, dz), 0.013, 0.012),
                        loc=(mx, y, mz),
                        rot=(0, -math.atan2(dz, dx), 0))
            o.data.materials.append(mat)
            made.append(o)
    return made


BUILDS = [
    ('prop_lamp_post', lamp_post),
    ('prop_pole', pole),
    ('prop_span', span),
    ('prop_bale_round', bale_round),
    ('prop_bale_wrapped', bale_wrapped),
    ('prop_bale_stack', bale_stack),
    ('prop_stook', stook),
    ('prop_sheep', sheep),
    ('prop_cattle', cattle),
    ('prop_muck', muck_heap),
    ('prop_trough', trough),
    ('prop_log_stack', log_stack),
    ('prop_timber_stack', timber_stack),
    ('prop_stone_heap', stone_heap),
    ('prop_sacks', sacks),
    ('prop_churns', churns),
    ('prop_tank', tank),
    ('prop_pallets', pallets),
    ('prop_pen', pen),
    ('prop_daffodils', daffodils),
    ('prop_blossom', blossom),
    ('prop_bird_up', bird_up),
    ('prop_bird_down', bird_down),
]


def main():
    report = []
    for name, build in BUILDS:
        lib.reset()
        parts = build()
        lib.merge_into(name, parts, None)
        lib.export(name, [], report)
    # The tree budget, for the tree reason: drawn hundreds of times, so this is
    # the cost that actually multiplies.
    # 180. The lamp post is the one thing here that carries its own pool of
    # light, which is ten boxes of it — and a lit road is most of what a village
    # at night looks like from above.
    lib.summarise(report, budget=180)


if __name__ == '__main__':
    main()
