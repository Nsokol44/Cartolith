"""
Upload-endpoint battery: the real-world files students actually bring,
pushed through POST /api/datasets/upload (not just the parser module).

History: v1.5.0's parser expansion lived in data_loading.py, but the
upload router in main.py bypassed it for the commonest files (bare
pd.read_csv for CSVs), matched zip members case-sensitively (a .SHP
bundle was "no recognized file in zip"), routed plain JSON arrays to
GDAL, and the desktop frontend's XHR upload never attached the
per-launch session token, so every upload was a 401 in the shipped app.
These tests pin the upload-level behaviour so the module-level tests
can't pass while the real path is broken again.
"""
import io
import json
import zipfile

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from shapely.geometry import Point

import data_loading as dl
import main

gpd = pytest.importorskip("geopandas")

client = TestClient(main.app)
TOKEN = {"X-Cartolith-Token": main.API_TOKEN}

PTS = gpd.GeoDataFrame({"name": ["a", "b"], "pop": [1, 2]},
                       geometry=[Point(-83.9, 35.9), Point(-84.0, 36.0)],
                       crs="EPSG:4326")


def _shp_parts(tmp_path, stem="places", gdf=None, prj=True):
    d = tmp_path / stem
    d.mkdir()
    (gdf if gdf is not None else PTS).to_file(str(d / f"{stem}.shp"))
    parts = {}
    for p in sorted(d.iterdir()):
        if p.suffix == ".prj" and not prj:
            continue
        parts[p.name] = p.read_bytes()
    return parts


def _zip_bytes(parts, prefix=""):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(prefix + name, data)
    return buf.getvalue()


def _upload(content, filename):
    return client.post("/api/datasets/upload",
                       files={"file": (filename, content)},
                       headers=TOKEN)


# ── the classroom failure mode ──────────────────────────────────────────

def test_upload_without_token_is_401(tmp_path):
    # Exactly what the pre-fix desktop frontend sent (XHR, no token
    # header): the middleware must reject it — and the frontend fix is
    # what makes the real app send the token. Pin both sides' contract.
    content = _zip_bytes(_shp_parts(tmp_path))
    r = client.post("/api/datasets/upload",
                    files={"file": ("places.zip", content)})
    assert r.status_code == 401


# ── zipped shapefiles ───────────────────────────────────────────────────

def test_zipped_shapefile_flat(tmp_path):
    r = _upload(_zip_bytes(_shp_parts(tmp_path)), "flat_upload.zip")
    assert r.status_code == 200
    body = r.json()
    assert body["geo_meta"]["feature_count"] == 2
    assert body["geo_meta"]["crs"] == "EPSG:4326"


def test_zipped_shapefile_nested_in_folder(tmp_path):
    r = _upload(_zip_bytes(_shp_parts(tmp_path), prefix="data/"),
                "nested_upload.zip")
    assert r.status_code == 200
    assert r.json()["geo_meta"]["feature_count"] == 2


def test_zipped_shapefile_mixed_case_extensions(tmp_path):
    parts = {name.rsplit(".", 1)[0] + "." + name.rsplit(".", 1)[1].upper(): data
             for name, data in _shp_parts(tmp_path).items()}
    assert any(k.endswith(".SHP") for k in parts)
    r = _upload(_zip_bytes(parts), "upper_upload.zip")
    assert r.status_code == 200
    assert r.json()["geo_meta"]["feature_count"] == 2


def test_zipped_shapefile_missing_prj_assumes_wgs84_and_says_so(tmp_path):
    r = _upload(_zip_bytes(_shp_parts(tmp_path, prj=False)), "noprj_upload.zip")
    assert r.status_code == 200
    body = r.json()
    assert body["geo_meta"]["crs"] == "EPSG:4326"
    assert ".prj" in body.get("geometry_note", "")


def test_zip_with_two_shapefiles_loads_one_and_tells_you(tmp_path):
    parts = _shp_parts(tmp_path, stem="places")
    parts.update(_shp_parts(tmp_path, stem="zones"))
    r = _upload(_zip_bytes(parts), "multi_upload.zip")
    assert r.status_code == 200
    body = r.json()
    assert "places.shp" in body.get("zip_note", "")
    assert "zones.shp" in body["zip_note"]


