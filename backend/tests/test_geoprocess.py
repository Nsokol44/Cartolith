"""
Validation of geoprocess + raster tools in backend/main.py, exercised
in-process (the app's own caches act as the dataset store).

Independent references are analytic: a 1 km buffer at the equator has a
known width in degrees; a "10 km" grid cell at 60N must actually be
~10 km wide on the ground; a plane DEM has a known slope and aspect.
"""
import numpy as np
import pytest

gpd = pytest.importorskip("geopandas")
import pandas as pd  # noqa: E402
from shapely.geometry import Point, box  # noqa: E402

import main  # noqa: E402


def put_vector(ds_id, gdf):
    main.vector_cache[ds_id] = gdf
    main.datasets[ds_id] = pd.DataFrame(
        {c: gdf[c] for c in gdf.columns if c != "geometry"})


@pytest.fixture(autouse=True)
def clean_caches():
    main.vector_cache.clear(); main.datasets.clear(); main.raster_cache.clear()
    yield
    main.vector_cache.clear(); main.datasets.clear(); main.raster_cache.clear()


def test_buffer_1km_at_equator_has_correct_size():
    put_vector("pts", gpd.GeoDataFrame(
        {"name": ["a"]}, geometry=[Point(0, 0)], crs="EPSG:4326"))
    out = main.geoprocess_run({"tool": "buffer", "dataset_id": "pts",
                               "params": {"distance": 1000}})
    g = main.vector_cache[out["id"]]
    minx, _, maxx, _ = g.geometry.iloc[0].bounds
    assert (maxx - minx) == pytest.approx(2000 / 111320, rel=0.05)
    area_km2 = float(g.to_crs("EPSG:3857").geometry.area.sum()) / 1e6
    assert area_km2 == pytest.approx(np.pi * 1.0 ** 2, rel=0.1)
    assert out["code_reveal"] and ".buffer(" in out["code_reveal"]


def test_buffer_rejects_zero_distance():
    put_vector("pts", gpd.GeoDataFrame(
        {"name": ["a"]}, geometry=[Point(0, 0)], crs="EPSG:4326"))
    with pytest.raises(Exception):
        main.geoprocess_run({"tool": "buffer", "dataset_id": "pts",
                             "params": {"distance": 0}})


def test_regular_grid_cells_are_actually_cell_km_wide_at_60n():
    """Regression test: before the fix, deg = cell_km/111 for BOTH axes,
    so a '10 km' cell at 60N came out 5.01 km wide in x."""
    put_vector("north", gpd.GeoDataFrame(
        {"n": [1]}, geometry=[box(0, 60, 2, 62)], crs="EPSG:4326"))
    out = main.geoprocess_run({"tool": "regular_grid", "dataset_id": "north",
                               "params": {"cell_km": 10}})
    g = main.vector_cache[out["id"]]
    widths_km = []
    for geom in g.geometry:
        minx, miny, maxx, maxy = geom.bounds
        if maxx - minx > 0.15:  # a full cell, not the clipped edge column
            widths_km.append((maxx - minx) * 111.32 * np.cos(np.radians(60.5)))
    assert widths_km, "expected at least one full-width cell"
    assert np.mean(widths_km) == pytest.approx(10.0, rel=0.1)


def test_spatial_join_counts_points_in_polygons():
    put_vector("pts", gpd.GeoDataFrame(
        {"name": ["in", "in2", "out"]},
        geometry=[Point(0.5, 0.5), Point(0.6, 0.6), Point(5, 5)], crs="EPSG:4326"))
    put_vector("poly", gpd.GeoDataFrame(
        {"zone": ["A"]}, geometry=[box(0, 0, 1, 1)], crs="EPSG:4326"))
    out = main.geoprocess_run({"tool": "spatial_join", "dataset_id": "pts",
                               "params": {"other_id": "poly", "predicate": "within"}})
    g = main.vector_cache[out["id"]]
    assert len(g) == 2


def test_centroid_of_square_is_its_centre():
    put_vector("sq", gpd.GeoDataFrame(
        {"n": [1]}, geometry=[box(0, 0, 2, 2)], crs="EPSG:4326"))
    out = main.geoprocess_run({"tool": "centroid", "dataset_id": "sq", "params": {}})
    g = main.vector_cache[out["id"]]
    assert g.geometry.iloc[0].x == pytest.approx(1.0)
    assert g.geometry.iloc[0].y == pytest.approx(1.0)


# ── raster tools ────────────────────────────────────────────────────────────

