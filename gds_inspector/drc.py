from typing import Any

import gdstk


def run_basic_drc(
    lib: gdstk.Library,
    unit_to_nm: float,
    thresholds: dict | None = None,
) -> dict[str, Any]:
    if thresholds is None:
        thresholds = {"min_width_nm": 100.0, "min_area_um2": 0.001}

    violations = []
    stats = {
        "total_polygons_checked": 0,
        "min_width_violations": 0,
        "min_area_violations": 0,
    }

    for cell in lib.cells:
        for poly in cell.polygons:
            stats["total_polygons_checked"] += 1

            bb = poly.bounding_box()
            if bb:
                (x1, y1), (x2, y2) = bb
                width_nm = min(x2 - x1, y2 - y1) * unit_to_nm
                if 0 < width_nm < thresholds["min_width_nm"]:
                    stats["min_width_violations"] += 1
                    if stats["min_width_violations"] <= 200:
                        violations.append(
                            {
                                "rule": "MIN_WIDTH",
                                "severity": "error",
                                "layer": poly.layer,
                                "cell": cell.name,
                                "value_nm": round(width_nm, 2),
                                "threshold_nm": thresholds["min_width_nm"],
                                "location": [
                                    round((x1 + x2) / 2 * unit_to_nm, 1),
                                    round((y1 + y2) / 2 * unit_to_nm, 1),
                                ],
                            }
                        )

            area_um2 = abs(poly.area())
            if 0 < area_um2 < thresholds["min_area_um2"]:
                stats["min_area_violations"] += 1
                if stats["min_area_violations"] <= 100:
                    violations.append(
                        {
                            "rule": "MIN_AREA",
                            "severity": "warning",
                            "layer": poly.layer,
                            "cell": cell.name,
                            "value_um2": round(area_um2, 6),
                            "threshold_um2": thresholds["min_area_um2"],
                        }
                    )

    return {
        "thresholds": thresholds,
        "stats": stats,
        "violations": violations,
        "passed": len(violations) == 0,
    }
