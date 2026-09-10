# WHAT THE SURFACE IS, IN WORDS
#
# A 1961 E-Type, collected from the works last Tuesday. Nothing on this car
# has aged. Every other material test is a claim about history; this one is a
# claim about manufacture, and the whole difficulty is that an expensive
# surface has almost no variation - so the little it has has to be right.
#
#   paint      Metallic basecoat under lacquer, metallic 0.62. Deep 0x0E3B22
#              where a panel faces away from the sky, 0x175030 where it faces
#              up into it - that flip is what a green car actually does, and
#              flat green is what a toy does. Plus a 7 cm mottle in the
#              basecoat carried into the roughness (0.255-0.29, never one
#              value), 14 mm orange peel in the lacquer, brighter polished
#              crowns, and the tucks darker where a mop cannot reach.
#   clearcoat  The lacquer over it: Coat Weight 1, Coat Roughness 0.035,
#              Coat IOR 1.5. Exports as KHR_materials_clearcoat.
#   chrome     Bumpers, sill blade, grille surround, spinners. Near-white,
#              metallic 1, roughness 0.035-0.062 with a faint lengthwise
#              polish streak and a little more roughness down in the corners.
#   glass      Screen, side and rear glass. Transmission 1 - a shader
#              property, not a texture, so it is NOT baked. Roughness 0.045,
#              because at 0.02 the screen is a mirror and a strip light in it
#              reads as a white sticker.
#   leather    Tan hide, 8 mm pebble grain, creases darker at the seams,
#              sheen 0.18.
#   rubber     Matte tyres, circumferential tread grooves at 35 mm, a raised
#              sidewall band with lettering suggested on it, faintly dusty.
#   road film  A pale warm grey, behind the arches and along the lower sill
#              only. A few percent. If it reads as dirt it is wrong - at a
#              0.40 layer weight it read as mud on the tyres and came back
#              down to 0.15.
import math

import texlib as tx


# ---------------------------------------------------------------- palette

BRG_DEEP = 0x0E3B22        # panel facing away from the light
BRG_LIT = 0x1B5A34         # panel facing up into the sky
BRG_MID = 0x175030         # the flip, softened: the full jump to
                           # BRG_LIT read as panel-to-panel mismatch
                           # on faceted bodywork
BRG_SHUT = 0x061C11        # down inside a tuck
CHROME = 0xF2F5F7
STEEL = 0xE2E6EA           # wire spokes: polished, not plated
LEATHER = 0xA87B4E
LEATHER_DK = 0x7A5535
RUBBER = 0x1A1A1C
RUBBER_LT = 0x2C2C30
DARK = 0x131417            # shuts, spoke fields, interior trim
FILM = 0x9C9184            # road film
GLASS = 0xCBD9D4
LAMP = 0xF6EFD9
TAILLAMP = 0xA5121C


# ---------------------------------------------------------------- helpers
#
# Everything in this block is something texlib does not have. Kept together
# deliberately, because the list is the report.

def val(g, x):
    n = g.node('ShaderNodeValue')
    n.outputs[0].default_value = x
    return n.outputs[0]


def scale(g, socket, k):
    """A mask times a constant. texlib.mul takes sockets only, so there is no
    way to say 'this mask, but a third as strong'."""
    n = g.node('ShaderNodeMath', operation='MULTIPLY')
    g.link(socket, n.inputs[0])
    n.inputs[1].default_value = k
    return n.outputs['Value']


def remap(g, socket, lo, hi):
    """0..1 -> lo..hi. texlib.ramp only sets From Min/Max, so it can tighten a
    mask but cannot put one inside a narrow range."""
    n = g.node('ShaderNodeMapRange')
    g.link(socket, n.inputs['Value'])
    n.inputs['From Min'].default_value = 0.0
    n.inputs['From Max'].default_value = 1.0
    n.inputs['To Min'].default_value = lo
    n.inputs['To Max'].default_value = hi
    n.clamp = True
    return n.outputs['Result']


