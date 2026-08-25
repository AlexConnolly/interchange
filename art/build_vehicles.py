# The 1985 fleet. content.md's nine vehicles, and the lights on them.
#
#   blender --background --python art/build_vehicles.py
#
# Nine vehicles is really three cabs and five bodies, which is the whole
# argument for authoring shapes as functions rather than as files: the artic
# tractor is the same object under a reefer, a box, a flatbed and a tipper, and
# writing it once means the four of them cannot drift apart.
#
# Two reserved material slots, both matched by *name* in the renderer because a
# glTF material index depends on export order and that is not a contract:
#
#   `livery` — bodywork the renderer tints per company at draw time.
#   `lamp`   — anything that emits. Pulled into a separate mesh drawn with an
#              unlit material, because a light has to glow when everything
#              round it is dark. Any lighting term at all gives you a headlamp
#              that goes out at dusk.
#
# Scale: a vehicle is about one tile long. Symbolic and deliberate — at true
# scale a lorry is four pixels and the game has no subject. design.md 7 has the
# arithmetic, and every game in this genre does this without writing it down.
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import lib  # noqa: E402
from boxmodel import Form  # noqa: E402

TILE = 1.0

TYRE = (0.10, 0.10, 0.11, 1)
GLASS = (0.24, 0.31, 0.37, 1)
TANK = (0.84, 0.86, 0.88, 1)
CHASSIS = (0.22, 0.23, 0.25, 1)
BOX = (0.90, 0.88, 0.83, 1)
TIMBER = (0.52, 0.40, 0.28, 1)
LAMP_WHITE = (1.0, 0.96, 0.86, 1.0)
# Nearly pure red, and the green and blue matter more than the red does.
#
# The lamps are drawn with an *additive* blend, so their colour is added to
# whatever is behind them: at (1.0, 0.24, 0.16) over a mid-grey road the result
# came out orange-pink and read as white at three pixels. Taking green and blue
# down to almost nothing means the sum can only move the red channel, so a tail
# lamp is red over tarmac, over grass and over snow.
LAMP_RED = (1.0, 0.06, 0.03, 1.0)


def wheels(name, axles, half_width, radius, length):
    """Wheels, on the ground.

    The export report's floor check is what makes this worth writing carefully:
    the first fleet built through this pipeline had a helper that narrowed the
    underside of the body and called it wheels, and every vehicle floated half a
    metre above the road. A comment is not geometry.
    """
    made = []
    m = lib.material('tyre', TYRE, rough=0.9)
    # The axle runs *across* the vehicle, and for a long time it did not.
    #
    # `lib.cyl` builds along Z. The rotation here was `(0, pi/2, 0)`, which maps
    # Z to X — so every wheel in the game had its axle pointing along the
    # direction of travel, like a roller. It is invisible on a small wheel from
    # four hundred feet, which is why it survived the whole fleet; a tractor has
    # wheels big enough to see and it was obvious immediately.
    #
    # `(pi/2, 0, 0)` maps Z to Y, which is across the vehicle. Where a wheel goes.
    for i, ox in enumerate(axles):
        for side in (-1, 1):
            o = lib.cyl('%s_w%d%s' % (name, i, '+' if side > 0 else '-'),
                        radius, radius, half_width * 0.22,
                        loc=(ox * length, side * half_width * 0.92, radius),
                        rot=(math.pi / 2, 0, 0), segments=8)
            o.data.materials.append(m)
            made.append(o)
    return made


