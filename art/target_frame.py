# The target frame. postmortem.md, recommendation 2.
#
#   blender --background --python art/target_frame.py
#
# One picture of what the game looks like, made before any renderer code, so
# that everything afterwards either matches it or is wrong.
#
# The old spec had 342 lines of art principles and no image. Its principles were
# followed faithfully and produced a grey-green blob field, which is how we
# learned that "the land is a ground, not a subject - desaturated and tonal" is
# a recipe for mud rather than a description of a place. So this file contains no
# principles at all. It contains a scene.
#
# UNITS. One Blender unit is one tile, and a tile is *a field*. There is no
# metric size, deliberately: the camera arithmetic says a readable lorry and a
# whole district on screen are incompatible at any tile size, so insisting on
# metres only produces a document apologising for the mismatch - which is
# exactly what the old scale.md was. A haul is twenty to fifty tiles. A lorry is
# about a tile long, which is generous in metres and correct on screen.
#
# WHAT THIS IS TRYING TO BE: a fun, casual game. Bright, warm, legible, charming.
# Late afternoon sun, long shadows, saturated fields, hedgerows you can see, one
# lorry you can follow. Not an operating diagram.
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import mathutils  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'art', 'shots', '_target')

# The frame shows this many tiles across. At 1920 px that is 40 px a tile,
# which is the number the whole scale question resolves to: a lorry drawn one
# tile long is 40 px, and 40 px is readable.
TILES_ACROSS = 26
RES_X = 1920
RES_Y = 1080


# The lane's course, as a function, so the hedges know where to leave a gap.
LANE = [(-19, -3.6), (-11, -3.1), (-4, -2.2), (3, -2.6), (10, -3.4), (19, -3.9)]


def LANE_Y_AT(x):
    for i in range(len(LANE) - 1):
        x0, y0 = LANE[i]
        x1, y1 = LANE[i + 1]
        if x0 <= x <= x1:
            t = (x - x0) / (x1 - x0)
            return y0 + (y1 - y0) * t
    return -99.0


def rgb(hexstr):
    h = hexstr.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)) + (1.0,)


# The palette, and it is the argument.
#
# The old one was desaturated on principle. These are the colours of an English
# district on a good afternoon in June, which is a place people like looking at.
PASTURE      = rgb('#7fa04a')
PASTURE_2    = rgb('#8fae55')
MEADOW       = rgb('#a8b656')
WHEAT        = rgb('#d8c05e')
WHEAT_RIPE   = rgb('#e0cb70')
PLOUGH       = rgb('#8c6a4c')
HEDGE        = rgb('#3f5c33')
HEDGE_LIT    = rgb('#4e6e3c')
TARMAC       = rgb('#5d5f63')
TARMAC_WORN  = rgb('#6e7176')
VERGE        = rgb('#6f8f42')
LINE_WHITE   = rgb('#dcdcd2')
BRICK        = rgb('#a3624a')
RENDER_WALL  = rgb('#cfc4ae')
SLATE        = rgb('#4a4d55')
STEEL_ROOF   = rgb('#8d9298')
CONCRETE     = rgb('#b3aca2')
TRUNK        = rgb('#54402f')
CANOPY       = rgb('#3e6b34')
CANOPY_LIT   = rgb('#528a41')
TANKER_TANK  = rgb('#d8dade')
CAB_RED      = rgb('#b8402f')
TYRE         = rgb('#1f2124')
GLASS        = rgb('#5f7a86')


