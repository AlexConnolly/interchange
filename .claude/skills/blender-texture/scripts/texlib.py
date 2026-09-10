# Procedural materials, masks, and baking them down to glTF textures.
#
# THE SHAPE OF THE PIPELINE, AND WHY IT HAS TO BE THIS SHAPE
#
# glTF carries image textures wired into a Principled BSDF. It does not carry
# procedural nodes. A noise-and-ramp material renders beautifully in Blender
# and arrives in the engine as flat grey, which is a failure you only find
# after export unless you know to expect it.
#
# So the pipeline is: build the material procedurally, unwrap, bake it down to
# images, rewire those images in place of the procedural graph, then export.
# `bake_set()` and `apply_baked()` do the last three.
#
# ON MASKS, WHICH ARE THE WHOLE GAME
#
# A material is a base surface plus things that sit on it in particular places
# — moss low down and on the shaded side, rust around fixings, dirt in the
# crevices, wear on the edges that get handled. Those placements are what make
# a surface read as a thing that has existed rather than a thing that was
# manufactured this morning, and every one of them is a mask.
#
# Note especially the difference between `mask_curvature` and `mask_cavity`:
# pointiness needs real concave geometry and gives you almost nothing on
# flat-faced low-poly, where ambient occlusion still finds the corners.
import bpy
import bmesh
import math
import os

import texconfig as cfg


# ---------------------------------------------------------------- colour

def srgb(hex_value, alpha=1.0):
    """0xRRGGBB as sRGB -> linear RGBA, which is what shader sockets hold."""
    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin(((hex_value >> 16) & 255) / 255.0),
            lin(((hex_value >> 8) & 255) / 255.0),
            lin((hex_value & 255) / 255.0),
            alpha)


# ---------------------------------------------------------------- the graph

