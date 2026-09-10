# Skinning the castle: limestone, damp, moss, lichen, bleach and soot, baked
# to glTF textures. Eight passes.
#
# This is the run that answered whether baked texturing solves the problem that
# per-face colour cannot: at face level "a lone green quad mid-wall is a tile,
# never a plant". It does - see images/castle-before-after.png.
#
# Three things worth taking from it rather than rediscovering:
#
#   - mask_curvature is a CONSTANT on flat-shaded geometry. Measured here at
#     100% coverage, mean 0.953, a flat grey silhouette. Use mask_cavity.
#   - mask_facing dots the raw geometry normal, which is constant across a
#     flat facet, so a directional mask is inherently per-face and brings the
#     hard-edged artefact back through the back door. Height, noise and cavity
#     masks do not have this problem.
#   - Coverage numbers beat looking. "The moss looks thin" became "8.5 percent,
#     target 15", which turned three passes from guesses into measurements.
#     sheet() now prints these.
#
# Texel density achieved: masonry 14.7 px/m at 4096, ward 21.7, fittings 28.3.
#
# Skin the ruined castle: limestone ashlar, damp plinth, moss, bleach, soot.
#
#   blender --background --python skin.py -- <outname> [--fast] [--texlib-bake]
#
# Compass convention: +Y north, +X east.
import bpy, sys, os, math, json

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = r"C:\Users\AlexConnolly\agent-skills\plugins\blender-texture\skills\blender-texture\scripts"
sys.path.append(SCRIPTS)
import texconfig as cfg          # noqa: E402
import texlib as tx              # noqa: E402
import texshots as ts            # noqa: E402

SRC = os.path.join(HERE, 'castle_src.glb')


def argv():
    a = sys.argv
    return a[a.index('--') + 1:] if '--' in a else []


ARGS = argv()
NAME = ARGS[0] if ARGS else 'castle_skin'
FAST = '--fast' in ARGS
TEXLIB_BAKE = '--texlib-bake' in ARGS
NO_BAKE = '--no-bake' in ARGS
TUNE_PATH = os.path.join(HERE, 'tune.json')
T = json.load(open(TUNE_PATH))
for _k, _v in list(T.items()):
    if isinstance(_v, str) and len(_v) == 6:
        try:
            T[_k] = int(_v, 16)
        except ValueError:
            pass

# The raking sun as shipped (az 200 deg) is behind the subject relative to the
# close camera, so rake.png comes out as a shadow study. Skim from the camera
# side instead.
cfg.RAKE_AZIMUTH_DEG = T['rake_az']
cfg.RAKE_ELEVATION_DEG = T['rake_el']

# UNWRAP_MARGIN ships at 0.02, which is a fraction of the whole UV square
# applied around EVERY island. On masonry (about 10,000 islands) that costs a
# factor of 28 in texel density: 0.84 px/m at 4096 instead of 23.3.
cfg.UNWRAP_MARGIN = T['unwrap_margin']
cfg.BAKE_MARGIN = T['bake_margin']
cfg.BAKE_SAMPLES = T['bake_samples']

SIZES = T['sizes_fast'] if FAST else T['sizes']


# ---------------------------------------------------------------- palette
STONE_A   = T['stone_a']
STONE_B   = T['stone_b']
STONE_C   = T['stone_c']
JOINT     = T['joint']
DAMP      = T['damp']
MOSS      = T['moss']
MOSS_DARK = T['moss_dark']
LICHEN    = T['lichen']
BLEACH    = T['bleach']
SOOT      = T['soot']


# ------------------------------------------------- helpers texlib does not have

def mad(g, s, mul, add):
    """s * mul + add. texlib.ramp() can only set the INPUT range, so there is
    no way to produce a small-amplitude signal with it."""
    m = g.node('ShaderNodeMath', operation='MULTIPLY_ADD')
    g.link(s, m.inputs[0])
    m.inputs[1].default_value = mul
    m.inputs[2].default_value = add
    return m.outputs['Value']


def mixf(g, a, b, fac):
    """Scalar lerp. texlib.layer() is RGBA-only; there is no float equivalent,
    which is what you need to drive roughness from several masks."""
    n = g.node('ShaderNodeMix', data_type='FLOAT')
    g.link(fac, g._in(n, 'Factor'))
    for key, v in (('A', a), ('B', b)):
        sock = g._in(n, key)
        if isinstance(v, (int, float)):
            sock.default_value = float(v)
        else:
            g.link(v, sock)
    return g._out(n)


def maxf(g, a, b):
    n = g.node('ShaderNodeMath', operation='MAXIMUM')
    g.link(a, n.inputs[0])
    g.link(b, n.inputs[1])
    return n.outputs['Value']


