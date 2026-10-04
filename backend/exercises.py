"""
Cartolith — exercises: the seed of the assessment ("check my work") system.

The guided lessons in the frontend check *that you clicked the right
things*. They cannot check that the thing you produced is *right*. This
module closes that loop for derived datasets and numeric results:

An exercise is a plain dict (JSON-serialisable, so instructors can author
them as files):

    {
      "id": "buffer-cities-500km",
      "title": "...", "prompt": "...",
      "objectives": ["..."],            # what this exercise certifies
      "checks": [ <check>, ... ]
    }

Check types (each produces a pass/fail + a student-readable message;
failures try to name the likely misconception, not just the mismatch):

    row_count        {"type": "row_count", "expected": 6}
    geometry_type    {"type": "geometry_type", "expected": "Polygon"}
    total_area_km2   {"type": "total_area_km2", "expected": 4712389,
                      "tolerance_pct": 15}
                     — measured after projecting to EPSG:3857 *for area
                     only*; if the submitted area looks like it was summed
                     in degrees, the feedback says so explicitly.
    attribute_stat   {"type": "attribute_stat", "column": "count",
                      "stat": "sum", "expected": 30, "tolerance": 0.5}
    numeric_result   {"type": "numeric_result", "key": "I",
                      "expected": 0.82, "tolerance": 0.05,
                      "label": "Moran's I"}
                     — for analysis outputs submitted as a dict.
    interpretation   {"type": "interpretation", "key": "verdict",
                      "must_contain": "clustered"}
                     — crude but honest: checks the student's stated
                     conclusion, not just their number.

grade() takes an exercise plus a submission:
    {"gdf": GeoDataFrame}        for dataset exercises
    {"result": {...}}            for numeric/interpretation exercises
and returns {"passed", "score", "feedback": [{check, passed, message}]}.

Fixtures in this module are small, real-geography teaching datasets
built in code so exercises run anywhere (including tests) with no files.
"""
from __future__ import annotations

from typing import Any, Dict, List

# ── fixtures ────────────────────────────────────────────────────────────────

def fixture_cities():
    """Six world cities, each > 2,000 km from the next (buffers won't merge)."""
    import geopandas as gpd
    from shapely.geometry import Point
    rows = [
        ("Knoxville", -83.92, 35.96), ("Denver", -104.99, 39.74),
        ("Seattle", -122.33, 47.61), ("Miami", -80.19, 25.76),
        ("Chicago", -87.63, 41.88), ("Phoenix", -112.07, 33.45),
    ]
    return gpd.GeoDataFrame(
        {"name": [r[0] for r in rows], "pop_k": [391, 715, 737, 442, 2746, 1608]},
        geometry=[Point(r[1], r[2]) for r in rows], crs="EPSG:4326")


def fixture_grid_values():
    """6x6 gradient field (the Moran's I teaching fixture) + its coordinates."""
    import numpy as np
    coords = [(x, y) for y in range(6) for x in range(6)]
    rng = np.random.default_rng(0)
    vals = [x + y for (x, y) in coords]
    return (np.array(vals, float) + rng.normal(0, 0.3, 36),
            np.array(coords, float))


# ── exercises ───────────────────────────────────────────────────────────────

EXERCISES: List[Dict[str, Any]] = [
    {
        "id": "buffer-cities-500km",
        "title": "Buffer the fixture cities by 500 km",
        "prompt": ("Load the fixture cities, buffer every city by 500 km, and "
                   "submit the buffered layer. One polygon per city."),
        "objectives": [
            "Buffer in a distance-preserving projection, not in degrees",
            "Predict a buffer's area before computing it (pi * r^2)",
        ],
        "checks": [
            {"type": "row_count", "expected": 6},
            {"type": "geometry_type", "expected": "Polygon"},
            # 6 * pi * 500^2 = 4,712,389 km2; buffers are far apart (no merge)
            {"type": "total_area_km2", "expected": 4712389, "tolerance_pct": 15},
        ],
    },
    {
        "id": "morans-i-gradient",
        "title": "Moran's I of a smooth gradient",
        "prompt": ("The fixture field increases smoothly from south-west to "
                   "north-east. Run Moran's I (k = 4 neighbours) and submit "
                   "the result plus your one-word verdict."),
        "objectives": [
            "Connect a map pattern to the sign/size of Moran's I",
            "Distinguish the statistic from its significance test",
        ],
        "checks": [
            {"type": "numeric_result", "key": "I", "label": "Moran's I",
             "expected": 0.818, "tolerance": 0.05},
            {"type": "interpretation", "key": "verdict", "must_contain": "cluster"},
        ],
    },
]


def get_exercise(exercise_id: str) -> Dict[str, Any] | None:
    return next((e for e in EXERCISES if e["id"] == exercise_id), None)


