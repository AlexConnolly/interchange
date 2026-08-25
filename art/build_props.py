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
