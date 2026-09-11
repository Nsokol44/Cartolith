# Cartolith — Desktop Packaging

Turns your existing FastAPI + React app into a double-click desktop app
for Windows, macOS, and Linux — no terminal, no "start the backend then
the frontend," no Tauri/Rust.

## How it works

- `launcher.py` starts your existing `backend/main.py` FastAPI app in a
  background thread, mounts the **built** React app (`frontend/dist`) as
  static files on that same app, and opens a native window (via
  `pywebview`) pointed at it. One process, one window, one port.
- `cartolith.spec` tells PyInstaller how to bundle Python + all your
  geospatial dependencies (GDAL/PROJ data files included — these are the
  files that normally get missed and cause silent crashes) into a folder
  next to your existing `backend/` and `frontend/` code.
- Nothing in `backend/` or `frontend/` is modified.

## One-time setup (do this once, in your own repo)

1. Copy the `desktop/` folder and `.github/workflows/build-desktop.yml`
   into the root of your project, next to your
   existing `backend/` and `frontend/` folders.
2. Commit and push to a GitHub repo (private is fine).

## Getting installers for students (recommended path)

Push to `main`, or push a tag like `v1.0`:

```bash
git tag v1.0
git push origin v1.0
```

GitHub's own Windows/macOS/Linux runners each build their **own** native
version automatically — this is the only way to get a real macOS build
without a Mac and a real Windows .exe without a Windows machine; no local
toolchain needed on your end. Check the "Actions" tab on your repo:
each OS produces a downloadable `.zip` (or attaches to the GitHub
Release if you pushed a tag). Upload those three zips to Canvas.

## Building locally instead (optional, e.g. to test before pushing)

```bash
# macOS or Linux
bash desktop/build_mac_or_linux.sh

# Windows
desktop\build_windows.bat
```

## What students do

1. Download the zip for their OS from Canvas.
2. Unzip it.
3. Double-click `CartolithExplorer` (Win/Linux) or `CartolithExplorer.app`
   (Mac). A window opens — that's it. No install, no Python, no terminal.

## Heads-up: geospatial packaging is the genuinely fiddly part

`fiona`, `rasterio`, `pyproj`, and `geopandas` all bundle their own
GDAL/PROJ binaries and data files. The spec file explicitly collects all
of them (`collect_all` in `cartolith.spec`), which handles the vast
majority of cases — but this stack is notorious for one library finding
the wrong `proj.db` at runtime on a machine that isn't the one it was
built on. **Test each platform's build on an actual machine of that OS
before handing it to a full class** — if something breaks, it'll most
likely surface as a `PROJ:` or `GDAL data not found` error the first
time a dataset loads, and the fix is almost always adding that specific
package's data directory to `datas` in the spec.

Netcdf4, laspy, and h3 are already in the collected-packages list too,
since your `requirements.txt` uses them.

## Icon

`cartolith.spec` currently ships with no custom icon (`icon=None`). Drop
an `.ico` (Windows) and `.icns` (macOS) into `desktop/` and point the two
`icon=` lines at them once you have branded ones.
