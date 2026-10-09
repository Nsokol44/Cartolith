"""
Dropped-file ingest: POST /api/datasets/upload-paths.

History: drag & drop never worked in the desktop app. Tauri v2's native
drag-drop handler (enabled by default) delivers file PATHS via
tauri:// events, the frontend listened for neither those nor HTML5 drop
events, and the only upload route took browser File objects — so a drop
was a silent nothing. This endpoint takes the dropped paths, reads the
files from local disk, and runs them through the same _ingest_bytes
pipeline as the multipart upload. These tests pin that contract:
the token gate, the shapefile-part grouping, batch error isolation,
the layer/sheet choice round-trip, and Stata .dta (the classroom ACS
files that failed as bare "failed" badges in v1.5.2).
"""
import io
import zipfile

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from shapely.geometry import Point

import main

gpd = pytest.importorskip("geopandas")

client = TestClient(main.app)
TOKEN = {"X-Cartolith-Token": main.API_TOKEN}

PTS = gpd.GeoDataFrame({"name": ["a", "b"], "pop": [1, 2]},
                       geometry=[Point(-83.9, 35.9), Point(-84.0, 36.0)],
                       crs="EPSG:4326")


def _post(paths, **kw):
    body = {"paths": [str(p) for p in paths]}
    body.update(kw)
    return client.post("/api/datasets/upload-paths", json=body, headers=TOKEN)


def _shp_parts_on_disk(tmp_path, stem="places"):
    d = tmp_path / "dropzone"
    d.mkdir(exist_ok=True)
    PTS.to_file(str(d / f"{stem}.shp"))
    return sorted(p for p in d.iterdir() if p.stem == stem)


def _write_xlsx(path, sheets):
    with pd.ExcelWriter(path, engine="openpyxl") as w:
        for name, df in sheets.items():
            df.to_excel(w, sheet_name=name, index=False)


# ── the token contract (same gate as the multipart upload) ────────────

def test_upload_paths_without_token_is_401(tmp_path):
    f = tmp_path / "a.csv"
    f.write_text("name,lat,lon\na,35.9,-83.9\n")
    r = client.post("/api/datasets/upload-paths",
                    json={"paths": [str(f)]})
    assert r.status_code == 401


# ── single files through the drop path ────────────────────────────────

def test_drop_csv_path_loads_as_points(tmp_path):
    f = tmp_path / "pts.csv"
    f.write_text("name,lat,lon\na,35.9,-83.9\nb,36.0,-84.0\n")
    r = _post([f])
    assert r.status_code == 200
    (entry,) = r.json()["results"]
    assert entry["status"] == "ok"
    assert entry["geo_meta"]["feature_count"] == 2


def test_drop_zipped_shapefile_path_loads(tmp_path):
    parts = _shp_parts_on_disk(tmp_path)
    zpath = tmp_path / "bundle.zip"
    with zipfile.ZipFile(zpath, "w") as z:
        for p in parts:
            z.write(p, arcname=p.name)
    r = _post([zpath])
    (entry,) = r.json()["results"]
    assert entry["status"] == "ok"
    assert entry["geo_meta"]["feature_count"] == 2


def test_drop_stata_with_latlon_becomes_points(tmp_path):
    f = tmp_path / "acs.dta"
    pd.DataFrame({"tract": ["001", "002"], "lat": [35.9, 36.0],
                  "lon": [-83.9, -84.0],
                  "medinc": [52000, 61000]}).to_stata(f, write_index=False)
    r = _post([f])
    (entry,) = r.json()["results"]
    assert entry["status"] == "ok"
    assert entry["geo_meta"]["feature_count"] == 2
    assert entry["load_meta"]["format"] == "stata"


def test_drop_stata_attribute_only_loads_as_table_with_note(tmp_path):
    f = tmp_path / "acs_counts.dta"
    pd.DataFrame({"county": ["Knox", "Blount"],
                  "pop": [470000, 130000]}).to_stata(f, write_index=False)
    r = _post([f])
    (entry,) = r.json()["results"]
    assert entry["status"] == "ok"
    assert entry["shape"] == [2, 2]
    # The student is told WHY there is no map layer — never bare silence.
    assert "No coordinate columns" in entry["geometry_note"]


# ── shapefile parts dropped together ──────────────────────────────────

def test_drop_shapefile_parts_group_into_one_dataset(tmp_path):
    parts = _shp_parts_on_disk(tmp_path)
    assert len(parts) >= 3  # .shp + .shx + .dbf at least
    r = _post(parts)
    results = r.json()["results"]
    assert len(results) == 1
    entry = results[0]
    assert entry["status"] == "ok"
    assert entry["geo_meta"]["feature_count"] == 2
    assert "shapefile" in entry["source"]


def test_drop_parts_from_different_folders_do_not_merge(tmp_path):
    d1 = tmp_path / "one"; d1.mkdir()
    d2 = tmp_path / "two"; d2.mkdir()
    PTS.to_file(str(d1 / "places.shp"))
    PTS.to_file(str(d2 / "places.shp"))
    paths = [p for p in sorted(d1.iterdir()) if p.stem == "places"]
    paths += [p for p in sorted(d2.iterdir()) if p.stem == "places"]
    r = _post(paths)
    results = r.json()["results"]
    assert len(results) == 2
    assert all(e["status"] == "ok" for e in results)


# ── batch behaviour: one bad file never kills the drop ────────────────

def test_drop_batch_isolates_errors(tmp_path):
    good = tmp_path / "good.csv"
    good.write_text("name,lat,lon\na,35.9,-83.9\n")
    junk = tmp_path / "junk.gpkg"
    junk.write_bytes(b"\x00\x01\x02 not a geopackage at all")
    missing = tmp_path / "gone.csv"
    r = _post([good, missing, junk])
    assert r.status_code == 200
    results = r.json()["results"]
    assert [e["status"] for e in results] == ["ok", "error", "error"]
    assert "Could not find" in results[1]["detail"]
    assert results[2]["detail"]  # the parser's reason, not an empty string


def test_drop_a_folder_is_an_actionable_error_not_a_crash(tmp_path):
    r = _post([tmp_path])
    (entry,) = r.json()["results"]
    assert entry["status"] == "error"
    assert "folder" in entry["detail"]


# ── the choice round-trip (multi-sheet workbook) ──────────────────────

def test_drop_multisheet_workbook_asks_then_loads_the_pick(tmp_path):
    f = tmp_path / "book.xlsx"
    _write_xlsx(f, {
        "One": pd.DataFrame({"name": ["a"], "lat": [35.9], "lon": [-83.9]}),
        "Two": pd.DataFrame({"name": ["a", "b", "c"],
                             "lat": [35.9, 36.0, 36.1],
                             "lon": [-83.9, -84.0, -84.1]}),
    })
    r = _post([f])
    (entry,) = r.json()["results"]
    assert entry["status"] == "needs_choice"
    assert entry["kind"] == "sheet"
    assert entry["options"] == ["One", "Two"]
    assert entry["paths"] == [str(f)]  # echoed for the follow-up call

    r2 = _post([f], sheet="Two")
    (picked,) = r2.json()["results"]
    assert picked["status"] == "ok"
    assert picked["shape"] == [3, 3]