def lamps(name, nose, tail, half_width, height):
    """Head and tail lamps.

    Absurdly sized, and it took two goes to be absurd enough.
    
    The first pass called them "four times a real lamp" and they came out at
    about a pixel and a half at playing zoom - so at night the district had cat's
    eyes glowing along every lane and the traffic on it was invisible. A light is
    the one part of a vehicle allowed to be bigger than life, and being timid
    about it means the whole reason for having night goes to waste.

    Overshot on the second go and came back: at a fifth of the vehicle's width
    the lamps were glowing panels with a lorry hidden behind them. The figure
    that works is a core about a ninth of the width with a dim halo twice that -
    five or six pixels at playing zoom against a forty-pixel lorry, so it reads
    as a lamp *on* something rather than as a light in the air.
    """
    made = []
    white = lib.material(lib.LAMP, LAMP_WHITE, emissive=3.0, rough=0.25)
    red = lib.material(lib.LAMP + '_red', LAMP_RED, emissive=2.6, rough=0.25)
    # A dim, wide halo round each lamp. The glow mesh is blended *additively*, so
    # a darker colour over a larger area is a softer light — no second material,
    # no second draw, just a bigger box painted fainter. It is what turns a lamp
    # from a lit pixel into something that reads as shining.
    halo_w = lib.material(lib.LAMP + '_halo', (0.22, 0.20, 0.15, 1.0),
                          emissive=1.0, rough=0.4)
    halo_r = lib.material(lib.LAMP + '_halor', (0.24, 0.02, 0.01, 1.0),
                          emissive=1.0, rough=0.4)
    for i, side in enumerate((-1, 1)):
        f = lib.box('%s_head%d' % (name, i),
                    (0.026, 0.062, 0.056),
                    loc=(nose, side * half_width * 0.60, height))
        f.data.materials.append(white)
        made.append(f)
        fh = lib.box('%s_headh%d' % (name, i),
                     (0.014, 0.125, 0.115),
                     loc=(nose + 0.006, side * half_width * 0.60, height))
        fh.data.materials.append(halo_w)
        made.append(fh)

        # Bigger than the headlamp, not smaller. A tail lamp is what you see most
        # of on a road full of traffic going the same way as you.
        r = lib.box('%s_tail%d' % (name, i),
                    (0.024, 0.068, 0.060),
                    loc=(tail, side * half_width * 0.60, height * 0.88))
        r.data.materials.append(red)
        made.append(r)
        rh = lib.box('%s_tailh%d' % (name, i),
                     (0.013, 0.135, 0.122),
                     loc=(tail - 0.006, side * half_width * 0.60, height * 0.88))
        rh.data.materials.append(halo_r)
        made.append(rh)
    return made


def beam(name, nose, tail, half_width, length):
    """Light *on the road*, in front of the lamps and behind them.

    The lamps glowed and lit nothing — "there's no lights from them though" —
    because an emissive quad is a bright shape, not a light source. Real lights
    are out of the question at this scale: a district at night has hundreds of
    lamps and `MeshLambertMaterial` takes a handful.

    So the spill is drawn. A flat quad lying on the road, additively blended, is
    indistinguishable from a headlamp beam from four hundred feet — and it is the
    thing that turns a pair of dots into a vehicle travelling.

    Segmented, because a beam has to *fade* and the glTF path carries one colour
    per material rather than per vertex. Four strips of decreasing brightness
    from the same reserved slot: the near one nearly white, the far one almost
    nothing. Eight triangles for the whole thing.

    Lying at z just above zero rather than parented to the lamps, so it stays on
    the ground when the vehicle pitches over a hump — a beam that tilted with the
    cab would sweep into the sky on every bump.
    """
    made = []
    steps = 5
    for i in range(steps):
        f = i / steps
        g = (i + 1) / steps
        # Falls off with the square, which is how light behaves and also what
        # stops the far end reading as a hard edge.
        bright = (1 - g) ** 2.4
        mat = lib.material(
            lib.LAMP + '_b%d' % i,
            (0.26 * bright, 0.22 * bright, 0.14 * bright, 1.0),
            emissive=1.0, rough=0.5,
        )
        mid = nose + length * (f + g) / 2
        # A third longer than its slot, so consecutive strips overlap. Additive
        # blending sums where they meet, which turns the hard step between one
        # brightness and the next into a ramp — the cheapest possible gradient on
        # a path that carries one colour per material.
        span = length * (g - f) * 1.34
        # Widening away from the vehicle: a beam spreads.
        wide = half_width * (1.5 + 5.0 * (f + g) / 2)
        o = lib.box('%s_beam%d' % (name, i), (span, wide * 2, 0.004),
                    loc=(mid, 0, 0.006))
        o.data.materials.append(mat)
        made.append(o)

    # And a much smaller, redder wash behind: brake and tail lamps do throw a
    # little onto the road, and without it a lorry seen from behind at night has
    # a hard edge where its lights stop.
    for i in range(2):
        f = i / 2
        g = (i + 1) / 2
        bright = (1 - g) ** 2
        mat = lib.material(
            lib.LAMP + '_r%d' % i,
            (0.34 * bright, 0.03 * bright, 0.02 * bright, 1.0),
            emissive=1.0, rough=0.5,
        )
        mid = tail - length * 0.34 * (f + g) / 2
        span = length * 0.34 * (g - f)
        wide = half_width * (1.4 + 2.2 * (f + g) / 2)
        o = lib.box('%s_glow%d' % (name, i), (span, wide * 2, 0.004),
                    loc=(mid, 0, 0.005))
        o.data.materials.append(mat)
        made.append(o)
    return made


