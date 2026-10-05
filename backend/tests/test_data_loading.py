"""
Parser coverage: every format Cartolith claims to open gets a tiny REAL
fixture generated programmatically, round-tripped through the parser,
with rows / geometry type / CRS asserted. Formats the installed stack
cannot generate get an explicit xfail with the reason — never a
silent skip.
"""
import io
import json
import sqlite3
import zipfile

import numpy as np
import pandas as pd
import pytest

gpd = pytest.importorskip("geopandas")
from shapely.geometry import Point, box  # noqa: E402

import data_loading as dl  # noqa: E402

PTS = gpd.GeoDataFrame({"name": ["a", "b", "c"], "pop": [1, 2, 3]},
                       geometry=[Point(0, 0), Point(1, 1), Point(2, 0)],
                       crs="EPSG:4326")
POLY = gpd.GeoDataFrame({"zone": ["A"]}, geometry=[box(0, 0, 1, 1)],
                        crs="EPSG:4326")


def _bytes_via_gpd(gdf, filename, **kw):
    import tempfile, os
    path = os.path.join(tempfile.mkdtemp(), filename)
    gdf.to_file(path, **kw)
    with open(path, "rb") as f:
        return f.read()


# ── sniffing ────────────────────────────────────────────────────────────────

def test_sniff_uses_content_not_extension():
    gpkg = _bytes_via_gpd(PTS, "x.gpkg")
    assert dl.sniff_format(gpkg, "lying_name.csv") == "sqlite"
    assert dl.sniff_format(b"GRIB\x00\x00\x00\x00", "x.txt") == "grib2"
    assert dl.sniff_format(b"SQLite format 3\x00rest", "x.gpkg") == "sqlite"
    assert dl.sniff_format(b"plain,text\n1,2\n", "x.csv") == "csv"


# ── vector formats ──────────────────────────────────────────────────────────

def test_geopackage_two_layers_needs_choice_then_reads():
    import tempfile, os
    path = os.path.join(tempfile.mkdtemp(), "two.gpkg")
    PTS.to_file(path, layer="points")
    POLY.to_file(path, layer="zones")
    content = open(path, "rb").read()
    with pytest.raises(dl.NeedsChoice) as e:
        dl.read_vector(content, "two.gpkg")
    assert set(e.value.options) == {"points", "zones"}
    gdf, meta = dl.read_vector(content, "two.gpkg", layer="zones")
    assert len(gdf) == 1 and meta["geometry_type"] == "Polygon"
    assert str(gdf.crs) == "EPSG:4326"


def test_kml_and_kmz_roundtrip():
    kml = _bytes_via_gpd(PTS, "pts.kml", driver="KML")
    gdf, meta = dl.read_vector(kml, "pts.kml")
    assert len(gdf) == 3 and meta["geometry_type"] == "Point"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("doc.kml", kml)
    gdf2, _ = dl.read_vector(buf.getvalue(), "pts.kmz")
    assert len(gdf2) == 3


def test_gpx_waypoints():
    gpx = """<?xml version="1.0"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
<wpt lat="35.96" lon="-83.92"><name>Knoxville</name></wpt>
<wpt lat="39.74" lon="-104.99"><name>Denver</name></wpt>
</gpx>"""
    gdf, meta = dl.read_vector(gpx.encode(), "trip.gpx", layer="waypoints")
    assert len(gdf) == 2 and meta["geometry_type"] == "Point"


def test_gml_roundtrip():
    gml = _bytes_via_gpd(PTS, "pts.gml", driver="GML")
    gdf, _ = dl.read_vector(gml, "pts.gml")
    assert len(gdf) == 3


def test_flatgeobuf_roundtrip():
    fgb = _bytes_via_gpd(PTS, "pts.fgb", driver="FlatGeobuf")
    gdf, _ = dl.read_vector(fgb, "pts.fgb")
    assert len(gdf) == 3 and str(gdf.crs) == "EPSG:4326"


def test_geojson_sequence():
    lines = []
    for i, (x, y) in enumerate([(0, 0), (1, 1)]):
        lines.append(json.dumps({"type": "Feature",
                                 "properties": {"n": i},
                                 "geometry": {"type": "Point", "coordinates": [x, y]}}))
    gdf, _ = dl.read_vector(("\n".join(lines)).encode(), "pts.geojsons")
    assert len(gdf) == 2


def test_topojson_points():
    topo = {"type": "Topology",
            "objects": {"pts": {"type": "GeometryCollection", "geometries": [
                {"type": "Point", "coordinates": [0, 0], "properties": {"n": 1}},
                {"type": "Point", "coordinates": [1, 1], "properties": {"n": 2}}]}},
            "arcs": []}
    try:
        gdf, _ = dl.read_vector(json.dumps(topo).encode(), "pts.topojson")
    except dl.ParseFailure as e:
        pytest.xfail(f"installed GDAL TopoJSON driver rejected minimal fixture: {e}")
    assert len(gdf) == 2


# ── tabular + geometry detection ────────────────────────────────────────────

