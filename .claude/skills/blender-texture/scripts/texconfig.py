# Everything about the texturing pipeline that is true of your project.
#
# Edit this file. Do not edit texlib.py or texshots.py.
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))


# ---------------------------------------------------------------- where things go

# The .glb this pipeline reads and writes. Usually the same directory the
# modelling toolkit exports to.
MODELS = os.environ.get('ART_OUT') or os.path.join(ROOT, 'public', 'models')

# Baked maps land here, one directory per material.
TEXTURES = os.environ.get('TEX_OUT') or os.path.join(ROOT, 'public', 'textures')

# Material contact sheets.
SHOTS = os.environ.get('TEX_SHOTS') or os.path.join(HERE, 'shots')


# ---------------------------------------------------------------- bake

# Map resolution. 512 is generous for a prop seen at 60 px; 2048 is for
# something the camera gets close to. Bake time scales with the square, but on
# a few thousand triangles even 2048 is seconds rather than minutes.
BAKE_SIZE = 1024

# Pass size='auto' to bake_set() to size the map from the object instead, using
# TARGET_PX_PER_M below. MAX_BAKE_SIZE is the ceiling: when 'auto' hits it, the
# object is over its fidelity budget and wants splitting into modules, which
# bake_set will say out loud.
MAX_BAKE_SIZE = 4096

# Not every map needs the resolution base colour does. Normals and roughness
# carry far less information and halving them costs nothing visible while
# quartering the memory. Relative to the chosen size.
MAP_SCALE = {
    'basecolor': 1.0,
    'roughness': 0.5,
    'normal':    0.5,
    'metallic':  0.5,
    'ao':        0.5,
}

# Cycles samples for the bake. Colour and roughness are flat lookups and need
# almost nothing; ambient occlusion is the one that gets noisy, so AO_SAMPLES
# is separate.
BAKE_SAMPLES = 8
AO_SAMPLES = 64

# Which maps to produce. 'basecolor' and 'roughness' are the minimum worth
# having. 'normal' only earns its place if the material has real bump detail.
# 'ao' is baked into base colour rather than exported separately by default,
# because glTF's occlusion map only affects indirect light and most real-time
# viewers barely show it.
MAPS = ('basecolor', 'roughness', 'normal')

# Padding around UV islands, in pixels, so bilinear filtering does not bleed
# the background across a seam at low mip levels.
BAKE_MARGIN = 8

# Angle limit for smart UV projection, in degrees, and the gap left between
# islands as a fraction of the map.
UNWRAP_ANGLE = 66.0

# Island margin, as a fraction of the whole UV square, applied PER ISLAND. It
# is therefore far smaller than it looks: a model with ten thousand islands at
# 0.02 spends the entire map on gaps and the texel density collapses. Measured
# on a 27k-triangle castle: 0.02 gave 0.84 px/m at 4096 and rendered solid
# black; 0.0005 gave 14.7 px/m. Raise it only for models with few, large
# islands, and check texel_density() after any change.
UNWRAP_MARGIN = 0.0005


# ---------------------------------------------------------------- look

# The texel density to aim for, and what bake_set(size='auto') sizes maps to
# hit. Wildly different densities between models in one scene is the commonest
# reason a set of assets fails to look like a set.
#
#    64 px/m   a distant prop, forty pixels on screen
#   128 px/m   a normal game camera
#   256 px/m   the player walks up to it
#   512 px/m   in your face, a hero render
#
# One object gets one UV square, so this and MAX_BAKE_SIZE together decide the
# largest object that can ever reach this fidelity: 4096 / 256 is 16 m. Beyond
# that the answer is modules, not effort.
TARGET_PX_PER_M = 128.0

# Contact sheet.
RES = 900

# Cycles samples for the contact sheet. Nothing sets this by default, and
# Cycles' own default is 4096 - so switching the sheet to Cycles (needed,
# because EEVEE approximates the AO node and the mask views then lie) made
# every render forty times slower than it had to be.
SHOT_SAMPLES = 96

# Studio environment: a gradient world plus a dark floor and black flags, for
# anything with metal or glass. Off by default because it changes the lighting,
# and a changed rig invalidates any before/after comparison unless the before
# is re-rendered under it too.
STUDIO_ENV = False
SWATCH_SUBDIV = 5          # the flat-lay swatch is a subdivided plane

# The raking-light shot: a low sun that skims the surface. This is the shot
# that separates real micro-surface from a colour that merely suggests it, and
# a material that only reads under flat front light is not finished.
RAKE_ELEVATION_DEG = 8.0
# 60 rather than 200: at 200 the sun sits behind sheet()'s own close camera
# and the raking shot becomes a shadow study.
RAKE_AZIMUTH_DEG = 60.0

# The studio world, for anything with metal or glass. A polished surface shows
# you its surroundings and nothing else, so against a flat sky colour chrome
# renders as grey card and no material work can fix it. A gradient, a darker
# ground and one bright disc give metal a horizon, a dark half and a travelling
# highlight - which is most of what reads as polished.
WORLD_STRENGTH = 1.0
WORLD_ZENITH  = 0x5C6B7A
WORLD_HORIZON = 0xBFC7CE
WORLD_GROUND  = 0x2A2A2C

SKY = 0x9DB0C0
SUN = 0xFFF4E0
GROUND = 0x8CA36B
SUN_ENERGY = 3.1
SUN_FROM = (60.0, -40.0, 100.0)


# ---------------------------------------------------------------- polished surfaces

# Turns on studio_world() + studio_cards() in sheet(): gradient sky and
# highlight, dark floor, two black flags out of shot. OFF by default, because
# a weathered stone wall does not need it and it changes every shot.
#
# Turn it on for anything with a mirror in it - chrome, glass, car paint,
# polished metal. Under the flat `world()` colour a mirror has one uniform
# thing to reflect and renders as a grey card no matter how right the material
# is. Measured on a sports car: the gradient sky ALONE changed almost nothing,
# because a flat-faced bumper takes one sample of it per facet. The black
# flags are what made chrome read as chrome.
#
# It changes the lighting, so re-render any baseline you are comparing against.
STUDIO_ENV = False
