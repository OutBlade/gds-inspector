import math
import os
from typing import Any

import gdstk

LAYER_COLORS = [
    "#E74C3C",
    "#3498DB",
    "#2ECC71",
    "#F39C12",
    "#9B59B6",
    "#1ABC9C",
    "#E67E22",
    "#95A5A6",
    "#34495E",
    "#F1C40F",
]


def get_layer_color(layer: int) -> str:
    return LAYER_COLORS[layer % len(LAYER_COLORS)]


def polygon_min_bb_dim(poly: gdstk.Polygon) -> float:
    bb = poly.bounding_box()
    if bb is None:
        return 0.0
    (x1, y1), (x2, y2) = bb
    return min(x2 - x1, y2 - y1)


def polygon_min_edge(poly: gdstk.Polygon) -> float:
    pts = poly.points
    n = len(pts)
    if n < 2:
        return 0.0
    min_len = float("inf")
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        length = math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
        if length > 0:
            min_len = min(min_len, length)
    return min_len if min_len != float("inf") else 0.0


def inspect_gds(filepath: str) -> dict[str, Any]:
    lib = gdstk.read_gds(filepath)

    unit = lib.unit
    precision = lib.precision
    unit_to_nm = unit / 1e-9

    file_info = {
        "path": os.path.basename(filepath),
        "size_bytes": os.path.getsize(filepath),
        "library_name": lib.name,
        "unit_meters": unit,
        "precision_meters": precision,
        "unit_label": "µm" if abs(unit - 1e-6) < 1e-8 else f"{unit * 1e9:.0f}nm",
        "cell_count": len(lib.cells),
    }

    top_cells = lib.top_level()
    top_cell_name = (
        top_cells[0].name if top_cells else (lib.cells[0].name if lib.cells else "")
    )

    cells_info = []
    for cell in lib.cells:
        bb = cell.bounding_box()
        bb_data = None
        if bb:
            (x1, y1), (x2, y2) = bb
            bb_data = {
                "x_min": x1 * unit_to_nm,
                "y_min": y1 * unit_to_nm,
                "x_max": x2 * unit_to_nm,
                "y_max": y2 * unit_to_nm,
                "width_nm": (x2 - x1) * unit_to_nm,
                "height_nm": (y2 - y1) * unit_to_nm,
            }
        cells_info.append(
            {
                "name": cell.name,
                "is_top": cell.name == top_cell_name,
                "polygon_count": len(cell.polygons),
                "path_count": len(cell.paths),
                "reference_count": len(cell.references),
                "bounding_box": bb_data,
            }
        )

    layers: dict[int, dict] = {}
    for cell in lib.cells:
        for poly in cell.polygons:
            layer = poly.layer
            if layer not in layers:
                layers[layer] = {
                    "layer": layer,
                    "datatype": poly.datatype,
                    "color": get_layer_color(layer),
                    "polygon_count": 0,
                    "total_area_um2": 0.0,
                    "min_cd_nm": float("inf"),
                    "max_cd_nm": 0.0,
                    "min_edge_nm": float("inf"),
                    "density_percent": 0.0,
                }
            area = abs(poly.area())
            min_dim = polygon_min_bb_dim(poly) * unit_to_nm
            min_edge = polygon_min_edge(poly) * unit_to_nm

            layers[layer]["polygon_count"] += 1
            layers[layer]["total_area_um2"] += area
            layers[layer]["min_cd_nm"] = min(layers[layer]["min_cd_nm"], min_dim)
            layers[layer]["max_cd_nm"] = max(layers[layer]["max_cd_nm"], min_dim)
            if min_edge > 0:
                layers[layer]["min_edge_nm"] = min(
                    layers[layer]["min_edge_nm"], min_edge
                )

    for ld in layers.values():
        if ld["min_cd_nm"] == float("inf"):
            ld["min_cd_nm"] = 0.0
        if ld["min_edge_nm"] == float("inf"):
            ld["min_edge_nm"] = 0.0

    if top_cells:
        top_cell = top_cells[0]
        bb = top_cell.bounding_box()
        if bb:
            (x1, y1), (x2, y2) = bb
            total_area = (x2 - x1) * (y2 - y1)
            flat_polys = top_cell.get_polygons()
            layer_areas: dict[int, float] = {}
            for poly in flat_polys:
                layer_areas[poly.layer] = layer_areas.get(poly.layer, 0.0) + abs(
                    poly.area()
                )
            for lid, larea in layer_areas.items():
                if lid in layers and total_area > 0:
                    layers[lid]["density_percent"] = larea / total_area * 100

    from gds_inspector.drc import run_basic_drc

    drc_results = run_basic_drc(lib, unit_to_nm)
    preview = _get_preview(lib, top_cell_name, unit_to_nm)

    return {
        "status": "ok",
        "file_info": file_info,
        "top_cell": top_cell_name,
        "cells": cells_info,
        "layers": list(layers.values()),
        "drc": drc_results,
        "preview": preview,
    }


def _get_preview(lib: gdstk.Library, top_cell_name: str, unit_to_nm: float) -> dict:
    MAX_POLYS = 3000

    top_cell = (
        lib[top_cell_name] if top_cell_name else (lib.cells[0] if lib.cells else None)
    )
    if not top_cell:
        return {
            "polygons": [],
            "bounds": None,
            "cell": "",
            "total_polygon_count": 0,
            "shown_polygon_count": 0,
        }

    flat_polys = top_cell.get_polygons()
    subset = flat_polys[:MAX_POLYS]

    all_x, all_y = [], []
    for poly in subset:
        pts = poly.points
        all_x.extend(pts[:, 0].tolist())
        all_y.extend(pts[:, 1].tolist())

    if not all_x:
        return {
            "polygons": [],
            "bounds": None,
            "cell": top_cell_name,
            "total_polygon_count": 0,
            "shown_polygon_count": 0,
        }

    bounds = {
        "x_min": float(min(all_x)) * unit_to_nm,
        "y_min": float(min(all_y)) * unit_to_nm,
        "x_max": float(max(all_x)) * unit_to_nm,
        "y_max": float(max(all_y)) * unit_to_nm,
    }

    polygons = [
        {
            "layer": poly.layer,
            "points": [
                [float(x) * unit_to_nm, float(y) * unit_to_nm] for x, y in poly.points
            ],
        }
        for poly in subset
    ]

    return {
        "cell": top_cell_name,
        "total_polygon_count": len(flat_polys),
        "shown_polygon_count": len(subset),
        "bounds": bounds,
        "polygons": polygons,
    }
