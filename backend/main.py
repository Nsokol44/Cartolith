"""
Cartolith — Python Backend v5.0
"""
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import pandas as pd
import numpy as np
import json, io, os, tempfile, traceback, base64, zipfile, struct
import datetime as dt
from pathlib import Path

try:
    from scipy import stats as scipy_stats; HAS_SCIPY = True
except ImportError: HAS_SCIPY = False

try:
    import statsmodels.api as sm
    from statsmodels.stats.diagnostic import het_breuschpagan
    from statsmodels.stats.stattools import durbin_watson
    HAS_STATSMODELS = True
except ImportError: HAS_STATSMODELS = False

try:
    import geopandas as gpd; HAS_GEOPANDAS = True
except ImportError: HAS_GEOPANDAS = False

try:
    import rasterio
    from rasterio.enums import Resampling
    HAS_RASTERIO = True
except ImportError: HAS_RASTERIO = False

try:
    import xarray as xr; HAS_XARRAY = True
except ImportError: HAS_XARRAY = False

try:
    import netCDF4 as nc4; HAS_NETCDF = True
except ImportError: HAS_NETCDF = False

try:
    import laspy; HAS_LASPY = True
except ImportError: HAS_LASPY = False

try:
    from PIL import Image; HAS_PIL = True
except ImportError: HAS_PIL = False

try:
    from sklearn.preprocessing import StandardScaler
    from sklearn.decomposition import PCA
    from sklearn.cluster import KMeans
    HAS_SKLEARN = True
except ImportError: HAS_SKLEARN = False

try:
    import matplotlib; matplotlib.use("Agg")
    import matplotlib.cm as cm
    from matplotlib.colors import Normalize
    HAS_MPL = True
except ImportError: HAS_MPL = False

try:
    import duckdb; HAS_DUCKDB = True
except ImportError: HAS_DUCKDB = False