def cab(name, length, half_width, height, floor):
    """A cab, grown rather than stacked.

    The windscreen is inset and the roof pulled back from the nose, so the
    silhouette has a step in it. Without the step a lorry at forty pixels is a
    lozenge, and a lozenge is not a lorry.
    """
    f = Form(size=(length, half_width * 2, height), at=(0, 0, floor + height / 2))
    # Pull the roof back off the nose so there is a bonnet line.
    roof = f.faces(normal='up')
    f.scale_faces(roof, (0.86, 0.96, 1.0))
    f.move(roof, (-length * 0.05, 0, 0))
    f.bevel(amount=0.006)
    obj = f.build(name)
    lib.repaint(obj, [
        (lib.livery_material(), lambda c: True),
        (lib.material('glass', GLASS, rough=0.2),
         lambda c: c.z > floor + height * 0.55 and c.x > length * 0.18),
        (lib.material('chassis', CHASSIS, rough=0.7), lambda c: c.z < floor + 0.012),
    ])
    return obj


def tank_body(name, length, half_width, radius, floor):
    """A cylindrical tank, lying along the vehicle."""
    # This one is right as it stands: a tank lies *along* the vehicle, so its
    # axis really is X. Only the wheels were wrong.
    o = lib.cyl(name, radius, radius, length,
                loc=(0, 0, floor + radius), rot=(0, math.pi / 2, 0), segments=10)
    o.data.materials.append(lib.material('tank', TANK, rough=0.35, metal=0.35))
    return o


def box_body(name, length, half_width, height, floor, colour=BOX):
    f = Form(size=(length, half_width * 2, height), at=(0, 0, floor + height / 2))
    f.bevel(amount=0.005)
    obj = f.build(name)
    lib.repaint(obj, [
        (lib.livery_material(), lambda c: True),
        (lib.material('boxroof', colour, rough=0.6),
         lambda c: c.z > floor + height * 0.94),
    ])
    return obj


def flat_body(name, length, half_width, floor):
    f = Form(size=(length, half_width * 2, 0.030), at=(0, 0, floor + 0.015))
    f.bevel(amount=0.004)
    obj = f.build(name)
    obj.data.materials.append(lib.material('flatbed', TIMBER, rough=0.85))
    return obj


def tipper_body(name, length, half_width, height, floor):
    """A skip, tapered so it reads as open at the top."""
    f = Form(size=(length, half_width * 2, height), at=(0, 0, floor + height / 2))
    top = f.faces(normal='up')
    inner = f.inset(top, thickness=0.022)
    f.move(inner, (0, 0, -height * 0.55))
    f.bevel(amount=0.005)
    obj = f.build(name)
    lib.repaint(obj, [
        (lib.livery_material(), lambda c: True),
        (lib.material('skip', (0.32, 0.33, 0.35, 1), rough=0.75),
         lambda c: c.z < floor + height * 0.55),
    ])
    return obj


# --------------------------------------------------------------- the vehicles

def van(reefer=False):
    L = TILE * 0.42
    hw = 0.085
    parts = [cab('van_cab', L * 0.34, hw, 0.11, 0.055)]
    for o in parts:
        o.location.x += L * 0.28
    parts.append(box_body('van_box', L * 0.60, hw, 0.15, 0.055,
                          (0.86, 0.90, 0.92, 1) if reefer else BOX))
    parts[-1].location.x -= L * 0.16
    parts += wheels('van', (0.30, -0.26), hw, 0.030, L)
    parts += lamps('van', L * 0.46, -L * 0.47, hw, 0.085)
    parts += beam('van', L * 0.5, -L * 0.5, hw, 1.15)
    return parts


