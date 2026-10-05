"""Assessment prototype ('check my work'): a correct submission passes,
a wrong one fails with feedback that names the likely misconception —
that feedback loop, not the pass/fail bit, is the teaching value."""
import numpy as np
import pytest

gpd = pytest.importorskip("geopandas")
from shapely.geometry import Point  # noqa: E402

import advanced_methods as adv  # noqa: E402
import exercises as ex  # noqa: E402
import main  # noqa: E402


def _buffer_cities(distance_m):
    cities = ex.fixture_cities()
    main.vector_cache["cities"] = cities
    import pandas as pd
    main.datasets["cities"] = pd.DataFrame(
        {c: cities[c] for c in cities.columns if c != "geometry"})
    out = main.geoprocess_run({"tool": "buffer", "dataset_id": "cities",
                               "params": {"distance": distance_m}})
    return main.vector_cache[out["id"]]


def test_correct_buffer_submission_passes():
    exercise = ex.get_exercise("buffer-cities-500km")
    result = ex.grade(exercise, {"gdf": _buffer_cities(500_000)})
    assert result["passed"], result["feedback"]
    assert result["score"] == 1.0


def test_wrong_distance_fails_with_unit_aware_feedback():
    exercise = ex.get_exercise("buffer-cities-500km")
    result = ex.grade(exercise, {"gdf": _buffer_cities(50_000)})  # 50 km, not 500
    assert not result["passed"]
    area_fb = [f for f in result["feedback"] if f["check"] == "total_area_km2"][0]
    assert not area_fb["passed"] and "km" in area_fb["message"]


def test_degrees_buffer_fails_row_and_area_checks():
    """The classic beginner error: buffer in lon/lat degrees."""
    exercise = ex.get_exercise("buffer-cities-500km")
    bad = ex.fixture_cities()
    bad["geometry"] = bad.geometry.buffer(0.5)  # 0.5 *degrees* (~55 km)
    result = ex.grade(exercise, {"gdf": bad})
    assert not result["passed"]
    # Note: a 5-degree buffer would nearly PASS the area check (~556 km
    # radius at the equator). Degree buffers can look right at a glance —
    # which is exactly why area alone is a weak check; see the grader
    # backlog in ENHANCEMENT_PLAN.md (shape/eccentricity check).


def test_missing_dataset_fails_cleanly():
    exercise = ex.get_exercise("buffer-cities-500km")
    result = ex.grade(exercise, {})
    assert not result["passed"]
    assert all("expects a dataset" in f["message"] or not f["passed"]
               for f in result["feedback"])


def test_morans_exercise_pass_and_fail():
    exercise = ex.get_exercise("morans-i-gradient")
    vals, coords = ex.fixture_grid_values()
    W = adv.spatial_weights(coords, k=4)
    out = adv.morans_i(vals, W, permutations=99)
    good = ex.grade(exercise, {"result": {"I": out["I"], "verdict": "clustered"}})
    assert good["passed"], good["feedback"]
    bad = ex.grade(exercise, {"result": {"I": 0.01, "verdict": "random"}})
    assert not bad["passed"]
    assert bad["score"] == 0.0


def test_attribute_stat_check():
    chk_ex = {"id": "t", "checks": [
        {"type": "attribute_stat", "column": "n", "stat": "sum",
         "expected": 30, "tolerance": 0}]}
    gdf = ex.fixture_cities()
    gdf["n"] = [5, 5, 5, 5, 5, 5]
    assert ex.grade(chk_ex, {"gdf": gdf})["passed"]
    gdf["n"] = [5, 5, 5, 5, 5, 6]
    out = ex.grade(chk_ex, {"gdf": gdf})
    assert not out["passed"] and "duplicated rows" in out["feedback"][0]["message"]


def test_exercise_endpoints_via_testclient():
    from fastapi.testclient import TestClient
    client = TestClient(main.app)
    client.headers["X-Cartolith-Token"] = main.API_TOKEN  # writes require the session token
    r = client.get("/api/exercises")
    assert r.status_code == 200 and len(r.json()["exercises"]) == 2
    r = client.post("/api/exercises/morans-i-gradient/check",
                    json={"result": {"I": 0.82, "verdict": "clustered"}})
    assert r.status_code == 200 and r.json()["passed"] is True
    r = client.post("/api/exercises/nope/check", json={"result": {}})
    assert r.status_code == 404