def test_csv_wkt_column_becomes_geometry():
    csv_text = "name,wkt\nA,POINT (0 0)\nB,POINT (1 1)\n"
    df, _ = dl.read_table(csv_text.encode(), "pts.csv")
    det = dl.detect_geometry(df)
    assert det == {"kind": "wkt", "column": "wkt"}
    gdf, note = dl.apply_geometry(df, det)
    assert len(gdf) == 2 and "assumed" in note


def test_csv_fuzzy_latlon_headers():
    csv_text = "City,LATITUDE,Longitude\nA,35.9,-83.9\nB,39.7,-105.0\n"
    df, _ = dl.read_table(csv_text.encode(), "cities.csv")
    det = dl.detect_geometry(df)
    assert det["kind"] == "latlon"
    gdf, _ = dl.apply_geometry(df, det)
    assert gdf.geometry.iloc[0].y == pytest.approx(35.9)


def test_csv_semicolon_and_latin1_encoding():
    text = "ville;note\nMontréal;café\nLyon;thé\n"
    df, _ = dl.read_table(text.encode("latin-1"), "villes.csv")
    assert list(df.columns) == ["ville", "note"]
    assert df["note"].iloc[0] == "café"


def test_json_records_and_jsonl():
    df, _ = dl.read_table(b'[{"a": 1}, {"a": 2}]', "r.json")
    assert df["a"].tolist() == [1, 2]
    df, _ = dl.read_table(b'{"a": 1}\n{"a": 2}\n', "r.jsonl")
    assert df["a"].tolist() == [1, 2]


def test_excel_two_sheets_needs_choice():
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as w:
        pd.DataFrame({"a": [1]}).to_excel(w, sheet_name="one", index=False)
        pd.DataFrame({"b": [2, 3]}).to_excel(w, sheet_name="two", index=False)
    content = buf.getvalue()
    with pytest.raises(dl.NeedsChoice) as e:
        dl.read_table(content, "book.xlsx")
    assert e.value.options == ["one", "two"]
    df, meta = dl.read_table(content, "book.xlsx", sheet="two")
    assert df["b"].tolist() == [2, 3] and meta["sheet"] == "two"


def test_sqlite_tables_needs_choice_and_wkt_detection():
    import tempfile, os
    path = os.path.join(tempfile.mkdtemp(), "data.sqlite")
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE places (name TEXT, wkt TEXT)")
    con.execute("INSERT INTO places VALUES ('A', 'POINT (0 0)')")
    con.execute("CREATE TABLE nums (v INTEGER)")
    con.execute("INSERT INTO nums VALUES (7)")
    con.commit(); con.close()
    content = open(path, "rb").read()
    with pytest.raises(dl.NeedsChoice):
        dl.read_table(content, "data.sqlite")
    df, meta = dl.read_table(content, "data.sqlite", table="places")
    det = dl.detect_geometry(df)
    assert det == {"kind": "wkt", "column": "wkt"}


def test_zip_with_geojson_not_shapefile():
    import main
    main.vector_cache.clear(); main.datasets.clear()
    gj = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"n": 1},
         "geometry": {"type": "Point", "coordinates": [0, 0]}}]}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("inner/pts.geojson", json.dumps(gj))
    out = main.parse_zip_upload(buf.getvalue(), "bundle.zip")
    assert out["geo_meta"]["feature_count"] == 1


# ── GRIB2 ───────────────────────────────────────────────────────────────────

def test_grib2_roundtrip_via_eccodes():
    eccodes = pytest.importorskip("eccodes")
    pytest.importorskip("cfgrib")
    import tempfile, os
    sid = eccodes.codes_grib_new_from_samples("regular_ll_sfc_grib2")
    eccodes.codes_set(sid, "Ni", 4)
    eccodes.codes_set(sid, "Nj", 3)
    eccodes.codes_set(sid, "latitudeOfFirstGridPointInDegrees", 40.0)
    eccodes.codes_set(sid, "longitudeOfFirstGridPointInDegrees", 0.0)
    eccodes.codes_set(sid, "iDirectionIncrementInDegrees", 1.0)
    eccodes.codes_set(sid, "jDirectionIncrementInDegrees", 1.0)
    eccodes.codes_set_array(sid, "values", [float(i) for i in range(12)])
    path = os.path.join(tempfile.mkdtemp(), "t.grib2")
    with open(path, "wb") as f:
        eccodes.codes_write(sid, f)
    df, meta = dl.read_grib(open(path, "rb").read())
    assert len(df) == 12
    assert {"latitude", "longitude"} <= set(df.columns)
    assert meta["variable"]


# ── service URLs & remote raster ────────────────────────────────────────────

def test_service_url_builders():
    kind, url = dl.build_service_url(
        "https://example.com/geoserver/wfs?typeNames=ns:cities")
    assert kind == "wfs" and "GetFeature" in url
    with pytest.raises(dl.ParseFailure, match="layer"):
        dl.build_service_url("https://example.com/geoserver/wfs")
    kind, url = dl.build_service_url(
        "https://example.com/ogc/collections/cities")
    assert kind == "ogc-api" and url.endswith("/items?f=json&limit=10000")
    kind, url = dl.build_service_url(
        "https://example.com/arcgis/rest/services/X/FeatureServer/0")
    assert kind == "arcgis" and "/query?" in url and "f=geojson" in url
    assert dl.build_service_url("https://example.com/data.geojson") == (
        "file", "https://example.com/data.geojson")