def rigid(kind):
    L = TILE * 0.60
    hw = 0.105
    parts = [cab('rigid_cab', L * 0.28, hw, 0.145, 0.062)]
    parts[0].location.x += L * 0.33
    if kind == 'tank':
        parts.append(tank_body('rigid_tank', L * 0.56, hw, 0.098, 0.070))
        parts[-1].location.x -= L * 0.12
    elif kind == 'tipper':
        parts.append(tipper_body('rigid_skip', L * 0.54, hw, 0.125, 0.070))
        parts[-1].location.x -= L * 0.12
    else:
        parts.append(box_body('rigid_box', L * 0.58, hw, 0.185, 0.070))
        parts[-1].location.x -= L * 0.12
    parts += wheels('rigid', (0.32, -0.20, -0.34), hw, 0.036, L)
    parts += lamps('rigid', L * 0.47, -L * 0.48, hw, 0.100)
    parts += beam('rigid', L * 0.5, -L * 0.5, hw, 1.35)
    return parts


def artic(kind):
    L = TILE * 0.96
    hw = 0.115
    parts = [cab('artic_cab', L * 0.20, hw, 0.165, 0.070)]
    parts[0].location.x += L * 0.38
    if kind == 'reefer':
        parts.append(box_body('artic_box', L * 0.60, hw, 0.215, 0.086,
                              (0.88, 0.92, 0.94, 1)))
    elif kind == 'flat':
        parts.append(flat_body('artic_flat', L * 0.62, hw, 0.086))
    elif kind == 'tipper':
        parts.append(tipper_body('artic_skip', L * 0.60, hw, 0.150, 0.086))
    else:
        parts.append(box_body('artic_box', L * 0.62, hw, 0.215, 0.086))
    parts[-1].location.x -= L * 0.14
    parts += wheels('artic', (0.40, 0.24, -0.20, -0.32, -0.44), hw, 0.038, L)
    parts += lamps('artic', L * 0.49, -L * 0.49, hw, 0.115)
    parts += beam('artic', L * 0.5, -L * 0.5, hw, 1.55)
    return parts


def car(estate=False):
    """A car. Not yours, and that is the whole point of it.

    The district had exactly one moving object in it - the player's van - and
    read as a diorama rather than a place. Ambient traffic is the cheapest thing
    that fixes that: a car every few tiles going about business that is nobody's
    concern makes the roads look used, which is what makes owning one mean
    something.

    Smaller than the van and much simpler. At the size a car appears it is a
    coloured wedge with lights, so that is what it is: a body, a cabin step, four
    wheels and the lamps. The step is the only part that matters - without it a
    car and a crate are the same silhouette.
    """
    L = TILE * 0.30
    hw = 0.062
    f = Form(size=(L, hw * 2, 0.062), at=(0, 0, 0.052))
    roof = f.faces(normal='up')
    # Pull the cabin in and up: a bonnet, a windscreen line, a boot.
    f.scale_faces(roof, (0.54 if not estate else 0.72, 0.86, 1.0))
    f.move(roof, (-L * 0.06, 0, 0.036))
    f.bevel(amount=0.005)
    obj = f.build('car_body')
    lib.repaint(obj, [
        (lib.livery_material(), lambda c: True),
        (lib.material('carglass', GLASS, rough=0.18),
         lambda c: c.z > 0.088),
    ])
    parts = [obj]
    parts += wheels('car', (0.30, -0.30), hw, 0.021, L)
    parts += lamps('car', L * 0.48, -L * 0.48, hw, 0.062)
    parts += beam('car', L * 0.5, -L * 0.5, hw, 0.95)
    return parts


