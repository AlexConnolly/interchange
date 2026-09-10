# The district's built palette. One definition, because a build script with
# its own idea of what brick looks like is a bug that no diff catches — the
# numbers are technically colours, so nothing type-checks to flag a wrong one.
# `build_town.py` shipped for a week with a BRICK half a shade darker and a
# lot greyer than this one, and every terrace in the game read as concrete
# standing next to a village of these same materials.
#
#   import palette as pal
#
# Straight off palette.ts BUILT, which is straight off the target frame.
BRICK = (0.639, 0.384, 0.290, 1)
RENDER = (0.812, 0.769, 0.682, 1)
# Oak, banded. A cask is the one container in the district that is neither steel
# nor a box, and the colour is doing that work on its own.
CASK = (0.475, 0.333, 0.208, 1)
SLATE = (0.290, 0.302, 0.333, 1)
# Terracotta pantile, and adding it was not decoration.
#
# The first village went in with slate on everything and read as a cluster of
# grey lumps. From the game's camera - 38 degrees of elevation - a pitched roof
# is most of the pixels of a house, so roof colour is very nearly the only
# colour a building has. A street of slate is a street of nothing.
PANTILE = (0.710, 0.416, 0.290, 1)
PANTILE_PALE = (0.769, 0.541, 0.400, 1)
THATCH = (0.706, 0.596, 0.373, 1)
STEEL = (0.553, 0.573, 0.596, 1)
CONCRETE = (0.702, 0.675, 0.635, 1)
GLASS = (0.373, 0.478, 0.525, 1)
SILO = (0.847, 0.855, 0.871, 1)
TIMBER = (0.478, 0.360, 0.243, 1)
SAWN = (0.741, 0.612, 0.435, 1)
STONE = (0.667, 0.643, 0.596, 1)
GRAVEL = (0.596, 0.573, 0.529, 1)
# The parish's own three, and they are the only greens anything built out of
# this palette uses.
#
# Everything else is a works or a street, and a works is brick, steel and
# concrete. A green has to read as *not that* from four hundred pixels away,
# which is a job colour does before shape gets a chance.
TURF = (0.400, 0.549, 0.286, 1)
TURF_WORN = (0.510, 0.588, 0.361, 1)
LEAF = (0.243, 0.420, 0.204, 1)
PATH = (0.729, 0.690, 0.596, 1)
RAIL = (0.310, 0.353, 0.322, 1)
DARK = (0.180, 0.180, 0.196, 1)
LEAD = (0.400, 0.412, 0.435, 1)

# Warm, and warmer than you would guess. A window at night is tungsten, which is
# far more orange than daylight, and a lit window painted "pale yellow" reads as
# a hole in the wall rather than as a room with somebody in it.
WINDOW = (1.0, 0.72, 0.34, 1.0)
WINDOW_DIM = (0.26, 0.15, 0.05, 1.0)
