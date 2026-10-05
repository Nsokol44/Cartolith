"""
Cartolith — "code reveal": the Python equivalent of every GUI operation.

Why this exists: a training tool must teach *transferable* skill, not just
its own buttons. Every geoprocess / raster operation Cartolith runs has a
short, idiomatic geopandas / rasterio / PySAL equivalent. The frontend can
show this snippet next to a result ("here is what you just did, in code"),
and the notebook export can carry it into a script the student keeps.

Snippets are templates: {src} is the input variable name, {other} the
second layer, and operation parameters are interpolated from the actual
run (distance, tolerance, band numbers, ...), so what the student sees is
what actually ran — not a generic example.

This module is pure string generation: no geospatial imports, so it can
never break the tools it describes.
"""
from typing import Any, Dict

_HEADER = "# Equivalent Python — run this in the Notebook tab or any geopandas session\n"


def _v(name: str) -> str:
    """Make a dataset id usable as a Python variable name."""
    out = "".join(c if (c.isalnum() or c == "_") else "_" for c in str(name))
    return out or "gdf"


def snippet_for(tool: str, params: Dict[str, Any] | None = None,
                src: str = "data", other: str = "other") -> str | None:
    """Return the equivalent-code snippet for `tool`, or None if uncovered."""
    p = params or {}
    a, b = _v(src), _v(other)
    d = p.get("distance", 1000)
    tol = p.get("tolerance", 0.001)
    cell_km = p.get("cell_km", 10)
    res = p.get("resolution", 7)

    geo = {
        "buffer": f"""{a}_buf = {a}.copy()
# Buffer in metres: project each feature to a local equidistant CRS
# (buffering lon/lat degrees directly is the classic beginner error).
{a}_buf["geometry"] = [
    g.buffer({d}) if g is not None else g
    for g in {a}.to_crs({a}.estimate_utm_crs()).geometry
]
{a}_buf = {a}_buf.to_crs({a}.crs)""",
        "centroid": f"{a}_pts = {a}.copy()\n{a}_pts['geometry'] = {a}.geometry.centroid",
        "convex_hull": f"hull = {a}.union_all().convex_hull",
        "bounding_box": f"bbox = {a}.total_bounds  # (minx, miny, maxx, maxy)",
        "simplify": f"{a}_simp = {a}.copy()\n{a}_simp['geometry'] = {a}.geometry.simplify({tol}, preserve_topology=True)",
        "dissolve": (f"{a}_diss = {a}.dissolve(by={p.get('by')!r}, as_index=False)"
                     if p.get("by") else f"{a}_diss = {a}.dissolve(as_index=False)"),
        "spatial_join": f"joined = gpd.sjoin({a}, {b}, predicate={p.get('predicate', 'intersects')!r}, how={p.get('how', 'inner')!r})",
        "clip": f"clipped = gpd.clip({a}, {b})",
        "intersection": f"out = gpd.overlay({a}, {b}, how='intersection')",
        "difference": f"out = gpd.overlay({a}, {b}, how='difference')",
        "union": f"out = gpd.overlay({a}, {b}, how='union')",
        "voronoi": "from shapely.ops import voronoi_diagram\ncells = voronoi_diagram(" + a + ".geometry.union_all())",
        "delaunay": "from shapely.ops import triangulate\ntris = triangulate(" + a + ".geometry.union_all())",
        "regular_grid": f"""import numpy as np
from shapely.geometry import box
cell_deg_x = {cell_km} / (111.32 * np.cos(np.radians({a}.total_bounds[[1, 3]].mean())))
cell_deg_y = {cell_km} / 110.57  # longitude degrees shrink with latitude!
grid = gpd.GeoDataFrame(geometry=[
    box(x, y, x + cell_deg_x, y + cell_deg_y)
    for x in np.arange({a}.total_bounds[0], {a}.total_bounds[2], cell_deg_x)
    for y in np.arange({a}.total_bounds[1], {a}.total_bounds[3], cell_deg_y)
], crs={a}.crs)""",
        "h3_grid": f"import h3\ncells = h3.geo_to_cells({a}.geometry.union_all().__geo_interface__, {res})",
        "h3_bin": f"import h3\n{a}['h3'] = [h3.latlng_to_cell(g.y, g.x, {res}) for g in {a}.geometry.centroid]\ncounts = {a}.groupby('h3').size()",
        "select_value": f"selected = {a}[{a}[{p.get('column')!r}] {p.get('op', '=')} {p.get('value')!r}]",
        "select_location": f"idx = gpd.sjoin({a}, {b}, predicate={p.get('predicate', 'intersects')!r}, how='inner').index.unique()\nselected = {a}.loc[idx]",
        "attribute_join": f"joined = {a}.merge({b}, left_on={p.get('key')!r}, right_on={p.get('key2') or p.get('key')!r}, how='left')",
    }
    if tool in geo:
        return _HEADER + "import geopandas as gpd\n\n" + geo[tool] + "\n"

    red, nir, green, blue = p.get("red", 3), p.get("nir", 4), p.get("green", 2), p.get("blue", 1)
    ras = {
        "hillshade": """import numpy as np
gy, gx = np.gradient(z, dy, dx)
slope = np.arctan(np.hypot(gx, gy))
aspect_math = np.arctan2(gy, -gx)              # mathematical angle
az = np.radians(90 - 315)                      # compass NW sun -> math angle
hillshade = np.sin(np.radians(45)) * np.cos(slope) + \\
    np.cos(np.radians(45)) * np.sin(slope) * np.cos(az - aspect_math)""",
        "slope": "import numpy as np\ngy, gx = np.gradient(z, dy, dx)  # dy/dx in the raster's own units (metres!)\nslope_deg = np.degrees(np.arctan(np.hypot(gx, gy)))",
        "aspect": """import numpy as np
gy, gx = np.gradient(z, dy, dx)
aspect = np.mod(90 - np.degrees(np.arctan2(gy, -gx)), 360)  # compass: 0 = north
aspect[np.hypot(gx, gy) == 0] = -1  # flat""",
        "ndvi": f"red = src.read({red}).astype('float32'); nir = src.read({nir}).astype('float32')\nndvi = (nir - red) / (nir + red)  # bands must be reflectance-scale, same units",
        "ndwi": f"green = src.read({green}).astype('float32'); nir = src.read({nir}).astype('float32')\nndwi = (green - nir) / (green + nir)",
        "evi": f"red = src.read({red}).astype('float32'); nir = src.read({nir}).astype('float32'); blue = src.read({blue}).astype('float32')\nevi = 2.5 * (nir - red) / (nir + 6 * red - 7.5 * blue + 1)  # coefficients assume 0-1 reflectance",
        "reproject": "from rasterio.warp import calculate_default_transform, reproject\n# see rasterio.warp.reproject with dst_crs='" + str(p.get("target_crs", "EPSG:3857")) + "'",
        "resample": "from rasterio.enums import Resampling\ndata = src.read(out_shape=(src.count, src.height * " + str(p.get("factor", 2)) + ", src.width * " + str(p.get("factor", 2)) + "), resampling=Resampling.bilinear)",
        "reclassify": "import numpy as np\nout = np.digitize(arr, bins=[...])  # one class per break interval",
        "contour": "from skimage import measure\nlines = measure.find_contours(z, level)  # one call per contour level",
        "polygonize": "from rasterio import features\npolys = list(features.shapes(arr.astype('int32'), transform=src.transform))",
        "zonal_stats": "from rasterio.mask import mask\nvals, _ = mask(src, [zone.__geo_interface__], crop=True)  # then np.nanmean(vals)",
    }
    if tool in ras:
        return _HEADER + "import rasterio\nimport numpy as np\n\n" + ras[tool] + "\n"

    net = {
        "od_matrix": "from scipy.spatial import cKDTree\n# great-circle (haversine) distances — straight-line, NOT road distance",
        "nearest": "from scipy.spatial import cKDTree\ntree = cKDTree(facility_xy); dist, idx = tree.query(point_xy, k=1)",
        "service_area": _HEADER + "import geopandas as gpd\n\n" + geo["buffer"] + "\n",
    }
    if tool in net:
        return net[tool] if tool == "service_area" else _HEADER + net[tool] + "\n"
    return None


COVERED_TOOLS = [
    "buffer", "centroid", "convex_hull", "bounding_box", "simplify", "dissolve",
    "spatial_join", "clip", "intersection", "difference", "union", "voronoi",
    "delaunay", "regular_grid", "h3_grid", "h3_bin", "select_value",
    "select_location", "attribute_join",
    "hillshade", "slope", "aspect", "ndvi", "ndwi", "evi", "reproject",
    "resample", "reclassify", "contour", "polygonize", "zonal_stats",
    "od_matrix", "nearest", "service_area",
]