app = FastAPI(title="Cartolith API", version="5.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

try:
    import starlette.formparsers as _fp
    if hasattr(_fp, "MultiPartParser"):
        _fp.MultiPartParser.max_file_size = 10 * 1024 * 1024 * 1024
except Exception: pass

datasets: Dict[str, pd.DataFrame] = {}
vector_cache: Dict[str, Any] = {}   # dataset_id -> full-fidelity GeoDataFrame (for geoprocessing)
raster_cache: Dict[str, str] = {}
netcdf_cache: Dict[str, str] = {}
lidar_cache: Dict[str, str] = {}
tmp_files: List[str] = []

def safe_float(v):
    if v is None: return None
    try:
        f = float(v)
        return None if (np.isnan(f) or np.isinf(f)) else f
    except: return None

def df_to_json(df, max_rows=500):
    s = df.head(max_rows).replace([np.nan, np.inf, -np.inf], None)
    return {"columns": list(df.columns), "rows": s.to_dict(orient="records"),
            "total_rows": len(df), "dtypes": {c: str(df[c].dtype) for c in df.columns}}

def infer_types(df):
    t = {}
    for c in df.columns:
        if pd.api.types.is_numeric_dtype(df[c]): t[c] = "numeric"
        elif pd.api.types.is_datetime64_any_dtype(df[c]): t[c] = "datetime"
        else: t[c] = "categorical"
    return t

def write_tmp(content, suffix):
    fd, path = tempfile.mkstemp(suffix=suffix)
    with os.fdopen(fd, "wb") as f: f.write(content)
    tmp_files.append(path)
    return path

def array_stats(arr):
    flat = arr.astype(np.float64).flatten()
    flat = flat[np.isfinite(flat)]
    if len(flat) == 0: return {"count": 0}
    return {"min": safe_float(float(np.min(flat))), "max": safe_float(float(np.max(flat))),
            "mean": safe_float(float(np.mean(flat))), "std": safe_float(float(np.std(flat))),
            "median": safe_float(float(np.median(flat))), "count": int(len(flat)),
            "nodata_count": int(arr.size - len(flat))}

def ndarray_to_png_b64(arr, colormap="viridis"):
    if not HAS_MPL or not HAS_PIL: return ""
    try:
        valid = arr[np.isfinite(arr)]
        if len(valid) == 0: return ""
        vmin, vmax = float(valid.min()), float(valid.max())
        if vmin == vmax: vmax = vmin + 1
        norm = Normalize(vmin=vmin, vmax=vmax)
        cmap_fn = cm.get_cmap(colormap)
        rgba = cmap_fn(norm(np.where(np.isfinite(arr), arr, np.nan)))
        rgba[~np.isfinite(arr)] = [0, 0, 0, 0]
        img = Image.fromarray((rgba * 255).astype(np.uint8), mode="RGBA")
        buf = io.BytesIO(); img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()
    except: return ""

def raster_band_thumb(src, band_idx=1, max_dim=512, colormap="viridis"):
    try:
        h, w = src.height, src.width
        scale = min(max_dim / max(h, w, 1), 1.0)
        out_h, out_w = max(1, int(h*scale)), max(1, int(w*scale))
        data = src.read(band_idx, out_shape=(out_h, out_w), resampling=Resampling.average).astype(np.float32)
        if src.nodata is not None: data[data == src.nodata] = np.nan
        return ndarray_to_png_b64(data, colormap)
    except: return ""

def rgb_raster_thumb(src, max_dim=512):
    if not HAS_PIL: return ""
    try:
        h, w = src.height, src.width
        scale = min(max_dim / max(h, w, 1), 1.0)
        out_h, out_w = max(1, int(h*scale)), max(1, int(w*scale))
        n = min(src.count, 3)
        bands = src.read(list(range(1, n+1)), out_shape=(n, out_h, out_w), resampling=Resampling.average)
        rgb = np.zeros((out_h, out_w, 3), dtype=np.uint8)
        for i in range(n):
            b = bands[i].astype(np.float32)
            if src.nodata is not None: b[b == src.nodata] = np.nan
            lo, hi = np.nanpercentile(b, 2), np.nanpercentile(b, 98)
            if hi > lo: b = np.clip((b - lo) / (hi - lo) * 255, 0, 255)
            b[~np.isfinite(b)] = 0; rgb[:, :, i] = b.astype(np.uint8)
        img = Image.fromarray(rgb, "RGB"); buf = io.BytesIO(); img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()
    except: return ""

def crs_to_str(crs):
    try: return str(crs) if crs else "Unknown"
    except: return "Unknown"

def _detect_coord(ds, candidates, exclude=None):
    exclude = exclude or []
    names = list(ds.coords) + list(ds.dims)
    for cand in candidates:
        for c in names:
            if c.lower() == cand.lower() and c not in exclude: return c
    for cand in candidates:
        for c in names:
            if c.lower().startswith(cand.lower()) and c not in exclude: return c
    return None

def _decode_time_labels(ds, time_c):
    try:
        times = ds[time_c].values
        if np.issubdtype(times.dtype, np.datetime64):
            return [str(t)[:16] for t in times]
        try:
            import cftime
            units = ds[time_c].attrs.get("units", "days since 1900-01-01")
            cal = ds[time_c].attrs.get("calendar", "standard")
            decoded = cftime.num2date(times, units=units, calendar=cal)
            return [str(d)[:16] for d in decoded]
        except: return [f"t={v:.3g}" for v in times]
    except: return [f"step {i}" for i in range(len(ds[time_c]))]

# ── Parsers ─────────────────────────────────────────────────────────────────

def _gdf_to_result(gdf, fname):
    geom_type = "Unknown"
    try: geom_type = gdf.geometry.geom_type.value_counts().idxmax()
    except: pass
    crs_str = crs_to_str(gdf.crs)
    bounds = gdf.total_bounds.tolist() if not gdf.empty else []
    df = pd.DataFrame(gdf.drop(columns=["geometry"], errors="ignore"))
    try:
        if "Point" in geom_type:
            df["_longitude"] = gdf.geometry.x.values
            df["_latitude"] = gdf.geometry.y.values
        centroids = gdf.geometry.centroid
        df["_centroid_lon"] = centroids.x.values
        df["_centroid_lat"] = centroids.y.values
        df["_geom_area"] = gdf.geometry.area.values
        df["_geom_length"] = gdf.geometry.length.values
        df["_geom_type"] = gdf.geometry.geom_type.values
        df["_geom_wkt"] = gdf.geometry.apply(lambda g: g.wkt[:200] if g else None)
    except: pass
    datasets[fname] = df
    try: vector_cache[fname] = gdf   # keep full geometry for the Geoprocess toolbox
    except: pass
    return {"id": fname, "name": fname, "format": "shapefile",
            "shape": list(df.shape), "columns": list(df.columns),
            "types": infer_types(df), "preview": df_to_json(df),
            "missing": {c: int(df[c].isna().sum()) for c in df.columns},
            "geo_meta": {"geometry_type": geom_type, "crs": crs_str, "bounds": bounds, "feature_count": len(gdf)}}

def parse_shapefile_upload(content, fname):
    if not HAS_GEOPANDAS: raise ValueError("geopandas not installed")
    if content[:2] == b'PK':
        with tempfile.TemporaryDirectory() as tmpdir:
            zpath = os.path.join(tmpdir, "upload.zip")
            with open(zpath, "wb") as f: f.write(content)
            with zipfile.ZipFile(zpath) as z: z.extractall(tmpdir)
            shps = list(Path(tmpdir).rglob("*.shp"))
            if not shps: raise ValueError("No .shp found in zip")
            gdf = gpd.read_file(str(shps[0]))
        return _gdf_to_result(gdf, fname)
    else:
        with tempfile.TemporaryDirectory() as tmpdir:
            shp_path = os.path.join(tmpdir, "data.shp")
            with open(shp_path, "wb") as f: f.write(content)
            os.environ.setdefault("SHAPE_RESTORE_SHX", "YES")
            try: gdf = gpd.read_file(shp_path)
            except:
                import fiona
                with fiona.Env(SHAPE_RESTORE_SHX="YES"): gdf = gpd.read_file(shp_path)
            return _gdf_to_result(gdf, fname)

def _parse_dbf_manual(content):
    if len(content) < 32: raise ValueError("DBF too small")
    num_records = struct.unpack_from("<I", content, 4)[0]
    header_size = struct.unpack_from("<H", content, 8)[0]
    record_size = struct.unpack_from("<H", content, 10)[0]
    fields = []
    offset = 32
    while offset < header_size - 1:
        if content[offset] == 0x0D: break
        name = content[offset:offset+11].split(b"\x00")[0].decode("latin-1").strip()
        ftype = chr(content[offset+11]); length = content[offset+16]
        fields.append((name, ftype, length)); offset += 32
    records = []
    for i in range(min(num_records, 100_000)):
        pos = header_size + i * record_size
        if pos + record_size > len(content): break
        if content[pos] == 0x2A: continue
        row = {}; foff = 1
        for name, ftype, length in fields:
            raw = content[pos+foff:pos+foff+length].decode("latin-1").strip()
            if ftype in ("N", "F"):
                try: row[name] = float(raw) if "." in raw else int(raw)
                except: row[name] = None
            elif ftype == "L": row[name] = raw.upper() in ("T", "Y")
            else: row[name] = raw
            foff += length
        records.append(row)
    return pd.DataFrame(records)

def parse_dbf(content, fname):
    if HAS_GEOPANDAS:
        try:
            path = write_tmp(content, ".dbf"); gdf = gpd.read_file(path)
            df = pd.DataFrame(gdf.drop(columns=["geometry"], errors="ignore"))
        except: df = _parse_dbf_manual(content)
    else: df = _parse_dbf_manual(content)
    datasets[fname] = df
    return {"id": fname, "name": fname, "format": "dbf",
            "shape": list(df.shape), "columns": list(df.columns),
            "types": infer_types(df), "preview": df_to_json(df),
            "missing": {c: int(df[c].isna().sum()) for c in df.columns}}

def _is_grid_mapping_var(var) -> bool:
    """True if this variable is a CF grid_mapping container (scalar, non-spatial)."""
    if var.ndim == 0: return True
    gm = var.attrs.get("grid_mapping_name", "")
    return bool(gm)  # has grid_mapping_name → it's a CRS container


def _open_netcdf_safe(path):
    """Open NetCDF with xarray, falling back to decode_times=False for tricky calendars."""
    try:
        return xr.open_dataset(path, engine="netcdf4", mask_and_scale=True)
    except Exception:
        try:
            return xr.open_dataset(path, engine="netcdf4", mask_and_scale=True, decode_times=False)
        except Exception:
            return xr.open_dataset(path, engine="netcdf4", decode_times=False, decode_cf=False)


def parse_netcdf(content, fname):
    path = write_tmp(content, ".nc"); netcdf_cache[fname] = path
    meta = {"variables": {}, "dimensions": {}, "global_attrs": {}, "time_info": None}
    df = pd.DataFrame()
    if not (HAS_XARRAY or HAS_NETCDF): raise ValueError("Install xarray and netCDF4")
    if HAS_XARRAY:
        ds = _open_netcdf_safe(path)
        meta["dimensions"] = dict(ds.sizes)
        meta["global_attrs"] = {k: str(v) for k, v in list(ds.attrs.items())[:20]}
        lat_c = _detect_coord(ds, ["lat","latitude","LAT","LATITUDE","nav_lat"])
        lon_c = _detect_coord(ds, ["lon","longitude","LON","LONGITUDE","nav_lon"], exclude=[lat_c] if lat_c else [])
        time_c = _detect_coord(ds, ["time","TIME","Time","t","T","date","DATE"])
        lev_c = _detect_coord(ds, ["level","lev","pressure","plev","depth","height","z","Z"],
                              exclude=[c for c in [lat_c,lon_c,time_c] if c])
        for name, lo, hi in [(lat_c,-90,90),(lon_c,-180,360)]:
            if name:
                try:
                    v = ds[name].values.flatten()
                    if not (float(np.nanmin(v)) >= lo and float(np.nanmax(v)) <= hi):
                        if name == lat_c: lat_c = None
                        else: lon_c = None
                except: pass
        if time_c and time_c in ds:
            try:
                n_times = int(ds.sizes.get(time_c, len(ds[time_c])))
                meta["time_info"] = {"coord": time_c, "n_steps": n_times,
                                     "labels": _decode_time_labels(ds, time_c),
                                     "units": ds[time_c].attrs.get("units","")}
            except Exception as e: meta["time_info"] = {"error": str(e)}

        # Filter out grid-mapping (CRS container) variables — they're not data
        real_data_vars = {k: v for k, v in ds.data_vars.items()
                         if not _is_grid_mapping_var(v) and v.dtype.kind in ('f','i','u')}

        for vname, var in real_data_vars.items():
            vstats = {}
            try:
                sel = {}
                if time_c and time_c in var.dims: sel[time_c] = 0
                if lev_c and lev_c in var.dims: sel[lev_c] = 0
                farr = var.isel(sel).values.astype(np.float64)
                fv = var.attrs.get("_FillValue") or var.attrs.get("missing_value")
                if fv: farr[farr == float(fv)] = np.nan
                vstats = array_stats(farr)
            except: pass
            meta["variables"][vname] = {
                "dims": list(var.dims), "shape": list(var.shape),
                "dtype": str(var.dtype), "units": var.attrs.get("units",""),
                "long_name": var.attrs.get("long_name", vname), "stats": vstats,
                "has_time": bool(time_c and time_c in var.dims),
                "has_lat": bool(lat_c and lat_c in var.dims),
                "has_lon": bool(lon_c and lon_c in var.dims)}

        max_pts = 5000; rows = {}
        if lat_c and lon_c:
            lat_arr = ds[lat_c].values; lon_arr = ds[lon_c].values
            if lat_arr.ndim == 1 and lon_arr.ndim == 1:
                lon_grid, lat_grid = np.meshgrid(lon_arr, lat_arr)
            elif lat_arr.ndim == 2: lat_grid, lon_grid = lat_arr, lon_arr
            else: lat_grid = lat_arr.flatten(); lon_grid = lon_arr.flatten()
            lon_grid = np.where(lon_grid > 180, lon_grid - 360, lon_grid)
            flat_lat = lat_grid.flatten(); flat_lon = lon_grid.flatten()
            if len(flat_lat) > max_pts:
                stride = max(1, len(flat_lat)//max_pts); flat_lat = flat_lat[::stride]; flat_lon = flat_lon[::stride]
            rows["_latitude"] = flat_lat; rows["_longitude"] = flat_lon; n = len(flat_lat)
            for vname in list(real_data_vars.keys())[:8]:
                var = ds[vname]
                try:
                    arr = var
                    if time_c and time_c in var.dims: arr = arr.isel({time_c: 0})
                    if lev_c and lev_c in arr.dims: arr = arr.isel({lev_c: 0})
                    a = arr.values.astype(np.float64)
                    fv = var.attrs.get("_FillValue") or var.attrs.get("missing_value")
                    if fv: a[a == float(fv)] = np.nan
                    flat = a.flatten()
                    if len(flat) > max_pts: flat = flat[::max(1, len(flat)//max_pts)]
                    rows[vname] = flat[:n]
                except: pass
        else:
            for vname in list(real_data_vars.keys())[:12]:
                var = ds[vname]
                try: rows[vname] = var.values.flatten()[:5000]
                except: pass

        max_len = max((len(v) for v in rows.values()), default=0)
        if max_len > 0: df = pd.DataFrame({k: pd.Series(list(v)[:max_len]) for k,v in rows.items()})
        ds.close()
    elif HAS_NETCDF:
        with nc4.Dataset(path) as ds:
            meta["dimensions"] = {k: len(v) for k,v in ds.dimensions.items()}
            rows = {}
            for vname in list(ds.variables.keys())[:10]:
                try:
                    arr = np.array(ds.variables[vname][:]).flatten()[:5000]
                    rows[vname] = arr
                    meta["variables"][vname] = {"dims": list(ds.variables[vname].dimensions),
                        "shape": list(ds.variables[vname].shape), "dtype": str(ds.variables[vname].dtype),
                        "units": getattr(ds.variables[vname],"units","")}
                except: pass
            df = pd.DataFrame(rows)
    datasets[fname] = df
    return {"id": fname, "name": fname, "format": "netcdf",
            "shape": list(df.shape), "columns": list(df.columns),
            "types": infer_types(df), "preview": df_to_json(df),
            "missing": {c: int(df[c].isna().sum()) for c in df.columns},
            "netcdf_meta": meta}

def parse_raster(content, fname, ext):
    if not HAS_RASTERIO: raise ValueError("rasterio not installed")
    path = write_tmp(content, f".{ext}"); raster_cache[fname] = path
    with rasterio.open(path) as src:
        band_count = src.count; h, w = src.height, src.width
        crs_str = crs_to_str(src.crs); bounds = list(src.bounds)
        nodata = src.nodata; driver = src.driver; dtypes = list(src.dtypes)
        res = list(src.res); tags = dict(src.tags())
        is_rgb = band_count in (3,4) and all(d=="uint8" for d in dtypes)
        is_dem = band_count == 1 and ext.lower() in ("dem","asc","hgt")
        band_stats = []; thumbnails = []
        if is_rgb:
            thumb = rgb_raster_thumb(src)
            if thumb: thumbnails.append({"band": "RGB", "thumbnail": thumb})
        else:
            for b in range(1, min(band_count+1, 9)):
                data = src.read(b).astype(np.float32)
                if nodata is not None: data[data==nodata] = np.nan
                bstats = array_stats(data)
                bname = (src.descriptions[b-1] or f"Band {b}") if src.descriptions else f"Band {b}"
                band_stats.append({"band": b, "name": bname, "dtype": dtypes[b-1], **bstats})
                if b <= 6:
                    cmap = "terrain" if is_dem else ("gray" if band_count==1 else "viridis")
                    thumb = raster_band_thumb(src, b, colormap=cmap)
                    if thumb: thumbnails.append({"band": b, "name": bname, "thumbnail": thumb})
        stride = max(1, int(np.sqrt(h*w/5000))); out_h = max(1,h//stride); out_w = max(1,w//stride)
        if band_count == 1:
            data = src.read(1, out_shape=(out_h,out_w), resampling=Resampling.average).astype(np.float32)
            if nodata is not None: data[data==nodata] = np.nan
            xs = np.linspace(bounds[0],bounds[2],out_w); ys = np.linspace(bounds[3],bounds[1],out_h)
            xg, yg = np.meshgrid(xs, ys)
            df = pd.DataFrame({"longitude": xg.flatten(), "latitude": yg.flatten(), "value": data.flatten()})
        else:
            cols_data = {}
            for b in range(1, min(band_count+1, 9)):
                d = src.read(b, out_shape=(out_h,out_w), resampling=Resampling.average).astype(np.float32)
                if nodata is not None: d[d==nodata] = np.nan
                bname = (src.descriptions[b-1] or f"band_{b}") if src.descriptions else f"band_{b}"
                cols_data[bname] = d.flatten()
            df = pd.DataFrame(cols_data)
    datasets[fname] = df
    return {"id": fname, "name": fname, "format": ext.lower(),
            "shape": list(df.shape), "columns": list(df.columns),
            "types": infer_types(df), "preview": df_to_json(df),
            "missing": {c: int(df[c].isna().sum()) for c in df.columns},
            "raster_meta": {"driver": driver, "bands": band_count, "width": w, "height": h,
                "crs": crs_str, "bounds": bounds, "resolution": res, "nodata": nodata,
                "is_rgb": is_rgb, "is_dem": is_dem, "is_multispectral": band_count>4,
                "band_stats": band_stats, "thumbnails": thumbnails,
                "tags": {k: str(v) for k,v in tags.items()}}}

def parse_lidar(content, fname, ext):
    if not HAS_LASPY: raise ValueError("laspy not installed")
    path = write_tmp(content, f".{ext}"); lidar_cache[fname] = path
    with laspy.open(path) as f:
        hdr = f.header
        point_count = int(hdr.point_count) if hasattr(hdr,"point_count") else 0
        fmt_id = int(hdr.point_format.id) if hasattr(hdr.point_format,"id") else 0
        version = f"{hdr.version.major}.{hdr.version.minor}" if hasattr(hdr,"version") else "unknown"
        chunk = None
        for c in f.chunk_iterator(min(200_000, max(point_count,1))): chunk = c; break
    if chunk is None: raise ValueError("No LiDAR points found")
    dim_names = [d.name for d in chunk.point_format]; rows = {}
    for dim in dim_names:
        try: rows[dim] = np.array(getattr(chunk, dim))
        except: pass
    rows["X"] = np.array(chunk.x); rows["Y"] = np.array(chunk.y); rows["Z"] = np.array(chunk.z)
    df = pd.DataFrame(rows)
    xyz_stats = {ax: {"min": safe_float(float(df[col].min())), "max": safe_float(float(df[col].max())),
                      "mean": safe_float(float(df[col].mean())), "std": safe_float(float(df[col].std()))}
                 for ax, col in [("x","X"),("y","Y"),("z","Z")]}
    class_counts = {}
    for ccol in ["classification","Classification"]:
        if ccol in df.columns: class_counts = {int(k): int(v) for k,v in df[ccol].value_counts().head(20).items()}; break
    return_counts = {}
    for rcol in ["return_number","return_num"]:
        if rcol in df.columns: return_counts = {int(k): int(v) for k,v in df[rcol].value_counts().items()}; break
    density_thumb = ""
    try:
        counts2d, _, _ = np.histogram2d(df["X"].values, df["Y"].values, bins=200)
        density_thumb = ndarray_to_png_b64(counts2d.T, "plasma")
    except: pass
    datasets[fname] = df
    return {"id": fname, "name": fname, "format": ext.lower(),
            "shape": list(df.shape), "columns": list(df.columns),
            "types": infer_types(df), "preview": df_to_json(df, max_rows=200),
            "missing": {c: int(df[c].isna().sum()) for c in df.columns},
            "lidar_meta": {"point_count": point_count, "sampled": len(df), "point_format": fmt_id,
                "version": version, "dimensions": dim_names, "xyz_stats": xyz_stats,
                "classification_counts": class_counts, "return_counts": return_counts,
                "density_thumbnail": density_thumb}}

def parse_image(content, fname, ext):
    if not HAS_PIL: raise ValueError("Pillow not installed")
    img = Image.open(io.BytesIO(content)); arr = np.array(img)
    h, w = arr.shape[:2]; bands = 1 if arr.ndim==2 else arr.shape[2]
    rows = {}
    if arr.ndim==2: rows["gray"] = arr.flatten().astype(float)
    else:
        for i, bn in enumerate(["red","green","blue","alpha"][:bands]): rows[bn] = arr[:,:,i].flatten().astype(float)
    df = pd.DataFrame(rows); datasets[fname] = df
    thumb_img = img.copy(); thumb_img.thumbnail((512,512), Image.LANCZOS)
    if thumb_img.mode not in ("RGB","RGBA"): thumb_img = thumb_img.convert("RGB")
    buf = io.BytesIO(); thumb_img.save(buf, format="PNG")
    thumb_b64 = base64.b64encode(buf.getvalue()).decode()
    return {"id": fname, "name": fname, "format": ext.lower(),
            "shape": list(df.shape), "columns": list(df.columns),
            "types": infer_types(df), "preview": df_to_json(df), "missing": {},
            "image_meta": {"width": w, "height": h, "bands": bands, "mode": img.mode,
                "thumbnail": thumb_b64,
                "band_stats": {col: array_stats(df[col].values.reshape(h,w)) for col in df.columns}}}

def parse_tabular(content, fname, ext):
    if ext == "csv": df = pd.read_csv(io.BytesIO(content))
    elif ext == "tsv": df = pd.read_csv(io.BytesIO(content), sep="\t")
    elif ext in ("json","geojson"):
        data = json.loads(content)
        if isinstance(data, dict) and data.get("type") == "FeatureCollection":
            if HAS_GEOPANDAS:
                path = write_tmp(content, f".{ext}"); gdf = gpd.read_file(path)
                return _gdf_to_result(gdf, fname)
            else:
                rows = []
                for feat in data.get("features",[]):
                    row = dict(feat.get("properties") or {}); geom = feat.get("geometry") or {}
                    if geom.get("type") == "Point":
                        c = geom.get("coordinates",[])
                        row["_lon"] = c[0] if len(c)>0 else None; row["_lat"] = c[1] if len(c)>1 else None
                    rows.append(row)
                df = pd.DataFrame(rows)
        elif isinstance(data, list): df = pd.DataFrame(data)
        else: df = pd.json_normalize(data)
    elif ext in ("xlsx","xls"): df = pd.read_excel(io.BytesIO(content))
    elif ext == "parquet": df = pd.read_parquet(io.BytesIO(content))
    else: raise ValueError(f"Unsupported format: .{ext}")
    for col in df.columns:
        if df[col].dtype == object and "date" in col.lower():
            try: df[col] = pd.to_datetime(df[col])
            except: pass
    datasets[fname] = df
    return {"id": fname, "name": fname, "format": ext,
            "shape": list(df.shape), "columns": list(df.columns),
            "types": infer_types(df), "preview": df_to_json(df),
            "missing": {c: int(df[c].isna().sum()) for c in df.columns}}

# ── Upload router ─────────────────────────────────────────────────────────────

@app.post("/api/datasets/upload")
async def upload_dataset(file: UploadFile = File(...), name: Optional[str] = None):
    content = await file.read()
    fname = name or file.filename or "upload"
    ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else "csv"
    try:
        if ext == "zip": return parse_shapefile_upload(content, fname)
        elif ext == "shp": return parse_shapefile_upload(content, fname)
        elif ext == "dbf": return parse_dbf(content, fname)
        elif ext in ("tif","tiff","geotiff","img","dem","hgt","asc"):
            if HAS_RASTERIO:
                try: return parse_raster(content, fname, ext)
                except: pass
            return parse_image(content, fname, ext)
        elif ext in ("nc","nc4","cdf","netcdf"): return parse_netcdf(content, fname)
        elif ext in ("las","laz"): return parse_lidar(content, fname, ext)
        elif ext in ("png","jpg","jpeg","bmp"): return parse_image(content, fname, ext)
        else: return parse_tabular(content, fname, ext)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse .{ext}: {str(e)}\n\n{traceback.format_exc()}")

# ── Dataset management ────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok", "version": "5.0.0",
            "capabilities": {"scipy": HAS_SCIPY, "statsmodels": HAS_STATSMODELS,
                "geopandas": HAS_GEOPANDAS, "rasterio": HAS_RASTERIO,
                "netcdf": HAS_NETCDF or HAS_XARRAY, "xarray": HAS_XARRAY,
                "lidar": HAS_LASPY, "sklearn": HAS_SKLEARN, "pillow": HAS_PIL, "matplotlib": HAS_MPL,
                "duckdb": HAS_DUCKDB},
            "supported_formats": ["csv","tsv","json","geojson","xlsx","parquet",
                "shp","dbf","zip","tif","tiff","geotiff","img","dem","hgt","asc",
                "nc","nc4","cdf","las","laz","png","jpg","jpeg","bmp"]}

@app.get("/api/datasets")
def list_datasets():
    return [{"id": k, "name": k, "rows": len(v), "columns": list(v.columns), "types": infer_types(v)} for k,v in datasets.items()]

@app.delete("/api/datasets/{dataset_id:path}")
def delete_dataset(dataset_id: str):
    found = False
    for store in [datasets, raster_cache, netcdf_cache, lidar_cache]:
        if dataset_id in store: del store[dataset_id]; found = True
    if not found: raise HTTPException(status_code=404, detail="Dataset not found")
    return {"deleted": dataset_id}

@app.get("/api/datasets/{dataset_id:path}/preview")
def get_preview(dataset_id: str, rows: int = 200, offset: int = 0):
    if dataset_id not in datasets: raise HTTPException(status_code=404)
    return df_to_json(datasets[dataset_id].iloc[offset:offset+rows])

@app.get("/api/datasets/{dataset_id:path}/describe")
def describe_dataset(dataset_id: str):
    if dataset_id not in datasets: raise HTTPException(status_code=404)
    df = datasets[dataset_id]; result = {}
    for col in df.columns:
        col_data = df[col].dropna()
        info = {"type": str(df[col].dtype), "count": int(col_data.count()), "missing": int(df[col].isna().sum())}
        if pd.api.types.is_numeric_dtype(df[col]):
            info.update({"mean": safe_float(col_data.mean()), "median": safe_float(col_data.median()),
                "std": safe_float(col_data.std()), "min": safe_float(col_data.min()),
                "max": safe_float(col_data.max()), "q1": safe_float(col_data.quantile(.25)),
                "q3": safe_float(col_data.quantile(.75)), "skew": safe_float(col_data.skew()),
                "kurtosis": safe_float(col_data.kurtosis()), "variance": safe_float(col_data.var())})
            if HAS_SCIPY and len(col_data) >= 3:
                try: _, pval = scipy_stats.normaltest(col_data); info["normality_pvalue"] = safe_float(pval)
                except: pass
        else:
            vc = col_data.value_counts()
            info.update({"unique": int(col_data.nunique()),
                "top_values": {str(k): int(v) for k,v in vc.head(10).items()},
                "mode": str(col_data.mode().iloc[0]) if len(col_data)>0 else None})
        result[col] = info
    return result

@app.get("/api/datasets/{dataset_id:path}/histogram")
def get_histogram(dataset_id: str, column: str, bins: int = 30):
    if dataset_id not in datasets: raise HTTPException(status_code=404)
    df = datasets[dataset_id]
    if column not in df.columns: raise HTTPException(status_code=400, detail="Column not found")
    vals = df[column].dropna()
    if not pd.api.types.is_numeric_dtype(vals):
        counts = vals.value_counts().head(30)
        return {"type": "bar", "labels": list(counts.index.astype(str)), "values": [int(v) for v in counts.values]}
    counts, edges = np.histogram(vals, bins=bins)
    return {"type": "histogram", "labels": [f"{e:.4g}" for e in edges[:-1]],
            "values": [int(c) for c in counts], "edges": [safe_float(e) for e in edges]}

@app.get("/api/datasets/{dataset_id:path}/export")
def export_dataset(dataset_id: str, fmt: str = "csv"):
    if dataset_id not in datasets: raise HTTPException(status_code=404)
    df = datasets[dataset_id].replace([np.inf, -np.inf], np.nan)
    safe_name = dataset_id.replace("/","_").replace("\\","_")
    if fmt == "csv":
        buf = io.BytesIO(); df.to_csv(buf, index=False); buf.seek(0)
        return StreamingResponse(buf, media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.csv"'})
    elif fmt == "tsv":
        buf = io.BytesIO(); df.to_csv(buf, index=False, sep="\t"); buf.seek(0)
        return StreamingResponse(buf, media_type="text/tab-separated-values",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.tsv"'})
    elif fmt == "json":
        buf = io.BytesIO(df.to_json(orient="records").encode()); buf.seek(0)
        return StreamingResponse(buf, media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.json"'})
    elif fmt == "geojson":
        lat_c = next((c for c in df.columns if c.lower() in ("_latitude","lat","latitude")), None)
        lon_c = next((c for c in df.columns if c.lower() in ("_longitude","lon","longitude")), None)
        if lat_c and lon_c:
            feats = []
            for _, row in df.iterrows():
                try: lat, lon = float(row[lat_c]), float(row[lon_c])
                except: continue
                props = {c: (None if (isinstance(row[c],float) and np.isnan(row[c])) else row[c]) for c in df.columns}
                feats.append({"type":"Feature","geometry":{"type":"Point","coordinates":[lon,lat]},"properties":props})
            gj = json.dumps({"type":"FeatureCollection","features":feats})
        else: gj = df.to_json(orient="records")
        buf = io.BytesIO(gj.encode()); buf.seek(0)
        return StreamingResponse(buf, media_type="application/geo+json",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.geojson"'})
    elif fmt == "parquet":
        buf = io.BytesIO(); df.to_parquet(buf, index=False); buf.seek(0)
        return StreamingResponse(buf, media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.parquet"'})
    elif fmt == "xlsx":
        buf = io.BytesIO(); df.to_excel(buf, index=False, engine="openpyxl"); buf.seek(0)
        return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.xlsx"'})
    else: raise HTTPException(status_code=400, detail=f"Unsupported format: {fmt}")

# ── Raster endpoints ──────────────────────────────────────────────────────────

@app.get("/api/raster/{dataset_id:path}/thumbnail")
def raster_thumbnail(dataset_id: str, band: int = 1, colormap: str = "viridis"):
    if dataset_id not in raster_cache: raise HTTPException(status_code=404)
    with rasterio.open(raster_cache[dataset_id]) as src:
        is_rgb = src.count in (3,4) and all(d=="uint8" for d in src.dtypes)
        b64 = rgb_raster_thumb(src) if is_rgb else raster_band_thumb(src, band, colormap=colormap)
    return Response(content=base64.b64decode(b64), media_type="image/png")

@app.get("/api/raster/{dataset_id:path}/info")
def raster_info(dataset_id: str):
    if dataset_id not in raster_cache: raise HTTPException(status_code=404)
    with rasterio.open(raster_cache[dataset_id]) as src:
        result = {"driver": src.driver, "bands": src.count, "width": src.width, "height": src.height,
            "crs": crs_to_str(src.crs), "bounds": list(src.bounds), "resolution": list(src.res),
            "nodata": src.nodata, "dtypes": list(src.dtypes), "transform": list(src.transform)[:6],
            "band_descriptions": list(src.descriptions), "tags": dict(src.tags()), "band_stats": []}
        for b in range(1, min(src.count+1, 13)):
            data = src.read(b).astype(np.float32)
            if src.nodata is not None: data[data==src.nodata] = np.nan
            result["band_stats"].append({"band": b, **array_stats(data)})
    return result

@app.get("/api/raster/{dataset_id:path}/band_slice")
def raster_band_slice(dataset_id: str, band: int = 1, colormap: str = "viridis"):
    """Return a single band as base64 PNG + stats. Band is 1-indexed."""
    if dataset_id not in raster_cache: raise HTTPException(status_code=404)
    path = raster_cache[dataset_id]
    with rasterio.open(path) as src:
        band = max(1, min(band, src.count))
        data = src.read(band).astype(np.float32)
        if src.nodata is not None: data[data == src.nodata] = np.nan
        thumb = ndarray_to_png_b64(data, colormap)
        stats = array_stats(data)
        desc = src.descriptions[band-1] if src.descriptions and src.descriptions[band-1] else f"Band {band}"
    return {"thumbnail": thumb, "stats": stats, "band": band, "description": desc}


@app.get("/api/netcdf/{dataset_id:path}/animation_frame")
@app.get("/api/raster/{dataset_id:path}/animation_frame")
async def animation_frame(dataset_id: str, variable: str = "", band: int = 1,
                          time_index: int = 0, level_index: int = 0,
                          colormap: str = "viridis", width: int = 400):
    """
    Return a single PNG frame for animation — works for both NetCDF and raster.
    The frame is returned as raw PNG bytes (not base64) for speed.
    """
    # ── Raster path ────────────────────────────────────────────────────────
    if dataset_id in raster_cache:
        path = raster_cache[dataset_id]
        with rasterio.open(path) as src:
            b = max(1, min(band, src.count))
            h, w = src.height, src.width
            scale = min(width / max(w, 1), 1.0)
            out_h, out_w = max(1, int(h*scale)), max(1, int(w*scale))
            data = src.read(b, out_shape=(out_h, out_w), resampling=Resampling.average).astype(np.float32)
            if src.nodata is not None: data[data == src.nodata] = np.nan
        b64 = ndarray_to_png_b64(data, colormap)
        if not b64: raise HTTPException(status_code=500, detail="Could not render frame")
        return Response(content=base64.b64decode(b64), media_type="image/png")

    # ── NetCDF path ────────────────────────────────────────────────────────
    if dataset_id not in netcdf_cache: raise HTTPException(status_code=404, detail="Dataset not found")
    if not HAS_XARRAY: raise HTTPException(status_code=500, detail="xarray required")
    path = netcdf_cache[dataset_id]
    ds = _open_netcdf_safe(path)

    # Filter to real data variables (skip grid-mapping containers like Lambert_Conformal)
    real_vars = [k for k, v in ds.data_vars.items()
                 if not _is_grid_mapping_var(v) and v.dtype.kind in ('f','i','u') and v.ndim >= 2]

    vname = variable if variable and variable in ds and not _is_grid_mapping_var(ds[variable]) else None
    if not vname:
        vname = next(iter(real_vars), None)
    if not vname:
        ds.close(); raise HTTPException(status_code=400, detail=f"No plottable variables found. Available: {list(ds.data_vars.keys())}")

    time_c = _detect_coord(ds, ["time","TIME","Time","t","T"])
    lev_c = _detect_coord(ds, ["level","lev","pressure","plev","depth","height","z","Z"])
    arr = ds[vname]
    fv = ds[vname].attrs.get("_FillValue") or ds[vname].attrs.get("missing_value")
    if time_c and time_c in arr.dims:
        arr = arr.isel({time_c: min(time_index, int(ds.sizes.get(time_c,1))-1)})
    if lev_c and lev_c in arr.dims:
        arr = arr.isel({lev_c: min(level_index, int(ds.sizes.get(lev_c,1))-1)})
    a = arr.values.astype(np.float64)
    if fv is not None:
        try: a[a == float(fv)] = np.nan
        except: pass
    while a.ndim > 2: a = a[0]
    if a.ndim == 1: a = a.reshape(1, -1)
    if a.ndim == 0: ds.close(); raise HTTPException(status_code=400, detail=f"Variable '{vname}' is scalar — choose a spatial variable")
    ds.close()
    # Downscale to requested width
    if a.shape[1] > width:
        try:
            from scipy.ndimage import zoom as ndzoom
            a = ndzoom(a, (width * a.shape[0] / a.shape[1] / a.shape[0], width / a.shape[1]), order=1)
        except Exception: pass
    b64 = ndarray_to_png_b64(a, colormap)
    if not b64: raise HTTPException(status_code=500, detail="Could not render frame — check matplotlib/Pillow installed")
    return Response(content=base64.b64decode(b64), media_type="image/png")


@app.post("/api/animation/export")
async def export_animation(request: dict):
    """
    Build a GIF or MP4 from a sequence of frames (NetCDF time steps or raster bands).
    Returns the file as a download.
    format: "gif" | "mp4"
    """
    dataset_id = request.get("dataset_id")
    fmt = request.get("format", "gif")
    variable = request.get("variable", "")
    colormap = request.get("colormap", "viridis")
    start = int(request.get("start", 0))
    end = int(request.get("end", 10))
    fps = float(request.get("fps", 4))
    width = int(request.get("width", 400))
    level_index = int(request.get("level_index", 0))

    if not HAS_PIL:
        raise HTTPException(status_code=500, detail="Pillow required: pip install Pillow")

    frames_pil = []
    is_raster = dataset_id in raster_cache
    is_netcdf = dataset_id in netcdf_cache

    if not is_raster and not is_netcdf:
        raise HTTPException(status_code=404, detail="Dataset not found in raster or NetCDF cache")

    if is_netcdf and not HAS_XARRAY:
        raise HTTPException(status_code=500, detail="xarray required")

    # Open dataset once to reuse
    ds = None
    src_raster = None
    real_vars = []

    if is_netcdf:
        ds = _open_netcdf_safe(netcdf_cache[dataset_id])
        real_vars = [k for k, v in ds.data_vars.items()
                     if not _is_grid_mapping_var(v) and v.dtype.kind in ('f','i','u') and v.ndim >= 2]
        vname = variable if variable and variable in ds and not _is_grid_mapping_var(ds[variable]) else None
        if not vname: vname = next(iter(real_vars), None)
        if not vname:
            ds.close(); raise HTTPException(status_code=400, detail="No plottable variables found")
        time_c = _detect_coord(ds, ["time","TIME","Time","t","T"])
        lev_c = _detect_coord(ds, ["level","lev","pressure","plev","depth","height","z","Z"])

    # Render each frame
    # Compute global min/max across all frames for consistent colormap
    global_min, global_max = None, None
    raw_arrays = []

    for step in range(start, end + 1):
        try:
            if is_raster:
                with rasterio.open(raster_cache[dataset_id]) as src:
                    b = max(1, min(step + 1, src.count))
                    h, w = src.height, src.width
                    scale = min(width / max(w, 1), 1.0)
                    out_h, out_w = max(1, int(h*scale)), max(1, int(w*scale))
                    a = src.read(b, out_shape=(out_h, out_w), resampling=Resampling.average).astype(np.float32)
                    if src.nodata is not None: a[a == src.nodata] = np.nan
            else:
                arr = ds[vname]
                fv = ds[vname].attrs.get("_FillValue") or ds[vname].attrs.get("missing_value")
                if time_c and time_c in arr.dims:
                    arr = arr.isel({time_c: min(step, int(ds.sizes.get(time_c,1))-1)})
                if lev_c and lev_c in arr.dims:
                    arr = arr.isel({lev_c: min(level_index, int(ds.sizes.get(lev_c,1))-1)})
                a = arr.values.astype(np.float64)
                if fv is not None:
                    try: a[a == float(fv)] = np.nan
                    except: pass
                while a.ndim > 2: a = a[0]
                if a.ndim == 1: a = a.reshape(1, -1)
            raw_arrays.append(a)
            valid = a[np.isfinite(a)]
            if len(valid) > 0:
                mn, mx = float(valid.min()), float(valid.max())
                if global_min is None or mn < global_min: global_min = mn
                if global_max is None or mx > global_max: global_max = mx
        except Exception as e:
            raw_arrays.append(None)

    if ds: ds.close()

    if global_min is None: global_min, global_max = 0.0, 1.0
    if global_min == global_max: global_max = global_min + 1

    # Convert arrays to PIL frames with consistent colormap
    import matplotlib.cm as cm_mod
    from matplotlib.colors import Normalize
    cmap_fn = cm_mod.get_cmap(colormap)
    norm = Normalize(vmin=global_min, vmax=global_max)

    for a in raw_arrays:
        if a is None:
            # blank frame
            frames_pil.append(Image.new("RGB", (width, max(1, width // 2)), (14, 15, 17)))
            continue
        # Resize
        if a.shape[1] > width:
            try:
                from scipy.ndimage import zoom as ndzoom
                a = ndzoom(a, (width * a.shape[0] / a.shape[1] / a.shape[0], width / a.shape[1]), order=1)
            except: pass
        rgba = cmap_fn(norm(np.where(np.isfinite(a), a, np.nan)))
        rgba[~np.isfinite(a)] = [0.05, 0.06, 0.07, 1.0]
        img_arr = (rgba[:, :, :3] * 255).astype(np.uint8)
        frames_pil.append(Image.fromarray(img_arr, "RGB"))

    if not frames_pil:
        raise HTTPException(status_code=500, detail="No frames rendered")

    # Ensure all frames same size
    W, H = frames_pil[0].size
    frames_pil = [f.resize((W, H), Image.LANCZOS) if f.size != (W, H) else f for f in frames_pil]
    duration_ms = max(1, int(1000 / fps))
    safe_name = dataset_id.replace("/","_").replace("\\","_").replace(".","_")

    if fmt == "gif":
        buf = io.BytesIO()
        frames_pil[0].save(buf, format="GIF", save_all=True,
                           append_images=frames_pil[1:],
                           duration=duration_ms, loop=0,
                           optimize=False)
        buf.seek(0)
        return StreamingResponse(buf, media_type="image/gif",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.gif"'})

    elif fmt == "mp4":
        # Use imageio if available, else fall back to GIF
        try:
            import imageio
            buf = io.BytesIO()
            writer = imageio.get_writer(buf, format="mp4", fps=fps, codec="libx264",
                                        output_params=["-pix_fmt", "yuv420p"])
            for f in frames_pil:
                writer.append_data(np.array(f))
            writer.close()
            buf.seek(0)
            return StreamingResponse(buf, media_type="video/mp4",
                headers={"Content-Disposition": f'attachment; filename="{safe_name}.mp4"'})
        except ImportError:
            # Fall back to GIF with MP4-style naming
            buf = io.BytesIO()
            frames_pil[0].save(buf, format="GIF", save_all=True,
                               append_images=frames_pil[1:],
                               duration=duration_ms, loop=0)
            buf.seek(0)
            return StreamingResponse(buf, media_type="image/gif",
                headers={"Content-Disposition": f'attachment; filename="{safe_name}_anim.gif"',
                         "X-Note": "imageio not installed, exported as GIF instead of MP4"})
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported format: {fmt}. Use 'gif' or 'mp4'")


@app.get("/api/shapefile/{dataset_id:path}/time_steps")
def shapefile_time_steps(dataset_id: str, time_col: str = ""):
    """Return unique time values from a shapefile's time column."""
    if dataset_id not in datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = datasets[dataset_id]
    if not time_col:
        # Auto-detect time column
        time_col = next((c for c in df.columns
                         if any(x in c.lower() for x in ['time','date','year','month','day','period'])), None)
    if not time_col or time_col not in df.columns:
        return {"time_col": None, "steps": [], "n_steps": 0}
    vals = df[time_col].dropna().unique()
    try: vals = sorted(vals)
    except: vals = list(vals)
    return {"time_col": time_col, "steps": [str(v) for v in vals], "n_steps": len(vals)}


@app.post("/api/shapefile/{dataset_id:path}/filter_time")
async def shapefile_filter_time(dataset_id: str, request: dict):
    """Filter a shapefile dataset to a specific time value and return GeoJSON."""
    if dataset_id not in datasets:
        raise HTTPException(status_code=404, detail="Dataset not found")
    df = datasets[dataset_id]
    time_col = request.get("time_col")
    time_value = request.get("time_value")
    value_col = request.get("value_col")
    colormap = request.get("colormap", "viridis")
    n_classes = int(request.get("n_classes", 5))
    max_features = int(request.get("max_features", 5000))

    if time_col and time_col in df.columns and time_value is not None:
        # Try numeric comparison first, then string
        try:
            filtered = df[df[time_col] == type(df[time_col].iloc[0])(time_value)]
        except Exception:
            filtered = df[df[time_col].astype(str) == str(time_value)]
    else:
        filtered = df

    if filtered.empty:
        return {"type": "geojson", "geojson": {"type": "FeatureCollection", "features": []},
                "feature_count": 0, "legend": []}

    # Temporarily swap dataset for this request
    orig = datasets[dataset_id]
    datasets[dataset_id] = filtered

    colors = COLORMAPS_CSS.get(colormap, COLORMAPS_CSS["viridis"])
    color_map = {}; legend = []
    if value_col and value_col in filtered.columns:
        vals = pd.to_numeric(filtered[value_col], errors="coerce").fillna(np.nan).values.astype(float)
        breaks = _classify(vals, "quantile", n_classes)
        class_idxs = np.searchsorted(breaks[1:-1], vals)
        n_c = len(colors); n_cls = len(breaks)-1
        for i, cls in enumerate(class_idxs):
            t = np.clip(cls/max(n_cls-1,1),0,1); bucket = int(t*(n_c-1))
            color_map[i] = colors[min(bucket,n_c-1)]
        for i in range(n_cls):
            t = i/max(n_cls-1,1); bucket = int(t*(n_c-1))
            legend.append({"color": colors[min(bucket,n_c-1)], "label": f"{breaks[i]:.3g} – {breaks[i+1]:.3g}"})

    lat_col = next((c for c in filtered.columns if c.lower() in ("lat","latitude","_latitude","_centroid_lat")), None)
    lon_col = next((c for c in filtered.columns if c.lower() in ("lon","lng","longitude","_longitude","_centroid_lon")), None)

    features = []
    has_wkt = "_geom_wkt" in filtered.columns

    if HAS_GEOPANDAS and has_wkt:
        try:
            from shapely import wkt as swkt
            from shapely.geometry import mapping as smapping
            for i, (_, row) in enumerate(filtered.head(max_features).iterrows()):
                try: geom = smapping(swkt.loads(str(row["_geom_wkt"])))
                except: continue
                props = {c: (None if (isinstance(row.get(c), float) and np.isnan(row[c])) else
                             (float(row[c]) if isinstance(row.get(c), (int, float)) else str(row.get(c, ""))))
                         for c in filtered.columns if not c.startswith("_")}
                if value_col: props["_color"] = color_map.get(i, colors[0]); props["_value"] = props.get(value_col)
                features.append({"type": "Feature", "geometry": geom, "properties": props})
        except: pass

    if not features and lat_col and lon_col:
        for i, (_, row) in enumerate(filtered.dropna(subset=[lat_col, lon_col]).head(max_features).iterrows()):
            try: lat, lon = float(row[lat_col]), float(row[lon_col])
            except: continue
            props = {c: (None if (isinstance(row.get(c), float) and np.isnan(row[c])) else
                         (float(row[c]) if pd.api.types.is_numeric_dtype(filtered[c]) else str(row[c])))
                     for c in filtered.columns if not c.startswith("_")}
            if value_col: props["_color"] = color_map.get(i, colors[0]); props["_value"] = props.get(value_col)
            features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": props})

    datasets[dataset_id] = orig
    return {"type": "geojson", "geojson": {"type": "FeatureCollection", "features": features},
            "feature_count": len(features), "legend": legend, "time_col": time_col, "time_value": str(time_value)}


# ── NetCDF endpoints ──────────────────────────────────────────────────────────

@app.get("/api/netcdf/{dataset_id:path}/variables")
def netcdf_variables(dataset_id: str):
    if dataset_id not in netcdf_cache: raise HTTPException(status_code=404)
    if not HAS_XARRAY: raise HTTPException(status_code=500, detail="xarray required")
    ds = xr.open_dataset(netcdf_cache[dataset_id], engine="netcdf4")
    result = {}
    for vname, var in ds.data_vars.items():
        vstats = {}
        if var.dtype.kind in ("f","i","u"):
            try: vstats = array_stats(var.values.astype(np.float64))
            except: pass
        result[vname] = {"dims": list(var.dims), "shape": list(var.shape),
            "units": var.attrs.get("units",""), "long_name": var.attrs.get("long_name",vname), "stats": vstats}
    ds.close(); return result

@app.post("/api/netcdf/{dataset_id:path}/load_time_band")
async def netcdf_load_time_band(dataset_id: str, request: dict):
    if dataset_id not in netcdf_cache: raise HTTPException(status_code=404)
    if not HAS_XARRAY: raise HTTPException(status_code=500, detail="xarray required")
    path = netcdf_cache[dataset_id]
    time_idx = int(request.get("time_index", 0)); level_idx = int(request.get("level_index", 0))
    var_filter = request.get("variables", None)
    ds = xr.open_dataset(path, engine="netcdf4", mask_and_scale=True)
    lat_c = _detect_coord(ds, ["lat","latitude","LAT","LATITUDE","nav_lat"])
    lon_c = _detect_coord(ds, ["lon","longitude","LON","LONGITUDE","nav_lon"], exclude=[lat_c] if lat_c else [])
    time_c = _detect_coord(ds, ["time","TIME","Time","t","T","date","DATE"])
    lev_c = _detect_coord(ds, ["level","lev","pressure","plev","depth","height","z","Z"],
                          exclude=[c for c in [lat_c,lon_c,time_c] if c])
    for name, lo, hi in [(lat_c,-90,90),(lon_c,-180,360)]:
        if name:
            try:
                v = ds[name].values.flatten()
                if not (float(np.nanmin(v)) >= lo and float(np.nanmax(v)) <= hi):
                    if name == lat_c: lat_c = None
                    else: lon_c = None
            except: pass
    rows = {}; max_pts = 8000
    if lat_c and lon_c:
        lat_arr = ds[lat_c].values; lon_arr = ds[lon_c].values
        if lat_arr.ndim==1 and lon_arr.ndim==1: lon_grid, lat_grid = np.meshgrid(lon_arr, lat_arr)
        elif lat_arr.ndim==2: lat_grid, lon_grid = lat_arr, lon_arr
        else: lat_grid = lat_arr.flatten(); lon_grid = lon_arr.flatten()
        lon_grid = np.where(lon_grid>180, lon_grid-360, lon_grid)
        flat_lat = lat_grid.flatten(); flat_lon = lon_grid.flatten()
        if len(flat_lat) > max_pts:
            stride = max(1, len(flat_lat)//max_pts); flat_lat = flat_lat[::stride]; flat_lon = flat_lon[::stride]
        rows["_latitude"] = flat_lat; rows["_longitude"] = flat_lon; n = len(flat_lat)
        target = var_filter or list(ds.data_vars)[:8]
        for vname in target:
            if vname not in ds.data_vars: continue
            var = ds[vname]
            if var.dtype.kind not in ("f","i","u"): continue
            try:
                arr = var
                if time_c and time_c in var.dims: arr = arr.isel({time_c: min(time_idx, int(ds.sizes[time_c])-1)})
                if lev_c and lev_c in arr.dims: arr = arr.isel({lev_c: min(level_idx, int(ds.sizes[lev_c])-1)})
                a = arr.values.astype(np.float64)
                fv = var.attrs.get("_FillValue") or var.attrs.get("missing_value")
                if fv: a[a==float(fv)] = np.nan
                flat = a.flatten()
                if len(flat) > max_pts: flat = flat[::max(1,len(flat)//max_pts)]
                rows[vname] = flat[:n]
            except: pass
    else:
        target = var_filter or list(ds.data_vars)[:12]
        for vname in target:
            if vname not in ds.data_vars: continue
            var = ds[vname]
            if var.dtype.kind not in ("f","i","u"): continue
            try:
                arr = var
                if time_c and time_c in var.dims: arr = arr.isel({time_c: min(time_idx, int(ds.sizes[time_c])-1)})
                rows[vname] = arr.values.flatten()[:5000]
            except: pass
    ds.close()
    max_len = max((len(v) for v in rows.values()), default=0)
    df = pd.DataFrame({k: pd.Series(list(v)[:max_len]) for k,v in rows.items()}) if max_len > 0 else pd.DataFrame()
    datasets[dataset_id] = df
    return {"shape": list(df.shape), "columns": list(df.columns), "types": infer_types(df),
            "preview": df_to_json(df, max_rows=100), "time_index": time_idx, "level_index": level_idx}

@app.post("/api/netcdf/{dataset_id:path}/slice")
async def netcdf_slice(dataset_id: str, request: dict):
    if dataset_id not in netcdf_cache: raise HTTPException(status_code=404)
    if not HAS_XARRAY: raise HTTPException(status_code=500, detail="xarray required")
    path = netcdf_cache[dataset_id]
    var_name = request.get("variable"); time_idx = int(request.get("time_index",0))
    level_idx = int(request.get("level_index",0)); colormap = request.get("colormap","viridis")
    ds = xr.open_dataset(path, engine="netcdf4")
    if var_name not in ds: ds.close(); raise HTTPException(status_code=400, detail=f"Variable not found: {var_name}")
    time_c = _detect_coord(ds, ["time","TIME","Time","t","T"]); lev_c = _detect_coord(ds, ["level","lev","pressure","plev","depth"])
    arr = ds[var_name]; fv = ds[var_name].attrs.get("_FillValue")
    if time_c and time_c in arr.dims: arr = arr.isel({time_c: min(time_idx, int(ds.sizes.get(time_c,1))-1)})
    if lev_c and lev_c in arr.dims: arr = arr.isel({lev_c: min(level_idx, int(ds.sizes.get(lev_c,1))-1)})
    a = arr.values.astype(np.float64)
    if fv: a[a==float(fv)] = np.nan
    while a.ndim > 2: a = a[0]
    if a.ndim == 1: a = a.reshape(1,-1)
    ds.close()
    thumb = ndarray_to_png_b64(a, colormap)
    return {"thumbnail": thumb, "stats": array_stats(a), "shape": list(a.shape)}

# ── LiDAR endpoints ───────────────────────────────────────────────────────────

@app.get("/api/lidar/{dataset_id:path}/pointcloud")
def lidar_pointcloud(dataset_id: str, max_points: int = 25000):
    if dataset_id not in datasets: raise HTTPException(status_code=404)
    df = datasets[dataset_id]; cols = [c for c in ["X","Y","Z"] if c in df.columns]
    if not cols: raise HTTPException(status_code=400, detail="No X/Y/Z columns")
    sample = df[cols].dropna()
    if len(sample) > max_points: sample = sample.sample(max_points, random_state=42)
    result = {"x": sample["X"].tolist(), "y": sample["Y"].tolist(), "z": sample["Z"].tolist(), "count": len(sample)}
    for icol in ["intensity","Intensity"]:
        if icol in df.columns: result["intensity"] = df.loc[sample.index, icol].tolist(); break
    for ccol in ["classification","Classification"]:
        if ccol in df.columns: result["classification"] = df.loc[sample.index, ccol].tolist(); break
    return result

@app.get("/api/lidar/{dataset_id:path}/density")
def lidar_density(dataset_id: str, grid_size: int = 150):
    if dataset_id not in datasets: raise HTTPException(status_code=404)
    df = datasets[dataset_id]; x, y = df["X"].dropna().values, df["Y"].dropna().values
    if len(x) == 0: return {"thumbnail":"","extent":[]}
    counts, xedges, yedges = np.histogram2d(x, y, bins=grid_size)
    thumb = ndarray_to_png_b64(counts.T, "plasma")
    return {"thumbnail": thumb, "extent": [float(xedges[0]),float(xedges[-1]),float(yedges[0]),float(yedges[-1])],
            "max_density": int(counts.max()), "total_points": int(len(x))}

# ── Cartography endpoints ─────────────────────────────────────────────────────

COLORMAPS_CSS = {
    "viridis": ["#440154","#3b528b","#21908c","#5dc963","#fde725"],
    "plasma":  ["#0d0887","#7e03a8","#cc4778","#f89441","#f0f921"],
    "inferno": ["#000004","#420a68","#932667","#dd513a","#fcffa4"],
    "rdylgn":  ["#d73027","#fc8d59","#ffffbf","#91cf60","#1a9850"],
    "spectral":["#d53e4f","#fc8d59","#ffffbf","#99d594","#3288bd"],
    "blues":   ["#eff3ff","#bdd7e7","#6baed6","#2171b5","#084594"],
    "reds":    ["#fee5d9","#fcae91","#fb6a4a","#de2d26","#a50f15"],
    "coolwarm":["#3b4cc0","#7da8e0","#f7f7f7","#e8896a","#b40426"],
    "greens":  ["#f7fcf5","#c7e9c0","#74c476","#238b45","#00441b"],
}

class CartoBBoxModel(BaseModel):
    min_lon: float; min_lat: float; max_lon: float; max_lat: float

class CartoLayerRequest(BaseModel):
    dataset_id: str; layer_type: str
    lat_col: Optional[str] = None; lon_col: Optional[str] = None
    value_col: Optional[str] = None; color_col: Optional[str] = None
    clip_bbox: Optional[CartoBBoxModel] = None; max_features: Optional[int] = 5000
    colormap: Optional[str] = "viridis"; classification: Optional[str] = "quantile"
    n_classes: Optional[int] = 5

def _classify(values, method, n):
    valid = values[np.isfinite(values)]
    if len(valid) == 0: return np.linspace(0,1,n+1)
    if method == "equal": return np.linspace(valid.min(), valid.max(), n+1)
    return np.percentile(valid, np.linspace(0,100,n+1))

@app.get("/api/carto/extent/{dataset_id:path}")
def carto_extent(dataset_id: str):
    if dataset_id in raster_cache:
        try:
            with rasterio.open(raster_cache[dataset_id]) as src:
                b = src.bounds
                if src.crs and str(src.crs) != "EPSG:4326":
                    try:
                        from pyproj import Transformer
                        tr = Transformer.from_crs(src.crs, "EPSG:4326", always_xy=True)
                        mn_lon, mn_lat = tr.transform(b.left, b.bottom)
                        mx_lon, mx_lat = tr.transform(b.right, b.top)
                        return {"min_lon": mn_lon, "min_lat": mn_lat, "max_lon": mx_lon, "max_lat": mx_lat}
                    except: pass
                return {"min_lon": b.left, "min_lat": b.bottom, "max_lon": b.right, "max_lat": b.top}
        except: pass
    if dataset_id not in datasets: raise HTTPException(status_code=404)
    df = datasets[dataset_id]
    lat_col = next((c for c in df.columns if c.lower() in ("lat","latitude","_latitude","_centroid_lat","y")), None)
    lon_col = next((c for c in df.columns if c.lower() in ("lon","lng","longitude","_longitude","_centroid_lon","x")), None)
    if not lat_col or not lon_col: return {"min_lon":-180,"min_lat":-90,"max_lon":180,"max_lat":90,"detected":False}
    lats = pd.to_numeric(df[lat_col],errors="coerce").dropna()
    lons = pd.to_numeric(df[lon_col],errors="coerce").dropna()
    lats = lats[(lats>=-90)&(lats<=90)]; lons = lons[(lons>=-180)&(lons<=180)]
    if len(lats)==0 or len(lons)==0: return {"min_lon":-180,"min_lat":-90,"max_lon":180,"max_lat":90,"detected":False}
    pl = max((float(lats.max())-float(lats.min()))*0.05,0.01)
    plo = max((float(lons.max())-float(lons.min()))*0.05,0.01)
    return {"min_lon": safe_float(float(lons.min())-plo), "min_lat": safe_float(float(lats.min())-pl),
            "max_lon": safe_float(float(lons.max())+plo), "max_lat": safe_float(float(lats.max())+pl),
            "lat_col": lat_col, "lon_col": lon_col, "detected": True, "point_count": int(len(lats))}

@app.post("/api/carto/layer")
def carto_layer(req: CartoLayerRequest):
    ds_id = req.dataset_id
    if req.layer_type == "raster_overlay":
        if ds_id not in raster_cache: raise HTTPException(status_code=404)
        with rasterio.open(raster_cache[ds_id]) as src:
            b = src.bounds; bounds_wgs84 = [b.left, b.bottom, b.right, b.top]
            if src.crs and str(src.crs) != "EPSG:4326":
                try:
                    from pyproj import Transformer
                    tr = Transformer.from_crs(src.crs, "EPSG:4326", always_xy=True)
                    mn_lon, mn_lat = tr.transform(b.left, b.bottom)
                    mx_lon, mx_lat = tr.transform(b.right, b.top)
                    bounds_wgs84 = [mn_lon, mn_lat, mx_lon, mx_lat]
                except: pass
            is_rgb = src.count in (3,4) and all(d=="uint8" for d in src.dtypes)
            thumb = rgb_raster_thumb(src, 1024) if is_rgb else raster_band_thumb(src, 1, 1024, req.colormap or "viridis")
        return {"type":"raster_overlay","bounds":bounds_wgs84,"image_b64":thumb,"dataset_id":ds_id}
    if ds_id not in datasets: raise HTTPException(status_code=404)
    df = datasets[ds_id].copy()
    lat_col = req.lat_col or next((c for c in df.columns if c.lower() in ("lat","latitude","_latitude","_centroid_lat","y")),None)
    lon_col = req.lon_col or next((c for c in df.columns if c.lower() in ("lon","lng","longitude","_longitude","_centroid_lon","x")),None)
    if req.clip_bbox and lat_col and lon_col:
        b = req.clip_bbox
        df = df[(pd.to_numeric(df[lon_col],errors="coerce")>=b.min_lon)&(pd.to_numeric(df[lon_col],errors="coerce")<=b.max_lon)&
                (pd.to_numeric(df[lat_col],errors="coerce")>=b.min_lat)&(pd.to_numeric(df[lat_col],errors="coerce")<=b.max_lat)]
    if req.layer_type == "heatmap":
        if not lat_col or not lon_col: raise HTTPException(status_code=400, detail="No lat/lon columns")
        sub = df[[lat_col,lon_col]].dropna()
        if req.value_col and req.value_col in df.columns:
            sub2 = df[[lat_col,lon_col,req.value_col]].dropna()
            vals = pd.to_numeric(sub2[req.value_col],errors="coerce").fillna(0)
            vmax = float(vals.max()) or 1.0
            pts = [[safe_float(float(r[lat_col])),safe_float(float(r[lon_col])),safe_float(float(r[req.value_col])/vmax)]
                   for _,r in sub2.head(req.max_features).iterrows()]
        else: pts = [[safe_float(float(r[lat_col])),safe_float(float(r[lon_col])),1.0] for _,r in sub.head(req.max_features).iterrows()]
        return {"type":"heatmap","points":pts}
    if not lat_col or not lon_col: raise HTTPException(status_code=400, detail="No lat/lon columns detected")
    sub = df.dropna(subset=[lat_col,lon_col])
    sub = sub[(pd.to_numeric(sub[lat_col],errors="coerce").between(-90,90))&(pd.to_numeric(sub[lon_col],errors="coerce").between(-180,180))]
    if len(sub) > req.max_features: sub = sub.sample(req.max_features, random_state=42)
    colors = COLORMAPS_CSS.get(req.colormap or "viridis", COLORMAPS_CSS["viridis"])
    color_map = {}; breaks = np.array([]); legend = []
    if req.value_col and req.value_col in sub.columns:
        vals = pd.to_numeric(sub[req.value_col],errors="coerce").fillna(np.nan).values.astype(float)
        breaks = _classify(vals, req.classification or "quantile", req.n_classes or 5)
        class_idxs = np.searchsorted(breaks[1:-1], vals)
        n_c = len(colors); n_cls = len(breaks)-1
        for i, (idx_row, cls) in enumerate(zip(sub.index, class_idxs)):
            t = np.clip(cls/max(n_cls-1,1),0,1); bucket = int(t*(n_c-1))
            color_map[idx_row] = colors[min(bucket,n_c-1)]
        for i in range(n_cls):
            t = i/max(n_cls-1,1); bucket = int(t*(n_c-1))
            legend.append({"color":colors[min(bucket,n_c-1)], "label":f"{breaks[i]:.3g} – {breaks[i+1]:.3g}"})
    features = []; prop_cols = [c for c in sub.columns if c not in (lat_col,lon_col)][:12]
    for idx, row in sub.iterrows():
        try: lat, lon = float(row[lat_col]), float(row[lon_col])
        except: continue
        props = {c: (None if pd.isna(row[c]) else (float(row[c]) if pd.api.types.is_numeric_dtype(sub[c]) else str(row[c]))) for c in prop_cols}
        if req.value_col and req.value_col in props:
            props["_color"] = color_map.get(idx, colors[0]); props["_value"] = props.get(req.value_col)
        features.append({"type":"Feature","geometry":{"type":"Point","coordinates":[lon,lat]},"properties":props})
    return {"type":"geojson","geojson":{"type":"FeatureCollection","features":features},
            "feature_count":len(features),"lat_col":lat_col,"lon_col":lon_col,"legend":legend,"colors":colors}

@app.post("/api/carto/vector")
def carto_vector(body: dict):
    ds_id = body.get("dataset_id")
    if ds_id not in datasets: raise HTTPException(status_code=404)
    df = datasets[ds_id]; value_col = body.get("value_col"); colormap = body.get("colormap","viridis")
    n_classes = int(body.get("n_classes",5)); classification = body.get("classification","quantile")
    clip_bbox = body.get("clip_bbox"); max_features = int(body.get("max_features",5000))
    colors = COLORMAPS_CSS.get(colormap, COLORMAPS_CSS["viridis"])
    has_wkt = "_geom_wkt" in df.columns
    lat_col = next((c for c in df.columns if c.lower() in ("lat","latitude","_latitude","_centroid_lat")),None)
    lon_col = next((c for c in df.columns if c.lower() in ("lon","lng","longitude","_longitude","_centroid_lon")),None)
    color_map = {}; legend = []; breaks = np.array([])
    if value_col and value_col in df.columns:
        vals = pd.to_numeric(df[value_col],errors="coerce").fillna(np.nan).values.astype(float)
        breaks = _classify(vals, classification, n_classes)
        class_idxs = np.searchsorted(breaks[1:-1], vals)
        n_c = len(colors); n_cls = len(breaks)-1
        for i, cls in enumerate(class_idxs):
            t = np.clip(cls/max(n_cls-1,1),0,1); bucket = int(t*(n_c-1))
            color_map[i] = colors[min(bucket,n_c-1)]
        for i in range(n_cls):
            t = i/max(n_cls-1,1); bucket = int(t*(n_c-1))
            legend.append({"color":colors[min(bucket,n_c-1)],"label":f"{breaks[i]:.3g} – {breaks[i+1]:.3g}"})
    features = []
    if HAS_GEOPANDAS and has_wkt:
        try:
            from shapely import wkt as swkt
            from shapely.geometry import mapping as smapping
            for i,(_, row) in enumerate(df.head(max_features).iterrows()):
                try: geom = smapping(swkt.loads(str(row["_geom_wkt"])))
                except: continue
                prop_cols = [c for c in df.columns if not c.startswith("_")][:10]
                props = {c: (None if (isinstance(row.get(c),float) and np.isnan(row[c])) else (float(row[c]) if isinstance(row.get(c),(int,float)) else str(row.get(c,"")))) for c in prop_cols}
                if value_col: props["_color"] = color_map.get(i,colors[0]); props["_value"] = props.get(value_col)
                if clip_bbox and lat_col and lon_col:
                    try:
                        clat, clon = float(row.get(lat_col,row.get("_centroid_lat",0))), float(row.get(lon_col,row.get("_centroid_lon",0)))
                        if not (clip_bbox["min_lat"]<=clat<=clip_bbox["max_lat"] and clip_bbox["min_lon"]<=clon<=clip_bbox["max_lon"]): continue
                    except: pass
                features.append({"type":"Feature","geometry":geom,"properties":props})
        except: pass
    if not features and lat_col and lon_col:
        for i,(_, row) in enumerate(df.dropna(subset=[lat_col,lon_col]).head(max_features).iterrows()):
            try: lat, lon = float(row[lat_col]), float(row[lon_col])
            except: continue
            if clip_bbox and not (clip_bbox["min_lat"]<=lat<=clip_bbox["max_lat"] and clip_bbox["min_lon"]<=lon<=clip_bbox["max_lon"]): continue
            props = {c: (None if (isinstance(row.get(c),float) and np.isnan(row[c])) else (float(row[c]) if pd.api.types.is_numeric_dtype(df[c]) else str(row[c]))) for c in df.columns if not c.startswith("_")}
            if value_col: props["_color"] = color_map.get(i,colors[0]); props["_value"] = props.get(value_col)
            features.append({"type":"Feature","geometry":{"type":"Point","coordinates":[lon,lat]},"properties":props})
    return {"type":"geojson","geojson":{"type":"FeatureCollection","features":features},
            "feature_count":len(features),"legend":legend,"colormap":colormap,"colors":colors,"has_geometry":has_wkt and bool(features)}

# ── Analysis ──────────────────────────────────────────────────────────────────

class AnalysisRequest(BaseModel):
    dataset_ids: List[str]; analysis_type: str; variables: List[str]
    params: Optional[Dict[str,Any]] = {}

@app.post("/api/analyze")
def run_analysis(req: AnalysisRequest):
    def resolve(var):
        if "::" in var:
            ds_id, col = var.split("::",1); return ds_id, col
        return (req.dataset_ids[0] if req.dataset_ids else None), var
    def get_series(var):
        ds_id, col = resolve(var)
        if ds_id not in datasets: raise HTTPException(status_code=404, detail=f"Dataset '{ds_id}' not found")
        if col not in datasets[ds_id].columns: raise HTTPException(status_code=400, detail=f"Column '{col}' not found")
        return datasets[ds_id][col]
    t = req.analysis_type
    try:
        if t == "describe":
            results = {}
            for v in req.variables:
                s = get_series(v).dropna()
                if pd.api.types.is_numeric_dtype(s):
                    results[v] = {"mean":safe_float(s.mean()),"median":safe_float(s.median()),
                        "std":safe_float(s.std()),"min":safe_float(s.min()),"max":safe_float(s.max()),
                        "q1":safe_float(s.quantile(.25)),"q3":safe_float(s.quantile(.75)),
                        "skew":safe_float(s.skew()),"kurtosis":safe_float(s.kurtosis()),
                        "count":int(s.count()),"missing":int(get_series(v).isna().sum())}
                else:
                    vc = s.value_counts()
                    results[v] = {"unique":int(s.nunique()),"mode":str(s.mode().iloc[0]) if len(s)>0 else None,
                        "top_values":{str(k):int(n) for k,n in vc.head(10).items()}}
            return {"type":"describe","results":results}
        elif t == "correlation":
            series = {v: get_series(v).dropna() for v in req.variables}
            df_sub = pd.DataFrame(series).dropna(); method = req.params.get("method","pearson")
            corr = df_sub.corr(method=method); pvals = {}
            if HAS_SCIPY:
                for c1 in corr.columns:
                    pvals[c1] = {}
                    for c2 in corr.columns:
                        if c1==c2: pvals[c1][c2]=0.0
                        else:
                            try: _,p = scipy_stats.pearsonr(df_sub[c1].dropna(),df_sub[c2].dropna()); pvals[c1][c2]=safe_float(p)
                            except: pvals[c1][c2]=None
            return {"type":"correlation","method":method,"n":len(df_sub),
                "matrix":{c:{c2:safe_float(v) for c2,v in row.items()} for c,row in corr.to_dict().items()},"pvalues":pvals}
        elif t == "regression":
            dep_var = req.params.get("dependent",req.variables[-1]); indep_vars = [v for v in req.variables if v!=dep_var]
            series = {v: get_series(v) for v in req.variables}; df_sub = pd.DataFrame(series).dropna()
            y, X = df_sub[dep_var], df_sub[indep_vars]
            if HAS_STATSMODELS:
                X_sm = sm.add_constant(X); model = sm.OLS(y,X_sm).fit()
                _,bp_pval,_,_ = het_breuschpagan(model.resid,X_sm)
                return {"type":"regression","dependent":dep_var,"independent":indep_vars,
                    "r_squared":safe_float(model.rsquared),"adj_r_squared":safe_float(model.rsquared_adj),
                    "f_statistic":safe_float(model.fvalue),"f_pvalue":safe_float(model.f_pvalue),
                    "aic":safe_float(model.aic),"bic":safe_float(model.bic),"n":int(model.nobs),
                    "durbin_watson":safe_float(durbin_watson(model.resid)),"breusch_pagan_pvalue":safe_float(bp_pval),
                    "coefficients":{v:{"coef":safe_float(model.params[v]),"std_err":safe_float(model.bse[v]),
                        "t_stat":safe_float(model.tvalues[v]),"p_value":safe_float(model.pvalues[v]),
                        "ci_lower":safe_float(model.conf_int().loc[v,0]),"ci_upper":safe_float(model.conf_int().loc[v,1])}
                        for v in model.params.index},
                    "residuals":[safe_float(v) for v in model.resid.tolist()[:1000]],
                    "fitted_values":[safe_float(v) for v in model.fittedvalues.tolist()[:1000]]}
            else:
                X_np = np.column_stack([np.ones(len(X))]+[X[c].values for c in indep_vars])
                coeffs,_,_,_ = np.linalg.lstsq(X_np,y.values,rcond=None)
                ss_res = np.sum((y.values-X_np@coeffs)**2); ss_tot = np.sum((y.values-y.mean())**2)
                return {"type":"regression","dependent":dep_var,"independent":indep_vars,
                    "r_squared":safe_float(1-ss_res/ss_tot if ss_tot!=0 else 0),
                    "coefficients":{(["const"]+indep_vars)[i]:{"coef":safe_float(c)} for i,c in enumerate(coeffs)},
                    "note":"Install statsmodels for full diagnostics"}
        elif t == "ttest":
            if not HAS_SCIPY: return {"error":"scipy required"}
            s1 = get_series(req.variables[0]).dropna()
            if len(req.variables)>=2:
                s2 = get_series(req.variables[1]).dropna(); stat,pval = scipy_stats.ttest_ind(s1,s2); test_type="two-sample"
            else:
                mu = req.params.get("mu",0); stat,pval = scipy_stats.ttest_1samp(s1,mu); test_type,s2 = "one-sample",None
            return {"type":"ttest","test_type":test_type,"statistic":safe_float(stat),"pvalue":safe_float(pval),
                "significant":bool(pval<0.05),
                "group1":{"n":int(len(s1)),"mean":safe_float(s1.mean()),"std":safe_float(s1.std())},
                "group2":{"n":int(len(s2)),"mean":safe_float(s2.mean()),"std":safe_float(s2.std())} if s2 is not None else None}
        elif t == "anova":
            if not HAS_SCIPY: return {"error":"scipy required"}
            groups = [get_series(v).dropna().values for v in req.variables]; stat,pval = scipy_stats.f_oneway(*groups)
            return {"type":"anova","f_statistic":safe_float(stat),"pvalue":safe_float(pval),"significant":bool(pval<0.05),
                "groups":[{"variable":v,"n":len(g),"mean":safe_float(float(np.mean(g))),"std":safe_float(float(np.std(g)))} for v,g in zip(req.variables,groups)]}
        elif t == "chi2":
            if not HAS_SCIPY: return {"error":"scipy required"}
            df_ct = pd.crosstab(get_series(req.variables[0]),get_series(req.variables[1]))
            stat,pval,dof,_ = scipy_stats.chi2_contingency(df_ct)
            return {"type":"chi2","statistic":safe_float(stat),"pvalue":safe_float(pval),"dof":int(dof),"significant":bool(pval<0.05)}
        elif t == "normality":
            if not HAS_SCIPY: return {"error":"scipy required"}
            results = {}
            for v in req.variables:
                s = get_series(v).dropna()
                if not pd.api.types.is_numeric_dtype(s): continue
                sw_stat,sw_p = scipy_stats.shapiro(s[:5000]); k2_stat,k2_p = scipy_stats.normaltest(s)
                results[v] = {"shapiro_wilk":{"statistic":safe_float(sw_stat),"pvalue":safe_float(sw_p),"normal":bool(sw_p>0.05)},
                              "dagostino_k2":{"statistic":safe_float(k2_stat),"pvalue":safe_float(k2_p),"normal":bool(k2_p>0.05)}}
            return {"type":"normality","results":results}
        elif t == "pca":
            if not HAS_SKLEARN: return {"error":"scikit-learn required"}
            series = {v: get_series(v) for v in req.variables}; df_sub = pd.DataFrame(series).dropna()
            n_components = min(req.params.get("n_components",len(req.variables)),len(req.variables))
            scaler = StandardScaler(); X_scaled = scaler.fit_transform(df_sub)
            pca = PCA(n_components=n_components); components = pca.fit_transform(X_scaled)
            return {"type":"pca","explained_variance_ratio":[safe_float(v) for v in pca.explained_variance_ratio_],
                "cumulative_variance":[safe_float(v) for v in np.cumsum(pca.explained_variance_ratio_)],
                "loadings":{req.variables[i]:[safe_float(v) for v in pca.components_[:,i]] for i in range(len(req.variables))},
                "scores":components[:,:2].tolist(),"n_components":n_components}
        elif t == "cluster":
            if not HAS_SKLEARN: return {"error":"scikit-learn required"}
            series = {v: get_series(v) for v in req.variables}; df_sub = pd.DataFrame(series).dropna()
            k = req.params.get("k",3); scaler = StandardScaler(); X_scaled = scaler.fit_transform(df_sub)
            km = KMeans(n_clusters=k,random_state=42,n_init=10); labels = km.fit_predict(X_scaled)
            inertias = [{"k":ki,"inertia":safe_float(KMeans(n_clusters=ki,random_state=42,n_init=10).fit(X_scaled).inertia_)} for ki in range(2,min(10,len(df_sub)))]
            centers = scaler.inverse_transform(km.cluster_centers_)
            return {"type":"cluster","k":k,"labels":[int(l) for l in labels],
                "centers":[{req.variables[j]:safe_float(centers[i][j]) for j in range(len(req.variables))} for i in range(k)],
                "inertia":safe_float(km.inertia_),"elbow_data":inertias,
                "counts":{str(i):int((labels==i).sum()) for i in range(k)}}
        elif t == "join":
            if len(req.dataset_ids)<2: raise HTTPException(status_code=400,detail="Join requires 2 datasets")
            left_id,right_id = req.dataset_ids[0],req.dataset_ids[1]
            left_key = req.params.get("left_key"); right_key = req.params.get("right_key",left_key); how = req.params.get("how","inner")
            merged = datasets[left_id].merge(datasets[right_id],left_on=left_key,right_on=right_key,how=how,suffixes=("_left","_right"))
            new_id = f"{left_id}_x_{right_id}"; datasets[new_id] = merged
            return {"type":"join","new_dataset_id":new_id,"shape":list(merged.shape),
                "columns":list(merged.columns),"types":infer_types(merged),"preview":df_to_json(merged)}
        elif t == "timeseries":
            if not HAS_STATSMODELS: return {"error":"statsmodels required"}
            from statsmodels.tsa.seasonal import seasonal_decompose
            s = get_series(req.variables[0]).dropna(); period = req.params.get("period",12)
            decomp = seasonal_decompose(s.values,model=req.params.get("model","additive"),period=period)
            return {"type":"timeseries","trend":[safe_float(v) for v in decomp.trend],
                "seasonal":[safe_float(v) for v in decomp.seasonal],
                "residual":[safe_float(v) for v in decomp.resid],"observed":[safe_float(v) for v in decomp.observed]}
        else: raise HTTPException(status_code=400,detail=f"Unknown analysis: {t}")
    except HTTPException: raise
    except Exception as e: raise HTTPException(status_code=500,detail=f"Analysis error: {str(e)}\n{traceback.format_exc()}")

class ChartRequest(BaseModel):
    dataset_id: str; chart_type: str; x: Optional[str]=None; y: Optional[str]=None
    color: Optional[str]=None; size: Optional[str]=None; group_by: Optional[str]=None
    agg: Optional[str]="mean"; bins: Optional[int]=30; limit: Optional[int]=5000

@app.post("/api/chart-data")
def get_chart_data(req: ChartRequest):
    if req.dataset_id not in datasets: raise HTTPException(status_code=404)
    df = datasets[req.dataset_id].replace([np.nan,np.inf,-np.inf],None)
    if req.chart_type in ("scatter","bubble"):
        cols = [c for c in [req.x,req.y,req.color,req.size] if c and c in df.columns]
        return {"data":df[cols].dropna().head(req.limit).to_dict(orient="records"),"columns":cols}
    elif req.chart_type in ("bar","line"):
        if req.x and req.y:
            result = df.groupby(req.x)[req.y].agg({"mean":"mean","sum":"sum","count":"count","median":"median","min":"min","max":"max"}.get(req.agg,"mean")).reset_index()
            return {"data":result.replace([np.nan,None],0).to_dict(orient="records"),"columns":list(result.columns)}
    elif req.chart_type == "histogram":
        if req.x and req.x in df.columns:
            vals = df[req.x].dropna()
            if pd.api.types.is_numeric_dtype(vals):
                counts,edges = np.histogram(vals,bins=req.bins)
                return {"labels":[f"{e:.4g}–{edges[i+1]:.4g}" for i,e in enumerate(edges[:-1])],"values":[int(c) for c in counts]}
    elif req.chart_type == "boxplot":
        cols = [c.strip() for c in (req.y or "").split(",") if c.strip() in df.columns]; result = {}
        for col in cols:
            vals = df[col].dropna()
            if pd.api.types.is_numeric_dtype(vals):
                q1,q3 = float(vals.quantile(.25)),float(vals.quantile(.75)); iqr = q3-q1
                result[col] = {"min":safe_float(vals.min()),"q1":q1,"median":safe_float(vals.median()),
                    "q3":q3,"max":safe_float(vals.max()),"mean":safe_float(vals.mean()),
                    "outliers":[safe_float(v) for v in vals[(vals<q1-1.5*iqr)|(vals>q3+1.5*iqr)].head(200)]}
        return {"type":"boxplot","data":result}
    elif req.chart_type == "heatmap":
        num_cols = [c for c in df.select_dtypes(include=np.number).columns][:15]
        corr = df[num_cols].corr().replace([np.nan],None)
        return {"columns":num_cols,"matrix":{c:{c2:safe_float(v) for c2,v in row.items()} for c,row in corr.to_dict().items()}}
    return {"data":[],"columns":[]}

# ══════════════════════════════════════════════════════════════════════════════
#  SQL Lab  —  query every loaded dataset with DuckDB, then turn any result into
#  a first-class dataset that flows through the rest of the app (with lineage).
# ══════════════════════════════════════════════════════════════════════════════

import re as _re

def _sanitize_ident(name: str, used: set) -> str:
    """Turn an arbitrary dataset id into a bare, unquoted DuckDB table name."""
    base = _re.sub(r"[^0-9a-zA-Z_]", "_", str(name)).strip("_").lower() or "t"
    if base[0].isdigit(): base = "t_" + base
    ident, n = base, 2
    while ident in used:
        ident = f"{base}_{n}"; n += 1
    used.add(ident)
    return ident

def _quote_ident(name: str) -> str:
    return '"' + str(name).replace('"', '""') + '"'

def _sql_catalog():
    """Map each loaded dataset -> a safe table name + column metadata."""
    used, catalog = set(), []
    for ds_id, df in datasets.items():
        table = _sanitize_ident(ds_id, used)
        catalog.append({
            "id": ds_id, "table": table,
            "row_count": int(len(df)),
            "kind": "vector" if ds_id in vector_cache else "table",
            "columns": [{"name": str(c), "type": str(df[c].dtype)} for c in df.columns],
        })
    return catalog

def _connect_sql():
    """Fresh in-memory DuckDB with every dataset registered; spatial is best-effort."""
    if not HAS_DUCKDB:
        raise HTTPException(status_code=503, detail="DuckDB is not installed. Run: pip install duckdb")
    con = duckdb.connect(database=":memory:")
    spatial = False
    try:
        con.execute("INSTALL spatial"); con.execute("LOAD spatial"); spatial = True
    except Exception:
        spatial = False
    catalog = _sql_catalog()
    for entry in catalog:
        df = datasets[entry["id"]]
        try:
            con.register(entry["table"], df)
            if entry["table"] != entry["id"]:
                # let people also write the exact filename in double quotes
                con.execute(f'CREATE OR REPLACE VIEW {_quote_ident(entry["id"])} '
                            f'AS SELECT * FROM {entry["table"]}')
        except Exception:
            pass
    return con, spatial, catalog

def _jsonable_cell(v):
    if v is None: return None
    if isinstance(v, float): return safe_float(v)
    if isinstance(v, (np.floating,)): return safe_float(float(v))
    if isinstance(v, (np.integer,)): return int(v)
    if isinstance(v, (np.bool_, bool)): return bool(v)
    if isinstance(v, (bytes, bytearray)):
        try:
            from shapely import wkb as _wkb
            return _wkb.loads(bytes(v)).wkt[:4000]
        except Exception:
            return v.hex()[:120]
    if isinstance(v, (pd.Timestamp,)): return v.isoformat()
    if isinstance(v, (str, int, bool)): return v
    return str(v)

def _relation_payload(rel, limit):
    """Serialise a DuckDB relation, converting GEOMETRY → WKT for display."""
    types = [str(t).upper() for t in rel.types]
    cols = [str(c) for c in rel.columns]
    has_geom = any("GEOMETRY" in t for t in types)
    total = None
    if not has_geom:
        try:
            df = rel.limit(limit + 1).df()
            truncated = len(df) > limit
            if truncated: df = df.head(limit)
            df = df.replace([np.nan, np.inf, -np.inf], None)
            rows = [{k: _jsonable_cell(v) for k, v in r.items()} for r in df.to_dict("records")]
            return {"columns": cols, "rows": rows, "returned": len(rows),
                    "truncated": truncated, "total_rows": total,
                    "dtypes": {c: str(df[c].dtype) for c in df.columns}}
        except Exception:
            pass
    # geometry-aware / fallback path
    fetched = rel.limit(limit + 1).fetchall()
    truncated = len(fetched) > limit
    fetched = fetched[:limit]
    rows = [{cols[i]: _jsonable_cell(val) for i, val in enumerate(row)} for row in fetched]
    return {"columns": cols, "rows": rows, "returned": len(rows),
            "truncated": truncated, "total_rows": total, "dtypes": {}}

def _run_sql(con, sql, limit):
    stmt = sql.strip().rstrip(";").strip()
    if not stmt:
        return {"columns": [], "rows": [], "returned": 0, "truncated": False, "message": "Nothing to run."}
    try:
        rel = con.sql(stmt)
    except Exception:
        con.execute(stmt)  # a side-effecting statement (CREATE/UPDATE/PRAGMA…)
        return {"columns": [], "rows": [], "returned": 0, "truncated": False,
                "message": "Statement executed — no rows returned."}
    if rel is None:
        con.execute(stmt)
        return {"columns": [], "rows": [], "returned": 0, "truncated": False,
                "message": "Statement executed — no rows returned."}
    payload = _relation_payload(rel, limit)
    try:
        payload["total_rows"] = int(con.sql(f"SELECT count(*) FROM ({stmt}) _q").fetchone()[0])
    except Exception:
        payload["total_rows"] = None
    return payload

class SqlQuery(BaseModel):
    sql: str
    limit: Optional[int] = 1000

class SqlMaterialize(BaseModel):
    sql: str
    name: str

@app.get("/api/sql/schema")
def sql_schema():
    return {"available": HAS_DUCKDB, "spatial": None if not HAS_DUCKDB else "runtime",
            "tables": _sql_catalog() if HAS_DUCKDB else []}

@app.post("/api/sql/query")
def sql_query(body: SqlQuery):
    con, spatial, _ = _connect_sql()
    limit = max(1, min(int(body.limit or 1000), 5000))
    import time as _t
    t0 = _t.perf_counter()
    try:
        result = _run_sql(con, body.sql, limit)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e).split("\n")[0][:400])
    finally:
        try: con.close()
        except Exception: pass
    result["elapsed_ms"] = round((_t.perf_counter() - t0) * 1000, 1)
    result["spatial"] = spatial
    return result

@app.post("/api/sql/materialize")
def sql_materialize(body: SqlMaterialize):
    con, _, catalog = _connect_sql()
    stmt = body.sql.strip().rstrip(";").strip()
    try:
        df = con.sql(stmt).df()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Query must return rows to save. {str(e).split(chr(10))[0][:300]}")
    finally:
        try: con.close()
        except Exception: pass
    # geometry columns from spatial results -> keep as WKT text so the table stays valid
    for c in df.columns:
        if df[c].dtype == object and len(df) and isinstance(df[c].iloc[0], (bytes, bytearray)):
            df[c] = df[c].apply(_jsonable_cell)
    new_id = _unique_dataset_id(body.name or "query_result")
    datasets[new_id] = df
    sources = [e["id"] for e in catalog if _re.search(rf'(?<![0-9a-zA-Z_]){_re.escape(e["table"])}(?![0-9a-zA-Z_])', stmt)
               or _quote_ident(e["id"]) in stmt]
    return {"id": new_id, "name": new_id, "format": "table",
            "shape": list(df.shape), "columns": list(df.columns),
            "types": infer_types(df), "preview": df_to_json(df),
            "missing": {c: int(df[c].isna().sum()) for c in df.columns},
            "derived": {"op": "sql", "sources": sources,
                        "detail": f"SQL query over {', '.join(sources) or 'loaded data'}",
                        "params": {"sql": stmt[:500]}}}

# ══════════════════════════════════════════════════════════════════════════════
#  Geoprocess  —  a compact vector toolbox (geopandas/shapely). Every tool emits
#  a new derived dataset that lands on the Cartography map automatically.
# ══════════════════════════════════════════════════════════════════════════════

def _unique_dataset_id(base: str) -> str:
    base = str(base).strip() or "result"
    if base not in datasets: return base
    n = 2
    while f"{base} ({n})" in datasets: n += 1
    return f"{base} ({n})"

def _get_vector_gdf(dataset_id):
    """Full-geometry GeoDataFrame for a dataset, or one built from lat/lon columns."""
    if not HAS_GEOPANDAS:
        raise HTTPException(status_code=503, detail="geopandas is not installed.")
    if dataset_id in vector_cache:
        gdf = vector_cache[dataset_id]
        if gdf.crs is None: gdf = gdf.set_crs("EPSG:4326", allow_override=True)
        return gdf
    df = datasets.get(dataset_id)
    if df is None:
        raise HTTPException(status_code=404, detail="Dataset not found.")
    lat = next((c for c in df.columns if str(c).lower() in ("lat", "latitude", "_latitude", "_centroid_lat")), None)
    lon = next((c for c in df.columns if str(c).lower() in ("lon", "lng", "longitude", "_longitude", "_centroid_lon")), None)
    if lat and lon:
        sub = df.dropna(subset=[lat, lon]).copy()
        drop = [c for c in sub.columns if str(c).startswith("_geom") or str(c).startswith("_centroid")]
        sub = sub.drop(columns=drop, errors="ignore")
        return gpd.GeoDataFrame(sub, geometry=gpd.points_from_xy(sub[lon], sub[lat]), crs="EPSG:4326")
    raise HTTPException(status_code=400,
        detail="This dataset has no geometry. Load a Shapefile/GeoJSON, or a table with lat/lon columns.")

def _store_derived_gdf(gdf, name, derived):
    """Persist a result GeoDataFrame as a map-ready, first-class dataset."""
    if gdf.crs is not None:
        try:
            if str(gdf.crs).upper() not in ("EPSG:4326", "OGC:CRS84"):
                gdf = gdf.to_crs("EPSG:4326")
        except Exception: pass
    else:
        gdf = gdf.set_crs("EPSG:4326", allow_override=True)
    gdf = gdf[~gdf.geometry.is_empty & gdf.geometry.notna()].copy()
    geom_type = "Unknown"
    try: geom_type = gdf.geometry.geom_type.value_counts().idxmax()
    except Exception: pass
    bounds = gdf.total_bounds.tolist() if not gdf.empty else []
    df = pd.DataFrame(gdf.drop(columns=["geometry"], errors="ignore"))
    try:
        import warnings as _w
        with _w.catch_warnings():
            _w.simplefilter("ignore")
            cent = gdf.geometry.centroid  # display hint only; approximate is fine
        df["_centroid_lon"] = cent.x.values
        df["_centroid_lat"] = cent.y.values
        df["_geom_type"] = gdf.geometry.geom_type.values
        df["_geom_wkt"] = gdf.geometry.apply(lambda g: g.wkt if g is not None else None)  # full fidelity
    except Exception: pass
    new_id = _unique_dataset_id(name)
    datasets[new_id] = df
    vector_cache[new_id] = gdf
    return {"id": new_id, "name": new_id, "format": "geojson",
            "shape": list(df.shape), "columns": list(df.columns),
            "types": infer_types(df), "preview": df_to_json(df),
            "missing": {c: int(df[c].isna().sum()) for c in df.columns},
            "geo_meta": {"geometry_type": geom_type, "crs": "EPSG:4326", "bounds": bounds,
                         "feature_count": int(len(gdf))},
            "derived": derived}

def _union_geom(gdf):
    geom = gdf.geometry
    return geom.union_all() if hasattr(geom, "union_all") else geom.unary_union

GEOPROCESS_TOOLS = {
    "buffer":       {"label": "Buffer",       "needs": ["distance"]},
    "centroid":     {"label": "Centroids",    "needs": []},
    "convex_hull":  {"label": "Convex hull",  "needs": []},
    "bounding_box": {"label": "Bounding box", "needs": []},
    "simplify":     {"label": "Simplify",     "needs": ["tolerance"]},
    "dissolve":     {"label": "Dissolve",     "needs": []},
    "spatial_join": {"label": "Spatial join", "needs": ["other_id"]},
    "clip":         {"label": "Clip",         "needs": ["other_id"]},
    "intersection": {"label": "Intersection", "needs": ["other_id"]},
    "difference":   {"label": "Difference",   "needs": ["other_id"]},
    "union":        {"label": "Union",        "needs": ["other_id"]},
    "voronoi":      {"label": "Voronoi",      "needs": []},
    "delaunay":     {"label": "Delaunay",     "needs": []},
    "regular_grid": {"label": "Regular grid", "needs": ["cell_km"]},
    "h3_grid":      {"label": "H3 hex grid",  "needs": ["resolution"]},
    "h3_bin":       {"label": "H3 binning",   "needs": ["resolution"]},
    "select_value": {"label": "Select by value",    "needs": ["column"]},
    "select_location": {"label": "Select by location", "needs": ["other_id"]},
    "attribute_join":  {"label": "Attribute join",     "needs": ["other_id", "key"]},
}

@app.get("/api/geoprocess/layers")
def geoprocess_layers():
    out = []
    for ds_id, df in datasets.items():
        source = None; geom_type = None; feats = int(len(df)); crs = None
        if ds_id in vector_cache:
            source = "vector"
            g = vector_cache[ds_id]
            try: geom_type = str(g.geometry.geom_type.value_counts().idxmax())
            except Exception: geom_type = "Unknown"
            crs = str(g.crs) if g.crs is not None else "EPSG:4326"
            feats = int(len(g))
        else:
            lat = next((c for c in df.columns if str(c).lower() in ("lat", "latitude", "_latitude", "_centroid_lat")), None)
            lon = next((c for c in df.columns if str(c).lower() in ("lon", "lng", "longitude", "_longitude", "_centroid_lon")), None)
            if lat and lon:
                source = "points"; geom_type = "Point"; crs = "EPSG:4326"
        if source:
            num_cols = [str(c) for c in df.columns if pd.api.types.is_numeric_dtype(df[c]) and not str(c).startswith("_")]
            cols = [str(c) for c in df.columns if not str(c).startswith("_")]
            out.append({"id": ds_id, "name": ds_id, "source": source, "geometry_type": geom_type,
                        "feature_count": feats, "crs": crs, "numeric_cols": num_cols, "columns": cols})
    return {"available": HAS_GEOPANDAS, "layers": out,
            "tools": [{"id": k, **v} for k, v in GEOPROCESS_TOOLS.items()]}

@app.post("/api/geoprocess/run")
def geoprocess_run(body: dict):
    if not HAS_GEOPANDAS:
        raise HTTPException(status_code=503, detail="geopandas is not installed.")
    tool = body.get("tool"); ds_id = body.get("dataset_id"); params = body.get("params", {}) or {}
    if tool not in GEOPROCESS_TOOLS:
        raise HTTPException(status_code=400, detail=f"Unknown tool: {tool}")
    from shapely.geometry import box as _box
    gdf = _get_vector_gdf(ds_id)
    if gdf.empty:
        raise HTTPException(status_code=400, detail="Input layer has no features.")
    detail = ""
    try:
        if tool == "buffer":
            dist = float(params.get("distance", 0))
            if dist == 0: raise ValueError("Buffer distance must be non-zero.")
            if gdf.crs is not None and gdf.crs.is_geographic:
                # Buffer each feature in a local equidistant projection so meters are
                # correct anywhere on Earth (a single UTM zone distorts far-away features).
                from shapely.ops import transform as _shp_transform
                import pyproj as _pyproj
                wgs84 = _pyproj.CRS("EPSG:4326")
                geoms = []
                for geom in gdf.geometry:
                    if geom is None or geom.is_empty:
                        geoms.append(geom); continue
                    c = geom.centroid
                    aeqd = _pyproj.CRS(f"+proj=aeqd +lat_0={c.y} +lon_0={c.x} +datum=WGS84 +units=m +no_defs")
                    fwd = _pyproj.Transformer.from_crs(wgs84, aeqd, always_xy=True).transform
                    inv = _pyproj.Transformer.from_crs(aeqd, wgs84, always_xy=True).transform
                    geoms.append(_shp_transform(inv, _shp_transform(fwd, geom).buffer(dist)))
                out = gdf.copy(); out["geometry"] = geoms; units = "m"
            else:
                out = gdf.copy(); out["geometry"] = gdf.buffer(dist); units = "units"
            detail = f"Buffered {ds_id} by {dist:g} {units}"

        elif tool == "centroid":
            out = gdf.copy()
            import warnings as _w
            with _w.catch_warnings():
                _w.simplefilter("ignore")
                out["geometry"] = gdf.geometry.centroid
            detail = f"Centroids of {ds_id}"

        elif tool == "convex_hull":
            hull = _union_geom(gdf).convex_hull
            out = gpd.GeoDataFrame({"name": [f"{ds_id} hull"]}, geometry=[hull], crs=gdf.crs)
            detail = f"Convex hull of {ds_id}"

        elif tool == "bounding_box":
            minx, miny, maxx, maxy = gdf.total_bounds
            out = gpd.GeoDataFrame({"name": [f"{ds_id} bbox"]}, geometry=[_box(minx, miny, maxx, maxy)], crs=gdf.crs)
            detail = f"Bounding box of {ds_id}"

        elif tool == "simplify":
            tol = float(params.get("tolerance", 0))
            if tol <= 0: raise ValueError("Tolerance must be greater than zero.")
            out = gdf.copy(); out["geometry"] = gdf.geometry.simplify(tol, preserve_topology=True)
            detail = f"Simplified {ds_id} (tolerance {tol:g})"

        elif tool == "dissolve":
            by = params.get("by")
            if by and by in gdf.columns:
                out = gdf.dissolve(by=by, as_index=False)
                detail = f"Dissolved {ds_id} by {by}"
            else:
                out = gpd.GeoDataFrame({"name": [f"{ds_id} dissolved"]}, geometry=[_union_geom(gdf)], crs=gdf.crs)
                detail = f"Dissolved {ds_id}"

        elif tool == "spatial_join":
            other_id = params.get("other_id")
            if not other_id: raise ValueError("Choose a second layer to join.")
            predicate = params.get("predicate", "intersects")
            how = params.get("how", "inner")
            left = gdf.to_crs("EPSG:4326") if gdf.crs else gdf.set_crs("EPSG:4326", allow_override=True)
            right = _get_vector_gdf(other_id)
            right = right.to_crs("EPSG:4326") if right.crs else right.set_crs("EPSG:4326", allow_override=True)
            out = gpd.sjoin(left, right, predicate=predicate, how=how).drop(columns=["index_right"], errors="ignore")
            detail = f"Spatial join {ds_id} ⨝ {other_id} ({predicate})"

        elif tool in ("clip", "intersection", "difference", "union"):
            other_id = params.get("other_id")
            if not other_id: raise ValueError("Choose a second (overlay) layer.")
            left = gdf.to_crs("EPSG:4326") if gdf.crs else gdf.set_crs("EPSG:4326", allow_override=True)
            right = _get_vector_gdf(other_id)
            right = right.to_crs("EPSG:4326") if right.crs else right.set_crs("EPSG:4326", allow_override=True)
            if tool == "clip":
                out = gpd.clip(left, right)
                detail = f"Clipped {ds_id} to {other_id}"
            else:
                try:
                    out = gpd.overlay(left, right, how=tool, keep_geom_type=False)
                except Exception as oe:
                    raise ValueError(f"{tool.title()} needs overlapping polygon layers. ({str(oe).split(chr(10))[0][:120]})")
                detail = f"{tool.title()} of {ds_id} and {other_id}"

        elif tool in ("voronoi", "delaunay"):
            from shapely.ops import voronoi_diagram, triangulate
            from shapely.geometry import MultiPoint
            pts = gdf.geometry.centroid if not (gdf.geometry.geom_type == "Point").all() else gdf.geometry
            mp = MultiPoint([p for p in pts if p is not None])
            if len(mp.geoms) < 3: raise ValueError("Need at least 3 points.")
            if tool == "voronoi":
                env = mp.convex_hull.buffer(mp.convex_hull.length * 0.1 + 0.5)
                cells = [g.intersection(env) for g in voronoi_diagram(mp).geoms]
                out = gpd.GeoDataFrame({"cell": range(len(cells))}, geometry=cells, crs=gdf.crs)
                detail = f"Voronoi polygons from {ds_id}"
            else:
                tris = triangulate(mp)
                out = gpd.GeoDataFrame({"tri": range(len(tris))}, geometry=tris, crs=gdf.crs)
                detail = f"Delaunay triangulation from {ds_id}"

        elif tool == "regular_grid":
            from shapely.geometry import box as _box
            cell_km = float(params.get("cell_km", 0))
            if cell_km <= 0: raise ValueError("Cell size must be greater than zero.")
            minx, miny, maxx, maxy = gdf.total_bounds
            deg = cell_km / 111.0
            cells, i = [], 0
            y = miny
            while y < maxy and i < 100000:
                x = minx
                while x < maxx and i < 100000:
                    cells.append(_box(x, y, min(x + deg, maxx), min(y + deg, maxy))); x += deg; i += 1
                y += deg
            out = gpd.GeoDataFrame({"cell": range(len(cells))}, geometry=cells, crs="EPSG:4326")
            detail = f"{len(cells)}-cell grid over {ds_id} ({cell_km:g} km)"

        elif tool == "h3_grid":
            import h3
            from shapely.geometry import Polygon as _Poly
            res = int(params.get("resolution", 3))
            g84 = gdf.to_crs("EPSG:4326") if gdf.crs else gdf.set_crs("EPSG:4326", allow_override=True)
            cellset = set()
            for geom in g84.geometry:
                if geom is None: continue
                try:
                    gj = geom.__geo_interface__
                    cellset |= set(h3.geo_to_cells(gj, res)) if hasattr(h3, "geo_to_cells") else set(h3.polyfill(gj, res, geo_json_conformant=True))
                except Exception:
                    c = geom.centroid; cellset.add(h3.latlng_to_cell(c.y, c.x, res) if hasattr(h3, "latlng_to_cell") else h3.geo_to_h3(c.y, c.x, res))
            polys, ids = [], []
            for cell in cellset:
                bnd = h3.cell_to_boundary(cell) if hasattr(h3, "cell_to_boundary") else h3.h3_to_geo_boundary(cell)
                polys.append(_Poly([(lng, lat) for lat, lng in bnd])); ids.append(cell)
            out = gpd.GeoDataFrame({"h3": ids}, geometry=polys, crs="EPSG:4326")
            detail = f"{len(polys)} H3 cells (res {res}) over {ds_id}"

        elif tool == "h3_bin":
            import h3
            from shapely.geometry import Polygon as _Poly
            res = int(params.get("resolution", 3))
            g84 = gdf.to_crs("EPSG:4326") if gdf.crs else gdf.set_crs("EPSG:4326", allow_override=True)
            pts = g84.geometry.centroid if not (g84.geometry.geom_type == "Point").all() else g84.geometry
            counts = {}
            for p in pts:
                if p is None: continue
                cell = h3.latlng_to_cell(p.y, p.x, res) if hasattr(h3, "latlng_to_cell") else h3.geo_to_h3(p.y, p.x, res)
                counts[cell] = counts.get(cell, 0) + 1
            polys, ids, cs = [], [], []
            for cell, cnt in counts.items():
                bnd = h3.cell_to_boundary(cell) if hasattr(h3, "cell_to_boundary") else h3.h3_to_geo_boundary(cell)
                polys.append(_Poly([(lng, lat) for lat, lng in bnd])); ids.append(cell); cs.append(cnt)
            out = gpd.GeoDataFrame({"h3": ids, "count": cs}, geometry=polys, crs="EPSG:4326")
            detail = f"Binned {len(pts)} points into {len(polys)} H3 cells (res {res})"

        elif tool == "select_value":
            col = params.get("column"); op = params.get("op", "="); val = params.get("value", "")
            if not col or col not in gdf.columns: raise ValueError("Choose a column to filter on.")
            s = gdf[col]
            try:
                num = float(val); sn = pd.to_numeric(s, errors="coerce")
                mask = {">" : sn > num, ">=": sn >= num, "<": sn < num, "<=": sn <= num,
                        "=": sn == num, "!=": sn != num}.get(op)
                if mask is None or mask.notna().sum() == 0: raise ValueError
            except Exception:
                sv = s.astype(str)
                mask = {"=": sv == str(val), "!=": sv != str(val),
                        "contains": sv.str.contains(str(val), case=False, na=False),
                        "starts": sv.str.startswith(str(val))}.get(op, sv == str(val))
            out = gdf[mask.fillna(False)].copy()
            if out.empty: raise ValueError("No features matched that condition.")
            detail = f"Selected {ds_id} where {col} {op} {val} ({len(out)} features)"

        elif tool == "select_location":
            other_id = params.get("other_id"); predicate = params.get("predicate", "intersects")
            if not other_id: raise ValueError("Choose a layer to select against.")
            left = gdf.to_crs("EPSG:4326") if gdf.crs else gdf.set_crs("EPSG:4326", allow_override=True)
            right = _get_vector_gdf(other_id)
            right = right.to_crs("EPSG:4326") if right.crs else right.set_crs("EPSG:4326", allow_override=True)
            idx = gpd.sjoin(left, right[["geometry"]], predicate=predicate, how="inner").index.unique()
            out = left.loc[idx].copy()
            if out.empty: raise ValueError("No features matched that spatial relationship.")
            detail = f"Selected {ds_id} {predicate} {other_id} ({len(out)} features)"

        elif tool == "attribute_join":
            other_id = params.get("other_id"); key = params.get("key")
            key2 = params.get("key2") or key
            if not other_id or not key: raise ValueError("Choose a table and a key column.")
            right_df = datasets.get(other_id)
            if right_df is None: raise ValueError("Join table not found.")
            right_df = right_df[[c for c in right_df.columns if not str(c).startswith("_")]]
            out = gdf.merge(right_df, left_on=key, right_on=key2, how="left", suffixes=("", "_joined"))
            out = gpd.GeoDataFrame(out, geometry=gdf.geometry.values, crs=gdf.crs)
            detail = f"Joined {other_id} onto {ds_id} on {key}"
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e).split("\n")[0][:400])

    name = body.get("output_name") or f"{GEOPROCESS_TOOLS[tool]['label']} · {ds_id}"
    sources = [ds_id] + ([params["other_id"]] if tool == "spatial_join" and params.get("other_id") else [])
    return _store_derived_gdf(out, name, {"op": tool, "sources": sources, "detail": detail, "params": params})


# ══════════════════════════════════════════════════════════════════════════════
#  Raster tools  —  terrain (hillshade / slope / aspect) and spectral indices
#  (NDVI / NDWI / EVI). Each reads a raster dataset and writes a new GeoTIFF that
#  registers as a first-class raster dataset (shows on the Cartography map).
# ══════════════════════════════════════════════════════════════════════════════

RASTER_TOOLS = {
    "hillshade": {"label": "Hillshade", "family": "terrain", "needs": []},
    "slope":     {"label": "Slope",     "family": "terrain", "needs": []},
    "aspect":    {"label": "Aspect",    "family": "terrain", "needs": []},
    "ndvi":      {"label": "NDVI",       "family": "spectral", "needs": ["red", "nir"]},
    "ndwi":      {"label": "NDWI",       "family": "spectral", "needs": ["green", "nir"]},
    "evi":       {"label": "EVI",        "family": "spectral", "needs": ["red", "nir", "blue"]},
    "reproject": {"label": "Reproject",  "family": "transform", "needs": ["target_crs"]},
    "resample":  {"label": "Resample",   "family": "transform", "needs": ["factor"]},
    "reclassify":{"label": "Reclassify", "family": "transform", "needs": ["breaks"]},
    "contour":   {"label": "Contour",    "family": "convert", "needs": ["interval"]},
    "polygonize":{"label": "Polygonize", "family": "convert", "needs": []},
    "zonal_stats":{"label": "Zonal statistics", "family": "convert", "needs": ["zones_id"]},
}

def _cellsize_meters(src):
    """Approximate pixel size in meters, even for degree-based (geographic) rasters."""
    rx, ry = abs(src.res[0]), abs(src.res[1])
    try:
        if src.crs and src.crs.is_geographic:
            lat0 = (src.bounds.top + src.bounds.bottom) / 2.0
            return rx * 111320.0 * max(np.cos(np.radians(lat0)), 0.01), ry * 110540.0
    except Exception:
        pass
    return rx, ry

def _register_raster_path(path, name, derived, colormap="viridis"):
    """Register an already-written single-band GeoTIFF as a raster dataset."""
    new_id = _unique_dataset_id(name)
    raster_cache[new_id] = path
    with rasterio.open(path) as r:
        h, w = r.height, r.width; b = r.bounds
        stride = max(1, int(np.sqrt(h * w / 5000))); oh, ow = max(1, h // stride), max(1, w // stride)
        d = r.read(1, out_shape=(oh, ow), resampling=Resampling.average).astype(np.float32)
        nod = r.nodata
        if nod is not None: d[d == nod] = np.nan
        xs = np.linspace(b.left, b.right, ow); ys = np.linspace(b.top, b.bottom, oh)
        xg, yg = np.meshgrid(xs, ys)
        df = pd.DataFrame({"longitude": xg.flatten(), "latitude": yg.flatten(), "value": d.flatten()})
        bstats = array_stats(d)
        thumb = raster_band_thumb(r, 1, 512, colormap)
        crs_str = crs_to_str(r.crs); bounds = list(r.bounds); res = list(r.res); W, H = r.width, r.height
    datasets[new_id] = df
    return {"id": new_id, "name": new_id, "format": "tif",
            "shape": list(df.shape), "columns": list(df.columns),
            "types": infer_types(df), "preview": df_to_json(df),
            "missing": {c: int(df[c].isna().sum()) for c in df.columns},
            "raster_meta": {"driver": "GTiff", "bands": 1, "width": W, "height": H,
                            "crs": crs_str, "bounds": bounds, "resolution": res, "nodata": None,
                            "is_rgb": False, "is_dem": derived.get("op") in ("hillshade", "slope", "aspect", "reproject", "resample"),
                            "is_multispectral": False,
                            "band_stats": [{"band": 1, "name": derived.get("op", "result"), "dtype": "float32", **bstats}],
                            "thumbnails": [{"band": 1, "name": derived.get("op"), "thumbnail": thumb}], "tags": {}},
            "derived": derived}

def _write_raster_dataset(array, src, name, derived, colormap="viridis", nodata=np.nan):
    """Persist a computed 2-D array (on src's grid) as a new single-band raster dataset."""
    if not HAS_RASTERIO:
        raise HTTPException(status_code=503, detail="rasterio is not installed.")
    arr = array.astype(np.float32)
    profile = src.profile.copy()
    profile.update(count=1, dtype="float32", driver="GTiff", nodata=-9999.0)
    out = np.where(np.isfinite(arr), arr, -9999.0).astype(np.float32)
    fd, path = tempfile.mkstemp(suffix=".tif"); os.close(fd); tmp_files.append(path)
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(out, 1)
    return _register_raster_path(path, name, derived, colormap)

@app.get("/api/raster-tools/layers")
def raster_tools_layers():
    layers = []
    for ds_id in datasets:
        if ds_id in raster_cache:
            try:
                with rasterio.open(raster_cache[ds_id]) as src:
                    layers.append({"id": ds_id, "name": ds_id, "bands": src.count,
                                   "width": src.width, "height": src.height,
                                   "is_dem": src.count == 1})
            except Exception:
                pass
    return {"available": HAS_RASTERIO, "layers": layers,
            "tools": [{"id": k, **v} for k, v in RASTER_TOOLS.items()]}

@app.post("/api/raster-tools/run")
def raster_tools_run(body: dict):
    if not HAS_RASTERIO:
        raise HTTPException(status_code=503, detail="rasterio is not installed.")
    tool = body.get("tool"); ds_id = body.get("dataset_id"); params = body.get("params", {}) or {}
    if tool not in RASTER_TOOLS:
        raise HTTPException(status_code=400, detail=f"Unknown raster tool: {tool}")
    if ds_id not in raster_cache:
        raise HTTPException(status_code=400, detail="Choose a raster layer (a GeoTIFF, DEM, or COG).")
    src_path = raster_cache[ds_id]
    name = body.get("output_name") or f"{RASTER_TOOLS[tool]['label']} · {ds_id}"

    # ---- transform / convert tools (own output grid or vector output) ----
    try:
        if tool in ("reproject", "resample"):
            from rasterio.warp import calculate_default_transform, reproject as rio_reproject
            with rasterio.open(src_path) as src:
                if tool == "reproject":
                    dst_crs = str(params.get("target_crs", "")).strip() or "EPSG:3857"
                    transform, w, h = calculate_default_transform(src.crs, dst_crs, src.width, src.height, *src.bounds)
                    detail = f"Reprojected {ds_id} to {dst_crs}"
                else:
                    factor = float(params.get("factor", 2))
                    if factor <= 0: raise ValueError("Factor must be greater than zero.")
                    dst_crs = src.crs
                    w, h = max(1, int(src.width / factor)), max(1, int(src.height / factor))
                    transform = src.transform * src.transform.scale(src.width / w, src.height / h)
                    detail = f"Resampled {ds_id} (×{factor:g})"
                prof = src.profile.copy()
                prof.update(crs=dst_crs, transform=transform, width=w, height=h, count=1, dtype="float32", nodata=-9999.0, driver="GTiff")
                fd, path = tempfile.mkstemp(suffix=".tif"); os.close(fd); tmp_files.append(path)
                rs = Resampling.bilinear if params.get("method") == "bilinear" else Resampling.nearest
                with rasterio.open(path, "w", **prof) as dst:
                    rio_reproject(source=rasterio.band(src, 1), destination=rasterio.band(dst, 1),
                                  src_transform=src.transform, src_crs=src.crs,
                                  dst_transform=transform, dst_crs=dst_crs, resampling=rs)
            return _register_raster_path(path, name, {"op": tool, "sources": [ds_id], "detail": detail, "params": params})

        if tool == "reclassify":
            with rasterio.open(src_path) as src:
                a = src.read(1).astype(np.float32)
                if src.nodata is not None: a[a == src.nodata] = np.nan
                breaks = params.get("breaks")
                if isinstance(breaks, str): breaks = [float(x) for x in breaks.replace(" ", "").split(",") if x != ""]
                if not breaks or len(breaks) < 1: raise ValueError("Give class breaks, e.g. 100,200,300")
                edges = [-np.inf] + sorted(float(b) for b in breaks) + [np.inf]
                out = np.full(a.shape, np.nan, dtype=np.float32)
                for i in range(len(edges) - 1):
                    out[(a >= edges[i]) & (a < edges[i + 1])] = i + 1
                out[np.isnan(a)] = np.nan
                return _write_raster_dataset(out, src, name, {"op": "reclassify", "sources": [ds_id], "detail": f"Reclassified {ds_id} into {len(edges)-1} classes", "params": params}, colormap="viridis")

        if tool in ("contour", "polygonize"):
            with rasterio.open(src_path) as src:
                a = src.read(1).astype(np.float32); transform = src.transform; crs = src.crs
                nod = src.nodata
            if tool == "polygonize":
                from rasterio.features import shapes as rio_shapes
                from shapely.geometry import shape as shp_shape
                mask = ~np.isnan(a) if nod is None else (a != nod)
                q = np.round(a).astype(np.int32)
                geoms, vals = [], []
                for geom, val in rio_shapes(q, mask=mask, transform=transform):
                    geoms.append(shp_shape(geom)); vals.append(val)
                g = gpd.GeoDataFrame({"value": vals}, geometry=geoms, crs=crs)
                if len(g) > 20000: g = g.iloc[:20000]
                return _store_derived_gdf(g, name, {"op": "polygonize", "sources": [ds_id], "detail": f"Polygonized {ds_id} ({len(g)} shapes)", "params": params})
            else:  # contour
                try:
                    from skimage import measure
                    have_ski = True
                except Exception:
                    have_ski = False
                if not have_ski:
                    raise ValueError("Contour needs scikit-image on the backend.")
                from shapely.geometry import LineString as _LS
                interval = float(params.get("interval", 0))
                if interval <= 0: raise ValueError("Contour interval must be greater than zero.")
                finite = a[np.isfinite(a)]
                lo, hi = float(np.nanmin(finite)), float(np.nanmax(finite))
                levels = np.arange(np.ceil(lo / interval) * interval, hi, interval)
                geoms, lv = [], []
                filled = np.where(np.isfinite(a), a, lo - 1)
                for level in levels:
                    for c in measure.find_contours(filled, level):
                        pts = [transform * (x, y) for y, x in c]  # (col,row)->(x,y)
                        if len(pts) >= 2: geoms.append(_LS(pts)); lv.append(round(float(level), 3))
                if not geoms: raise ValueError("No contours at that interval — try a smaller value.")
                g = gpd.GeoDataFrame({"level": lv}, geometry=geoms, crs=crs)
                return _store_derived_gdf(g, name, {"op": "contour", "sources": [ds_id], "detail": f"Contours of {ds_id} every {interval:g}", "params": params})

        if tool == "zonal_stats":
            zones_id = params.get("zones_id")
            if not zones_id: raise ValueError("Choose a polygon layer for the zones.")
            zones = _get_vector_gdf(zones_id)
            with rasterio.open(src_path) as src:
                zones = zones.to_crs(src.crs) if zones.crs else zones.set_crs(src.crs, allow_override=True)
                from rasterio.mask import mask as rio_mask
                means, mins, maxs, sums, counts = [], [], [], [], []
                for geom in zones.geometry:
                    try:
                        out_img, _ = rio_mask(src, [geom.__geo_interface__], crop=True, filled=True, nodata=np.nan)
                        vals = out_img[0].astype(np.float32); vals = vals[np.isfinite(vals)]
                    except Exception:
                        vals = np.array([])
                    if vals.size:
                        means.append(float(np.mean(vals))); mins.append(float(np.min(vals)))
                        maxs.append(float(np.max(vals))); sums.append(float(np.sum(vals))); counts.append(int(vals.size))
                    else:
                        means.append(None); mins.append(None); maxs.append(None); sums.append(None); counts.append(0)
            zones = zones.to_crs("EPSG:4326")
            zones["zs_mean"], zones["zs_min"], zones["zs_max"], zones["zs_sum"], zones["zs_count"] = means, mins, maxs, sums, counts
            return _store_derived_gdf(zones, name, {"op": "zonal_stats", "sources": [ds_id, zones_id], "detail": f"Zonal stats of {ds_id} over {zones_id}", "params": params})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e).split("\n")[0][:400])

    # ---- same-grid tools (terrain + spectral) ----
    try:
        with rasterio.open(src_path) as src:
            nb = src.count
            def band(n):
                n = int(n)
                if n < 1 or n > nb: raise ValueError(f"Band {n} is out of range (this raster has {nb}).")
                a = src.read(n).astype(np.float32)
                if src.nodata is not None: a[a == src.nodata] = np.nan
                return a

            if tool in ("hillshade", "slope", "aspect"):
                z = band(1)
                dx, dy = _cellsize_meters(src)
                gy, gx = np.gradient(z, dy, dx)  # gx = dz/dx, gy = dz/dy
                if tool == "slope":
                    result = np.degrees(np.arctan(np.hypot(gx, gy))); cmap = "magma"; detail = f"Slope of {ds_id} (degrees)"
                elif tool == "aspect":
                    asp = np.degrees(np.arctan2(gy, -gx)); result = np.where(asp < 0, 360 + asp, asp); cmap = "twilight"; detail = f"Aspect of {ds_id} (0–360°)"
                else:  # hillshade
                    az, alt = np.radians(315.0), np.radians(45.0)
                    slope = np.arctan(np.hypot(gx, gy)); aspect = np.arctan2(gy, -gx)
                    hs = (np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect))
                    result = np.clip(hs * 255.0, 0, 255); cmap = "gray"; detail = f"Hillshade of {ds_id} (az 315°, alt 45°)"

            else:  # spectral indices
                def idx(name):
                    v = params.get(name)
                    if v in (None, ""): raise ValueError(f"Choose the {name.upper()} band.")
                    return int(v)
                if tool == "ndvi":
                    red, nir = band(idx("red")), band(idx("nir"))
                    result = (nir - red) / (nir + red); cmap = "rdylgn"; detail = f"NDVI of {ds_id}"
                elif tool == "ndwi":
                    green, nir = band(idx("green")), band(idx("nir"))
                    result = (green - nir) / (green + nir); cmap = "brbg"; detail = f"NDWI of {ds_id}"
                else:  # evi
                    red, nir, blue = band(idx("red")), band(idx("nir")), band(idx("blue"))
                    result = 2.5 * (nir - red) / (nir + 6.0 * red - 7.5 * blue + 1.0); cmap = "rdylgn"; detail = f"EVI of {ds_id}"
                result = np.where(np.isfinite(result), np.clip(result, -1, 1) if tool != "evi" else result, np.nan)

            name = body.get("output_name") or f"{RASTER_TOOLS[tool]['label']} · {ds_id}"
            return _write_raster_dataset(result, src, name,
                                         {"op": tool, "sources": [ds_id], "detail": detail, "params": params},
                                         colormap=cmap)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e).split("\n")[0][:400])


# ══════════════════════════════════════════════════════════════════════════════
#  Network analysis  —  origin–destination cost matrix, nearest-facility
#  allocation, and service areas. These use straight-line (great-circle) distance:
#  honest, offline, and dependency-free. True drive-time needs a routing engine.
# ══════════════════════════════════════════════════════════════════════════════

NETWORK_TOOLS = {
    "od_matrix":    {"label": "OD cost matrix",  "needs": ["other_id"]},
    "nearest":      {"label": "Nearest facility", "needs": ["other_id"]},
    "service_area": {"label": "Service area",     "needs": ["distance_km"]},
}

def _points_from_dataset(ds_id):
    """Return (labels, lats, lons) for a point-like dataset."""
    gdf = _get_vector_gdf(ds_id)
    pts = gdf.geometry.centroid if not (gdf.geometry.geom_type == "Point").all() else gdf.geometry
    lons = np.array([p.x for p in pts]); lats = np.array([p.y for p in pts])
    label_col = next((c for c in gdf.columns if c != "geometry" and gdf[c].dtype == object and not str(c).startswith("_")), None)
    labels = gdf[label_col].astype(str).tolist() if label_col else [f"{ds_id}#{i}" for i in range(len(gdf))]
    return labels, lats, lons

def _haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0088
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi = np.radians(lat2 - lat1); dl = np.radians(lon2 - lon1)
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * R * np.arcsin(np.sqrt(a))

@app.get("/api/network/layers")
def network_layers():
    # reuse the geoprocess layer discovery (any point-capable dataset works)
    return geoprocess_layers()

@app.post("/api/network/run")
def network_run(body: dict):
    if not HAS_GEOPANDAS:
        raise HTTPException(status_code=503, detail="geopandas is not installed.")
    tool = body.get("tool"); ds_id = body.get("dataset_id"); params = body.get("params", {}) or {}
    if tool not in NETWORK_TOOLS:
        raise HTTPException(status_code=400, detail=f"Unknown network tool: {tool}")
    try:
        if tool == "service_area":
            dist_km = float(params.get("distance_km", 0))
            if dist_km <= 0: raise ValueError("Service radius must be greater than zero.")
            return geoprocess_run({"tool": "buffer", "dataset_id": ds_id,
                                   "params": {"distance": dist_km * 1000.0},
                                   "output_name": body.get("output_name") or f"Service area · {ds_id} ({dist_km:g} km)"})

        other_id = params.get("other_id")
        if not other_id: raise ValueError("Choose a destinations/facilities layer.")
        o_lab, o_lat, o_lon = _points_from_dataset(ds_id)
        d_lab, d_lat, d_lon = _points_from_dataset(other_id)
        if len(o_lab) == 0 or len(d_lab) == 0: raise ValueError("Both layers need at least one point.")

        if tool == "od_matrix":
            MAX = 300
            if len(o_lab) > MAX or len(d_lab) > MAX:
                raise ValueError(f"Too many pairs ({len(o_lab)}×{len(d_lab)}). Keep each layer under {MAX} points.")
            rows = []
            for i in range(len(o_lab)):
                dkm = _haversine_km(o_lat[i], o_lon[i], d_lat, d_lon)
                for j in range(len(d_lab)):
                    rows.append({"origin": o_lab[i], "destination": d_lab[j], "distance_km": round(float(dkm[j]), 3)})
            df = pd.DataFrame(rows)
            new_id = _unique_dataset_id(body.get("output_name") or f"OD matrix · {ds_id}→{other_id}")
            datasets[new_id] = df
            return {"id": new_id, "name": new_id, "format": "table",
                    "shape": list(df.shape), "columns": list(df.columns),
                    "types": infer_types(df), "preview": df_to_json(df),
                    "missing": {c: int(df[c].isna().sum()) for c in df.columns},
                    "derived": {"op": "od_matrix", "sources": [ds_id, other_id],
                                "detail": f"Great-circle distances, {ds_id} → {other_id}", "params": {}}}

        if tool == "nearest":
            import geopandas as _gpd
            recs = []
            for i in range(len(o_lab)):
                dkm = _haversine_km(o_lat[i], o_lon[i], d_lat, d_lon)
                j = int(np.argmin(dkm))
                recs.append({"origin": o_lab[i], "nearest_facility": d_lab[j],
                             "distance_km": round(float(dkm[j]), 3), "lat": float(o_lat[i]), "lon": float(o_lon[i])})
            df = pd.DataFrame(recs)
            gdf = _gpd.GeoDataFrame(df, geometry=_gpd.points_from_xy(df["lon"], df["lat"]), crs="EPSG:4326")
            return _store_derived_gdf(gdf, body.get("output_name") or f"Nearest facility · {ds_id}",
                                      {"op": "nearest", "sources": [ds_id, other_id],
                                       "detail": f"Each {ds_id} point tagged with its nearest {other_id}", "params": {}})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e).split("\n")[0][:400])


# ══════════════════════════════════════════════════════════════════════════════
#  Projects  —  save the whole workspace (data + lineage + map) to one JSON file
#  and restore it later. Vector/tabular data round-trips fully; rasters keep their
#  metadata (pixels are re-derivable through the pipeline).
# ══════════════════════════════════════════════════════════════════════════════

def _df_full_records(df):
    safe = df.replace([np.inf, -np.inf], np.nan)
    out = []
    for row in safe.to_dict("records"):
        r = {}
        for k, v in row.items():
            if v is None or (isinstance(v, float) and np.isnan(v)): r[k] = None
            elif isinstance(v, np.integer): r[k] = int(v)
            elif isinstance(v, np.floating): r[k] = float(v)
            elif isinstance(v, (pd.Timestamp,)): r[k] = v.isoformat()
            elif isinstance(v, (np.bool_, bool)): r[k] = bool(v)
            elif isinstance(v, (str, int, float, bool)): r[k] = v
            else: r[k] = str(v)
        out.append(r)
    return out

@app.post("/api/project/save")
def project_save(body: dict):
    entries = []
    for ds_id, df in datasets.items():
        is_raster = ds_id in raster_cache
        entry = {"id": ds_id, "name": ds_id, "columns": list(df.columns),
                 "derived": getattr(df, "_derived", None), "is_raster": is_raster}
        # carry lineage/sample flags stored by the frontend copy if provided
        meta = (body.get("dataset_meta") or {}).get(ds_id, {})
        entry.update({k: meta[k] for k in ("format", "derived", "sample", "raster_meta", "geo_meta") if k in meta})
        if not is_raster and len(df) <= 200000:
            entry["records"] = _df_full_records(df)
        else:
            entry["records"] = None  # too large / raster — rebuildable via pipeline
        entries.append(entry)
    return {"cartolith_project": True, "version": 1, "saved_at": dt.datetime.utcnow().isoformat(),
            "map": body.get("map"), "datasets": entries}

@app.post("/api/project/load")
def project_load(body: dict):
    proj = body.get("project") or body
    if not proj.get("cartolith_project"):
        raise HTTPException(status_code=400, detail="Not a Cartolith project file.")
    restored, skipped = [], []
    for e in proj.get("datasets", []):
        if not e.get("records"):
            skipped.append(e.get("id")); continue
        df = pd.DataFrame(e["records"], columns=e.get("columns"))
        new_id = _unique_dataset_id(e.get("name") or e.get("id") or "dataset")
        datasets[new_id] = df
        if "_geom_wkt" in df.columns and HAS_GEOPANDAS:
            try:
                from shapely import wkt as _swkt
                geom = df["_geom_wkt"].apply(lambda w: _swkt.loads(w) if isinstance(w, str) else None)
                vector_cache[new_id] = gpd.GeoDataFrame(df.copy(), geometry=geom, crs="EPSG:4326")
            except Exception: pass
        restored.append({"id": new_id, "name": new_id, "format": e.get("format", "csv"),
                         "shape": list(df.shape), "columns": list(df.columns),
                         "types": infer_types(df), "preview": df_to_json(df),
                         "missing": {c: int(df[c].isna().sum()) for c in df.columns},
                         "derived": e.get("derived"), "sample": e.get("sample"),
                         "geo_meta": e.get("geo_meta")})
    return {"restored": restored, "skipped": skipped, "map": proj.get("map")}

# ══════════════════════════════════════════════════════════════════════════════
#  Lineage & pipeline  —  every derived dataset knows its recipe, so we can draw
#  the dependency graph and re-run a recipe to reproduce (or refresh) a result.
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/lineage")
def lineage(dataset_meta: str = ""):
    """Build the derivation DAG from the datasets currently loaded."""
    known = set(datasets.keys())
    nodes, edges = [], []
    for ds_id, df in datasets.items():
        d = None
        # provenance rides on the frontend dataset object; the backend infers kind here
        kind = "raster" if ds_id in raster_cache else ("vector" if ds_id in vector_cache else "table")
        nodes.append({"id": ds_id, "kind": kind, "rows": int(len(df))})
    return {"nodes": nodes, "note": "Lineage detail (op/sources) is supplied by the client dataset objects."}

def _rerun_recipe(op, sources, params, name):
    vector_ops = set(GEOPROCESS_TOOLS.keys())
    raster_ops = set(RASTER_TOOLS.keys())
    network_ops = set(NETWORK_TOOLS.keys())
    src0 = sources[0] if sources else None
    if op in vector_ops:
        return geoprocess_run({"tool": op, "dataset_id": src0, "params": params, "output_name": name})
    if op in raster_ops:
        return raster_tools_run({"tool": op, "dataset_id": src0, "params": params, "output_name": name})
    if op in network_ops:
        return network_run({"tool": op, "dataset_id": src0, "params": params, "output_name": name})
    if op == "sql":
        return sql_materialize(SqlMaterialize(sql=params.get("sql", ""), name=name))
    raise HTTPException(status_code=400, detail=f"Don't know how to re-run op '{op}'.")

@app.post("/api/pipeline/rerun")
def pipeline_rerun(body: dict):
    """Re-execute one derived dataset's recipe. Sources must still be loaded."""
    derived = body.get("derived") or {}
    op = derived.get("op"); sources = derived.get("sources", []); params = derived.get("params", {}) or {}
    if not op: raise HTTPException(status_code=400, detail="This dataset has no recipe to re-run.")
    missing = [s for s in sources if s not in datasets]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing input(s): {', '.join(missing)}. Load them first.")
    name = body.get("output_name") or f"{op} (re-run)"
    return _rerun_recipe(op, sources, params, name)

# ══════════════════════════════════════════════════════════════════════════════
#  Load from URL  —  pull cloud-native / remote data straight in by link.
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/load-url")
def load_url(body: dict):
    url = (body.get("url") or "").strip()
    if not url: raise HTTPException(status_code=400, detail="Provide a URL.")
    name = body.get("name") or url.split("/")[-1].split("?")[0] or "remote"
    low = url.lower().split("?")[0]
    try:
        if low.endswith((".csv", ".tsv")):
            sep = "\t" if low.endswith(".tsv") else ","
            df = pd.read_csv(url, sep=sep)
            new_id = _unique_dataset_id(name); datasets[new_id] = df
            return {"id": new_id, "name": new_id, "format": "csv", "shape": list(df.shape),
                    "columns": list(df.columns), "types": infer_types(df), "preview": df_to_json(df),
                    "missing": {c: int(df[c].isna().sum()) for c in df.columns}}
        if not HAS_GEOPANDAS:
            raise HTTPException(status_code=503, detail="geopandas is needed for spatial URLs.")
        if low.endswith((".parquet", ".geoparquet")):
            try: gdf = gpd.read_parquet(url)
            except Exception:
                df = pd.read_parquet(url)
                return _register_plain_table(df, name)
        elif low.endswith(".zip"):
            gdf = gpd.read_file(f"zip+{url}" if url.startswith("http") else url)
        else:  # geojson, json, fgb, gpkg, gml, kml …
            gdf = gpd.read_file(url)
        if gdf.crs is not None and str(gdf.crs).upper() not in ("EPSG:4326", "OGC:CRS84"):
            gdf = gdf.to_crs("EPSG:4326")
        return _store_loaded_gdf(gdf, name)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Couldn't load that URL: {str(e).split(chr(10))[0][:200]}")

def _register_plain_table(df, name):
    new_id = _unique_dataset_id(name); datasets[new_id] = df
    return {"id": new_id, "name": new_id, "format": "parquet", "shape": list(df.shape),
            "columns": list(df.columns), "types": infer_types(df), "preview": df_to_json(df),
            "missing": {c: int(df[c].isna().sum()) for c in df.columns}}

def _store_loaded_gdf(gdf, name):
    """Register a freshly loaded GeoDataFrame as a normal (non-derived) vector dataset."""
    gdf = gdf[~gdf.geometry.is_empty & gdf.geometry.notna()].copy() if len(gdf) else gdf
    geom_type = "Unknown"
    try: geom_type = gdf.geometry.geom_type.value_counts().idxmax()
    except Exception: pass
    df = pd.DataFrame(gdf.drop(columns=["geometry"], errors="ignore"))
    try:
        import warnings as _w
        with _w.catch_warnings():
            _w.simplefilter("ignore"); cent = gdf.geometry.centroid
        df["_centroid_lon"] = cent.x.values; df["_centroid_lat"] = cent.y.values
        df["_geom_type"] = gdf.geometry.geom_type.values
        df["_geom_wkt"] = gdf.geometry.apply(lambda g: g.wkt if g is not None else None)
    except Exception: pass
    new_id = _unique_dataset_id(name); datasets[new_id] = df; vector_cache[new_id] = gdf
    return {"id": new_id, "name": new_id, "format": "geojson", "shape": list(df.shape),
            "columns": list(df.columns), "types": infer_types(df), "preview": df_to_json(df),
            "missing": {c: int(df[c].isna().sum()) for c in df.columns},
            "geo_meta": {"geometry_type": geom_type, "crs": "EPSG:4326",
                         "bounds": gdf.total_bounds.tolist() if len(gdf) else [], "feature_count": int(len(gdf))}}


# ══════════════════════════════════════════════════════════════════════════════
#  Sample data  —  one click to a working map, so a first-time user never stares
#  at a blank app. Cities (points) + Regions (polygons) are built to teach joins,
#  buffers, hulls and dissolves together.
# ══════════════════════════════════════════════════════════════════════════════

_SAMPLE_CITIES = [
    ("Tokyo","Japan",37.4,35.68,139.69),("Delhi","India",32.9,28.61,77.21),
    ("Shanghai","China",29.2,31.23,121.47),("Sao Paulo","Brazil",22.6,-23.55,-46.63),
    ("Mexico City","Mexico",22.3,19.43,-99.13),("Cairo","Egypt",21.8,30.04,31.24),
    ("Mumbai","India",20.9,19.08,72.88),("Beijing","China",20.9,39.90,116.41),
    ("Dhaka","Bangladesh",22.5,23.81,90.41),("New York","USA",18.8,40.71,-74.01),
    ("Los Angeles","USA",12.4,34.05,-118.24),("London","UK",9.5,51.51,-0.13),
    ("Paris","France",11.1,48.86,2.35),("Lagos","Nigeria",15.4,6.52,3.38),
    ("Moscow","Russia",12.6,55.76,37.62),("Istanbul","Turkey",15.6,41.01,28.98),
    ("Buenos Aires","Argentina",15.4,-34.60,-58.38),("Johannesburg","South Africa",6.0,-26.20,28.05),
    ("Sydney","Australia",5.3,-33.87,151.21),("Toronto","Canada",6.4,43.65,-79.38),
    ("Jakarta","Indonesia",11.1,-6.21,106.85),("Bangkok","Thailand",11.1,13.76,100.50),
    ("Nairobi","Kenya",4.9,-1.29,36.82),("Lima","Peru",11.0,-12.05,-77.04),
]
_SAMPLE_REGIONS = [
    ("North America","A",-168,15,-52,72),("South America","B",-82,-56,-34,13),
    ("Europe","A",-25,35,45,71),("Africa","C",-18,-35,52,37),
    ("Asia","A",45,5,150,75),("Oceania","B",110,-48,180,-10),
]

SAMPLES = {
    "world_cities": {"name": "World cities", "kind": "points", "count": len(_SAMPLE_CITIES),
        "blurb": "24 major cities as points, with population. Great for buffers, hulls and joins."},
    "world_regions": {"name": "World regions", "kind": "polygons", "count": len(_SAMPLE_REGIONS),
        "blurb": "6 continent areas as polygons. Try a spatial join with the cities."},
}

@app.get("/api/samples")
def list_samples():
    return {"samples": [{"id": k, **v} for k, v in SAMPLES.items()]}

@app.post("/api/samples/load")
def load_sample(body: dict):
    sid = body.get("id")
    if sid == "world_cities":
        df = pd.DataFrame(_SAMPLE_CITIES, columns=["city", "country", "population_millions", "lat", "lon"])
        new_id = _unique_dataset_id("World cities")
        datasets[new_id] = df
        return {"id": new_id, "name": new_id, "format": "csv",
                "shape": list(df.shape), "columns": list(df.columns),
                "types": infer_types(df), "preview": df_to_json(df),
                "missing": {c: int(df[c].isna().sum()) for c in df.columns},
                "sample": True}
    if sid == "world_regions":
        if not HAS_GEOPANDAS:
            raise HTTPException(status_code=503, detail="geopandas is needed to load polygon samples.")
        from shapely.geometry import box as _box
        rows = [{"region": r[0], "market_tier": r[1]} for r in _SAMPLE_REGIONS]
        geoms = [_box(r[2], r[3], r[4], r[5]) for r in _SAMPLE_REGIONS]
        gdf = gpd.GeoDataFrame(rows, geometry=geoms, crs="EPSG:4326")
        geom_type = "Polygon"
        df = pd.DataFrame(gdf.drop(columns=["geometry"]))
        cent = gdf.geometry.centroid
        df["_centroid_lon"] = cent.x.values; df["_centroid_lat"] = cent.y.values
        df["_geom_type"] = gdf.geometry.geom_type.values
        df["_geom_wkt"] = gdf.geometry.apply(lambda g: g.wkt)
        new_id = _unique_dataset_id("World regions")
        datasets[new_id] = df; vector_cache[new_id] = gdf
        return {"id": new_id, "name": new_id, "format": "geojson",
                "shape": [len(gdf), len(rows[0]) if rows else 0], "columns": list(df.columns),
                "types": infer_types(df), "preview": df_to_json(df),
                "missing": {c: int(df[c].isna().sum()) for c in df.columns},
                "geo_meta": {"geometry_type": geom_type, "crs": "EPSG:4326",
                             "bounds": gdf.total_bounds.tolist(), "feature_count": len(gdf)},
                "sample": True}
    raise HTTPException(status_code=404, detail="Unknown sample.")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True, http="h11")