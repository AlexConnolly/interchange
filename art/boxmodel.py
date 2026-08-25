# Box modelling: one mesh, grown.
#
# The first pass at these models stacked separate primitives and merged them,
# which is exactly what the three.js code did and produces exactly the same
# result — a pile of solids that intersect, with no continuous surface and no
# flowing outline. Every junction is a hard collision between two shapes
# because that is literally what it is. Moving that into Blender changed the
# tool and not the method, so it changed nothing you could see.
#
# The standard game-art workflow grows one mesh instead. You start from a
# single cube and pull the form out of it: extrude a face to make a limb,
# inset before extruding so the limb has a shoulder rather than a stump, loop
# cut where the form needs to bend, bevel the edges that catch the light. The
# surface stays connected the whole way, so the silhouette is one line rather
# than a stack of collisions, and the triangles go into shape instead of into
# geometry buried inside other geometry.
#
# Sources for the workflow, if anyone wants the long version:
#   Blender Studio, "Step by Step - Low Poly Character Creation"
#   LL3M (threedle/ll3m), on using BMesh and modifiers rather than primitives
import bpy
import bmesh
import math
from mathutils import Vector, Matrix

DIRS = {
    '+x': (1, 0, 0), '-x': (-1, 0, 0),
    '+y': (0, 1, 0), '-y': (0, -1, 0),
    '+z': (0, 0, 1), '-z': (0, 0, -1),
    # Aliases, because a build script reads better saying which way is up than
    # saying which axis it is.
    'up': (0, 0, 1), 'down': (0, 0, -1),
    'front': (0, -1, 0), 'back': (0, 1, 0),
    'left': (-1, 0, 0), 'right': (1, 0, 0),
}