def streak_noise(g, scale, squash, seed=0.0):
    """Noise stretched along Z, so it reads as something that ran down the
    wall. texlib.mask_noise always feeds raw object coordinates, so there is
    no way to make an anisotropic field with it — and almost every real stain
    is anisotropic, because gravity."""
    sq = g.node('ShaderNodeVectorMath', operation='MULTIPLY')
    g.link(g.coords().outputs['Object'], sq.inputs[0])
    sq.inputs[1].default_value = (1.0, 1.0, squash)
    n = g.node('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = 6.0
    n.inputs['Distortion'].default_value = 0.3
    g.link(sq.outputs['Vector'], n.inputs['Vector'])
    return next(s for s in n.outputs if s.name in ('Factor', 'Fac'))


def facing_rough(g, direction, softness, scale, strength):
    """mask_facing, but against a normal that has been roughened first.

    texlib.mask_facing dots the raw Geometry Normal against a direction. On a
    flat-shaded mesh that normal is CONSTANT across a facet, so the mask is
    constant across a facet too, and every polygon comes out a hard-edged
    block of one value. On the gate arch that is a fan of solid green wedges —
    the same 'lone green quad' failure the per-face material had, arriving
    through the back door. Perturbing the normal with a bump first makes the
    direction vary inside a facet, so the mask crosses polygon edges."""
    n = g.node('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = 6.0
    g.link(g.coords().outputs['Object'], n.inputs['Vector'])
    b = g.node('ShaderNodeBump')
    b.inputs['Strength'].default_value = strength
    b.inputs['Distance'].default_value = 1.0
    g.link(next(s for s in n.outputs if s.name in ('Factor', 'Fac')),
           b.inputs['Height'])
    d = g.node('ShaderNodeVectorMath', operation='DOT_PRODUCT')
    g.link(b.outputs['Normal'], d.inputs[0])
    d.inputs[1].default_value = direction
    m = g.node('ShaderNodeMapRange')
    g.link(d.outputs['Value'], m.inputs['Value'])
    m.inputs['From Min'].default_value = 1.0 - softness * 2.0
    m.inputs['From Max'].default_value = 1.0
    m.clamp = True
    return m.outputs['Result']


def xyz(g):
    sep = g.node('ShaderNodeSeparateXYZ')
    g.link(g.coords().outputs['Object'], sep.inputs['Vector'])
    return sep


def band(g, z0, z1, soft=1.0):
    """1 between z0 and z1 in world Z, fading over `soft` metres."""
    up = g.mask_height(z0 - soft, z0 + soft)
    dn = g.mask_height(z1 - soft, z1 + soft, invert=True)
    return g.mul(up, dn)


def mask_column(g, x, y, radius, z0, z1, soft=1.0):
    """Soot plume: near (x, y) in plan, between z0 and z1, widening upward.
    texlib has no 'near this point' mask at all, so this is hand-built."""
    sub = g.node('ShaderNodeVectorMath', operation='SUBTRACT')
    g.link(g.coords().outputs['Object'], sub.inputs[0])
    sub.inputs[1].default_value = (x, y, 0.0)
    flat = g.node('ShaderNodeVectorMath', operation='MULTIPLY')
    g.link(sub.outputs['Vector'], flat.inputs[0])
    flat.inputs[1].default_value = (1.0, 1.0, 0.0)
    ln = g.node('ShaderNodeVectorMath', operation='LENGTH')
    g.link(flat.outputs['Vector'], ln.inputs[0])
    m = g.node('ShaderNodeMapRange')
    g.link(ln.outputs['Value'], m.inputs['Value'])
    m.inputs['From Min'].default_value = radius
    m.inputs['From Max'].default_value = radius * 0.35
    m.clamp = True
    return g.mul(m.outputs['Result'], band(g, z0, z1, soft))


def courses(g, height, thickness, perpend):
    """Ashlar coursing: horizontal bed joints every `height` metres plus
    vertical perpends, offset half a block per course. 1 in the joint.

    texlib has no brick / coursing mask, which for anything architectural is
    the single most obvious gap."""
    sep = xyz(g)
    # bed joints: fract(z / h) near 0
    d = g.node('ShaderNodeMath', operation='DIVIDE')
    g.link(sep.outputs['Z'], d.inputs[0])
    d.inputs[1].default_value = height
    fr = g.node('ShaderNodeMath', operation='FRACT')
    g.link(d.outputs['Value'], fr.inputs[0])
    bed = g.node('ShaderNodeMapRange')
    g.link(fr.outputs['Value'], bed.inputs['Value'])
    bed.inputs['From Min'].default_value = thickness / height
    bed.inputs['From Max'].default_value = 0.0
    bed.clamp = True

    # perpends: fract((x + y + course_parity * perpend/2) / perpend)
    course = g.node('ShaderNodeMath', operation='FLOOR')
    g.link(d.outputs['Value'], course.inputs[0])
    par = g.node('ShaderNodeMath', operation='MODULO')
    g.link(course.outputs['Value'], par.inputs[0])
    par.inputs[1].default_value = 2.0
    off = g.node('ShaderNodeMath', operation='MULTIPLY')
    g.link(par.outputs['Value'], off.inputs[0])
    off.inputs[1].default_value = perpend * 0.5
    s1 = g.node('ShaderNodeMath', operation='ADD')
    g.link(sep.outputs['X'], s1.inputs[0])
    g.link(sep.outputs['Y'], s1.inputs[1])
    s2 = g.node('ShaderNodeMath', operation='ADD')
    g.link(s1.outputs['Value'], s2.inputs[0])
    g.link(off.outputs['Value'], s2.inputs[1])
    d2 = g.node('ShaderNodeMath', operation='DIVIDE')
    g.link(s2.outputs['Value'], d2.inputs[0])
    d2.inputs[1].default_value = perpend
    fr2 = g.node('ShaderNodeMath', operation='FRACT')
    g.link(d2.outputs['Value'], fr2.inputs[0])
    per = g.node('ShaderNodeMapRange')
    g.link(fr2.outputs['Value'], per.inputs['Value'])
    per.inputs['From Min'].default_value = thickness / perpend
    per.inputs['From Max'].default_value = 0.0
    per.clamp = True
    return maxf(g, bed.outputs['Result'], per.outputs['Result'])


def block_id(g, height, perpend):
    """One random value per ashlar block, from the same coursing lattice.

    This is what actually makes cut stone read as cut stone: each block came
    out of the quarry a slightly different colour. A noise field cannot do it,
    because a noise field does not know where the joints are."""
    sep = xyz(g)
    d = g.node('ShaderNodeMath', operation='DIVIDE')
    g.link(sep.outputs['Z'], d.inputs[0])
    d.inputs[1].default_value = height
    course = g.node('ShaderNodeMath', operation='FLOOR')
    g.link(d.outputs['Value'], course.inputs[0])
    par = g.node('ShaderNodeMath', operation='MODULO')
    g.link(course.outputs['Value'], par.inputs[0])
    par.inputs[1].default_value = 2.0
    off = g.node('ShaderNodeMath', operation='MULTIPLY')
    g.link(par.outputs['Value'], off.inputs[0])
    off.inputs[1].default_value = perpend * 0.5
    s1 = g.node('ShaderNodeMath', operation='ADD')
    g.link(sep.outputs['X'], s1.inputs[0])
    g.link(sep.outputs['Y'], s1.inputs[1])
    s2 = g.node('ShaderNodeMath', operation='ADD')
    g.link(s1.outputs['Value'], s2.inputs[0])
    g.link(off.outputs['Value'], s2.inputs[1])
    d2 = g.node('ShaderNodeMath', operation='DIVIDE')
    g.link(s2.outputs['Value'], d2.inputs[0])
    d2.inputs[1].default_value = perpend
    col = g.node('ShaderNodeMath', operation='FLOOR')
    g.link(d2.outputs['Value'], col.inputs[0])
    # a third axis so blocks on the X wall and the Y wall differ
    d3 = g.node('ShaderNodeMath', operation='DIVIDE')
    g.link(sep.outputs['X'], d3.inputs[0])
    d3.inputs[1].default_value = perpend * 4.0
    fl3 = g.node('ShaderNodeMath', operation='FLOOR')
    g.link(d3.outputs['Value'], fl3.inputs[0])
    v = g.node('ShaderNodeCombineXYZ')
    g.link(col.outputs['Value'], v.inputs['X'])
    g.link(course.outputs['Value'], v.inputs['Y'])
    g.link(fl3.outputs['Value'], v.inputs['Z'])
    wn = g.node('ShaderNodeTexWhiteNoise')
    g.link(v.outputs['Vector'], wn.inputs['Vector'])
    return wn.outputs['Value']


def rough_socket(g, socket):
    """texlib.roughness() takes a value+one mask; it cannot take a socket you
    built yourself, which is what you need once more than one layer changes
    the roughness."""
    g.link(socket, g.bsdf.inputs['Roughness'])


# ---------------------------------------------------------------- the masks
# Each takes a Graph and returns a socket. Shared between the material build
# and the mask contact sheet, so the sheet cannot drift from the material.

def m_patch_big(g):
    return g.mask_noise(scale=T['n_big'], detail=3.0, distortion=0.35, seed=1.0)


def m_patch_mid(g):
    return g.mask_noise(scale=T['n_mid'], detail=4.0, distortion=0.3, seed=2.0)


def m_patch_fine(g):
    return g.mask_noise(scale=T['n_fine'], detail=5.0, distortion=0.2, seed=3.0)


def m_grain(g):
    return g.mask_noise(scale=T['n_grain'], detail=8.0, seed=4.0)


def m_courses(g):
    return courses(g, T['course_h'], T['joint_t'], T['perpend'])


def m_blocks(g):
    return block_id(g, T['course_h'], T['perpend'])


def m_one(g):
    """Constant 1: the silhouette, so mask coverage can be measured as a
    fraction of visible surface instead of guessed at."""
    return mad(g, m_patch_big(g), 0.0, 1.0)


def m_base(g):
    """Two-tone limestone as a MASK view: where the warmer bed shows."""
    return g.ramp(m_patch_mid(g), T['base_lo'], T['base_hi'])


def m_damp(g):
    """A tide mark. The height gradient is multiplied by a coherent noise field
    before it is thresholded, so the contour of the top edge wanders instead of
    running level. The jitter noise has to be COARSE — at 0.8 m the wobble is
    smaller than one wall block and reads as a soft edge, not a ragged one."""
    h = g.mask_height(T['damp_lo'], T['damp_hi'], invert=True)
    coarse = g.mask_noise(scale=T['damp_jit_scale'], detail=4.0,
                          distortion=0.6, seed=21.0)
    jitter = mad(g, coarse, T['damp_jit'], 1.0 - T['damp_jit'] * 0.5)
    fleck = mad(g, m_patch_fine(g), T['damp_fleck'],
                1.0 - T['damp_fleck'] * 0.5)
    return g.ramp(g.mul(h, jitter, fleck), T['damp_t0'], T['damp_t1'],
                  gamma=T['damp_gamma'])


def _face(g, direction):
    if T.get('face_rough'):
        return facing_rough(g, direction, T['face_soft'],
                            T['face_rough_scale'], T['face_rough'])
    return g.mask_facing(direction, softness=T['face_soft'])


def m_shade(g):
    """North + east: the faces that stay wet."""
    return g.add(_face(g, (0, 1, 0)), _face(g, (1, 0, 0)))


def m_sunny(g):
    return g.add(_face(g, (0, -1, 0)), _face(g, (-1, 0, 0)))


def m_cavity(g):
    """Two scales. A short ray finds the actual seam where two walls meet; a
    long one finds a sheltered angle — the re-entrant that never sees sun. Moss
    wants both, and one distance cannot give you both."""
    seam = g.ramp(g.mask_cavity(distance=T['cav_near'], samples=T['ao_samples']),
                  T['seam_lo'], T['seam_hi'])
    shelter = g.ramp(g.mask_cavity(distance=T['cav_far'], samples=T['ao_samples']),
                     T['shelt_lo'], T['shelt_hi'])
    return g.add(seam, mad(g, shelter, T['shelt_w'], 0.0))


def m_curvature(g):
    """Kept only to demonstrate that it gives nothing on flat-faced low-poly."""
    return g.mask_curvature()


def m_moss(g):
    """Growth where growth happens: the seam, the sheltered angle, the shaded
    face — and always low down.

    Every factor here needs a FLOOR. Four 0..1 fields multiplied together have
    a typical value near 0.1, and the first version of this covered under two
    per cent of the model."""
    corner = g.ramp(m_cavity(g), T['cav_lo'], T['cav_hi'], gamma=T['cav_gamma'])
    low = g.mask_height(T['moss_lo'], T['moss_hi'], invert=True)
    sheltered = g.mul(g.ramp(m_shade(g), T['shade_lo'], T['shade_hi']),
                      mad(g, low, T['shade_low_w'], 1.0 - T['shade_low_w']))
    # placement: union, not product. A seam is mossy whichever way it faces,
    # and a north wall is mossy whether or not it is a seam.
    seed = g.add(mad(g, corner, T['corner_w'], 0.0),
                 mad(g, sheltered, T['shade_w'], 0.0))
    # break-up: these MODULATE around 1, they do not gate. Two 0..1 noises
    # multiplied into the placement is what made pass 2 invisible.
    patch = mad(g, g.ramp(m_patch_mid(g), T['moss_p0'], T['moss_p1']),
                T['moss_p_amp'], 1.0 - T['moss_p_amp'] * 0.5)
    fine = mad(g, m_patch_fine(g), T['moss_f_amp'],
               1.0 - T['moss_f_amp'] * 0.5)
    bias = mad(g, low, T['moss_bias'], 1.0 - T['moss_bias'])
    field = g.mul(seed, patch, fine, bias)
    # Crenulation. Without this the field is one smooth low-frequency cloud
    # and thresholding it just moves a smooth contour around — the mask view
    # stays a soft even gradient however hard the threshold is set. Growth
    # has a ragged margin, and some of that margin follows the masonry.
    if T.get('moss_cren_amp'):
        cren = g.mask_noise(scale=T['moss_cren_scale'], detail=8.0,
                            distortion=0.5, seed=41.0)
        field = g.mul(field, mad(g, cren, T['moss_cren_amp'],
                                 1.0 - T['moss_cren_amp'] * 0.5))
    if T.get('moss_blk_amp'):
        field = g.mul(field, mad(g, m_blocks(g), T['moss_blk_amp'],
                                 1.0 - T['moss_blk_amp'] * 0.5))
    return g.ramp(field, T['moss_t0'], T['moss_t1'], gamma=T['moss_gamma'])


def m_bleach(g):
    high = g.mask_height(T['bleach_lo'], T['bleach_hi'])
    patch = g.ramp(m_patch_big(g), T['bleach_p0'], T['bleach_p1'])
    field = g.mul(g.ramp(m_sunny(g), 0.3, 1.0), high, patch)
    # Same lesson as the moss: a height ramp thresholded on its own gives a
    # smooth vertical fade, which is the one thing the brief says must not
    # happen. Break the ramp before thresholding it, and let some of the
    # break follow the coursing.
    if T.get('bleach_cren_amp'):
        cren = g.mask_noise(scale=T['bleach_cren_scale'], detail=7.0,
                            distortion=0.4, seed=53.0)
        field = g.mul(field, mad(g, cren, T['bleach_cren_amp'],
                                 1.0 - T['bleach_cren_amp'] * 0.5))
    if T.get('bleach_blk_amp'):
        field = g.mul(field, mad(g, m_blocks(g), T['bleach_blk_amp'],
                                 1.0 - T['bleach_blk_amp'] * 0.5))
    return g.ramp(field, T['bleach_t0'], T['bleach_t1'],
                  gamma=T['bleach_gamma'])


def m_lichen(g):
    up = g.mask_facing((0, 0, 1), softness=T['lich_soft'])
    patch = g.ramp(m_patch_fine(g), T['lich_p0'], T['lich_p1'])
    field = g.mul(up, patch)
    if T.get('lich_blk_amp'):
        field = g.mul(field, mad(g, m_blocks(g), T['lich_blk_amp'],
                                 1.0 - T['lich_blk_amp'] * 0.5))
    return g.ramp(field, T['lich_t0'], T['lich_t1'], gamma=T['lich_gamma'])


def m_soot(g):
    cols = [mask_column(g, *c) for c in T['soot_columns']]
    out = cols[0]
    for c in cols[1:]:
        out = g.add(out, c)
    # a round soft blob is not what a hearth leaves. Streak it vertically.
    streak = mad(g, streak_noise(g, T['soot_streak_scale'],
                                 T['soot_streak_squash'], 31.0),
                 T['soot_streak_amp'], 1.0 - T['soot_streak_amp'] * 0.35)
    return g.ramp(g.mul(out, streak), T['soot_t0'], T['soot_t1'],
                  gamma=T['soot_gamma'])


MASKS = {
    'base':      m_base,
    'courses':   m_courses,
    'blocks':    m_blocks,
    'damp':      m_damp,
    'moss':      m_moss,
    'cavity':    m_cavity,
    'curvature': m_curvature,
    'bleach':    m_bleach,
    'lichen':    m_lichen,
    'soot':      m_soot,
}


# ---------------------------------------------------------------- materials

def limestone(name='limestone'):
    g = tx.Graph(name)

    joint = m_courses(g)
    grain = m_grain(g)

    col = g.variegate(STONE_A, STONE_B, m_base(g))
    col = g.layer(col, STONE_C, g.ramp(m_patch_big(g), T['third_lo'], T['third_hi']))
    # per-block tone: pushes each stone a little pale or a little warm
    blk = m_blocks(g)
    col = g.layer(col, STONE_C, g.ramp(blk, T['blk_pale_lo'], T['blk_pale_hi']))
    col = g.layer(col, STONE_B, g.ramp(blk, T['blk_warm_hi'], T['blk_warm_lo']))
    col = g.layer(col, STONE_B, g.ramp(grain, 0.35, 0.85))
    col = g.layer(col, JOINT, g.ramp(joint, 0.15, 0.9))

    bleach = m_bleach(g)
    damp = m_damp(g)
    soot = m_soot(g)
    lichen = m_lichen(g)
    moss = m_moss(g)

    col = g.layer(col, BLEACH, bleach)
    col = g.layer(col, DAMP, damp)
    col = g.layer(col, SOOT, soot)
    col = g.layer(col, LICHEN, lichen)
    # moss goes on in two tones so it is not a flat green fill
    mosscol = g.variegate(MOSS, MOSS_DARK, g.ramp(m_patch_fine(g), 0.3, 0.7))
    col = g.layer(col, mosscol, moss)
    g.base_colour(col)

    # roughness: dry stone high, damp low, bleach higher, moss highest
    r = mad(g, grain, T['r_grain'], T['r_base'])
    r = mixf(g, r, T['r_bleach'], bleach)
    r = mixf(g, r, T['r_damp'], damp)
    r = mixf(g, r, T['r_moss'], moss)
    rough_socket(g, r)
    g.metallic(0.0)

    # Relief has to be built at a size the map can hold. A 6 cm mortar joint
    # is 0.9 px at 15 px/m and vanishes; a whole block sitting 1 cm proud is
    # 12 x 23 px and survives, which is why rake.png showed nothing until the
    # bump was rebuilt at block scale rather than joint scale.
    h = mad(g, blk, T['b_block'], -T['b_block'] * 0.5)
    h = g.add(h, mad(g, joint, -T['b_joint'], 0.0))
    h = g.add(h, mad(g, g.mask_noise(scale=T['b_grain_scale'], detail=6.0,
                                     seed=17.0), T['b_grain'], 0.0))
    g.bump(h, strength=T['b_strength'], distance=T['b_distance'])
    return g.build()


def simple(name, hex_a, hex_b, scale, rough, metal=0.0, bumpy=0.0):
    g = tx.Graph(name)
    n = g.mask_noise(scale=scale, detail=5.0, distortion=0.2, seed=7.0)
    col = g.variegate(hex_a, hex_b, g.ramp(n, 0.32, 0.68))
    # everything at ground level gets the same damp plinth, or the timber
    # posts float clean out of a wet wall
    damp = m_damp(g)
    col = g.layer(col, DAMP, g.ramp(damp, 0.0, 1.0))
    g.base_colour(col)
    r = mad(g, n, 0.12, rough)
    r = mixf(g, r, max(0.0, rough - 0.3), damp)
    rough_socket(g, r)
    g.metallic(metal)
    if bumpy:
        g.bump(n, strength=bumpy, distance=0.02)
    return g.build()


def thatch_mat():
    g = tx.Graph('thatch')
    streak = g.mask_noise(scale=T['thatch_scale'], detail=8.0,
                          distortion=1.2, seed=11.0)
    col = g.variegate(0xB09755, 0x7E663A, g.ramp(streak, 0.3, 0.7))
    col = g.layer(col, 0x5E5A3C, g.ramp(m_patch_mid(g), 0.55, 0.85))
    g.base_colour(col)
    rough_socket(g, mad(g, streak, 0.1, 0.88))
    g.bump(streak, strength=0.6, distance=0.03)
    return g.build()


def earth_mat():
    g = tx.Graph('earth')
    n = g.mask_noise(scale=0.12, detail=6.0, distortion=0.4, seed=13.0)
    f = g.mask_noise(scale=1.4, detail=6.0, seed=14.0)
    col = g.variegate(0x8A7A5C, 0x6E6144, g.ramp(n, 0.3, 0.7))
    col = g.layer(col, 0x5B6138, g.ramp(g.mul(n, f), 0.42, 0.72))
    col = g.layer(col, 0x9C8F72, g.ramp(f, 0.6, 0.85))
    g.base_colour(col)
    rough_socket(g, mad(g, f, 0.1, 0.9))
    g.bump(f, strength=0.3, distance=0.02)
    return g.build()


# stone family -> one continuous limestone. This is the whole point: the
# builder's per-face moss/damp/pale assignment is thrown away and replaced by
# masks that do not stop at a polygon edge.
STONE_FAMILY = ('stone_old', 'stone_new', 'stone_pale', 'stone_damp',
                'moss', 'lichen')


def build_materials():
    lime = limestone()
    out = {n: lime for n in STONE_FAMILY}
    out['rubble'] = simple('rubble', 0xA79C8A, 0x7E7565, 0.9, 0.95, bumpy=0.5)
    out['timber'] = simple('timber', 0x6B4E30, 0x4A3520, 1.1, 0.9, bumpy=0.4)
    out['timber_dark'] = simple('timber_dark', 0x3E2C1B, 0x241A10, 1.1, 0.88,
                                bumpy=0.4)
    out['slate'] = simple('slate', 0x5A6166, 0x3E4548, 0.7, 0.55, bumpy=0.25)
    out['iron'] = simple('iron', 0x3A3A38, 0x22201E, 1.5, 0.55, metal=0.85)
    out['banner'] = simple('banner', 0x9E2B22, 0x74201A, 1.2, 0.85)
    out['opening'] = simple('opening', 0x0E0D0B, 0x060505, 1.0, 0.95)
    out['smoke'] = simple('smoke', 0xCDCEC8, 0xB6B8B2, 1.0, 0.95)
    out['thatch'] = thatch_mat()
    out['earth'] = earth_mat()
    return out


# ---------------------------------------------------------------- baking

def bake_set_multi(obj, name, size, maps):
    """texlib.bake_set() only inserts the bake target into the FIRST material
    on the object; Cycles needs one in every material or it aborts with
    'No active image found'. Same thing otherwise."""
    if not obj.data.uv_layers:
        raise SystemExit('%s has no UVs' % obj.name)
    os.makedirs(cfg.TEXTURES, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    spec = {
        'basecolor': ('DIFFUSE', False, {'pass_filter': {'COLOR'}}, cfg.BAKE_SAMPLES),
        'roughness': ('ROUGHNESS', True, {}, cfg.BAKE_SAMPLES),
        'normal':    ('NORMAL', True, {}, cfg.BAKE_SAMPLES),
    }
    trees = [m.node_tree for m in obj.data.materials if m and m.node_tree]
    out = {}
    for key in maps:
        kind, non_colour, kw, samples = spec[key]
        # bake_set() uses one size for every map. Base colour is what the eye
        # reads; roughness and normal can be half that and save three quarters
        # of their bytes in the glb.
        sz = int(size * T['map_scale'].get(key, 1.0))
        tx._setup_cycles(samples)
        img = bpy.data.images.new('%s_%s' % (name, key), sz, sz,
                                  alpha=False, float_buffer=False)
        if non_colour:
            img.colorspace_settings.name = 'Non-Color'
        nodes = []
        for nt in trees:
            n = nt.nodes.new('ShaderNodeTexImage')
            n.image = img
            nt.nodes.active = n
            for other in nt.nodes:
                other.select = False
            n.select = True
            nodes.append((nt, n))
        bpy.ops.object.bake(type=kind, **kw)
        path = os.path.join(cfg.TEXTURES, '%s_%s.png' % (name, key))
        img.filepath_raw = path
        img.file_format = 'PNG'
        img.save()
        out[key] = path
        for nt, n in nodes:
            nt.nodes.remove(n)
        print('BAKED %-10s %-5d %s' % (key, sz, path))
    return out


def coverage(path, silhouette):
    """What fraction of the visible model this mask actually covers, and how
    much of that is a hard edge rather than a gradient.

    The mask views are images with no numbers on them, so 'the moss looks a bit
    thin' is as far as looking gets you. A percentage is the difference between
    guessing at a threshold and setting one."""
    img = bpy.data.images.load(path, check_existing=False)
    px = list(img.pixels)
    bpy.data.images.remove(img)
    # image.pixels hands back the stored bytes as floats WITHOUT undoing the
    # display transform, so a mask of 0.5 comes back as 0.735. Undo it, or
    # every coverage figure is 20 points too generous.
    vals = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
            for c in px[0::4]]
    if silhouette is None:
        return vals, None
    inside = [v for v, s in zip(vals, silhouette) if s > 0.5]
    if not inside:
        return vals, None
    n = float(len(inside))
    strong = sum(1 for v in inside if v > 0.5) / n
    mid = sum(1 for v in inside if 0.15 < v < 0.85) / n
    return vals, (strong * 100.0, mid * 100.0,
                  sum(inside) / n)


def mask_views(objs, name, masks):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = T['mask_samples']
    sc.cycles.use_denoising = False
    sc.cycles.device = 'CPU'
    for o in list(sc.objects):
        if o.type == 'LIGHT':
            bpy.data.objects.remove(o, do_unlink=True)
    lo, hi = ts.bounds(objs)
    size = max(hi[i] - lo[i] for i in range(3))
    centre = tuple((lo[i] + hi[i]) / 2 for i in range(3))
    el = math.radians(35.264389682754654)
    az = math.radians(45.0)
    hero = (centre[0] + math.cos(el) * math.sin(az) * size * 4,
            centre[1] - math.cos(el) * math.cos(az) * size * 4,
            centre[2] + math.sin(el) * size * 4)
    out = os.path.join(cfg.SHOTS, name)
    sil_path = os.path.join(out, 'mask_silhouette.png')
    with ts.MaskView(objs, m_one):
        ts.camera(hero, centre, ortho=size * 1.5)
        ts.render(sil_path)
    sil, _ = coverage(sil_path, None)

    print('%-12s %8s %8s %8s' % ('MASK', 'strong%', 'soft%', 'mean'))
    for label, fn in masks.items():
        with ts.MaskView(objs, fn):
            ts.camera(hero, centre, ortho=size * 1.5)
            p = os.path.join(out, 'mask_%s.png' % label)
            ts.render(p)
        _, cov = coverage(p, sil)
        if cov:
            print('COVER %-12s %7.1f%% %7.1f%% %8.3f'
                  % (label, cov[0], cov[1], cov[2]))
        # a close mask view too: at whole-castle scale a 2.5 m damp band is
        # 26 pixels tall and you cannot see whether its edge is ragged
        with ts.MaskView(objs, fn):
            tgt = T['mask_close_target']
            loc = T['mask_close_loc']
            ts.camera(tuple(loc), tuple(tgt), lens=T['closeup_lens'])
            ts.render(os.path.join(out, 'maskc_%s.png' % label))
    ts.setup()


# ---------------------------------------------------------------- main

def lib_material_alpha(name, hex_value, alpha):
    """A translucent material that survives glTF export.

    glTF carries this as the base colour alpha with an alphaMode of BLEND, so
    it needs the blend method set on the Blender material as well as the socket
    value -- setting only the socket exports as opaque."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    rgba = tx.srgb(hex_value, alpha)
    b.inputs['Base Color'].default_value = rgba
    b.inputs['Roughness'].default_value = 1.0
    if 'Alpha' in b.inputs:
        b.inputs['Alpha'].default_value = alpha
    m.blend_method = 'BLEND'
    return m


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ts.setup()
    bpy.ops.import_scene.gltf(filepath=SRC)
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']

    mats = build_materials()
    for o in objs:
        for i, m in enumerate(o.data.materials):
            if m is None:
                continue
            repl = mats.get(m.name)
            if repl is None:
                print('!! no replacement for material', m.name)
                continue
            o.data.materials[i] = repl

    # The vapour group is never textured. Baking rebuilds a Principled from
    # image maps and drops the alpha, which turns translucent smoke into solid
    # pale cubes over the roofs -- at night, the brightest thing in frame.
    smoke_objs = [o for o in objs if o.name.startswith('vapour')]
    for o in smoke_objs:
        o.data.materials.clear()
        o.data.materials.append(
            lib_material_alpha('vapour', 0xCDCEC8, 0.30))
    objs = [o for o in objs if o not in set(smoke_objs)]
    if smoke_objs:
        print('SKIP   %d vapour object(s) left translucent, not baked'
              % len(smoke_objs))

    if not NO_BAKE:
        for o in objs:
            loops = tx.unwrap(o)
            d = tx.texel_density(o, SIZES[o.name])
            area = sum(p.area for p in o.data.polygons)
            print('UNWRAP %-10s loops=%-7d area=%8.1f m2  size=%-5d '
                  'texel=%6.1f px/m' % (o.name, loops, area, SIZES[o.name], d))

        for o in objs:
            if TEXLIB_BAKE:
                paths = tx.bake_set(o, '%s_%s' % (NAME, o.name),
                                    size=SIZES[o.name])
            else:
                paths = bake_set_multi(o, '%s_%s' % (NAME, o.name),
                                       SIZES[o.name], cfg.MAPS)
            tx.apply_baked(o, paths, name='%s_%s_baked' % (NAME, o.name))

        tx.export([o.name for o in objs], NAME)

    # contact sheet: hero / rake / flat of the BAKED material, in EEVEE.
    ts.setup()
    ts.sheet(objs, NAME)

    # The masks separately, in CYCLES. sheet() renders them in whatever engine
    # is current, and EEVEE evaluates the Ambient Occlusion node with a
    # screen-space approximation: the cavity mask it shows has haloes along
    # every silhouette and streaks across the courtyard that are not in the
    # bake at all. For any ray-traced mask the EEVEE mask view is a lie.
    mask_views(objs, NAME, MASKS)

    # extra: a real close-up of the gatehouse wall, and one of an inside corner
    lo, hi = ts.bounds(objs)
    size = max(hi[i] - lo[i] for i in range(3))
    for o in list(bpy.context.scene.objects):
        if o.type == 'LIGHT':
            bpy.data.objects.remove(o, do_unlink=True)
    ts.sun(cfg.SUN_FROM, cfg.SUN_ENERGY)
    ts.world(cfg.SKY)
    out = os.path.join(cfg.SHOTS, NAME)
    for label, tgt, loc in T['closeups']:
        ts.camera(tuple(loc), tuple(tgt), lens=T['closeup_lens'])
        ts.render(os.path.join(out, 'close_%s.png' % label))
    print('DONE', out)


main()