def mat(name, colour, rough=0.72, metal=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = colour
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def box(name, centre, size, colour, rot=(0, 0, 0), rough=0.72):
    bpy.ops.mesh.primitive_cube_add(size=1, location=centre, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    o.data.materials.append(mat(name + '_m', colour, rough))
    for p in o.data.polygons:
        p.use_smooth = False
    return o


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)


# --------------------------------------------------------------------- ground

def ground():
    """Fields, with hedges between them.

    This is the whole difference between a landscape and a noise field. The old
    renderer coloured every tile by its biome, which is a per-pixel lottery and
    reads as camouflage. Real countryside is *parcels*: hard-edged fields, each
    one a single crop, separated by hedgerows you can see from a mile off. The
    hedge is what turns a green blur into a place.
    """
    # A base plane well under the fields, so nothing shows through a seam.
    box('bedrock', (0, 0, -0.12), (60, 60, 0.2), PLOUGH)

    # Field parcels by recursive subdivision, not a jittered grid.
    #
    # Iteration 2 jittered a grid and it still read as a lattice, because a
    # jittered grid is a grid. English enclosure fields come from repeatedly
    # dividing land, so that is the generator: take a rectangle, split it at a
    # random ratio on its longer axis, stop when it is small enough. It costs
    # ten lines and produces the thing a jittered grid cannot - fields of
    # genuinely different sizes, meeting at T-junctions rather than crossroads.
    #
    # This is also the algorithm the game's worldgen wants, which is the point
    # of building the target frame first: it tells you what to write.
    import random
    rng = random.Random(11)
    CROPS = [PASTURE, PASTURE_2, MEADOW, WHEAT, WHEAT_RIPE, PLOUGH]

    parcels = []

    def split(x0, y0, x1, y1, depth):
        w, d = x1 - x0, y1 - y0
        if depth <= 0 or (w < 5.0 and d < 4.2) or rng.random() < 0.12:
            parcels.append((x0, y0, x1, y1))
            return
        if w > d * 1.15:
            t = rng.uniform(0.34, 0.66)
            cut = x0 + w * t
            split(x0, y0, cut, y1, depth - 1)
            split(cut, y0, x1, y1, depth - 1)
        else:
            t = rng.uniform(0.34, 0.66)
            cut = y0 + d * t
            split(x0, y0, x1, cut, depth - 1)
            split(x0, cut, x1, y1, depth - 1)

    split(-19.0, -15.0, 19.0, 15.0, 5)
    for n, (x0, y0, x1, y1) in enumerate(parcels):
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        w, d = x1 - x0, y1 - y0
        crop = CROPS[rng.randrange(len(CROPS))]
        box('field%d' % n, (cx, cy, 0.0), (w, d, 0.02), crop, rough=0.85)
        rows(n, cx, cy, w, d, crop, w > d)
        hedge_ring('hedge%d' % n, cx, cy, w, d)


def rows(idx, cx, cy, w, d, crop, along_x):
    """Crop rows: a handful of slightly darker stripes across a field."""
    shade = tuple(c * 0.93 for c in crop[:3]) + (1.0,)
    count = 7
    if along_x:
        for k in range(count):
            y = cy - d / 2 + d * (k + 0.5) / count
            box('row%d_%d' % (idx, k), (cx, y, 0.012), (w * 0.94, d / count * 0.34, 0.004),
                shade, rough=0.9)
    else:
        for k in range(count):
            x = cx - w / 2 + w * (k + 0.5) / count
            box('row%d_%d' % (idx, k), (x, cy, 0.012), (w / count * 0.34, d * 0.94, 0.004),
                shade, rough=0.9)


def hedge_ring(name, cx, cy, w, d):
    """A hedge round a field.

    Narrow and dark. Iteration 1 made them a fifth of a tile wide with a heavy
    taper and they read as grass banks; the fix is thinner, taller, darker, and
    varied in height along the run so a boundary is a hedge rather than an
    extruded rectangle.

    The road is cut out of them where it crosses, because a lane that ploughs
    straight through a hedgerow is the sort of thing that looks wrong before you
    can say why. A real one goes through a gap with a gate in it.
    """
    import random
    import bmesh
    rng = random.Random(hash(name) & 0xffff)
    t = 0.085
    for i, (x, y, sx, sy, along_x) in enumerate((
        (cx, cy + d / 2, w / 2, t / 2, True),
        (cx, cy - d / 2, w / 2, t / 2, True),
        (cx - w / 2, cy, t / 2, d / 2, False),
        (cx + w / 2, cy, t / 2, d / 2, False),
    )):
        # In segments, so height can vary along the run.
        span = (w if along_x else d)
        segs = max(2, int(span / 1.6))
        for k in range(segs):
            f = (k + 0.5) / segs
            h = 0.40 + rng.uniform(-0.09, 0.13)
            if along_x:
                px = cx - w / 2 + w * f
                py = y
                ssx, ssy = span / segs / 2 * 1.02, t / 2
            else:
                px = x
                py = cy - d / 2 + d * f
                ssx, ssy = t / 2, span / segs / 2 * 1.02
            # A gap where the lane crosses, rather than a hedge over a road.
            if abs(py - LANE_Y_AT(px)) < 1.5:
                continue
            o = box('%s_%d_%d' % (name, i, k), (px, py, h / 2),
                    (ssx * 2, ssy * 2, h),
                    HEDGE if (i + k) % 3 else HEDGE_LIT, rough=0.95)
            bm = bmesh.new()
            bm.from_mesh(o.data)
            for v in bm.verts:
                if v.co.z > 0:
                    v.co.x *= 0.80
                    v.co.y *= 0.80
                    v.co.z += rng.uniform(-0.03, 0.03)
            bm.to_mesh(o.data)
            bm.free()


# ----------------------------------------------------------------------- lane

def lane():
    """A road that looks like a road.

    The old renderer drew a way as a flat coloured band with a hub and four
    arms, sized for reading junctions from above. It is why "the roads aren't
    even real roads" was the right complaint. A road is: a cambered surface,
    two verges, a worn crown, and edge lining. Four pieces, and it reads
    immediately.
    """
    pts = LANE
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        ln = math.hypot(x1 - x0, y1 - y0)
        ang = math.atan2(y1 - y0, x1 - x0)
        # Verges first, so the tarmac sits inside them.
        box('verge%d' % i, (mx, my, 0.03), (ln, 1.55, 0.06), VERGE,
            rot=(0, 0, ang), rough=0.9)
        box('road%d' % i, (mx, my, 0.055), (ln, 1.05, 0.05), TARMAC,
            rot=(0, 0, ang), rough=0.6)
        # The worn crown: two wheel tracks, slightly lighter.
        for side in (-0.30, 0.30):
            ox = -math.sin(ang) * side
            oy = math.cos(ang) * side
            box('worn%d_%d' % (i, int(side * 10)),
                (mx + ox, my + oy, 0.081), (ln, 0.30, 0.004), TARMAC_WORN,
                rot=(0, 0, ang), rough=0.55)
        # And a centre line, dashed.
        n = max(1, int(ln / 1.1))
        for k in range(n):
            t = (k + 0.5) / n
            px = x0 + (x1 - x0) * t
            py = y0 + (y1 - y0) * t
            box('line%d_%d' % (i, k), (px, py, 0.083), (0.42, 0.055, 0.004),
                LINE_WHITE, rot=(0, 0, ang), rough=0.5)


# ------------------------------------------------------------------ buildings

def farm(x, y):
    """A farmhouse and two sheds. Small, warm, and clearly somebody's."""
    box('farmhouse', (x, y, 0.30), (1.5, 1.1, 0.60), RENDER_WALL, rough=0.8)
    roof('farmhouse_roof', x, y, 1.62, 1.22, 0.60, 0.34, SLATE)
    box('shed1', (x + 1.9, y - 0.4, 0.22), (1.9, 1.0, 0.44), BRICK, rough=0.8)
    roof('shed1_roof', x + 1.9, y - 0.4, 2.0, 1.08, 0.44, 0.16, STEEL_ROOF)
    box('yard', (x + 0.9, y + 1.2, 0.012), (4.2, 1.4, 0.024), CONCRETE, rough=0.8)


def creamery(x, y):
    """The destination, and it should look worth driving to: a process block, a
    chiller, silos, and a tanker bay with a lorry standing in it."""
    box('cream_block', (x, y, 0.42), (3.4, 2.2, 0.84), BRICK, rough=0.8)
    # A band of glazing, because a blank wall at this size is a slab.
    box('cream_glaze', (x, y - 1.12, 0.60), (3.0, 0.06, 0.22), GLASS, rough=0.25)
    box('cream_roof', (x, y, 0.87), (3.5, 2.3, 0.08), STEEL_ROOF, rough=0.5)
    # Plant on the roof, which is most of what says "works" from above.
    box('cream_plant', (x - 0.8, y + 0.4, 1.00), (0.9, 0.7, 0.22), SLATE, rough=0.6)
    for i, sx in enumerate((-1.0, -0.45, 0.10)):
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=12, radius=0.26, depth=1.15,
            location=(x + 2.5, y + 1.0 + sx, 0.575))
        o = bpy.context.object
        o.name = 'silo%d' % i
        o.data.materials.append(mat('silo_m', TANKER_TANK, 0.45))
        for p in o.data.polygons:
            p.use_smooth = False
    box('bay', (x - 0.2, y - 1.9, 0.014), (5.0, 1.9, 0.028), CONCRETE, rough=0.8)


