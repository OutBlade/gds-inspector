import os
import tempfile

import gdstk
import pytest

from gds_inspector.inspector import inspect_gds


def make_test_gds(path: str):
    lib = gdstk.Library()
    lib.unit = 1e-6
    lib.precision = 1e-9
    cell = lib.new_cell("TOP")
    cell.add(gdstk.rectangle((0, 0), (10, 10), layer=1))
    cell.add(gdstk.rectangle((15, 0), (25, 5), layer=1))
    cell.add(gdstk.rectangle((0, 15), (5, 20), layer=2))
    # 50 nm wide feature — should trigger MIN_WIDTH DRC
    cell.add(gdstk.rectangle((30, 0), (30.05, 10), layer=1))
    lib.write_gds(path)


@pytest.fixture
def gds_file():
    tmp = tempfile.NamedTemporaryFile(suffix=".gds", delete=False)
    tmp.close()
    make_test_gds(tmp.name)
    yield tmp.name
    os.unlink(tmp.name)


def test_status_ok(gds_file):
    result = inspect_gds(gds_file)
    assert result["status"] == "ok"


def test_file_info(gds_file):
    result = inspect_gds(gds_file)
    fi = result["file_info"]
    assert fi["size_bytes"] > 0
    assert fi["cell_count"] == 1


def test_layers_detected(gds_file):
    result = inspect_gds(gds_file)
    layer_ids = {l["layer"] for l in result["layers"]}
    assert 1 in layer_ids
    assert 2 in layer_ids


def test_layer1_polygon_count(gds_file):
    result = inspect_gds(gds_file)
    layer1 = next(l for l in result["layers"] if l["layer"] == 1)
    assert layer1["polygon_count"] == 3


def test_drc_min_width_violation(gds_file):
    result = inspect_gds(gds_file)
    viols = [v for v in result["drc"]["violations"] if v["rule"] == "MIN_WIDTH"]
    assert len(viols) > 0


def test_density_nonzero(gds_file):
    result = inspect_gds(gds_file)
    layer1 = next(l for l in result["layers"] if l["layer"] == 1)
    assert layer1["density_percent"] > 0


def test_preview_polygons(gds_file):
    result = inspect_gds(gds_file)
    assert len(result["preview"]["polygons"]) > 0


def test_cells_info(gds_file):
    result = inspect_gds(gds_file)
    assert len(result["cells"]) == 1
    assert result["cells"][0]["name"] == "TOP"
    assert result["cells"][0]["is_top"] is True
