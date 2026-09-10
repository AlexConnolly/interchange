# Everything about this pipeline that is true of your project and not of mine.
#
# Keeping the project-specific numbers here means lib.py and shots.py stay
# identical across projects, so a fix to either is a fix everywhere.
#
# Edit this file. Do not edit lib.py or shots.py.
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))


# ---------------------------------------------------------------- where things go

# Where exported .glb files land. Getting this wrong fails silently: point it
# somewhere the app does not load from and every render shows the previous
# build. ART_OUT overrides it, for CI and for trying a build without touching
# the app's assets.
OUT = os.environ.get('ART_OUT') or os.path.join(
    ROOT, 'packages', 'client', 'public', 'models')

# Where contact sheets land, one directory per model.
SHOTS = os.environ.get('ART_SHOTS') or os.path.join(HERE, 'shots')


# ---------------------------------------------------------------- scale

# What one Blender unit means. Model in real metres and leave this at 1.0
# unless your engine says otherwise — a game whose character is 3.0 units tall
# would set UNITS_PER_M = 3.0 / 1.75.
# A tile is 32 m of district and one Blender unit wide, so a unit is 32 m and a
# metre is a thirty-second of one. Everything in `art/` is authored in tiles for
# exactly this reason — a barn is 0.6 long, a house 0.45 — and the figure on the
# contact sheet has to be a person against that, not against a metre.
UNITS_PER_M = 1.0 / 32.0

# The height of the contact sheet's scale figure, in world units. Set it to
# whatever your app's character actually is; a human is 1.75 m.
FIGURE_H = 1.75 * UNITS_PER_M

# The grid drawn on the ground. STEP is the fine check; MAJOR is the heavier
# line, and should be your tile or block size if you have one.
# The fine line is a metre and the heavy one is a tile, which is the unit every
# footprint in the content is quoted in.
GRID_STEP = 1.0 * UNITS_PER_M
GRID_MAJOR = 1.0


# ---------------------------------------------------------------- the hero shot

# The angle your app looks from. With a fixed camera, put its real numbers here
# and the hero shot stops approximating what the player sees and becomes it.
#
# The defaults are true isometric — atan(1/sqrt(2)) elevation, 45 azimuth —
# which is the classic 2:1 game projection and a fair stand-in for a free
# orbit camera.
# The district's own camera, straight off `CAMERA_ELEVATION` and
# `CAMERA_AZIMUTH` in `packages/render/src/camera.ts`. Not an isometric
# stand-in: the game's camera is fixed, so the hero shot can *be* the player's
# view rather than resemble it — which is the whole difference between judging a
# model and judging a photograph of one.
HERO_ELEVATION_DEG = 38.0
HERO_AZIMUTH_DEG = -32.0

# Orthographic if your camera is. A perspective app should set this False and
# set HERO_LENS.
HERO_ORTHOGRAPHIC = True
HERO_LENS = 45.0

# How far the hero camera stands off, in world units. None derives it from the
# model's size. Under an orthographic camera distance only has to clear the
# geometry, so a large floor is harmless; under a PERSPECTIVE one it sets the
# framing, and a floor of 60 renders a 200 mm object about four pixels tall.
# Set it explicitly for anything much smaller or larger than a metre.
HERO_DISTANCE = None

# Azimuth offsets for the four hero renders, standing in for the object turning
# under a camera that does not. Catches a model composed for one corner. Use
# (0.0,) if the object never rotates.
HERO_HEADINGS = (0.0, 90.0, 180.0, 270.0)


# ---------------------------------------------------------------- small renders

# Pixels per metre at the sizes the object is actually seen at. Each is
# rendered for real at that size and then blown up nearest-neighbour, so the
# upscale adds no information.
#
# Derive these from your app: a 1080 px viewport spanning 64 tiles of 4 m is
# 1080 / (64 * 4) = 4.2 px per metre.
#
# (label, pixels-per-metre, upscale factor). Set to () to skip.
# Derived from the game rather than guessed. The wheel allows 14 to 70 tiles
# across a viewport that is about 1600 wide, and a tile is 32 m — so the close
# end is 1600 / (14 * 32) = 3.6 px per metre and the wide end 1600 / (70 * 32)
# = 0.7. A building is 2 tiles, so it is 230 px across when you are leaning in
# and 46 when you are looking at the district.
#
# Which is the number that matters here: at 46 px a chimney is one pixel. Every
# decision about detail on these models is a decision about what survives the
# second row.
SMALL_RENDERS = (
    ('close-3.6', 3.6, 6),
    ('district-0.7', 0.7, 14),
)


# ---------------------------------------------------------------- look

RES = 900                 # the big shots, square

# Flat shading suits a low-poly look seen from a distance: at forty pixels a
# smooth normal is mush, and a toon ramp wants facets to break against. Set
# True for anything the player stands next to.
# Flat, and not a preference. `docs/art.md` calls for low-poly flat-shaded work
# under a low orthographic camera, and the district is seen from four hundred
# feet — a smooth normal at forty pixels is mush.
SMOOTH_DEFAULT = False

# Sides on a cylinder when the call site does not say. 8 for a far-off toon
# look, 16 or 24 for anything seen close up.
CYL_SEGMENTS = 8

# Contact sheet colours only. Nothing here reaches an exported model.
SKY = 0x9DB0C0
SUN = 0xFFF4E0
GROUND = 0x8CA36B
GROUND_ALT = 0x9DB27C     # the dark squares of the checker
GRID_LINE = 0xBFAF8E      # the major lines
FIGURE = 0x6F8CA6

SUN_ENERGY = 3.1

# Where the key light comes from, in Blender's Z-up coordinates. Match your
# app's directional light. A Y-up engine's light at (60, 100, 40) is
# (60, -40, 100) here.
SUN_FROM = (60.0, -40.0, 100.0)


# ---------------------------------------------------------------- export

# glTF is Y-up and Blender is Z-up, so the exporter rotates on the way out:
# Blender (x, y, z) becomes glTF (x, z, -y). Model with Z up. Leave True unless
# you are exporting for something that wants Z-up.
EXPORT_YUP = True

# Warn when a model exceeds this many triangles. None disables the check.
TRI_BUDGET = None