class Graph:
    """A material under construction.

    Every method returns a socket, and sockets are the currency: a mask is a
    socket carrying 0..1, a colour is a socket carrying RGB. That keeps the
    build script readable as a description of the surface rather than as node
    plumbing."""

    def __init__(self, name):
        self.mat = bpy.data.materials.new(name)
        self.mat.use_nodes = True
        self.nt = self.mat.node_tree
        self.bsdf = next(n for n in self.nt.nodes
                         if n.type == 'BSDF_PRINCIPLED')
        self._x = -400
        self._coord = None

    # ------------------------------------------------------------ plumbing

    def node(self, kind, **kw):
        n = self.nt.nodes.new(kind)
        n.location = (self._x, 0)
        self._x -= 40
        for k, v in kw.items():
            setattr(n, k, v)
        return n

    def link(self, out, socket_in):
        return self.nt.links.new(out, socket_in)

    @staticmethod
    def _in(node, name, skip=0):
        """Resolve an input socket by name, ignoring the disabled duplicates.

        The Mix node carries ten inputs — two Factors and four A/B pairs, one
        per data type — of which three are enabled. Indexing it by position is
        how you silently wire nothing, so everything here goes by name and
        takes the enabled one."""
        found = [s for s in node.inputs if s.name == name and s.enabled]
        if not found:
            found = [s for s in node.inputs if s.name == name]
        return found[skip]

    @staticmethod
    def _out(node, name='Result'):
        found = [s for s in node.outputs if s.name == name and s.enabled]
        if not found:
            found = [s for s in node.outputs if s.name == name]
        return found[0]

    def coords(self):
        if self._coord is None:
            self._coord = self.node('ShaderNodeTexCoord')
        return self._coord

    # ------------------------------------------------------------ masks
    #
    # Each returns a socket carrying roughly 0..1. Combine with mul/add/ramp.

    def mask_noise(self, scale=6.0, detail=6.0, distortion=0.0, seed=0.0,
                   stretch=None):
        """Fractal noise in object space. The general-purpose breaker-up of
        anything too even.

        `stretch` scales the coordinates before the noise, so the field itself
        becomes directional: `stretch=(1, 1, 0.15)` draws it out vertically.
        Almost every real stain runs downward - rain streaks, rust weeping from
        a fixing, soot above a hearth, damp wicking up a wall - and isotropic
        noise cannot say any of that. It is the difference between weathering
        and a texture."""
        n = self.node('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        n.inputs['Distortion'].default_value = distortion
        if 'W' in n.inputs:
            n.inputs['W'].default_value = seed
        vec = self.coords().outputs['Object']
        if stretch:
            m = self.node('ShaderNodeMapping')
            m.inputs['Scale'].default_value = stretch
            self.link(vec, m.inputs['Vector'])
            vec = m.outputs['Vector']
        self.link(vec, n.inputs['Vector'])
        return n.outputs['Fac']

    def mask_voronoi(self, scale=8.0, randomness=1.0):
        """Cellular. Reads as stones, scales, flaking paint, dried mud."""
        n = self.node('ShaderNodeTexVoronoi')
        n.inputs['Scale'].default_value = scale
        n.inputs['Randomness'].default_value = randomness
        self.link(self.coords().outputs['Object'], n.inputs['Vector'])
        return n.outputs['Distance']

    def mask_height(self, lo, hi, invert=False):
        """A gradient in world Z: 0 at `lo`, 1 at `hi`, clamped outside both.

        Read that clamp carefully, because the obvious call is the wrong one.
        `mask_height(0, 2.5)` is 1 for the *entire wall above 2.5 m*, not a
        band across the bottom — so a damp plinth is:

            damp = g.mask_height(0.0, 2.5, invert=True)   # 1 at the foot

        Getting this backwards produces a mask covering ninety percent of the
        model, which looks like the material is broken rather than the
        placement. Check the coverage number in the mask view: a plinth on a
        12 m wall should be reporting something like 20 percent, not 90."""
        geo = self.node('ShaderNodeNewGeometry')
        sep = self.node('ShaderNodeSeparateXYZ')
        self.link(geo.outputs['Position'], sep.inputs['Vector'])
        m = self.node('ShaderNodeMapRange')
        self.link(sep.outputs['Z'], m.inputs['Value'])
        m.inputs['From Min'].default_value = hi if invert else lo
        m.inputs['From Max'].default_value = lo if invert else hi
        m.clamp = True
        return m.outputs['Result']

    def mask_facing(self, direction=(0, 0, 1), softness=0.5):
        """How much a surface points a given way, in world space.

        Moss goes on the shaded side; snow and dust go on the up-faces; paint
        fades on the side the weather comes from. `direction` is Z-up."""
        geo = self.node('ShaderNodeNewGeometry')
        d = self.node('ShaderNodeVectorMath', operation='DOT_PRODUCT')
        self.link(geo.outputs['Normal'], d.inputs[0])
        d.inputs[1].default_value = direction
        m = self.node('ShaderNodeMapRange')
        self.link(d.outputs['Value'], m.inputs['Value'])
        m.inputs['From Min'].default_value = 1.0 - softness * 2.0
        m.inputs['From Max'].default_value = 1.0
        m.clamp = True
        return m.outputs['Result']

    def mask_curvature(self, lo=0.45, hi=0.52, convex=False):
        """Pointiness: high on convex edges, low in concave creases.

        Only useful where the mesh actually has curvature. On flat-faced
        low-poly a whole wall is one value and this returns nothing usable —
        use `mask_cavity` there instead."""
        geo = self.node('ShaderNodeNewGeometry')
        m = self.node('ShaderNodeMapRange')
        self.link(geo.outputs['Pointiness'], m.inputs['Value'])
        m.inputs['From Min'].default_value = hi if convex else lo
        m.inputs['From Max'].default_value = lo if convex else hi
        m.clamp = True
        return m.outputs['Result']

    def mask_cavity(self, distance=0.3, inside=True, samples=16):
        """Ambient occlusion: how enclosed a point is.

        This is the one that works on hard-surface low-poly. Pointiness needs
        smooth concave curvature; AO finds the inside corner where two flat
        walls meet, which is where dirt and moss actually collect.

        Bake this in Cycles and look at it in Cycles. EEVEE evaluates the node
        with a screen-space approximation: haloes along every silhouette and
        streaks across open floors, none of which is in the Cycles bake. A
        mask view of this rendered in EEVEE is actively misleading."""
        n = self.node('ShaderNodeAmbientOcclusion')
        n.inputs['Distance'].default_value = distance
        n.only_local = True
        n.samples = samples
        # The occlusion output is called 'AO' from 2.81 on; older code and
        # some other nodes still call the equivalent socket 'Fac'.
        out = next(s for s in n.outputs if s.name in ('AO', 'Fac'))
        if inside:
            inv = self.node('ShaderNodeInvert')
            self.link(out, inv.inputs['Color'])
            out = inv.outputs['Color']
        return out

    def mask_edges(self, radius=0.02):
        """Bevel-based edge detection: high on a sharp exposed corner. Where
        paint rubs through and metal polishes bright."""
        bev = self.node('ShaderNodeBevel')
        bev.inputs['Radius'].default_value = radius
        geo = self.node('ShaderNodeNewGeometry')
        d = self.node('ShaderNodeVectorMath', operation='DOT_PRODUCT')
        self.link(bev.outputs['Normal'], d.inputs[0])
        self.link(geo.outputs['True Normal'], d.inputs[1])
        m = self.node('ShaderNodeMapRange')
        self.link(d.outputs['Value'], m.inputs['Value'])
        m.inputs['From Min'].default_value = 1.0
        m.inputs['From Max'].default_value = 0.9
        m.clamp = True
        return m.outputs['Result']

    def mask_cells(self, cell=(0.5, 0.5, 0.5), seed=0.0):
        """A different random value per grid cell, constant within the cell.

        Brick, ashlar, tile, planks, paving, panels, scales — anything laid out
        in units where each unit is a slightly different tone. Per-unit tonal
        variation is usually the single thing that stops a repeated surface
        reading as one flat expanse.

        Position is snapped to the cell size and hashed, so the value is
        genuinely constant across each cell rather than a gradient that happens
        to look blocky."""
        sep = self.node('ShaderNodeSeparateXYZ')
        self.link(self.coords().outputs['Object'], sep.inputs['Vector'])
        comb = self.node('ShaderNodeCombineXYZ')
        for axis, size in zip('XYZ', cell):
            d = self.node('ShaderNodeMath', operation='DIVIDE')
            self.link(sep.outputs[axis], d.inputs[0])
            d.inputs[1].default_value = max(1e-6, size)
            f = self.node('ShaderNodeMath', operation='FLOOR')
            self.link(d.outputs['Value'], f.inputs[0])
            self.link(f.outputs['Value'], comb.inputs[axis])
        wn = self.node('ShaderNodeTexWhiteNoise', noise_dimensions='4D')
        self.link(comb.outputs['Vector'], wn.inputs['Vector'])
        if 'W' in wn.inputs:
            wn.inputs['W'].default_value = seed
        return wn.outputs['Value']

    def mask_courses(self, height=0.3, length=0.9, mortar=0.03, offset=0.5,
                     bias=0.0):
        """Coursed masonry: the joint lines, and a per-block random tone.

        Returns `(joints, blocks)` — `joints` is 1 in the mortar and 0 on the
        block face, `blocks` is a different value per block. Layer a slightly
        recessed, darker colour with `joints` and vary the base tone with
        `blocks`.

        Works for brick, ashlar, tiling, and with `offset=0` for stack bond or
        panelling."""
        n = self.node('ShaderNodeTexBrick')
        n.offset = offset
        n.squash = 1.0
        n.inputs['Scale'].default_value = 1.0
        n.inputs['Mortar Size'].default_value = mortar
        n.inputs['Bias'].default_value = bias
        n.inputs['Brick Width'].default_value = length
        n.inputs['Row Height'].default_value = height
        n.inputs['Color1'].default_value = (0.0, 0.0, 0.0, 1.0)
        n.inputs['Color2'].default_value = (1.0, 1.0, 1.0, 1.0)
        n.inputs['Mortar'].default_value = (0.5, 0.5, 0.5, 1.0)
        # The brick node lays its pattern in the XY plane, so a wall standing in
        # Z needs the coordinates turned on their side or the courses run flat
        # across the ground instead of up the wall.
        sep = self.node('ShaderNodeSeparateXYZ')
        self.link(self.coords().outputs['Object'], sep.inputs['Vector'])
        comb = self.node('ShaderNodeCombineXYZ')
        self.link(sep.outputs['X'], comb.inputs['X'])
        self.link(sep.outputs['Z'], comb.inputs['Y'])
        self.link(sep.outputs['Y'], comb.inputs['Z'])
        self.link(comb.outputs['Vector'], n.inputs['Vector'])
        return n.outputs['Fac'], n.outputs['Color']

    # ------------------------------------------------------------ combining

    def mul(self, *sockets):
        """Intersection: moss is low AND shaded AND patchy."""
        out = sockets[0]
        for s in sockets[1:]:
            n = self.node('ShaderNodeMath', operation='MULTIPLY')
            self.link(out, n.inputs[0])
            self.link(s, n.inputs[1])
            out = n.outputs['Value']
        return out

    def add(self, *sockets):
        out = sockets[0]
        for s in sockets[1:]:
            n = self.node('ShaderNodeMath', operation='ADD')
            n.use_clamp = True
            self.link(out, n.inputs[0])
            self.link(s, n.inputs[1])
            out = n.outputs['Value']
        return out

    def fmax(self, *sockets):
        """Union of masks, and usually what you want instead of `mul`.

        Multiplying four independent 0..1 fields gives an average around 0.06,
        so a mask built by intersecting everything is almost always invisible —
        the classic "nothing happens" first pass. Reach for `mul` when a
        condition genuinely must hold everywhere at once (low AND shaded), and
        `fmax` when any of several places will do."""
        out = sockets[0]
        for s in sockets[1:]:
            n = self.node('ShaderNodeMath', operation='MAXIMUM')
            self.link(out, n.inputs[0])
            self.link(s, n.inputs[1])
            out = n.outputs['Value']
        return out

    def fmin(self, *sockets):
        out = sockets[0]
        for s in sockets[1:]:
            n = self.node('ShaderNodeMath', operation='MINIMUM')
            self.link(out, n.inputs[0])
            self.link(s, n.inputs[1])
            out = n.outputs['Value']
        return out

    def fmix(self, a, b, fac):
        """Blend two scalars. `layer()` only mixes colours."""
        n = self.node('ShaderNodeMix', data_type='FLOAT')
        self.link(fac, self._in(n, 'Factor'))
        for socket, value in ((self._in(n, 'A'), a), (self._in(n, 'B'), b)):
            if isinstance(value, (int, float)):
                socket.default_value = float(value)
            else:
                self.link(value, socket)
        return self._out(n)

    def remap(self, socket, lo=0.0, hi=1.0, out_lo=0.0, out_hi=1.0):
        """Rescale a mask, input range AND output range.

        `ramp` only sets the input range, so there was no way to say "this
        never goes above 0.4" without hand-building a multiply. Driving
        roughness or a subtle tint usually wants exactly that."""
        m = self.node('ShaderNodeMapRange')
        self.link(socket, m.inputs['Value'])
        m.inputs['From Min'].default_value = lo
        m.inputs['From Max'].default_value = hi
        m.inputs['To Min'].default_value = out_lo
        m.inputs['To Max'].default_value = out_hi
        m.clamp = True
        return m.outputs['Result']

    def ramp(self, socket, lo=0.0, hi=1.0, gamma=1.0):
        """Tighten or loosen a mask. `gamma` above 1 shrinks it toward the
        strongest areas, which is usually what turns a uniform green haze into
        distinct patches."""
        m = self.node('ShaderNodeMapRange')
        self.link(socket, m.inputs['Value'])
        m.inputs['From Min'].default_value = lo
        m.inputs['From Max'].default_value = hi
        m.clamp = True
        out = m.outputs['Result']
        if gamma != 1.0:
            p = self.node('ShaderNodeMath', operation='POWER')
            self.link(out, p.inputs[0])
            p.inputs[1].default_value = gamma
            out = p.outputs['Value']
        return out

    # ------------------------------------------------------------ colour

    def colour(self, hex_value):
        n = self.node('ShaderNodeRGB')
        n.outputs[0].default_value = srgb(hex_value)
        return n.outputs[0]

    def variegate(self, hex_a, hex_b, mask):
        """Two tones of the same material, mixed by a mask. Real stone, timber
        and paint are never one colour, and two tones in coherent patches is
        most of the difference between a surface and a fill."""
        n = self.node('ShaderNodeMix', data_type='RGBA')
        self.link(mask, self._in(n, 'Factor'))
        self._in(n, 'A').default_value = srgb(hex_a)
        self._in(n, 'B').default_value = srgb(hex_b)
        return self._out(n)

    def layer(self, under, over, mask):
        """Put `over` on top of `under` where `mask` says. The core move: base
        stone, then moss on it, then damp on that."""
        n = self.node('ShaderNodeMix', data_type='RGBA')
        self.link(mask, self._in(n, 'Factor'))
        if isinstance(under, int):
            self._in(n, 'A').default_value = srgb(under)
        else:
            self.link(under, self._in(n, 'A'))
        if isinstance(over, int):
            self._in(n, 'B').default_value = srgb(over)
        else:
            self.link(over, self._in(n, 'B'))
        return self._out(n)

    # ------------------------------------------------------------ output

    def base_colour(self, socket):
        if isinstance(socket, int):
            self.bsdf.inputs['Base Color'].default_value = srgb(socket)
        else:
            self.link(socket, self.bsdf.inputs['Base Color'])
        return self

    def roughness(self, value=0.75, mask=None, spread=0.2):
        """Roughness variation is underrated. A single value reads as plastic;
        varying it by the same masks that drive colour is what makes wet
        patches look wet and worn metal look worn."""
        # A socket straight in, for when several layers each change roughness
        # and you have already combined them - the value-plus-one-mask form
        # cannot express that, and roughness is exactly the channel where you
        # want four contributions at once.
        if hasattr(value, 'is_linked') or hasattr(value, 'node'):
            self.link(value, self.bsdf.inputs['Roughness'])
            return self
        if mask is None:
            self.bsdf.inputs['Roughness'].default_value = value
            return self
        m = self.node('ShaderNodeMapRange')
        self.link(mask, m.inputs['Value'])
        m.inputs['To Min'].default_value = max(0.0, value - spread)
        m.inputs['To Max'].default_value = min(1.0, value + spread)
        self.link(m.outputs['Result'], self.bsdf.inputs['Roughness'])
        return self

    def metallic(self, value=0.0, mask=None):
        if mask is None:
            self.bsdf.inputs['Metallic'].default_value = value
        else:
            self.link(mask, self.bsdf.inputs['Metallic'])
        return self

    def bump(self, height, strength=0.25, distance=0.1):
        """Surface relief from a mask. Bakes into the normal map."""
        n = self.node('ShaderNodeBump')
        n.inputs['Strength'].default_value = strength
        n.inputs['Distance'].default_value = distance
        self.link(height, n.inputs['Height'])
        self.link(n.outputs['Normal'], self.bsdf.inputs['Normal'])
        return self

    def build(self):
        return self.mat


# ---------------------------------------------------------------- unwrapping

def unwrap(obj, angle=None, margin=None):
    """Smart UV projection. Works headless.

    Returns the number of UV loops, which is worth printing: zero means the
    unwrap silently did nothing and every bake after it will be blank."""
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(
        angle_limit=math.radians(cfg.UNWRAP_ANGLE if angle is None else angle),
        island_margin=cfg.UNWRAP_MARGIN if margin is None else margin)
    bpy.ops.object.mode_set(mode='OBJECT')
    return len(obj.data.uv_layers[0].data) if obj.data.uv_layers else 0


def weight_uvs(obj, weights, default=1.0):
    """Give some materials more of the UV square than others, then repack.

    Smart projection packs by area, so a large flat surface nobody looks at can
    take most of the map while the detail that matters is starved - one castle
    measured its ward floor taking 56 percent. `weights` is
    {material_name: factor}; above 1 gets more texels, below 1 fewer.

    Call it after unwrap() and before bake_set()."""
    if not obj.data.uv_layers:
        raise SystemExit('%s has no UVs; call unwrap() first' % obj.name)
    names = [m.name if m else '' for m in obj.data.materials]
    uv = obj.data.uv_layers[0].data
    for p in obj.data.polygons:
        w = weights.get(names[p.material_index] if
                        p.material_index < len(names) else '', default)
        if w == 1.0:
            continue
        cu = sum(uv[i].uv[0] for i in p.loop_indices) / len(p.loop_indices)
        cv = sum(uv[i].uv[1] for i in p.loop_indices) / len(p.loop_indices)
        for i in p.loop_indices:
            uv[i].uv[0] = cu + (uv[i].uv[0] - cu) * w
            uv[i].uv[1] = cv + (uv[i].uv[1] - cv) * w
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(margin=cfg.UNWRAP_MARGIN)
    bpy.ops.object.mode_set(mode='OBJECT')
    print('UVWEIGHT %s  %s  -> %.1f px/m'
          % (obj.name, weights, texel_density(obj)))
    return obj


def texel_density(obj, size=None):
    """Pixels per metre, given the UV layout and a map size.

    Two models in one scene at wildly different densities is the commonest
    reason a set of assets fails to look like a set."""
    size = size or cfg.BAKE_SIZE
    if not obj.data.uv_layers:
        return 0.0
    uv = obj.data.uv_layers[0].data
    area_uv = 0.0
    area_3d = 0.0
    for p in obj.data.polygons:
        pts = [uv[i].uv for i in p.loop_indices]
        for i in range(1, len(pts) - 1):
            a, b, c = pts[0], pts[i], pts[i + 1]
            area_uv += abs((b[0] - a[0]) * (c[1] - a[1])
                           - (c[0] - a[0]) * (b[1] - a[1])) / 2.0
        area_3d += p.area
    if area_3d <= 0 or area_uv <= 0:
        return 0.0
    return math.sqrt(area_uv) * size / math.sqrt(area_3d)


# ---------------------------------------------------------------- baking

def _setup_cycles(samples):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    try:
        sc.cycles.device = 'CPU'
    except Exception:
        pass
    sc.render.bake.margin = cfg.BAKE_MARGIN
    try:
        sc.render.bake.use_selected_to_active = False
    except Exception:
        pass


def size_for(obj, target=None, cap=None, floor=128, quiet=False):
    """The map size that actually hits a target texel density for this object.

    Density scales linearly with map size, so measuring at 1024 and scaling is
    exact — and unlike `extent / target`, it accounts for how well the unwrap
    packed, which is usually the larger term.

    The object must be unwrapped first.

    When the answer is above the cap it says so, loudly, because that is the
    moment the fidelity budget has been exceeded and no amount of further work
    will recover it: one object gets one UV square, and the only way to buy
    more texels is to split the thing into modules."""
    target = target or cfg.TARGET_PX_PER_M
    cap = cap or cfg.MAX_BAKE_SIZE
    d = texel_density(obj, 1024)
    if d <= 0:
        print('WARNING %s has no usable UVs; falling back to %d'
              % (obj.name, cfg.BAKE_SIZE))
        return cfg.BAKE_SIZE
    need = 1024.0 * target / d
    size = floor
    while size < need and size < cap:
        size *= 2
    size = int(min(cap, max(floor, size)))
    got = d * size / 1024.0
    if not quiet:
        print('TEXELS %-20s %6.1f px/m at %d  (target %.0f)'
              % (obj.name, got, size, target))
        if got < target * 0.75:
            ext = max(max(v.co[i] for v in obj.data.vertices)
                      - min(v.co[i] for v in obj.data.vertices)
                      for i in range(3))
            print('       OVER BUDGET. %.1f px/m against a target of %.0f, and '
                  '%d is the cap.' % (got, target, cap))
            print('       This object is %.1f m across. At %.0f px/m one map '
                  'covers about %.1f m,' % (ext, target, cap / target))
            print('       so it needs roughly %d modules rather than more '
                  'effort on this one.'
                  % max(2, int(round((ext / (cap / target)) ** 2))))
    return size


def bake_set(obj, name, size=None, maps=None):
    """Bake the object's procedural material down to image files.

    Returns {map_name: path}. The object must be unwrapped first.

    Base colour is baked as DIFFUSE with only the colour pass, so it is the
    albedo and not the albedo times the lighting — bake COMBINED by accident
    and every model arrives with this scene's sun burned into it."""
    maps = maps or cfg.MAPS
    if not obj.data.uv_layers:
        raise SystemExit('%s has no UVs; call unwrap() first' % obj.name)
    if size == 'auto':
        size = size_for(obj)
    size = size or cfg.BAKE_SIZE
    os.makedirs(cfg.TEXTURES, exist_ok=True)

    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    out = {}
    # EVERY material on the object needs its own target image node, all
    # pointing at the same image.
    #
    # Blender bakes the whole object in one pass, but it writes only the faces
    # whose material carries an active image texture node. Wiring just the
    # first material leaves every other material's faces unbaked and black,
    # and Blender reports "No active and selected image texture node found" as
    # an *Info* message, so nothing raises and the export still counts the
    # image as present.
    trees = [m.node_tree for m in obj.data.materials if m and m.use_nodes]
    if not trees:
        raise SystemExit('%s has no node material' % obj.name)

    spec = {
        'basecolor': ('DIFFUSE', False, {'pass_filter': {'COLOR'}},
                      cfg.BAKE_SAMPLES),
        'roughness': ('ROUGHNESS', True, {}, cfg.BAKE_SAMPLES),
        'normal':    ('NORMAL', True, {}, cfg.BAKE_SAMPLES),
        'ao':        ('AO', True, {}, cfg.AO_SAMPLES),
        'emit':      ('EMIT', False, {}, cfg.BAKE_SAMPLES),
    }

    targets = []
    for key in maps:
        kind, non_colour, kw, samples = spec[key]
        _setup_cycles(samples)
        # Normals and roughness carry far less information than base colour,
        # so they are baked smaller: no visible loss, a quarter of the memory.
        # getattr, because a project carrying a slightly older texconfig.py
        # would otherwise die here with an AttributeError - AFTER the
        # unwrap has run and the time has been spent.
        msize = max(64, int(size * getattr(cfg, 'MAP_SCALE', {}).get(key, 1.0)))
        img = bpy.data.images.new('%s_%s' % (name, key), msize, msize,
                                  alpha=False, float_buffer=False)
        if non_colour:
            img.colorspace_settings.name = 'Non-Color'
        for nt in trees:
            node = nt.nodes.new('ShaderNodeTexImage')
            node.image = img
            nt.nodes.active = node
            node.select = True
            targets.append((nt, node))
        bpy.ops.object.bake(type=kind, **kw)
        path = os.path.join(cfg.TEXTURES, '%s_%s.png' % (name, key))
        img.filepath_raw = path
        img.file_format = 'PNG'
        img.save()
        out[key] = path
        print('BAKED %-10s %4d  %s  (%d material%s)'
              % (key, msize, path, len(trees),
                 '' if len(trees) == 1 else 's'))
    for nt, n in targets:
        nt.nodes.remove(n)
    return out


def bake_socket(graph, socket, name, size=None, non_colour=True):
    """Bake any socket in the graph to an image, via an Emission shader.

    Blender has no bake type for metallic, or for a mask, or for anything else
    that is not one of its named passes. Routing the socket through Emission
    and baking EMIT captures the value exactly, whatever it is.

    This is how you get a metallic map. Without one, `apply_baked` leaves the
    Principled metallic at a constant and every chrome surface exports as a
    dielectric — which renders as grey card and is the single most common
    reason a metal does not look like metal."""
    size = size or cfg.BAKE_SIZE
    nt = graph.nt
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    kept = out.inputs['Surface'].links[0].from_socket if \
        out.inputs['Surface'].links else None
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = 1.0
    nt.links.new(socket, em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])

    _setup_cycles(cfg.BAKE_SAMPLES)
    img = bpy.data.images.new(name, size, size, alpha=False)
    if non_colour:
        img.colorspace_settings.name = 'Non-Color'
    node = nt.nodes.new('ShaderNodeTexImage')
    node.image = img
    nt.nodes.active = node
    node.select = True
    bpy.ops.object.bake(type='EMIT')

    os.makedirs(cfg.TEXTURES, exist_ok=True)
    path = os.path.join(cfg.TEXTURES, name + '.png')
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()

    nt.nodes.remove(node)
    nt.nodes.remove(em)
    if kept:
        nt.links.new(kept, out.inputs['Surface'])
    print('BAKED %-10s %s  (via emission)' % ('socket', path))
    return path


