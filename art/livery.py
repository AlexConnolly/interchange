# -*- coding: utf-8 -*-
# The two material slots this game reserves, and nothing else.
#
# These used to sit in `lib.py`, which is now the `blender-model` skill's shared
# toolkit — identical across projects, so that a fix to it is a fix everywhere.
# The moment that became true, anything Interchange-specific living in it was a
# local edit waiting to be overwritten by the next upgrade. `artconfig.py` holds
# the project's *numbers* on the same argument; this holds its two reserved
# materials, which are code.
#
# Both are contracts with the renderer rather than decisions about how a model
# looks. See `glb.ts` for the other end of each.
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lib  # noqa: E402


# The material slot every model reserves for company colour.
#
# art-pipeline.md 4.2: Tribe Wars bakes faction colour into the material, which
# is right when there are two fixed sides and wrong here, where up to eight
# companies in one region run the same lorry. Faces painted with this material
# are tinted per company by the renderer at draw time; everything else keeps
# the colour it was authored with.
#
# It is a name rather than an index because a glTF material index depends on
# what order the exporter happened to write the slots in, and the renderer has
# to be able to find it without knowing that.
LIVERY = 'livery'

# And the slot for anything that emits.
#
# Headlamps, tail lights, cat's eyes, lit windows. The renderer pulls faces
# painted with this into a *separate mesh drawn with an unlit material*, because
# a light has to glow when everything round it is dark — and any lighting term
# at all makes a headlamp that goes out at dusk, which is precisely backwards.
#
# A name rather than an index for the same reason as the livery slot: a glTF
# material index depends on the order the exporter happened to write the slots
# in, which is not a contract.
LAMP = 'lamp'


def livery_material():
    """The reserved slot. Authored mid-grey so a model that is never tinted —
    in a review render, say — still reads as bodywork rather than as a hole."""
    return lib.material(LIVERY, (0.55, 0.55, 0.57, 1.0), rough=0.55)


def lamp_material(colour=(1.0, 0.95, 0.84, 1.0)):
    """The reserved emissive slot. Authored bright so a review render shows a
    lamp as a lamp rather than as a pale square."""
    return lib.material(LAMP, colour, emissive=3.0, rough=0.25)
