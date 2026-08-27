# -*- mode: python ; coding: utf-8 -*-
#
# Builds the "cartolith-backend" sidecar binary that Tauri bundles and
# spawns at runtime (see src-tauri/src/main.rs).
#
# Build with (run from the PROJECT ROOT, the folder containing backend/,
# frontend/, desktop-tauri/, src-tauri/):
#
#   pyinstaller desktop-tauri/backend.spec --noconfirm
#
# This produces desktop-tauri/dist/cartolith-backend(.exe). The CI
# workflow (.github/workflows/build-tauri.yml) then renames it with the
# Rust target-triple suffix Tauri's externalBin mechanism requires and
# copies it into src-tauri/binaries/.
#
# IMPORTANT: this is a ONEFILE build (unlike desktop/cartolith.spec's
# onedir build) because Tauri's sidecar mechanism bundles a single
# executable per platform.

from PyInstaller.utils.hooks import collect_all

block_cipher = None

# Packages with C extensions / bundled binary data that PyInstaller's
# default import scanner misses. geopandas/fiona/rasterio/pyproj ship
# their own GDAL/PROJ data files -- these MUST be collected explicitly or
# the app crashes on launch with "PROJ: proj_create failed" or similar,
# even though it imports fine when run from source. See desktop/README.md
# for the same caveat -- it applies identically here.
COLLECT_ALL_PACKAGES = [
    "fastapi",
    "starlette",
    "pydantic",
    "pandas",
    "fiona",
    "rasterio",
    "pyproj",
    "geopandas",
    "shapely",
    "scipy",
    "sklearn",
    "statsmodels",
    "skimage",
    "netCDF4",
    "h3",
    "laspy",
    "pyarrow",
    "duckdb",
]

datas, binaries, hiddenimports = [], [], []
for pkg in COLLECT_ALL_PACKAGES:
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception as e:
        print(f"[backend.spec] WARNING: could not collect '{pkg}': {e}")

# Ship the (unmodified) backend source alongside the sidecar so
# launcher_tauri.py can find it via sys._MEIPASS at runtime.
datas += [
    ("../backend", "backend"),
]

hiddenimports += [
    "uvicorn.logging",
    "uvicorn.loop.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "fastapi.middleware.cors",
    "fastapi.responses",
    "starlette.middleware.cors",
    "starlette.responses",
]

a = Analysis(
    ["launcher_tauri.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="cartolith-backend",
    debug=False,
    strip=False,
    upx=False,
    console=True,   # irrelevant on macOS/Linux sidecars; harmless on Windows
    icon=None,
)
# Note: this is a onefile build because a.binaries/a.zipfiles/a.datas are
# passed directly into EXE() above (no separate COLLECT() step, which is
# what makes an onedir build instead).