def roof(name, cx, cy, w, d, base, height, colour):
    """A pitched roof, ridge along X. Four faces and it is the single strongest
    cue that a box is a building."""
    import bmesh
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    hw, hd = w / 2, d / 2
    v = [bm.verts.new(p) for p in (
        (cx - hw, cy - hd, base), (cx + hw, cy - hd, base),
        (cx + hw, cy + hd, base), (cx - hw, cy + hd, base),
        (cx - hw, cy, base + height), (cx + hw, cy, base + height),
    )]
    bm.faces.new((v[0], v[1], v[5], v[4]))
    bm.faces.new((v[2], v[3], v[4], v[5]))
    bm.faces.new((v[0], v[4], v[3]))
    bm.faces.new((v[1], v[2], v[5]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat(name + '_m', colour, 0.7))
    for p in me.polygons:
        p.use_smooth = False
    return o


# ------------------------------------------------------------------- vehicles

def tanker(x, y, ang):
    """A milk tanker, drawn about a tile long.

    Symbolic scale, stated plainly: a tile is a field and a real tanker is a
    fraction of one. Drawn to scale it is four pixels and the game has no
    subject. Every game in this genre draws its vehicles oversized and none of
    them says so; this one says so.
    """
    c = math.cos(ang)
    s = math.sin(ang)

    def place(name, ox, oy, oz, sx, sy, sz, colour, rough=0.6):
        return box(name, (x + ox * c - oy * s, y + ox * s + oy * c, oz),
                   (sx, sy, sz), colour, rot=(0, 0, ang), rough=rough)

    place('cab', 0.30, 0, 0.20, 0.34, 0.30, 0.28, CAB_RED, 0.45)
    place('cab_win', 0.44, 0, 0.30, 0.06, 0.26, 0.12, GLASS, 0.25)
    # The tank, as a cylinder lying along the vehicle.
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=14, radius=0.15, depth=0.62,
        location=(x - 0.16 * c, y - 0.16 * s, 0.22),
        rotation=(0, math.pi / 2, ang))
    o = bpy.context.object
    o.name = 'tank'
    o.data.materials.append(mat('tank_m', TANKER_TANK, 0.30, 0.4))
    for p in o.data.polygons:
        p.use_smooth = False
    for i, ox in enumerate((0.30, -0.02, -0.34)):
        for side in (-0.15, 0.15):
            place('wheel%d_%d' % (i, int(side * 10)), ox, side, 0.065,
                  0.11, 0.05, 0.13, TYRE, 0.8)


