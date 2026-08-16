# Cartolith — GIS & Teaching update

This brings GeoLibre-style GIS power into Cartolith, reworked around Cartolith's own
idea and aimed squarely at **people who have never used GIS**.

## The distinct idea: datasets are the currency, and everything teaches

GeoLibre is organized around *map layers* and assumes GIS fluency. Cartolith is
organized around *datasets* — every tab reads and writes them. So instead of
copying the layer model, **each operation derives a new dataset** that flows
through every existing tab, and each derived dataset carries **lineage** (the `⤳`
badge) so you can always see how it was made. A **teaching layer** is woven
through the whole app so a first-timer is never stuck.

## The Geoprocess hub — one tab, four categories

To keep navigation simple, all 20 spatial tools live in a single **Geoprocess**
tab with a categorized rail (no extra top-level tabs). Pick a tool, pick an input,
read the plain-English explainer, run — the result is a new dataset on the map.

**Vector** — Buffer, Centroids, Convex hull, Bounding box, Simplify, Dissolve,
Spatial join. Buffers are accurate anywhere on Earth (each feature buffered in its
own local equidistant projection).

**Overlay** — Clip, Intersection, Difference, Union between two layers.

**Raster** — Terrain from a DEM (Hillshade, Slope, Aspect) and spectral indices
from imagery (NDVI, NDWI, EVI, with band pickers). Each writes a real GeoTIFF that
registers as a raster dataset and draws on the Cartography map.

**Network** — OD cost matrix, Nearest facility, and Service area. These use
straight-line (great-circle) distance: honest, offline, and instant. True
drive-time would need a road-network routing engine — called out in the UI.

## SQL Lab

Query every dataset with DuckDB — filter, group, join, spatial `ST_` functions
when available. Schema browser, starter queries, history, CSV export, and
**save any result as a dataset** that works in every tab.

## The teaching layer (for GIS newcomers)

- **Learn GIS** button → a plain-English glossary (~30 concepts) plus a 3-step
  "make your first map" guide.
- **`?` explainers** beside every tool and term — definition, when to use it, and
  a concrete real-world example.
- **One-click sample data** everywhere — 24 world cities (points) + 6 world
  regions (polygons), built to demonstrate joins, buffers, overlays, and network
  tools together.
- A friendly **Welcome** on first launch.

## Run it

Nothing changed about how you launch — the script installs the new dependencies
(`duckdb`, and `rasterio` was already required) and starts both servers:

```bash
./start.sh
# → frontend http://localhost:5173 , backend http://localhost:8000
```

## New backend endpoints
```
GET  /api/sql/schema            POST /api/sql/query        POST /api/sql/materialize
GET  /api/geoprocess/layers     POST /api/geoprocess/run   (vector + overlay)
GET  /api/raster-tools/layers   POST /api/raster-tools/run (terrain + spectral)
GET  /api/network/layers        POST /api/network/run      (OD / nearest / service area)
GET  /api/samples               POST /api/samples/load
```
`duckdb` was added to `backend/requirements.txt`; `/api/health` reports it.

## Honest scope

This is a broad, tested foundation toward an approachable ArcGIS alternative — not
a claim to have reproduced all of ArcGIS or GeoLibre. Network tools are
straight-line by design (no bundled routing engine); raster tools cover the most
common terrain/spectral operations. Everything shares the same "derive a dataset,
explain every step" model, so further tools (reproject/zonal-stats, isochrones on
a real network, etc.) slot in the same way.

---

## Update — easier display + "What's next" suggestions

**Results now show on the map in one click.** The Geoprocess result card's *See it
on the map* button (and a new *Show on map* suggestion) send the dataset straight
to Cartography and auto-add it as the right layer type — no Add-Layer dialog, no
guessing. Rasters go on as overlays, shapes as vector, lat/lon tables as points.

**Features are always findable.** Vector layers now also drop a small locator dot
at each feature, so even tiny shapes (like a 500 m buffer viewed at world zoom)
are visible. The map also zooms sensibly instead of snapping to an unreadable
extent. (The earlier buffers *were* drawing correctly — they were just sub-pixel
at the zoom the map had fit to.)

**A "What's next" panel** sits at the top of Explore. It reads the active dataset —
points vs. polygons vs. table, which columns are numbers or text, whether it's
mappable, where data is missing — and offers one-click next steps grouped into
**Visualize**, **Analyze**, and **Transform**. Each button jumps to the right tab
with columns pre-selected (e.g. "population by country" preloads a bar chart;
"Show on map" drops it on Cartography; "Find correlations" preloads Analyze).

---

## Update — toward ArcGIS/GeoLibre parity (batch 1)

This batch went deep on the pieces that are high-value **and** verifiable, and is
honest about what still needs its own focused pass.

**Tool matrix — filled out.** The Geoprocess hub now has 31 tools across six
categories, all with the plain-English teaching treatment:
- *Vector:* buffer, centroids, convex hull, bounding box, simplify, dissolve, spatial join
- *Overlay:* clip, intersection, difference, union
- *Grids:* Voronoi, Delaunay, regular grid, H3 hex grid, H3 binning
- *Select & join:* select by value, select by location, attribute join
- *Raster:* hillshade, slope, aspect, NDVI, NDWI, EVI, reproject, resample, reclassify, contour, polygonize, zonal statistics
- *Network:* OD cost matrix, nearest facility, service area

**Project save / load.** Save the whole workspace to one `.cartolith.json` file and
reopen it later. Vector and tabular data round-trip fully (geometry included);
derived datasets keep their lineage. In the sidebar: **Save** / **Open**.

**Visual pipeline & lineage (the differentiator).** The **Pipeline** button opens a
live dependency graph of every dataset — sources, the recipe that made each one,
and one-click **re-run** to reproduce a result (handy after inputs change).
Derived datasets also get a ↻ re-run button right in the list. Nothing in GeoLibre
surfaces provenance like this.

**Load from URL.** The sidebar **URL** button pulls remote data straight in —
GeoJSON, CSV, GeoParquet, FlatGeobuf, or a zipped Shapefile — streamed by link.

### Honest status on the rest

These are large or can't be verified in a headless sandbox, so they deserve their
own passes rather than a rushed, untested drop:

- **MapLibre + vector tiles (engine swap).** The single biggest lift. Replacing the
  working Leaflet map blind (no browser here) risks breaking what works. Best done
  as a deliberate, visually-tested migration — recommended as the next standalone task.
- **On-map symbology + label engine.** Basic color-by-column exists; full
  categorized/graduated/rule-based styling and a label engine are a dedicated UI effort.
- **Real road-network routing + geocoding.** Current network tools are honest
  straight-line estimates. True drive-time/isochrones need a routing engine (OSRM/
  Valhalla) or an OSM graph; geocoding needs a provider (Nominatim). Both require
  network access this sandbox blocks, so they need to be built and tested live.
- **Interactive editing/digitizing, AI assistant, Jupyter/Python package.** Each is a
  substantial standalone feature (editing = big map UI; AI = provider keys; the
  notebook package = its own pip distribution).

New deps: `h3`, `scikit-image` (added to `requirements.txt`). New endpoints:
`/api/project/{save,load}`, `/api/pipeline/rerun`, `/api/lineage`, `/api/load-url`,
plus the expanded `/api/geoprocess/run` and `/api/raster-tools/run`.
