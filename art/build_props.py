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


BUILDS = [
    ('prop_lamp_post', lamp_post),
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