def tree(x, y, seed=0):
    """A tree, and not a sphere on a stick.

    The first render used one icosphere and it read as exactly that. Two
    offset canopies of different sizes give an outline that is not a circle,
    which at this size is the entire difference between a tree and a bauble.
    """
    import random
    r = random.Random(seed * 977 + 3)
    h = 0.55 + r.random() * 0.35
    rad = 0.30 + r.random() * 0.16
    bpy.ops.mesh.primitive_cylinder_add(vertices=5, radius=0.055, depth=h * 0.55,
                                        location=(x, y, h * 0.27))
    t = bpy.context.object
    t.name = 'trunk%d' % seed
    t.data.materials.append(mat('trunk_m', TRUNK, 0.9))
    made = [t]
    for k, (ox, oy, oz, sc) in enumerate((
        (0.0, 0.0, h * 0.70, 1.0),
        (rad * 0.42, -rad * 0.30, h * 0.92, 0.66),
        (-rad * 0.38, rad * 0.26, h * 0.80, 0.54),
    )):
        bpy.ops.mesh.primitive_ico_sphere_add(
            subdivisions=1, radius=rad * sc, location=(x + ox, y + oy, oz))
        c = bpy.context.object
        c.name = 'canopy%d_%d' % (seed, k)
        c.scale = (1.0, 1.0, 0.78)
        c.rotation_euler = (0, 0, r.random() * 2)
        c.data.materials.append(mat('canopy_m%d' % (k % 2),
                                    CANOPY_LIT if k % 2 == 0 else CANOPY, 0.9))
        made.append(c)
    for o in made:
        for p in o.data.polygons:
            p.use_smooth = False