class Form:
    """One mesh, grown.

    Faces are selected by where they point and where they are, so the scripts
    read as "take the face on the outside of the chest and pull an arm out of
    it" rather than as a list of hard-coded coordinates."""

    def __init__(self, size=(1, 1, 1), at=(0, 0, 0)):
        self.bm = bmesh.new()
        bmesh.ops.create_cube(self.bm, size=1.0)
        # `size` is the full extent, matching lib.box(). It was the half
        # extent for one build and every soldier came out at double scale,
        # floating a metre off the ground with its legs ending in mid-air.
        for v in self.bm.verts:
            v.co.x = v.co.x * size[0] + at[0]
            v.co.y = v.co.y * size[1] + at[1]
            v.co.z = v.co.z * size[2] + at[2]
        self._smooth = False

    # ------------------------------------------------------------ selection

    def faces(self, normal=None, above=None, below=None,
              xmin=None, xmax=None, ymin=None, ymax=None, tol=0.5):
        out = []
        # Loudly, and this is not defensive programming for its own sake.
        #
        # `DIRS.get` returning None for a name that is not in the table meant an
        # unrecognised direction silently disabled the filter and matched every
        # face in the mesh. The first house built with this library asked for
        # the face pointing 'up', got all six, extruded them, and came out as a
        # flat sheet two hundredths of a tile thick — which took a render to
        # notice and would have taken much longer to explain.
        #
        # A typo in a face selector has to be an error, because the shape of the
        # bug it causes otherwise looks like a modelling mistake rather than a
        # spelling one.
        if normal is not None and normal not in DIRS:
            raise KeyError('unknown face direction %r; expected one of %s'
                           % (normal, ', '.join(sorted(DIRS))))
        want = DIRS.get(normal) if normal else None
        for f in self.bm.faces:
            if want:
                n = f.normal
                if n.x * want[0] + n.y * want[1] + n.z * want[2] < tol:
                    continue
            c = f.calc_center_median()
            if above is not None and c.z < above: continue
            if below is not None and c.z > below: continue
            if xmin is not None and c.x < xmin: continue
            if xmax is not None and c.x > xmax: continue
            if ymin is not None and c.y < ymin: continue
            if ymax is not None and c.y > ymax: continue
            out.append(f)
        return out

    def face(self, **kw):
        f = self.faces(**kw)
        return f[:1]

    # ------------------------------------------------------------ growing

    def extrude(self, faces, move=(0, 0, 0), scale=None):
        """Pull faces out. The returned faces are what you extrude from next,
        so a limb is a chain of these and stays one continuous surface."""
        if not faces:
            return []
        res = bmesh.ops.extrude_face_region(self.bm, geom=list(faces))
        verts = [g for g in res['geom'] if isinstance(g, bmesh.types.BMVert)]
        new = [g for g in res['geom'] if isinstance(g, bmesh.types.BMFace)]
        bmesh.ops.translate(self.bm, verts=verts, vec=Vector(move))
        if scale:
            mid = Vector((0, 0, 0))
            for v in verts:
                mid += v.co
            mid /= max(1, len(verts))
            bmesh.ops.scale(self.bm, verts=verts, vec=Vector(scale),
                            space=Matrix.Translation(-mid))
        # the faces we grew from are interior now; leaving them puts a wall
        # across the middle of every limb
        bmesh.ops.delete(self.bm, geom=list(faces), context='FACES')
        return new

    def inset(self, faces, thickness=0.05, depth=0.0):
        """Shrink a face inside itself before extruding. This is the step that
        turns a stump into a shoulder — the extrusion starts from a smaller
        face, so there is a shelf where the limb meets the body.

        Returns the shrunk *inner* faces, which is what you extrude next.
        bmesh's own `inset_region` hands back the opposite — the ring of new
        rim faces — and every `extrude(inset(f))` in the build was therefore
        pulling on the frame rather than the panel. Visible as pauldrons that
        grew as vertical fins beside the head instead of caps over the
        shoulder. The originals are retained and shrunk in place, so they are
        still valid to return."""
        if not faces:
            return []
        keep = list(faces)
        bmesh.ops.inset_region(
            self.bm, faces=keep, thickness=thickness, depth=depth,
            use_even_offset=True)
        return [f for f in keep if f.is_valid]

    def grow(self, faces, steps):
        """A chain of extrusions: [(move, scale), ...]. Most limbs are three of
        these and nothing else."""
        cur = faces
        for move, scale in steps:
            cur = self.extrude(cur, move, scale)
        return cur

    # ------------------------------------------------------------ shaping

    def cut(self, axis=2, cuts=1):
        i = {'x': 0, 'y': 1, 'z': 2}.get(axis, axis)
        edges = [e for e in self.bm.edges
                 if abs((e.verts[1].co - e.verts[0].co)[i]) > 1e-5]
        if edges:
            bmesh.ops.subdivide_edges(self.bm, edges=edges, cuts=cuts, use_grid_fill=True)
        return self

    def bevel(self, amount=0.02, segments=1, min_angle=None):
        """Chamfer the edges. `min_angle`, in degrees, skips any edge whose two
        faces already meet nearly flush.

        A limb built as a chain of tapered extrusions has a ring of those at
        every joint — four edges per segment where the surface turns by five
        degrees. Chamfering them is invisible and costs as much as chamfering
        the corner rails that actually carry the silhouette, which on a
        quadruped is a third of the model's triangles spent on nothing. The
        default is unfiltered so the existing builds are untouched."""
        geom = list(self.bm.verts) + list(self.bm.edges) + list(self.bm.faces)
        if min_angle is not None:
            lim = math.radians(min_angle)
            edges = [e for e in self.bm.edges
                     if len(e.link_faces) != 2 or e.calc_face_angle(0.0) >= lim]
            geom = list({v for e in edges for v in e.verts}) + edges
        bmesh.ops.bevel(
            self.bm, geom=geom,
            offset=amount, segments=segments, affect='EDGES', profile=0.5,
            clamp_overlap=True)
        return self

    def taper(self, lo, hi, at_lo=1.0, at_hi=1.0, axes='xy'):
        """Squeeze in X and Y as a function of height. The cheapest way to stop
        a limb being a parallel-sided tube, and the difference between a torso
        and a box."""
        for v in self.bm.verts:
            if v.co.z < lo or v.co.z > hi:
                continue
            t = (v.co.z - lo) / max(1e-6, hi - lo)
            k = at_lo + (at_hi - at_lo) * t
            if 'x' in axes: v.co.x *= k
            if 'y' in axes: v.co.y *= k
        return self

    def bend(self, lo, hi, amount, axis='y'):
        """Lean the upper part of the mesh over. A figure that is exactly
        vertical from ankle to crown reads as furniture."""
        for v in self.bm.verts:
            if v.co.z < lo:
                continue
            t = min(1.0, (v.co.z - lo) / max(1e-6, hi - lo))
            if axis == 'y':
                v.co.y += amount * t * t
            else:
                v.co.x += amount * t * t
        return self

    def move(self, faces, vec):
        verts = list({v for f in faces for v in f.verts})
        if verts:
            bmesh.ops.translate(self.bm, verts=verts, vec=Vector(vec))
        return self

    def scale_faces(self, faces, vec):
        verts = list({v for f in faces for v in f.verts})
        if not verts:
            return self
        mid = Vector((0, 0, 0))
        for v in verts:
            mid += v.co
        mid /= len(verts)
        bmesh.ops.scale(self.bm, verts=verts, vec=Vector(vec),
                        space=Matrix.Translation(-mid))
        return self

    def mirror(self, axis='x'):
        """Model one side and get the other free, exactly symmetric — which is
        most of what makes armour read as issued rather than improvised."""
        i = {'x': 0, 'y': 1, 'z': 2}[axis]
        dead = [f for f in self.bm.faces if f.calc_center_median()[i] < -1e-4]
        if dead:
            bmesh.ops.delete(self.bm, geom=dead, context='FACES')
        res = bmesh.ops.duplicate(
            self.bm, geom=list(self.bm.verts) + list(self.bm.edges) + list(self.bm.faces))
        dv = [g for g in res['geom'] if isinstance(g, bmesh.types.BMVert)]
        df = [g for g in res['geom'] if isinstance(g, bmesh.types.BMFace)]
        vec = [1, 1, 1]
        vec[i] = -1
        bmesh.ops.scale(self.bm, verts=dv, vec=Vector(vec))
        bmesh.ops.reverse_faces(self.bm, faces=df)
        bmesh.ops.remove_doubles(self.bm, verts=list(self.bm.verts), dist=1e-4)
        return self

    def smooth(self, on=True):
        self._smooth = on
        return self

    def build(self, name, mat=None, parent=None):
        bmesh.ops.recalc_face_normals(self.bm, faces=list(self.bm.faces))
        mesh = bpy.data.meshes.new(name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        for p in mesh.polygons:
            p.use_smooth = self._smooth
        if mat:
            obj.data.materials.append(mat)
        if parent:
            # The depsgraph has to be evaluated first. Setting an empty's
            # location does not update its matrix_world until Blender
            # re-evaluates, so taking the inverse straight away yields the
            # identity and every child ends up displaced by its parent's
            # position — a soldier a metre off the ground with no legs.
            bpy.context.view_layer.update()
            obj.parent = parent
            obj.matrix_parent_inverse = parent.matrix_world.inverted()
        return obj