def test_zip_with_junk_files_still_loads(tmp_path):
    parts = _shp_parts(tmp_path)
    parts["README.txt"] = b"field notes"
    parts["places.xml"] = b"<metadata/>"
    r = _upload(_zip_bytes(parts), "junk_upload.zip")
    assert r.status_code == 200
    assert r.json()["geo_meta"]["feature_count"] == 2


def test_zip_unwraps_geojson_and_csv(tmp_path):
    gj = io.BytesIO()
    with zipfile.ZipFile(gj, "w") as z:
        z.writestr("pts.geojson", PTS.to_json())
    r = _upload(gj.getvalue(), "gj_upload.zip")
    assert r.status_code == 200
    assert r.json()["geo_meta"]["feature_count"] == 2

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("pts.csv", "name,lat,lon\nA,35.9,-83.9\n")
    r = _upload(buf.getvalue(), "csv_upload.zip")
    assert r.status_code == 200
    assert r.json()["geo_meta"]["feature_count"] == 1


# ── tables through the upload path (the bypassed robust reader) ─────────

def test_upload_csv_cp1252_decodes(tmp_path):
    content = "name,lat,lon\nCafé,35.9,-83.9\n".encode("cp1252")
    r = _upload(content, "cp1252_upload.csv")
    assert r.status_code == 200
    rows = r.json()["preview"]["rows"]
    assert rows[0]["name"] == "Café"


def test_upload_csv_semicolon_becomes_points_not_one_column():
    content = b"name;lat;lon\na;35.9;-83.9\nb;36.0;-84.0\n"
    r = _upload(content, "semi_upload.csv")
    assert r.status_code == 200
    assert r.json()["geo_meta"]["feature_count"] == 2


def test_upload_csv_named_txt_loads():
    r = _upload(b"name,lat,lon\na,35.9,-83.9\n", "table_upload.txt")
    assert r.status_code == 200
    assert r.json()["geo_meta"]["feature_count"] == 1


def test_upload_plain_json_array_is_a_table_not_a_gdal_error():
    content = json.dumps([{"name": "a", "lat": 35.9, "lon": -83.9}]).encode()
    r = _upload(content, "records_upload.json")
    assert r.status_code == 200
    assert r.json()["geo_meta"]["feature_count"] == 1


# ── geometry inference: 0–360 longitudes (global weather grids) ─────────

def test_detect_geometry_wraps_0360_longitudes():
    df = pd.DataFrame({"latitude": [35.5, 36.0],
                       "longitude": [275.8, 276.4], "t2m": [280.0, 281.0]})
    det = dl.detect_geometry(df)
    assert det is not None and det.get("wrap_lon") is True
    gdf, note = dl.apply_geometry(df, det)
    assert list(gdf.geometry.x) == pytest.approx([-84.2, -83.6])
    assert "0–360" in note


# ── KML fallback reader (GDAL KML drivers are build-dependent) ──────────

KML = """<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>P</name><Point><coordinates>-83.9,35.9,0</coordinates></Point></Placemark>
<Placemark><name>L</name><LineString><coordinates>-84.0,35.8 -83.9,35.9</coordinates></LineString></Placemark>
<Placemark><name>A</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-84.2,35.8 -83.8,35.8 -83.8,36.1 -84.2,36.1 -84.2,35.8</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>"""


def test_kml_fallback_parses_placemark_geometries():
    gdf, meta = dl._read_kml_fallback(KML.encode(), "kml")
    assert len(gdf) == 3
    assert list(gdf.geometry.geom_type) == ["Point", "LineString", "Polygon"]
    assert meta["reader"] == "builtin-kml-fallback"


def test_kml_fallback_reads_kmz_doc_kml():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("doc.kml", KML)
    gdf, _meta = dl._read_kml_fallback(buf.getvalue(), "kmz")
    assert len(gdf) == 3