# ---------------------------------------------------------------------- light

def light_and_camera():
    """Late afternoon, and the shadows are the point.

    The old renderer had no shadows at all - a two-term hemisphere model - which
    is most of why nothing in it had any weight. A single low sun with real
    shadows does more for how solid a scene looks than every other change in
    this file put together.
    """
    bpy.ops.object.light_add(type='SUN', location=(0, 0, 20))
    sun = bpy.context.object
    sun.data.energy = 3.4
    sun.data.angle = math.radians(1.4)
    sun.data.color = (1.0, 0.94, 0.82)
    # Low, and across the frame, so hedges and buildings throw long shadows
    # over the fields.
    sun.rotation_euler = (math.radians(52), 0, math.radians(38))

    world = bpy.data.worlds.new('sky')
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = rgb('#8fb4d8')
    bg.inputs['Strength'].default_value = 0.9

    cam_data = bpy.data.cameras.new('play')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = TILES_ACROSS
    cam = bpy.data.objects.new('play', cam_data)
    bpy.context.collection.objects.link(cam)
    # The play camera: a low three-quarter view. Low enough to see the sides of
    # things, high enough to read the network.
    target = mathutils.Vector((0.0, -0.5, 0.0))
    d = 40.0
    el = math.radians(38)
    az = math.radians(-32)
    cam.location = target + mathutils.Vector((
        math.sin(az) * math.cos(el) * d,
        -math.cos(az) * math.cos(el) * d,
        math.sin(el) * d,
    ))
    direction = target - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam


def render():
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = RES_X
    sc.render.resolution_y = RES_Y
    sc.render.film_transparent = False
    try:
        sc.eevee.use_shadows = True
        sc.eevee.use_raytracing = True
    except Exception:
        pass
    # Standard, not AgX.
    #
    # The first render used AgX Punchy, which is a film emulation and desaturates
    # hard: a field authored at #7fa04a came out pale sage. That is the same
    # mistake the old art direction made in prose - reaching for something that
    # sounds sophisticated and getting mud - so the transform is Standard and the
    # colours in the palette above are the colours on screen.
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = -0.15
    os.makedirs(OUT, exist_ok=True)
    sc.render.filepath = os.path.join(OUT, 'target.png')
    bpy.ops.render.render(write_still=True)
    print('wrote', sc.render.filepath)


def main():
    reset()
    ground()
    lane()
    farm(-7.5, 0.6)
    creamery(7.0, 1.4)
    tanker(-1.0, -2.3, math.radians(7))
    tanker(8.2, -1.6, math.radians(96))
    for i, (x, y) in enumerate((
        (-12.0, 2.0), (-11.2, 3.1), (2.2, 4.4), (3.0, 5.0),
        (12.4, 3.4), (-3.5, -6.4), (-2.6, -7.0), (11.4, -3.4),
        (-15.0, -5.0), (15.5, 6.0), (-6.0, 10.0), (8.0, 10.5),
    )):
        tree(x, y, i)
    light_and_camera()
    render()


if __name__ == '__main__':
    main()
