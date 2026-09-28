"""Writes a parity fixture and the Python backend's report for it.

Usage: python make_fixture.py OUT_DIR
The web test suite (tests/parity.test.ts) reads both files when PARITY_DIR is set.
"""

import json
import math
import os
import sys

import gdstk

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, ROOT)

from gds_inspector.inspector import inspect_gds  # noqa: E402


def build(path: str) -> None:
    lib = gdstk.Library("PARITY", unit=1e-6, precision=1e-9)

    unit = lib.new_cell("UNIT")
    unit.add(gdstk.rectangle((0, 0), (2, 1), layer=1))
    unit.add(gdstk.Polygon([(0, 2), (3, 2), (3, 3), (1, 3), (1, 5), (0, 5)], layer=2, datatype=3))
    unit.add(gdstk.rectangle((4, 0), (4.05, 2), layer=1))
    unit.add(gdstk.FlexPath([(0, 6), (5, 6), (5, 9)], 0.5, ends="flush", layer=3, simple_path=True))

    array = lib.new_cell("ARRAY")
    array.add(gdstk.Reference(unit, (0, 0), columns=4, rows=3, spacing=(10, 12)))

    top = lib.new_cell("TOP")
    top.add(gdstk.rectangle((-20, -20), (0, 0), layer=1))
    top.add(gdstk.FlexPath([(-20, 5), (-5, 5)], 1.0, ends="extended", layer=4, simple_path=True))
    top.add(gdstk.Reference(unit, (100, 0), rotation=math.pi / 2))
    top.add(gdstk.Reference(unit, (150, 0), magnification=2))
    top.add(gdstk.Reference(unit, (200, 0), x_reflection=True))
    top.add(gdstk.Reference(array, (0, 50)))
    lib.write_gds(path)


def main() -> None:
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    gds = os.path.join(out, "fixture.gds")
    build(gds)
    with open(os.path.join(out, "expected.json"), "w", encoding="utf-8") as f:
        json.dump(inspect_gds(gds), f, default=float)


if __name__ == "__main__":
    main()
