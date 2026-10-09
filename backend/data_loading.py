"""
Cartolith — data loading: format sniffing, the vector/tabular parsers for
everything that is not a shapefile/raster/NetCDF/LiDAR, geometry-column
detection, OGC/ArcGIS service URLs, GRIB2, and plain-English errors.

Design rules (this is a teaching tool):
  * Never die with a raw stack trace — `friendly_error` turns parser
    failures into "what happened + what to try next".
  * Sniff content before trusting the extension — students rename files,
    download ".csv" that is really Excel, and get GeoPackages named .zip.
  * Multi-layer / multi-sheet / multi-table files are a *choice*, not an
    error: parsers raise NeedsChoice listing the options, and the API
    returns them so the UI can ask.
  * Guessed geometry (WKT column, lat/lon pair) always comes with a
    stated assumption (WGS84) the student can correct.

Nothing here registers datasets — main.py owns the stores; this module
returns (frame, meta) pairs so it stays unit-testable headless.
"""
from __future__ import annotations

import csv
import io
import json
import sqlite3
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional, Tuple


class NeedsChoice(Exception):
    """The file parsed, but holds several layers/sheets/tables and the
    caller did not pick one. `options` is what to show the user."""

    def __init__(self, kind: str, options: list):
        super().__init__(f"This file has several {kind}: {', '.join(map(str, options))}")
        self.kind = kind          # 'layer' | 'sheet' | 'table'
        self.options = options


class ParseFailure(Exception):
    """A parse failure whose message is already student-readable."""


# ── sniffing ────────────────────────────────────────────────────────────────