def band(g, socket, lo, hi, feather=0.02):
    """1 inside [lo, hi], 0 outside, soft at both ends. There is no way to say
    'between these two values' with ramp()."""
    a = g.node('ShaderNodeMapRange')
    g.link(socket, a.inputs['Value'])
    a.inputs['From Min'].default_value = lo - feather
    a.inputs['From Max'].default_value = lo + feather
    a.clamp = True
    b = g.node('ShaderNodeMapRange')
    g.link(socket, b.inputs['Value'])
    b.inputs['From Min'].default_value = hi + feather
    b.inputs['From Max'].default_value = hi - feather
    b.clamp = True
    m = g.node('ShaderNodeMath', operation='MULTIPLY')
    g.link(a.outputs['Result'], m.inputs[0])
    g.link(b.outputs['Result'], m.inputs[1])
    return m.outputs['Value']


def noise(g, scale_vec, detail=6.0, distortion=0.0, seed=0.0, space='Object'):
    """mask_noise with a per-axis scale.

    texlib.mask_noise takes one scalar scale, so every noise it makes is
    isotropic blobs. Polish streaks, brushed metal, the drag of a spray gun -
    all of them need the noise stretched along an axis."""
    m = g.node('ShaderNodeMapping')
    g.link(g.coords().outputs[space], m.inputs['Vector'])
    m.inputs['Scale'].default_value = scale_vec
    n = g.node('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = 1.0
    n.inputs['Detail'].default_value = detail
    n.inputs['Distortion'].default_value = distortion
    if 'W' in n.inputs:
        n.inputs['W'].default_value = seed
    g.link(m.outputs['Vector'], n.inputs['Vector'])
    return n.outputs['Fac']


def position(g):
    return g.node('ShaderNodeNewGeometry').outputs['Position']


def radial(g, centre, plane=(1.0, 0.0, 1.0)):
    """Distance from an axis through a world point. No such thing in texlib,
    and it is what every manufactured round object needs: a tyre sidewall, a
    hub, a bolt circle, a lens."""
    sub = g.node('ShaderNodeVectorMath', operation='SUBTRACT')
    g.link(position(g), sub.inputs[0])
    sub.inputs[1].default_value = centre
    flat = g.node('ShaderNodeVectorMath', operation='MULTIPLY')
    g.link(sub.outputs['Vector'], flat.inputs[0])
    flat.inputs[1].default_value = plane
    ln = g.node('ShaderNodeVectorMath', operation='LENGTH')
    g.link(flat.outputs['Vector'], ln.inputs[0])
    return ln.outputs['Value']


def axial(g, centre, axis=(0.0, 1.0, 0.0)):
    """|distance along an axis| from a world point."""
    sub = g.node('ShaderNodeVectorMath', operation='SUBTRACT')
    g.link(position(g), sub.inputs[0])
    sub.inputs[1].default_value = centre
    d = g.node('ShaderNodeVectorMath', operation='DOT_PRODUCT')
    g.link(sub.outputs['Vector'], d.inputs[0])
    d.inputs[1].default_value = axis
    a = g.node('ShaderNodeMath', operation='ABSOLUTE')
    g.link(d.outputs['Value'], a.inputs[0])
    return a.outputs['Value']


def minimum(g, *sockets):
    out = sockets[0]
    for s in sockets[1:]:
        n = g.node('ShaderNodeMath', operation='MINIMUM')
        g.link(out, n.inputs[0])
        g.link(s, n.inputs[1])
        out = n.outputs['Value']
    return out


def sine(g, socket, period, phase=0.0):
    n = g.node('ShaderNodeMath', operation='MULTIPLY_ADD')
    g.link(socket, n.inputs[0])
    n.inputs[1].default_value = 2.0 * math.pi / period
    n.inputs[2].default_value = phase
    s = g.node('ShaderNodeMath', operation='SINE')
    g.link(n.outputs['Value'], s.inputs[0])
    r = g.node('ShaderNodeMapRange')
    g.link(s.outputs['Value'], r.inputs['Value'])
    r.inputs['From Min'].default_value = -1.0
    r.inputs['From Max'].default_value = 1.0
    r.clamp = True
    return r.outputs['Result']


def rough_from(g, socket):
    """Wire an arbitrary socket into Roughness.

    texlib.roughness(value, mask, spread) only maps ONE mask into a symmetric
    band around one value, so anything built from several influences - which
    is every real surface - has to reach past it."""
    g.link(socket, g.bsdf.inputs['Roughness'])
    return g


# ---------------------------------------------------------------- wheels

# Wheel centres in world space, measured off the mesh. The four are joined
# into one object at bake time, so the radial masks have to be built from
# explicit centres rather than from object-space coordinates.
WHEELS = ((1.28, 0.65, 0.315), (1.28, -0.65, 0.315),
          (-1.135, 0.66, 0.325), (-1.135, -0.66, 0.325))
TYRE_R = 0.325


def tyre_radius(g):
    return minimum(g, *[radial(g, c) for c in WHEELS])


def tyre_axial(g):
    return minimum(g, *[axial(g, c) for c in WHEELS])


# ---------------------------------------------------------------- masks
#
# Each of these is both a layer in a material and a mask view in the sheet, so
# they are written once, here, and called from both.

def cavity(g, distance=0.30, samples=20):
    """One AO evaluation per graph, shared.

    Two masks in the paint wanted a cavity at 0.28 and at 0.35, which is two
    Ambient Occlusion nodes and the slowest thing in a 2048 bake by a wide
    margin. They are not different enough to be worth twice the bake."""
    key = '_cavity_%s' % distance
    if not hasattr(g, key):
        setattr(g, key, g.mask_cavity(distance=distance, samples=samples))
    return getattr(g, key)


def m_flip(g):
    """How much a panel faces up into the sky. Drives the basecoat flip.

    At softness 0.95 this covered 80.8% of the car (mask_paint_flip.png) and
    the lighter tone was doing the work of the base colour. Tightened to a
    little over half."""
    return g.ramp(g.mask_facing((0, 0, 1), softness=0.80),
                  lo=0.30, hi=0.92)


def m_grain(g):
    """The slow cloudy variation in a metallic basecoat, panel to panel.

    At scale 42 with detail 8 this was salt-and-pepper speckle
    (mask_paint_grain.png): most of its energy was below the 2.2 mm texel, so
    it aliased in the bake and drove a noisy roughness map, which is the
    definition of CG plastic. 7 cm cells and two octaves is a mottle."""
    return g.ramp(g.mask_noise(scale=14.0, detail=2.5, seed=3.0),
                  lo=0.36, hi=0.66)


def m_peel(g):
    """Orange peel: the ripple a spray gun leaves under lacquer, plus the
    slower undulation of a panel that was finished by hand.

    At 9 mm and strength 0.10 this was invisible in rake.png - the wing was a
    perfectly smooth facet - which is the one thing that shot exists to catch.
    14 mm at 0.40 survives it."""
    fine = noise(g, (70.0, 70.0, 70.0), detail=3.0, distortion=0.4, seed=7.0)
    slow = noise(g, (24.0, 24.0, 24.0), detail=2.0, seed=13.0)
    return g.add(scale(g, fine, 0.75), scale(g, slow, 0.35))


def m_shut(g):
    """The tucks: inside the arches, the grille aperture, under the bumpers.

    At distance 0.09 this returned 0.0% (mask_shutline.png) - the body panels
    are modelled flush, so there are no shut lines for a cavity mask to find.
    At 0.28 it finds the places a polishing mop genuinely cannot reach, which
    is the same idea and is actually present in the mesh."""
    return g.ramp(cavity(g), lo=0.10, hi=0.62, gamma=1.1)


def m_crown(g):
    """The exposed edge of a panel - a wing crown, a door edge - which the
    cloth passes over most and which reads brightest. 1.6% at radius 0.010
    was a hairline; 0.022 puts it on the crown."""
    return g.ramp(g.mask_edges(radius=0.022), lo=0.0, hi=0.55, gamma=1.1)


def m_film(g):
    """Road film. Low down, in the sheltered places, broken up by one noise
    field so it goes in runs and not in speckle. Wanted: a few percent.

    The first version was placed correctly and had an amplitude of 0.05
    (mask_roadfilm_wheel.png: visible wisps, coverage 0.0% above 0.5), which
    after a 0.30 layer weight was nothing at all. The final ramp lifts the
    wisps to full strength without moving them."""
    low = g.ramp(g.mask_height(0.45, 0.03), lo=0.0, hi=1.0, gamma=1.2)
    tucked = g.ramp(cavity(g), lo=0.12, hi=0.55)
    patchy = g.ramp(g.mask_noise(scale=9.0, detail=7.0, seed=11.0),
                    lo=0.40, hi=0.66, gamma=1.2)
    behind = g.ramp(noise(g, (3.0, 14.0, 14.0), detail=6.0, seed=5.0),
                    lo=0.35, hi=0.68)
    raw = g.mul(low, g.add(tucked, scale(g, behind, 0.9)), patchy)
    return g.ramp(raw, lo=0.03, hi=0.30)


def m_polish(g):
    """The lengthwise drag of the polishing mop on a chrome bumper."""
    return g.ramp(noise(g, (4.0, 26.0, 26.0), detail=5.0, seed=2.0),
                  lo=0.38, hi=0.66)


def m_pebble(g):
    """Leather grain.

    3 mm cells at 765 px/m is two texels a cell: it baked to mush and the seat
    read as tan cardboard in seat.png. 8 mm is five texels and survives."""
    inv = g.node('ShaderNodeInvert')
    g.link(g.mask_voronoi(scale=130.0, randomness=1.0), inv.inputs['Color'])
    return g.ramp(inv.outputs['Color'], lo=0.45, hi=1.0)


def m_seam(g):
    return g.ramp(g.mask_cavity(distance=0.05, samples=24), lo=0.35, hi=0.9)


def m_tread(g):
    """The tread band of the tyre, as opposed to the sidewall."""
    return g.ramp(tyre_axial(g), lo=0.075, hi=0.045)


def m_letters(g):
    """A raised band on the sidewall with lettering suggested on it. Not real
    letters - broken marks at the right size, which at a glance is what the
    eye takes them for.

    The ring landed exactly where it should first time
    (mask_tyre_letters_wheel.png) but at scale 95 the marks were 2 mm dots and
    read as glitter. 40 is 25 mm marks, which is letter-sized."""
    ring = band(g, tyre_radius(g), 0.238, 0.288, feather=0.008)
    outer = g.ramp(tyre_axial(g), lo=0.050, hi=0.072)
    cells = g.ramp(g.mask_voronoi(scale=40.0, randomness=0.9),
                   lo=0.52, hi=0.14)
    return g.mul(ring, outer, cells)


def m_grooves(g):
    """Circumferential tread grooves, 35 mm apart."""
    return g.mul(m_tread(g), sine(g, tyre_axial(g), 0.035))


# ---------------------------------------------------------------- materials

def paint(name='car_paint'):
    g = tx.Graph(name)
    flip = m_flip(g)
    grain = m_grain(g)
    shut = m_shut(g)
    crown = m_crown(g)
    film = m_film(g)

    col = g.variegate(BRG_DEEP, BRG_MID, flip)
    col = g.layer(col, BRG_LIT, scale(g, grain, 0.22))
    col = g.layer(col, BRG_SHUT, scale(g, shut, 0.85))
    col = g.layer(col, BRG_LIT, scale(g, crown, 0.18))
    col = g.layer(col, FILM, scale(g, film, 0.42))
    g.base_colour(col)

    # A perfectly uniform roughness is what makes CG paint look like plastic.
    # 0.245 on the crowns, 0.29 in the hollows, 0.40 where the film sits.
    r = g.add(remap(g, grain, 0.255, 0.288),
              scale(g, shut, 0.055),
              scale(g, film, 0.14))
    sub = g.node('ShaderNodeMath', operation='SUBTRACT')
    g.link(r, sub.inputs[0])
    g.link(scale(g, crown, 0.02), sub.inputs[1])
    rough_from(g, sub.outputs['Value'])

    # 0.40 measured 1.98 deg mean tilt in the baked normal map, which under a
    # hard strip highlight read as hammered metal rather than as lacquer.
    g.bump(g.add(scale(g, m_peel(g), 0.85), scale(g, grain, 0.15)),
           strength=0.24, distance=0.0045)
    return g


def chrome(name='car_chrome'):
    g = tx.Graph(name)
    polish = m_polish(g)
    shut = g.ramp(g.mask_cavity(distance=0.06, samples=24), lo=0.3, hi=0.9)
    film = m_film(g)
    col = g.variegate(CHROME, 0xDDE3E8, scale(g, polish, 0.5))
    col = g.layer(col, 0xBFC6CB, scale(g, shut, 0.5))
    col = g.layer(col, FILM, scale(g, film, 0.16))
    g.base_colour(col)
    r = g.add(remap(g, polish, 0.035, 0.062),
              scale(g, shut, 0.10),
              scale(g, film, 0.16))
    rough_from(g, r)
    g.bump(scale(g, polish, 0.5), strength=0.03, distance=0.0008)
    return g


def steel(name='car_wire'):
    g = tx.Graph(name)
    polish = g.ramp(noise(g, (30.0, 6.0, 30.0), detail=5.0, seed=4.0),
                    lo=0.35, hi=0.7)
    grime = g.ramp(g.mask_cavity(distance=0.10, samples=16), lo=0.3, hi=0.85)
    col = g.variegate(STEEL, 0xB9BFC6, polish)
    col = g.layer(col, 0x8E9299, scale(g, grime, 0.55))
    g.base_colour(col)
    # Spokes at roughness 0.16 are a mirror, and a mirror inside a wheel arch
    # reflects the inside of a wheel arch: the wheel centre read as a black
    # disc in wheel.png. Brushed steel holds a highlight instead.
    rough_from(g, g.add(remap(g, polish, 0.30, 0.42), scale(g, grime, 0.16)))
    return g


def hide(name='car_hide'):
    g = tx.Graph(name)
    pebble = m_pebble(g)
    seam = m_seam(g)
    broad = g.ramp(g.mask_noise(scale=26.0, detail=6.0, seed=9.0),
                   lo=0.4, hi=0.66)
    col = g.variegate(LEATHER, 0xBC8F60, broad)
    col = g.layer(col, LEATHER_DK, scale(g, pebble, 0.60))
    col = g.layer(col, 0x63421F, scale(g, seam, 0.7))
    g.base_colour(col)
    rough_from(g, g.add(remap(g, pebble, 0.46, 0.63), scale(g, seam, 0.10)))
    g.bump(g.add(scale(g, pebble, 0.9),
                 scale(g, g.mask_noise(scale=380.0, detail=3.0, seed=1.0),
                       0.12)),
           strength=0.80, distance=0.0028)
    return g


def rubber(name='car_rubber'):
    g = tx.Graph(name)
    letters = m_letters(g)
    grooves = m_grooves(g)
    tread = m_tread(g)
    film = m_film(g)
    # 240-scale noise at bump 0.55 made the tyre read as black sponge in
    # wheel.png. The relief a tyre actually has is the moulding - lettering
    # and grooves - not an all-over speckle.
    fine = g.mask_noise(scale=110.0, detail=4.0, seed=6.0)
    col = g.variegate(RUBBER, RUBBER_LT, g.ramp(fine, lo=0.4, hi=0.62))
    col = g.layer(col, 0x3A3A40, scale(g, letters, 0.6))
    col = g.layer(col, 0x0E0E10, scale(g, grooves, 0.8))
    # 0.40 put tan smears across the sidewall in wheel.png: mud, not road
    # film. The brief's test is whether it reads as dirt, and it did.
    col = g.layer(col, FILM, scale(g, film, 0.15))
    g.base_colour(col)
    r = g.add(remap(g, fine, 0.86, 0.94),
              scale(g, tread, 0.04),
              scale(g, film, 0.06))
    rough_from(g, r)
    g.bump(g.add(scale(g, letters, 1.0),
                 scale(g, grooves, 0.7),
                 scale(g, fine, 0.10)),
           strength=0.32, distance=0.005)
    return g


def dark(name='car_dark'):
    """Shut faces, spoke fields, interior trim: satin black, no shine."""
    g = tx.Graph(name)
    fine = g.mask_noise(scale=160.0, detail=5.0, seed=8.0)
    grime = g.ramp(g.mask_cavity(distance=0.12, samples=16), lo=0.3, hi=0.9)
    col = g.variegate(DARK, 0x1E2024, g.ramp(fine, lo=0.42, hi=0.65))
    col = g.layer(col, 0x0A0B0D, scale(g, grime, 0.6))
    g.base_colour(col)
    rough_from(g, g.add(remap(g, fine, 0.62, 0.74), scale(g, grime, 0.10)))
    g.bump(fine, strength=0.25, distance=0.0015)
    return g


# ---------------------------------------------------------------- baked set

BAKED = {
    'paint': (paint, 2048),
    'chrome': (chrome, 1024),
    'wire': (steel, 512),
    'hide': (hide, 1024),
    'rubber': (rubber, 1024),
    'dark': (dark, 1024),
}

MAPS = {
    'paint': ('basecolor', 'roughness', 'normal'),
    'chrome': ('basecolor', 'roughness', 'normal'),
    'wire': ('basecolor', 'roughness'),
    'hide': ('basecolor', 'roughness', 'normal'),
    'rubber': ('basecolor', 'roughness', 'normal'),
    'dark': ('basecolor', 'roughness', 'normal'),
}

# Metallic is constant within a family because the car is split by material,
# so apply_baked(metallic=) carries it and no metallic map is needed.
METALLIC = {
    'paint': 0.62,      # metallic basecoat under the lacquer
    'chrome': 1.0,
    'wire': 1.0,
    'hide': 0.0,
    'rubber': 0.0,
    'dark': 0.0,
}

# Shader properties that no bake can carry, set on the material after
# apply_baked() has rewired it to the images.
SHADER = {
    'paint': {'Coat Weight': 1.0, 'Coat Roughness': 0.035, 'Coat IOR': 1.5,
              'IOR': 1.47},
    'chrome': {},
    'wire': {},
    'hide': {'Sheen Weight': 0.18, 'Sheen Roughness': 0.35},
    'rubber': {'Specular IOR Level': 0.35},
    'dark': {'Specular IOR Level': 0.4},
}

# Not baked at all: transmission is a shader property and glTF carries it via
# KHR_materials_transmission.
GLASSY = {
    # 0.02 made the screen a mirror, and the key strip reflected in it as a
    # hard-edged white rectangle that read as a sticker.
    'glass': {'colour': GLASS, 'Roughness': 0.045, 'Transmission Weight': 1.0,
              'IOR': 1.52, 'Metallic': 0.0},
    'lamp': {'colour': LAMP, 'Roughness': 0.06, 'Transmission Weight': 0.85,
             'IOR': 1.5, 'Metallic': 0.0},
    'taillamp': {'colour': TAILLAMP, 'Roughness': 0.05,
                 'Transmission Weight': 0.72, 'IOR': 1.5, 'Metallic': 0.0},
}

# Which source material goes into which family.
FAMILY = {
    'car_paint': 'paint',
    'car_chrome': 'chrome',
    'car_wire': 'wire',
    'car_hide': 'hide',
    'car_rubber': 'rubber',
    'car_shadow': 'dark',
    'car_spokefield': 'dark',
    'car_trim': 'dark',
    'car_glass': 'glass',
    'car_lamp': 'lamp',
    'car_taillamp': 'taillamp',
}


# ---------------------------------------------------------------- mask views

def _is(*names):
    return lambda n: any(n.startswith(x) for x in names)


MASKS = {
    'paint_flip': {'fn': m_flip, 'pick': _is('paint'), 'cams': ('ortho',)},
    'paint_grain': {'fn': m_grain, 'pick': _is('paint'), 'cams': ('ortho',)},
    'paint_peel': {'fn': m_peel, 'pick': _is('paint'), 'cams': ('wing',)},
    'shutline': {'fn': m_shut, 'pick': _is('paint'), 'cams': ('ortho', 'wing')},
    'crown': {'fn': m_crown, 'pick': _is('paint'), 'cams': ('ortho',)},
    'polish': {'fn': m_polish, 'pick': _is('chrome'), 'cams': ('ortho',)},
    'leather': {'fn': m_pebble, 'pick': _is('hide'), 'cams': ('seat',)},
    'tyre_letters': {'fn': m_letters, 'pick': _is('rubber'),
                     'cams': ('ortho', 'wheel')},
    'tyre_grooves': {'fn': m_grooves, 'pick': _is('rubber'),
                     'cams': ('wheel',)},
    'roadfilm': {'fn': m_film,
                 'pick': _is('paint', 'chrome', 'rubber', 'dark'),
                 'cams': ('ortho', 'wheel')},
}