# ── grading ─────────────────────────────────────────────────────────────────

def _grade_check(chk: Dict[str, Any], sub: Dict[str, Any]) -> Dict[str, Any]:
    t = chk["type"]
    def done(ok, msg):
        return {"check": t, "passed": bool(ok), "message": msg}

    if t in ("numeric_result", "interpretation"):
        res = sub.get("result") or {}
        if t == "numeric_result":
            got = res.get(chk["key"])
            if got is None:
                return done(False, f"No {chk.get('label', chk['key'])} in your submission — "
                                   "run the analysis and submit its result.")
            if abs(float(got) - chk["expected"]) <= chk["tolerance"]:
                return done(True, f"{chk.get('label', chk['key'])} = {float(got):.3f} — correct.")
            return done(False, f"{chk.get('label', chk['key'])}: you got {float(got):.3f}, "
                               f"expected about {chk['expected']:.3f}. Check the weights "
                               "(k neighbours) and that you analysed the value column, "
                               "not the coordinates.")
        got = str(res.get(chk["key"], "")).lower()
        if chk["must_contain"] in got:
            return done(True, "Interpretation matches the statistic.")
        return done(False, f"Your verdict doesn't mention '{chk['must_contain']}'. "
                           "Re-read the sign of the statistic: positive Moran's I with "
                           "a small p-value means similar values cluster.")

    gdf = sub.get("gdf")
    if gdf is None:
        return done(False, "This exercise expects a dataset submission.")
    if t == "row_count":
        if len(gdf) == chk["expected"]:
            return done(True, f"{len(gdf)} features — correct.")
        return done(False, f"You submitted {len(gdf)} features; expected {chk['expected']}. "
                           "Did a dissolve or a join change the feature count?")
    if t == "geometry_type":
        types = set(gdf.geometry.geom_type)
        if types == {chk["expected"]}:
            return done(True, f"Geometry type {chk['expected']} — correct.")
        return done(False, f"Geometry is {sorted(types)}, expected {chk['expected']}. "
                           "A buffer of points produces polygons — did the operation run?")
    if t == "total_area_km2":
        # Geodesic area on the ellipsoid. (An earlier draft of this grader
        # projected to EPSG:3857 and inflated US-latitude areas by ~65% —
        # caught by test_exercises. Web Mercator is for display, never
        # for measurement; the grader must not commit the misconception
        # it exists to teach against.)
        try:
            from pyproj import Geod
            _geod = Geod(ellps="WGS84")
            area_km2 = sum(abs(_geod.geometry_area_perimeter(g)[0])
                           for g in gdf.geometry if g is not None) / 1e6
        except Exception:
            area_km2 = float(gdf.to_crs("EPSG:5070").geometry.area.sum()) / 1e6
        exp, tol = chk["expected"], chk["expected"] * chk["tolerance_pct"] / 100.0
        if abs(area_km2 - exp) <= tol:
            return done(True, f"Total area {area_km2:,.0f} km² — within tolerance.")
        # Misconception detector: area summed in lon/lat degrees is ~ (1/111)^2 scale
        deg_area = float(gdf.geometry.area.sum())
        hint = ""
        if abs(deg_area - exp) < abs(area_km2 - exp):
            hint = (" Your number looks like an area summed in degrees — project to a "
                    "metre-based CRS before measuring area.")
        return done(False, f"Total area is {area_km2:,.0f} km²; expected about "
                           f"{exp:,.0f} km² (±{chk['tolerance_pct']}%). "
                           "Check the buffer distance and its units (500 km = 500,000 m)." + hint)
    if t == "attribute_stat":
        col = chk["column"]
        if col not in gdf.columns:
            return done(False, f"Column '{col}' is missing from your submission.")
        s = gdf[col]
        got = {"sum": s.sum(), "mean": s.mean(), "min": s.min(), "max": s.max(),
               "count": s.count()}[chk["stat"]]
        if abs(float(got) - chk["expected"]) <= chk.get("tolerance", 0):
            return done(True, f"{col} {chk['stat']} = {float(got):.3f} — correct.")
        return done(False, f"{col} {chk['stat']}: you got {float(got):.3f}, "
                           f"expected {chk['expected']}. Check for duplicated rows "
                           "from the join (one-to-many joins multiply features).")
    return done(False, f"Unknown check type '{t}'.")


def grade(exercise: Dict[str, Any], submission: Dict[str, Any]) -> Dict[str, Any]:
    """Grade a submission against an exercise. See module docstring."""
    feedback = [_grade_check(c, submission) for c in exercise["checks"]]
    passed = all(f["passed"] for f in feedback)
    score = sum(f["passed"] for f in feedback) / max(len(feedback), 1)
    return {"exercise": exercise["id"], "passed": passed,
            "score": round(float(score), 3), "feedback": feedback}