def test_cog_opened_by_range_requests(tmp_path):
    """Serve a GeoTIFF over local HTTP with Range support and prove GDAL
    registers it via range requests. The server runs as a SUBPROCESS: an
    in-process http.server deadlocks against GDAL's threaded curl stack."""
    import subprocess
    import sys
    import time
    import urllib.request
    import rasterio
    from rasterio.transform import from_origin

    path = str(tmp_path / "cog.tif")
    arr = np.arange(100, dtype="float32").reshape(10, 10)
    with rasterio.open(path, "w", driver="GTiff", height=10, width=10, count=1,
                       dtype="float32", crs="EPSG:4326",
                       transform=from_origin(0, 10, 1, 1), tiled=True,
                       blockxsize=16, blockysize=16) as ds:
        ds.write(arr, 1)
    log = str(tmp_path / "server.log")
    server_src = (
        "import sys\n"
        "from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer\n"
        "data = open(sys.argv[1], 'rb').read()\n"
        "class H(BaseHTTPRequestHandler):\n"
        "    protocol_version = 'HTTP/1.1'\n"
        "    def do_HEAD(self):\n"
        "        self.send_response(200); self.send_header('Accept-Ranges', 'bytes')\n"
        "        self.send_header('Content-Length', str(len(data))); self.end_headers()\n"
        "    def do_GET(self):\n"
        "        rng = self.headers.get('Range')\n"
        "        with open(sys.argv[2], 'a') as f: f.write(str(rng) + '\\n')\n"
        "        if rng:\n"
        "            unit = rng.split('=')[1]; a, _, b = unit.partition('-')\n"
        "            a = int(a); b = int(b) if b else len(data) - 1\n"
        "            body = data[a:b + 1]\n"
        "            self.send_response(206)\n"
        "            self.send_header('Content-Range', f'bytes {a}-{b}/{len(data)}')\n"
        "        else:\n"
        "            body = data; self.send_response(200)\n"
        "        self.send_header('Accept-Ranges', 'bytes')\n"
        "        self.send_header('Content-Length', str(len(body)))\n"
        "        self.end_headers(); self.wfile.write(body)\n"
        "    def log_message(self, *a): pass\n"
        "ThreadingHTTPServer(('127.0.0.1', int(sys.argv[3])), H).serve_forever()\n")
    srv_py = str(tmp_path / "rangeserver.py")
    with open(srv_py, "w") as f:
        f.write(server_src)
    port = 8871
    srv = subprocess.Popen([sys.executable, srv_py, path, log, str(port)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/cog.tif",
                                       timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        meta = dl.open_remote_raster(f"http://127.0.0.1:{port}/cog.tif")
    finally:
        srv.terminate()
    assert meta["width"] == 10 and meta["height"] == 10
    assert meta["crs"] == "EPSG:4326"
    ranges = open(log).read()
    assert "bytes=" in ranges, f"expected range requests, server saw: {ranges!r}"


def test_friendly_error_has_actionable_hint():
    msg = dl.friendly_error("gpkg", ValueError("boom"))
    assert "What to try next" in msg and "boom" in msg


def test_upload_endpoint_gpkg_choice_flow():
    """End-to-end: multipart upload of a 2-layer GeoPackage returns the
    layer choice (nothing registered), then ?layer= registers it."""
    import tempfile, os
    from fastapi.testclient import TestClient
    import main
    path = os.path.join(tempfile.mkdtemp(), "two.gpkg")
    PTS.to_file(path, layer="points")
    POLY.to_file(path, layer="zones")
    content = open(path, "rb").read()
    client = TestClient(main.app)
    r = client.post("/api/datasets/upload",
                    files={"file": ("two.gpkg", content,
                                    "application/octet-stream")})
    assert r.status_code == 200 and r.json().get("needs_choice") is True
    assert set(r.json()["options"]) == {"points", "zones"}
    r = client.post("/api/datasets/upload?layer=zones",
                    files={"file": ("two.gpkg", content,
                                    "application/octet-stream")})
    body = r.json()
    assert r.status_code == 200 and body["geo_meta"]["feature_count"] == 1
    assert body["geo_meta"]["geometry_type"] == "Polygon"


def test_upload_endpoint_wkt_csv_becomes_spatial():
    from fastapi.testclient import TestClient
    import main
    client = TestClient(main.app)
    csv_bytes = b"name,wkt\nA,POINT (0 0)\nB,POINT (1 1)\n"
    r = client.post("/api/datasets/upload",
                    files={"file": ("pts.csv", csv_bytes, "text/csv")})
    body = r.json()
    assert r.status_code == 200 and "geometry_note" in body
    assert body["geo_meta"]["feature_count"] == 2