def tractor():
    """A tractor, and it is nearly all wheels.

    The silhouette is the whole job. At forty pixels a tractor and a van are the
    same box unless the *back wheels are enormous* — that one proportion is what
    the eye reads, and everything else here exists to hold it up: a narrow bonnet
    in front, a tall thin cab set back over the rear axle, and a bar of an
    implement dragging behind.

    Painted in the livery slot like everything else, so a farm's tractor takes a
    colour. Which is not quite right — a tractor belongs to the farm, not to the
    haulier — and it is right *enough*, because what it buys is that no two
    tractors in the district are the same colour.
    """
    L = TILE * 0.34
    hw = 0.070
    parts = []

    # Bonnet: low and narrow, forward of the cab.
    bonnet = lib.box('tr_bonnet', (L * 0.44, hw * 1.15, 0.072),
                     loc=(L * 0.20, 0, 0.088), chamfer=0.005)
    lib.repaint(bonnet, [(lib.livery_material(), lambda c: True)])
    parts.append(bonnet)

    # Cab: tall, glazed, set back.
    f = Form(size=(L * 0.30, hw * 1.7, 0.115), at=(-L * 0.13, 0, 0.135))
    f.bevel(amount=0.004)
    cabin = f.build('tr_cab')
    lib.repaint(cabin, [
        (lib.material('trcab', (0.86, 0.86, 0.84, 1), rough=0.6), lambda c: True),
        (lib.material('trglass', GLASS, rough=0.18), lambda c: c.z > 0.115),
    ])
    parts.append(cabin)
    # A roof, because the flat top of the cab is what reads at this size.
    parts.append(_tr_paint(lib.box('tr_roof', (L * 0.34, hw * 1.85, 0.012),
                                   loc=(-L * 0.13, 0, 0.196)),
                           (0.30, 0.31, 0.33, 1), 'trroof'))

    tyre = lib.material('tyre', TYRE, rough=0.9)
    # Rear wheels: the whole point. Nearly the height of the bonnet.
    for i, side in enumerate((-1, 1)):
        o = lib.cyl('tr_rear%d' % i, 0.072, 0.072, hw * 0.44,
                    loc=(-L * 0.17, side * hw * 1.02, 0.072),
                    rot=(math.pi / 2, 0, 0), segments=9)
        o.data.materials.append(tyre)
        parts.append(o)
        f2 = lib.cyl('tr_front%d' % i, 0.040, 0.040, hw * 0.32,
                     loc=(L * 0.30, side * hw * 0.86, 0.040),
                     rot=(math.pi / 2, 0, 0), segments=8)
        f2.data.materials.append(tyre)
        parts.append(f2)

    # The implement: a bar with tines, dragged. Says "working" rather than
    # "driving", which is the difference between a tractor and a small lorry.
    parts.append(_tr_paint(lib.box('tr_bar', (0.026, hw * 2.5, 0.020),
                                   loc=(-L * 0.52, 0, 0.052)),
                           (0.36, 0.24, 0.20, 1), 'trbar'))
    for i in range(5):
        y = (i / 4 - 0.5) * hw * 2.2
        parts.append(_tr_paint(lib.box('tr_tine%d' % i, (0.014, 0.010, 0.038),
                                       loc=(-L * 0.54, y, 0.030)),
                               (0.42, 0.43, 0.45, 1), 'trtine'))

    parts += lamps('tr', L * 0.44, -L * 0.50, hw, 0.150)
    return parts


def _tr_paint(obj, rgba, name):
    obj.data.materials.append(lib.material(name, rgba, rough=0.7))
    return obj


BUILDS = [
    ('veh_tractor', tractor),
    ('veh_car_saloon', lambda: car(False)),
    ('veh_car_estate', lambda: car(True)),
    ('veh_van_transit', lambda: van(False)),
    ('veh_van_reefer', lambda: van(True)),
    ('veh_rigid_box', lambda: rigid('box')),
    ('veh_rigid_tipper', lambda: rigid('tipper')),
    ('veh_rigid_tanker', lambda: rigid('tank')),
    ('veh_artic_reefer', lambda: artic('reefer')),
    ('veh_artic_box', lambda: artic('box')),
    ('veh_artic_flat', lambda: artic('flat')),
    ('veh_artic_tipper', lambda: artic('tipper')),
]


def main():
    report = []
    for name, build in BUILDS:
        lib.reset()
        parts = build()
        lib.merge_into(name, parts, None)
        lib.export(name, [], report)
    # Raised from 240 after looking at the renders. Four lamps cost about ninety
    # triangles between them and they are the single best thing in the model at
    # night, which is exactly the trade a budget is for: it is a question, not a
    # rule, and the answer here is that the lights stay.
    #
    # Dozens of vehicles at 450 triangles each is a few tens of thousands, on a
    # ground pass already drawing sixteen thousand. It is not the frame.
    # 560, up from 480. The halos round the lamps are four boxes a vehicle and
    # they are the difference between a lorry at night being visible and not.
    # 700. The beams are twelve boxes a vehicle and they are the difference
    # between a lamp being a bright dot and a vehicle having headlights.
    lib.summarise(report, budget=700)


if __name__ == '__main__':
    main()