def _write_raster(tmp_path, arr, nodata=None, crs="EPSG:3857", res=100.0):
    import rasterio
    from rasterio.transform import from_origin
    path = str(tmp_path / "r.tif")
    kw = dict(driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1,
              dtype="float32", crs=crs, transform=from_origin(0, arr.shape[0] * res, res, res))
    if nodata is not None:
        kw["nodata"] = nodata
    with rasterio.open(path, "w", **kw) as ds:
        ds.write(arr.astype("float32"), 1)
    main.raster_cache["r"] = path
    main.datasets["r"] = pd.DataFrame({"value": [1]})
    return path


def _read_result(out):
    import rasterio
    with rasterio.open(main.raster_cache[out["id"]]) as ds:
        return ds.read(1)


def test_slope_and_aspect_of_east_rising_plane(tmp_path):
    """Plane rising to the east: slope = atan(rise/run); the slope FACES
    west, so compass aspect must be 270 (ArcGIS/GDAL convention)."""
    arr = np.tile(np.arange(20, dtype=float) * 10.0, (20, 1))  # +10 per 100 m cell
    _write_raster(tmp_path, arr)
    out = main.raster_tools_run({"tool": "slope", "dataset_id": "r", "params": {}})
    slope = _read_result(out)
    assert np.nanmean(slope) == pytest.approx(np.degrees(np.arctan(0.1)), abs=0.2)

    out = main.raster_tools_run({"tool": "aspect", "dataset_id": "r", "params": {}})
    aspect = _read_result(out)
    assert np.nanmean(aspect) == pytest.approx(270.0, abs=1.0)


def test_aspect_of_flat_is_minus_one(tmp_path):
    _write_raster(tmp_path, np.full((10, 10), 50.0))
    out = main.raster_tools_run({"tool": "aspect", "dataset_id": "r", "params": {}})
    assert set(np.unique(_read_result(out))) == {-1.0}


def test_hillshade_lights_the_northwest_flank(tmp_path):
    """Regression test: the sun azimuth (315°, NW) was plugged into a
    mathematical-angle formula unconverted, lighting the SE flank —
    inverted relief. A cone's NW flank must be bright, its SE flank dark."""
    y, x = np.mgrid[0:41, 0:41]
    cone = 100 - np.hypot(x - 20, y - 20) * 2.0
    _write_raster(tmp_path, cone, res=100.0)
    out = main.raster_tools_run({"tool": "hillshade", "dataset_id": "r", "params": {}})
    hs = _read_result(out)
    assert hs[12, 12] > hs[28, 28]  # NW flank brighter than SE flank


def test_ndvi_known_values(tmp_path):
    import rasterio
    from rasterio.transform import from_origin
    path = str(tmp_path / "ms.tif")
    red = np.full((5, 5), 0.1, dtype="float32")
    nir = np.full((5, 5), 0.5, dtype="float32")
    with rasterio.open(path, "w", driver="GTiff", height=5, width=5, count=2,
                       dtype="float32", crs="EPSG:3857",
                       transform=from_origin(0, 500, 100, 100)) as ds:
        ds.write(red, 1); ds.write(nir, 2)
    main.raster_cache["ms"] = path
    main.datasets["ms"] = pd.DataFrame({"value": [1]})
    out = main.raster_tools_run({"tool": "ndvi", "dataset_id": "ms",
                                 "params": {"red": 1, "nir": 2}})
    assert np.nanmean(_read_result(out)) == pytest.approx((0.5 - 0.1) / 0.6, abs=0.01)


def test_zonal_stats_ignores_nodata(tmp_path):
    """Verified-correct behaviour, kept as a regression test: rasterio.mask
    converts the source nodata to NaN, so a -9999 patch must not pollute
    the mean (true mean 100.0 over the 96 valid cells)."""
    arr = np.full((10, 10), 100.0, dtype="float32")
    arr[4:6, 4:6] = -9999.0
    _write_raster(tmp_path, arr, nodata=-9999.0, crs="EPSG:4326", res=1.0)
    put_vector("zone", gpd.GeoDataFrame(
        {"z": [1]}, geometry=[box(0, 0, 10, 10)], crs="EPSG:4326"))
    out = main.raster_tools_run({"tool": "zonal_stats", "dataset_id": "r",
                                 "params": {"zones_id": "zone"}})
    g = main.vector_cache[out["id"]]
    assert g["zs_mean"].iloc[0] == pytest.approx(100.0)
    assert g["zs_count"].iloc[0] == 96