def apply_baked(obj, paths, name='baked', metallic=0.0,
                emission=None, emission_strength=0.0):
    """Replace the procedural material with the baked maps, wired the way the
    glTF exporter understands.

    This step is not optional. glTF carries Image Texture -> Principled and
    nothing else, so a procedural material exports as a flat colour."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        if n.type not in ('BSDF_PRINCIPLED', 'OUTPUT_MATERIAL'):
            nt.nodes.remove(n)
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    uvmap = nt.nodes.new('ShaderNodeUVMap')
    uvmap.uv_map = obj.data.uv_layers[0].name

    def image(path, non_colour):
        img = bpy.data.images.load(path, check_existing=True)
        if non_colour:
            img.colorspace_settings.name = 'Non-Color'
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = img
        nt.links.new(uvmap.outputs['UV'], n.inputs['Vector'])
        return n

    if 'basecolor' in paths:
        nt.links.new(image(paths['basecolor'], False).outputs['Color'],
                     bsdf.inputs['Base Color'])
    if 'roughness' in paths:
        nt.links.new(image(paths['roughness'], True).outputs['Color'],
                     bsdf.inputs['Roughness'])
    if 'normal' in paths:
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(image(paths['normal'], True).outputs['Color'],
                     nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    # Metal is not optional to get right. glTF reads baseColour completely
    # differently for a metal, and leaving this at zero is why chrome exports
    # as grey card. Pass a map from bake_socket(), or a constant when the whole
    # object is or is not metal.
    if 'metallic' in paths:
        nt.links.new(image(paths['metallic'], True).outputs['Color'],
                     bsdf.inputs['Metallic'])
    else:
        bsdf.inputs['Metallic'].default_value = metallic
    # Emission, because a baked material had no way to glow.
    #
    # Anything that gives off light — a lit window, a forge, a brazier, a lamp
    # — had to be excluded from the texture pass entirely and kept as a flat
    # material, which meant a glowing thing could not also be a textured thing.
    # glTF carries this as the emissive texture and KHR_materials_emissive-
    # strength.
    if 'emission' in paths:
        nt.links.new(image(paths['emission'], False).outputs['Color'],
                     bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    elif emission_strength and emission:
        bsdf.inputs['Emission Color'].default_value = srgb(emission)
        bsdf.inputs['Emission Strength'].default_value = emission_strength

    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.material_index = 0
    return mat


# ---------------------------------------------------------------- no-UV route

def vertex_colour(obj, fn, name='Col'):
    """Per-vertex colour from a function of position and normal.

    glTF carries this as COLOR_0, so it needs no UVs, no bake and no image
    files. It cannot hold detail finer than the mesh, but unlike a per-face
    material assignment it interpolates — which is the difference between a
    damp band that fades out and a row of green rectangles.

    `fn(co, normal) -> (r, g, b)` in 0..1 linear."""
    me = obj.data
    layer = me.color_attributes.get(name)
    if layer is None:
        layer = me.color_attributes.new(name=name, type='FLOAT_COLOR',
                                        domain='POINT')
    for i, v in enumerate(me.vertices):
        co = obj.matrix_world @ v.co
        r, g, b = fn(co, v.normal)
        layer.data[i].color = (r, g, b, 1.0)
    return layer


def export(out_name, objs=None):
    """Export with textures embedded in the glb.

    `objs` limits the export to those objects; None exports the scene. The
    previous signature took a list of names it then ignored and exported
    everything regardless, which is worth knowing if you have old call sites."""
    if not isinstance(out_name, str):
        raise TypeError(
            'export() takes (out_name, objs=None). It previously took a list '
            'of object names first and ignored them; you have passed a %s as '
            'the name. Swap the arguments.' % type(out_name).__name__)
    os.makedirs(cfg.MODELS, exist_ok=True)
    path = os.path.join(cfg.MODELS, out_name + '.glb')
    bpy.ops.object.select_all(action='DESELECT')
    if objs is None:
        bpy.ops.object.select_all(action='SELECT')
    else:
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_apply=True, export_yup=True, export_cameras=False,
        export_lights=False, export_image_format='AUTO',
    )
    size = os.path.getsize(path)
    with open(path, 'rb') as f:
        images = f.read().count(b'\x89PNG')
    print('EXPORT %s  %.1f KB  %d embedded image(s)'
          % (path, size / 1024.0, images))
    if not images:
        print('WARNING no images in the glb - did apply_baked() run?')
    return path