def sniff_format(content: bytes, filename: str = "") -> str:
    """Best-guess format key from magic bytes first, extension second."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    head = content[:8]
    if content[:15] == b"SQLite format 3":
        return "sqlite"          # GeoPackage and SpatiaLite are SQLite inside
    if content[:11] == b"<stata_dta":
        return "stata"           # Stata .dta, format 117+ (XML-style header)
    if head[:4] == b"GRIB":
        return "grib2"
    if head[:4] == b"LASF":
        return "las"
    if head[:3] == b"CDF" or head == b"\x89HDF\r\n\x1a\n":
        return "netcdf"          # classic NetCDF, or HDF5 (NetCDF4 / HDF5)
    if head[:4] in (b"II*\x00", b"MM\x00*"):
        return "geotiff"
    if head[:2] == b"PK":
        if ext == "kmz":
            return "kmz"
        if ext in ("xlsx",):
            return "xlsx"
        return "zip"
    if head[:4] == b"\xff\xd8\xff\xe0" or head[:4] == b"\x89PNG":
        return "image"
    if ext in ("gpkg", "kml", "gpx", "gml", "topojson", "fgb", "geojson",
               "geojsons", "jsonl", "sqlite", "db", "grib", "grib2", "grb2",
               "h5", "hdf5", "dta"):
        return {"h5": "netcdf", "hdf5": "netcdf", "grb2": "grib2",
                "grib": "grib2", "db": "sqlite", "dta": "stata"}.get(ext, ext)
    return ext or "unknown"


# ── vector ──────────────────────────────────────────────────────────────────

VECTOR_EXTS = ("gpkg", "kml", "kmz", "gpx", "gml", "topojson", "fgb",
               "geojson", "geojsons", "json", "shp")


def _tmp_with_suffix(content: bytes, suffix: str) -> str:
    fd, path = tempfile.mkstemp(suffix=suffix)
    with open(path, "wb") as f:
        f.write(content)
    return path


def list_vector_layers(path: str) -> list:
    import pyogrio
    try:
        return [name for name, _gt in pyogrio.list_layers(path)]
    except Exception:
        return []


def _read_kml_fallback(content: bytes, ext: str):
    """Dependency-free KML reader for the common Placemark geometries
    (Point / LineString / Polygon / Multi*). Exists because GDAL builds
    with the KML/LIBKML drivers disabled are common (the fiona wheel in
    this project's own CI venv has neither) — Google Earth files are too
    central to a geography classroom to hinge on a driver lottery.
    Returns (gdf, meta) like read_vector."""
    import xml.etree.ElementTree as ET
    import geopandas as gpd
    from shapely.geometry import (Point, LineString, Polygon, MultiPoint,
                                  MultiLineString, MultiPolygon)
    if ext == "kmz":
        import zipfile
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as z:
                names = [n for n in z.namelist() if n.lower().endswith(".kml")]
                if not names:
                    raise ParseFailure("This .kmz holds no .kml document inside it.")
                xml = z.read(names[0])
        except ParseFailure:
            raise
        except Exception as e:
            raise ParseFailure(friendly_error("kmz", e)) from e
    else:
        xml = content
    try:
        root = ET.fromstring(xml)
    except Exception as e:
        raise ParseFailure(f"Couldn't parse this KML as XML: {e}") from e

    def tag(el):
        return el.tag.rsplit("}", 1)[-1]

    def children(el, name):
        return [c for c in el if tag(c) == name]

    def child(el, name):
        for c in el:
            if tag(c) == name:
                return c
        return None

    def parse_coords(text):
        pts = []
        for tok in (text or "").split():
            parts = tok.split(",")
            try:
                pts.append((float(parts[0]), float(parts[1])))
            except Exception:
                continue
        return pts

    def ring(el):
        lr = child(el, "LinearRing")
        if lr is None:
            return []
        co = child(lr, "coordinates")
        return parse_coords(co.text if co is not None else "")

    def geom_of(el):
        t = tag(el)
        if t == "Point":
            co = child(el, "coordinates")
            pts = parse_coords(co.text if co is not None else "")
            return Point(pts[0]) if pts else None
        if t == "LineString":
            co = child(el, "coordinates")
            pts = parse_coords(co.text if co is not None else "")
            return LineString(pts) if len(pts) >= 2 else None
        if t == "Polygon":
            outer_el = child(el, "outerBoundaryIs")
            shell = ring(outer_el) if outer_el is not None else []
            if len(shell) < 4:
                return None
            holes = [ring(h) for h in children(el, "innerBoundaryIs")]
            holes = [h for h in holes if len(h) >= 4]
            return Polygon(shell, holes)
        if t in ("MultiGeometry", "MultiTrack", "MultiGeometryCollection"):
            parts = [g for g in (geom_of(c) for c in el) if g is not None]
            if not parts:
                return None
            kinds = {g.geom_type for g in parts}
            if kinds == {"Point"}:
                return MultiPoint(parts)
            if kinds <= {"LineString", "MultiLineString"}:
                lines = []
                for g in parts:
                    lines.extend(list(g.geoms) if g.geom_type == "MultiLineString" else [g])
                return MultiLineString(lines)
            if kinds <= {"Polygon", "MultiPolygon"}:
                polys = []
                for g in parts:
                    polys.extend(list(g.geoms) if g.geom_type == "MultiPolygon" else [g])
                return MultiPolygon(polys)
            from shapely.geometry import GeometryCollection
            return GeometryCollection(parts)
        return None

    rows = []
    for el in root.iter():
        if tag(el) != "Placemark":
            continue
        geom = None
        for c in el:
            geom = geom_of(c)
            if geom is not None:
                break
        if geom is None:
            continue
        name_el = child(el, "name")
        desc_el = child(el, "description")
        row = {"name": name_el.text.strip() if name_el is not None and name_el.text else "",
               "description": desc_el.text.strip() if desc_el is not None and desc_el.text else ""}
        ext_el = child(el, "ExtendedData")
        if ext_el is not None:
            for d in ext_el.iter():
                if tag(d) == "Data" and d.get("name"):
                    v = child(d, "value")
                    row[d.get("name")] = v.text if v is not None else None
        row["geometry"] = geom
        rows.append(row)
    if not rows:
        raise ParseFailure(
            "No Placemark geometries (Point / LineString / Polygon) were "
            "found in this KML. Ground overlays and network links are not "
            "vector layers — export the placemarks from Google Earth and "
            "try again.")
    gdf = gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")
    meta = {"format": ext, "layers": [], "crs_assumed_wgs84": False,
            "geometry_type": str(gdf.geometry.geom_type.value_counts().idxmax()),
            "reader": "builtin-kml-fallback"}
    return gdf, meta


def read_vector(content: bytes, filename: str, layer: Optional[str] = None):
    """Parse any GDAL-readable vector file. Returns (gdf, meta).

    Raises NeedsChoice when the file holds several layers and none was
    picked, ParseFailure with a friendly message otherwise.
    """
    import geopandas as gpd
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "geojson"
    path = _tmp_with_suffix(content, f".{ext}")
    try:
        layers = list_vector_layers(path)
        if len(layers) > 1 and layer is None:
            raise NeedsChoice("layer", layers)
        gdf = gpd.read_file(path, layer=layer) if layer else gpd.read_file(path)
    except NeedsChoice:
        raise
    except Exception as e:
        if ext in ("kml", "kmz"):
            try:
                return _read_kml_fallback(content, ext)
            except ParseFailure:
                raise
            except Exception:
                pass
        raise ParseFailure(friendly_error(ext, e)) from e
    finally:
        Path(path).unlink(missing_ok=True)
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")  # most of these formats are WGS84-native
        assumed = True
    else:
        assumed = False
    meta = {"format": ext, "layers": layers, "crs_assumed_wgs84": assumed,
            "geometry_type": (str(gdf.geometry.geom_type.value_counts().idxmax())
                              if len(gdf) else "Empty")}
    return gdf, meta


# ── tabular ─────────────────────────────────────────────────────────────────

def _read_csv_bytes(content: bytes, sep_hint: Optional[str] = None):
    import pandas as pd
    text = None
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            text = content.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise ParseFailure("Could not decode this text file in UTF-8 or Latin-1. "
                           "Re-save it as UTF-8 and try again.")
    sep = sep_hint
    if sep is None:
        try:
            sep = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|").delimiter
        except Exception:
            sep = ","
    return pd.read_csv(io.StringIO(text), sep=sep)


def read_table(content: bytes, filename: str, sheet: Optional[str] = None,
               table: Optional[str] = None):
    """Parse CSV/TSV/JSON/Excel/SQLite into a DataFrame. Returns (df, meta)."""
    import pandas as pd
    fmt = sniff_format(content, filename)
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else fmt

    if fmt in ("sqlite",):
        return _read_sqlite(content, table)
    if ext in ("xlsx", "xls") or fmt == "xlsx":
        try:
            sheets = pd.ExcelFile(io.BytesIO(content)).sheet_names
        except Exception as e:
            raise ParseFailure(friendly_error("xlsx", e)) from e
        if len(sheets) > 1 and sheet is None:
            raise NeedsChoice("sheet", sheets)
        df = pd.read_excel(io.BytesIO(content), sheet_name=sheet or sheets[0])
        return df, {"format": "xlsx", "sheets": sheets, "sheet": sheet or sheets[0]}
    if ext in ("jsonl", "ndjson", "geojsons"):
        text = content.decode("utf-8", errors="replace")
        if ext == "geojsons" or text.lstrip().startswith('{"type": "Feature"') \
                or text.lstrip().startswith('{"type":"Feature"'):
            return read_vector(content, filename.rsplit(".", 1)[0] + ".geojsons")
        rows = [json.loads(l) for l in text.splitlines() if l.strip()]
        return pd.DataFrame(rows), {"format": "jsonl"}
    if ext == "json" or fmt == "json":
        data = json.loads(content)
        if isinstance(data, list):
            return pd.DataFrame(data), {"format": "json"}
        return pd.json_normalize(data), {"format": "json"}
    if ext == "dta" or fmt == "stata":
        # Stata .dta (ACS/Census extracts are commonly shipped this way).
        # pandas reads every Stata format version; no extra dependency.
        # Value labels come through as the values themselves, variable
        # labels are dropped — the columns keep their Stata names.
        try:
            df = pd.read_stata(io.BytesIO(content))
        except Exception as e:
            raise ParseFailure(friendly_error("stata", e)) from e
        return df, {"format": "stata"}
    # csv / tsv / txt / dat / unknown text
    sep = "\t" if ext == "tsv" else None
    try:
        df = _read_csv_bytes(content, sep_hint=sep)
    except ParseFailure:
        raise
    except Exception as e:
        raise ParseFailure(friendly_error("csv", e)) from e
    return df, {"format": "csv"}


def _read_sqlite(content: bytes, table: Optional[str] = None):
    import pandas as pd
    path = _tmp_with_suffix(content, ".sqlite")
    try:
        con = sqlite3.connect(path)
        tables = [r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'gpkg_%' "
            "AND name NOT LIKE 'rtree_%'").fetchall()]
        if not tables:
            raise ParseFailure("This SQLite file has no data tables. If it is a "
                               "GeoPackage, its layers load as vector data instead.")
        if len(tables) > 1 and table is None:
            raise NeedsChoice("table", tables)
        use = table or tables[0]
        df = pd.read_sql_query(f'SELECT * FROM "{use}"', con)
        con.close()
    finally:
        Path(path).unlink(missing_ok=True)
    return df, {"format": "sqlite", "tables": tables, "table": use}


# ── geometry detection in plain tables ──────────────────────────────────────

_LAT_NAMES = ("lat", "latitude", "y", "lat_dd", "dec_lat", "point_lat")
_LON_NAMES = ("lon", "lng", "long", "longitude", "x", "lon_dd", "dec_lon",
              "point_lon", "long_dd")
_WKT_NAMES = ("wkt", "geometry", "geom", "the_geom", "shape", "well_known_text")
_WKB_NAMES = ("wkb", "geometry_wkb", "geom_wkb")
_WKT_PREFIXES = ("POINT", "LINESTRING", "POLYGON", "MULTIPOINT",
                 "MULTILINESTRING", "MULTIPOLYGON", "GEOMETRYCOLLECTION")


def _col(df, candidates) -> Optional[str]:
    low = {str(c).strip().lower(): c for c in df.columns}
    for cand in candidates:
        if cand in low:
            return low[cand]
    return None


def detect_geometry(df) -> Optional[Dict[str, Any]]:
    """Find geometry hiding in a plain table: a WKT/WKB column, or a
    lat/lon pair with plausible ranges. Returns None if unsure — a wrong
    guess is worse than asking."""
    wkt = _col(df, _WKT_NAMES)
    if wkt is not None:
        sample = df[wkt].dropna().astype(str).head(20)
        hits = sum(s.strip().upper().startswith(_WKT_PREFIXES) for s in sample)
        if len(sample) and hits / len(sample) >= 0.8:
            return {"kind": "wkt", "column": wkt}
    wkb = _col(df, _WKB_NAMES)
    if wkb is not None and len(df):
        return {"kind": "wkb", "column": wkb}
    lat, lon = _col(df, _LAT_NAMES), _col(df, _LON_NAMES)
    if lat is not None and lon is not None and lat != lon:
        import pandas as pd
        la = pd.to_numeric(df[lat], errors="coerce")
        lo = pd.to_numeric(df[lon], errors="coerce")
        ok = la.notna() & lo.notna()
        if ok.mean() > 0.8 and la[ok].between(-90, 90).mean() > 0.95:
            if lo[ok].between(-180, 180).mean() > 0.95:
                return {"kind": "latlon", "lat": lat, "lon": lon}
            # Global weather grids (GRIB/NetCDF straight from cfgrib/xarray)
            # conventionally use 0..360 longitudes — accept and wrap.
            if lo[ok].between(0, 360).mean() > 0.95:
                return {"kind": "latlon", "lat": lat, "lon": lon,
                        "wrap_lon": True}
    return None


def apply_geometry(df, det: Dict[str, Any]):
    """Build a GeoDataFrame from a detected geometry description.
    Returns (gdf, assumption_note)."""
    import geopandas as gpd
    if det["kind"] == "latlon":
        import pandas as pd
        sub = df.dropna(subset=[det["lat"], det["lon"]]).copy()
        lonv = pd.to_numeric(sub[det["lon"]], errors="coerce")
        latv = pd.to_numeric(sub[det["lat"]], errors="coerce")
        wrapped = ""
        if det.get("wrap_lon"):
            lonv = lonv.where(lonv <= 180, lonv - 360)
            sub[det["lon"]] = lonv
            wrapped = (" Longitudes arrived in the 0–360 convention and "
                       "were wrapped to −180…180.")
        gdf = gpd.GeoDataFrame(
            sub, geometry=gpd.points_from_xy(lonv, latv),
            crs="EPSG:4326")
        return gdf, (f"Made points from '{det['lon']}' / '{det['lat']}' and assumed "
                     "WGS84 (EPSG:4326). If your coordinates use another CRS, "
                     "reproject before measuring distances." + wrapped)
    if det["kind"] == "wkt":
        from shapely import wkt as shapely_wkt
        geoms = df[det["column"]].apply(
            lambda v: shapely_wkt.loads(v) if isinstance(v, str) and v.strip() else None)
        gdf = gpd.GeoDataFrame(df.drop(columns=[det["column"]]), geometry=geoms,
                               crs="EPSG:4326")
        return gdf, (f"Parsed geometry from the '{det['column']}' WKT column and "
                     "assumed WGS84 (EPSG:4326) — WKT text itself carries no CRS.")
    if det["kind"] == "wkb":
        from shapely import wkb as shapely_wkb
        def _load(v):
            try:
                if isinstance(v, (bytes, bytearray)):
                    return shapely_wkb.loads(bytes(v))
                if isinstance(v, str):
                    return shapely_wkb.loads(bytes.fromhex(v))
            except Exception:
                return None
            return None
        geoms = df[det["column"]].apply(_load)
        if geoms.notna().mean() < 0.5:
            raise ParseFailure(
                f"The '{det['column']}' column looks like WKB but most values did "
                "not parse as plain WKB — SpatiaLite stores geometry in its own "
                "envelope format. Export the layer from the .gpkg/.sqlite in QGIS, "
                "or add a WKT column, and load that instead.")
        gdf = gpd.GeoDataFrame(df.drop(columns=[det["column"]]), geometry=geoms,
                               crs="EPSG:4326")
        return gdf, f"Parsed geometry from the '{det['column']}' WKB column (assumed WGS84)."
    raise ParseFailure(f"Unknown geometry kind {det['kind']!r}.")


# ── GRIB2 (climate) ─────────────────────────────────────────────────────────

def read_grib(content: bytes):
    """Parse a GRIB2 file via cfgrib/xarray into a tidy table:
    one row per grid cell, columns latitude/longitude/<variable>.
    Returns (df, meta)."""
    try:
        import cfgrib  # noqa: F401
        import xarray as xr
    except Exception as e:
        raise ParseFailure(
            "GRIB2 needs the cfgrib + ecCodes engine, which is not installed "
            f"in this build ({e}). Install with: pip install cfgrib eccodes — "
            "or convert the file to NetCDF with `cdo -f nc copy in.grib2 out.nc` "
            "or `wgrib2 in.grib2 -netcdf out.nc` and load that instead.") from e
    path = _tmp_with_suffix(content, ".grib2")
    try:
        ds = xr.open_dataset(path, engine="cfgrib")
        var = list(ds.data_vars)[0]
        df = ds[var].to_dataframe().reset_index()
        meta = {"format": "grib2", "variable": var,
                "variables": list(ds.data_vars),
                "long_name": str(ds[var].attrs.get("long_name", ""))}
        ds.close()
    except Exception as e:
        raise ParseFailure(friendly_error("grib2", e)) from e
    finally:
        Path(path).unlink(missing_ok=True)
        Path(path + ".idx").unlink(missing_ok=True)
    return df, meta


# ── web services & remote rasters ───────────────────────────────────────────

def build_service_url(url: str) -> Tuple[str, str]:
    """Classify a data-service URL and return (kind, fetch_url):
      'wfs'     — OGC WFS: ensure a GetFeature GeoJSON request
      'ogc-api' — OGC API Features: ensure /items with f=json
      'arcgis'  — ArcGIS REST feature layer: ensure /query?...&f=geojson
      'file'    — anything else, fetched as-is
    """
    low = url.lower()
    if "service=wfs" in low or "/wfs" in low or "request=getfeature" in low:
        if "request=getfeature" in low:
            return "wfs", url
        sep = "&" if "?" in url else "?"
        if "typename" not in low and "typenames" not in low:
            raise ParseFailure(
                "That looks like a WFS service address, but WFS needs a layer "
                "name. Add it to the URL, e.g. '&typeNames=namespace:layer' "
                "(the service's GetCapabilities document lists the names), "
                "then load the full GetFeature URL.")
        return "wfs", (f"{url}{sep}service=WFS&version=2.0.0&request=GetFeature"
                       "&outputFormat=application/json")
    if "/collections/" in low:
        base = url.split("?")[0]
        if not base.rstrip("/").endswith("/items"):
            base = base.rstrip("/") + "/items"
        return "ogc-api", f"{base}?f=json&limit=10000"
    if "/rest/services/" in low:
        base = url.split("?")[0].rstrip("/")
        if not base.endswith("/query"):
            base += "/query"
        return "arcgis", (f"{base}?where=1%3D1&outFields=*"
                          "&returnGeometry=true&f=geojson")
    return "file", url


def open_remote_raster(url: str) -> Dict[str, Any]:
    """Open a remote (Cloud-Optimized) GeoTIFF by URL. rasterio/GDAL reads
    only the byte ranges it needs (header + requested windows) when the
    server supports HTTP range requests — the file is never downloaded
    whole just to register it."""
    import rasterio
    with rasterio.open(url) as src:
        return {"format": "cog", "width": src.width, "height": src.height,
                "count": src.count, "crs": str(src.crs) if src.crs else None,
                "bounds": list(src.bounds), "res": list(src.res),
                "is_cog_layout": bool(src.profile.get("tiled"))}


# ── friendly errors ─────────────────────────────────────────────────────────

_HINTS = {
    "gpkg": "A GeoPackage is a SQLite database of layers. If it will not open, "
            "check it is a real .gpkg (not a .zip renamed). Layer choice: pass "
            "?layer=<name>.",
    "kml": "KML is the Google Earth format. If this came from Google Earth, "
           "a .kmz is a zipped KML — load the .kmz directly, no need to unzip.",
    "gpx": "GPX files hold waypoints, tracks and routes as separate layers — "
           "choose one with ?layer=waypoints (or tracks / track_points).",
    "csv": "Could not read this as a table. Check the delimiter (commas vs "
           "semicolons vs tabs), that the first row is the header, and that "
           "the file is not actually an Excel file renamed to .csv.",
    "xlsx": "Could not read this workbook. If it has several sheets, pick one "
            "with ?sheet=<name>. Very old .xls files may need re-saving as .xlsx.",
    "grib2": "GRIB2 is a weather/climate format. If the values look wrong, the "
             "file may hold several variables or steps — this loader takes the "
             "first variable; slice it with xarray/cfgrib for full control.",
    "zip": "This zip did not contain a recognised dataset. Supported inside "
           "a zip: shapefile bundles, GeoJSON, GeoPackage, KML, GML, "
           "FlatGeobuf, NetCDF, GeoTIFF, LAS/LAZ, CSV.",
    "sqlite": "SQLite/GeoPackage databases load layer-by-layer; pick one with "
              "?layer=<name> for vector layers or ?table=<name> for tables.",
    "stata": "This is a Stata .dta file. If it will not read, it may be "
             "corrupt or from a very old Stata version — re-export it from "
             "Stata (or save as CSV) and try again.",
}


def friendly_error(fmt: str, exc: Exception) -> str:
    hint = _HINTS.get(fmt, "Check the file is complete and really is the "
                           "format its name claims.")
    first = str(exc).split("\n")[0][:200]
    return (f"Couldn't load this as {fmt}: {first}\nWhat to try next: {hint}")
