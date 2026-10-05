# Cartolith

A desktop data-exploration tool for spatial and tabular datasets —
shapefiles, GeoJSON, CSV, raster, NetCDF, lidar — built with FastAPI +
React and packaged as a native double-click app. Cartolith is designed
for **teaching GIS and spatial analysis to people who have never used
GIS**: every operation derives a new dataset with visible lineage, and a
plain-English teaching layer (glossary, per-tool explainers, guided
lessons) is woven through the whole app.

Version 1.4.11 · MIT License (see `LICENSE`)

---

## Students: install and run (the only path most people need)

1. Go to **[the latest release](https://github.com/Nsokol44/Cartolith/releases/latest)**.
2. Under "Assets", download the one file for your computer:
   - **Windows** → `Cartolith-windows.zip`
   - **Mac, 2020 or newer (M1/M2/M3/M4 chip)** → `Cartolith-macos-apple-silicon.zip`
   - **Mac, older (Intel chip)** → `Cartolith-macos-intel.zip`
   - Not sure which Mac you have? Apple menu → **About This Mac** → "Chip" (Apple M-something) or "Processor" (Intel).
3. Unzip it, then:
   - **Windows:** run the installer inside (`.msi` or `*-setup.exe` — not a plain `Cartolith.exe`). Windows will likely warn "Windows protected your PC" — click **More info → Run anyway**. Then open Cartolith from the Start Menu.
   - **Mac:** double-click **`Install and Run Cartolith.command`** the *first* time (not `Cartolith.app` directly) — it clears the "not verified" block for unsigned apps. After that, open `Cartolith.app` normally.
4. First launch can take a minute or two. That's expected, not frozen.

You do **not** need Python, Node, GDAL, or this source code. If someone
points you at `./start.sh` or `pip install`, that's the developer setup
below — let your instructor know.

**If the native app won't launch** on your machine, look for the
`Cartolith-web-*` zip for your platform on the same release page. That
fallback build opens in your regular web browser with a plain console
window alongside. If that fails too, "Running from source" at the bottom
is the last resort.

## Which build do I use?

There are two packaging paths in this repo. They confused people, so
here is the whole story:

| Build | Where it lives | Status |
|---|---|---|
| **Tauri native app** (`Cartolith-*.zip`) | `src-tauri/`, `desktop-tauri/`, built by `.github/workflows/build-tauri.yml` | **Primary.** Give this to students first. |
| PyInstaller + browser (`Cartolith-web-*.zip`) | `desktop/` | **Legacy fallback** for machines where the native app won't launch. See the banner in `desktop/README.md`. |

### For Mac students (web fallback build)

The macOS web-fallback zip contains **`Cartolith.app`** and
**`Install and Run Cartolith.command`**. Tell students to double-click
the `.command` file the *first* time, not the `.app` directly — it
clears the "unidentified developer" / "damaged" block macOS puts on
unsigned downloaded apps, then opens the app for them. After that first
run, `Cartolith.app` can be opened normally.

The fallback launches in the student's **default browser** (a tab at
`http://127.0.0.1:<port>`) instead of a native window, with a small
console window alongside; the server shuts itself down when the tab
closes. This is a workaround for not having code-signing set up; the
actual fix for a fully invisible launch is notarizing the app with an
Apple Developer account (~$99/yr), which removes the need for the
`.command` script entirely.

## Developers / instructors: run from source

One command:

```bash
./start.sh
```

That is the whole dev workflow. It checks your prerequisites with
plain-English errors (Python 3.10–3.12 — newer Pythons force the GIS
libraries into source builds that usually fail; Node 18+), creates
`backend/.venv`, installs dependencies **only when they have changed**,
starts the backend on port 8000 and the frontend on port 5173, and waits
until the backend answers before launching the UI. `./stop.sh` stops
both; `./restart.sh` restarts.

Then open http://localhost:5173. In dev mode the frontend proxies to the
backend at http://localhost:8000; `./start.sh` prints both URLs.

### Cutting a release

```bash
git tag v1.4.12   # keep the app version strings in step — see below
git push origin v1.4.12
```

GitHub Actions (`build-tauri.yml`) builds the Windows and both macOS
installers and attaches them to the release. Linux is currently disabled
in the build matrix (the matrix entry is commented out in the workflow).

Version numbers live in four places and must agree with the tag:
`backend/main.py` (FastAPI `version=` and `/api/health`),
`frontend/package.json`, `src-tauri/tauri.conf.json`, and the banner in
`start.sh`. They were aligned to the tag line (1.4.11) in October 2026;
before that the app strings said 5.0.0 while tags said 1.4.x, which made
bug reports hard to place.
>>>>>>> enhance/training-tool

### Tests

```bash
cd backend && python -m pytest tests/ -q
```

The suite validates the analytical core against independent references
(PySAL/esda for the spatial statistics, analytic cases for buffers,
terrain, zonal statistics) plus the exercise grader and code-reveal
coverage. CI runs it on every push (`.github/workflows/tests.yml`) — the
desktop build workflow itself only packages.

## What Cartolith does

- **Dataset-centric workflow** — Explore, Visualize, Cartography,
  Analyze, Statistics, Geoprocess, SQL Lab, Notebook, and Learn tabs all
  read and write *datasets*; every operation derives a new dataset that
  carries its lineage (the Pipeline view draws the dependency graph and
  can re-run any recipe).
- **Geoprocess hub** — 19 vector/overlay/grid/select tools (buffer,
  spatial join, clip/intersection/difference/union, Voronoi, H3, …),
  12 raster tools (terrain, NDVI/NDWI/EVI, zonal statistics, …), and
  3 network tools (OD matrix, nearest facility, service area) using
  straight-line distance — honest, offline, and instant; true drive-time
  would need a routing engine.
- **Statistics, including spatial statistics** — Moran's I, Geary's C,
  LISA, geographically weighted regression, spatial lag models, plus the
  standard suite (regression, PCA, k-means, trees/forests, MLP).
- **Teaching layer** — a 52-concept plain-English glossary, a `?`
  explainer beside every tool, 8 guided lessons whose steps check the
  app's real state, and one-click sample data.
- **Code reveal** — operations return the equivalent geopandas/PySAL
  snippet, so a workflow learned in the GUI can be re-run as a script.

## Honest limitations

Unsigned installers (no paid Apple/Microsoft certificates), basemaps
need an internet connection (choose "No basemap" offline), network
tools are straight-line only, symbology/labels are basic, and there is
no digitizing/editing yet. `WHATS_NEW.md` tracks feature history in
detail; `ENHANCEMENT_PLAN.md` is a candid audit of correctness,
pedagogy, and what to build next.

## Running from source as a last resort (students)

Only for a specific stuck machine — it trades installer friction for
Python-environment friction, which is the problem the packaged app
exists to avoid.

```bash
git clone https://github.com/Nsokol44/Cartolith.git
cd Cartolith
./start.sh
```

Use Python 3.10–3.12, upgrade pip first (`pip install --upgrade pip
setuptools wheel`), on Mac `brew install gdal` helps if a wheel is
missing, and on Apple Silicon make sure Terminal is not running under
Rosetta (`arch` should print `arm64`). Get the exact `pip install` error
text before troubleshooting — the fix depends on which package failed.

## History

Cartolith was formerly "DataLens Explorer". User-facing strings, the
FastAPI title, and the project file format were renamed
(`.datalens.json` → `.cartolith.json`); old project files are not
recognised unless a compatibility check is added.
