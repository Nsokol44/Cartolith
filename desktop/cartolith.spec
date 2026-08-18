# -*- mode: python ; coding: utf-8 -*-
# Build with:  pyinstaller desktop/cartolith.spec --noconfirm
#
# Run from the PROJECT ROOT (the folder containing backend/, frontend/, desktop/),
# not from inside desktop/. Build frontend first: cd frontend && npm ci && npm run build

import sys
from PyInstaller.utils.hooks import collect_all, collect_data_files

block_cipher = None

# ---------------------------------------------------------------------
# Packages with C extensions / bundled binary data that PyInstaller's
# default import scanner misses. geopandas/fiona/rasterio/pyproj ship
# their own GDAL/PROJ data files -- these MUST be collected explicitly
# or the app will crash on launch with "PROJ: proj_create failed" or
# similar, even though it imports fine when run from source.
# ---------------------------------------------------------------------
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
]

datas, binaries, hiddenimports = [], [], []
for pkg in COLLECT_ALL_PACKAGES:
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception as e:
        print(f"[spec] WARNING: could not collect '{pkg}': {e}")

# Ship the built frontend and the backend source alongside the exe so
# launcher.py can find them via sys._MEIPASS at runtime.
datas += [
    ("../frontend/dist", "frontend/dist"),
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
    "fastapi.staticfiles",
    "starlette.middleware.cors",
    "starlette.responses",
    "starlette.staticfiles",
]

a = Analysis(
    ["launcher.py"],
    pathex=[".."],
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
    [],
    exclude_binaries=True,
    name="Cartolith",
    debug=False,
    strip=False,
    upx=False,
    # Show a console window: with no native app window (we open the
    # browser instead), this is the only thing a student can close to
    # quit the local server. It also prints the URL if the browser
    # tab gets closed by accident.
    console=True,
    icon=None,               # drop an .ico/.icns here once you have one
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name="Cartolith",
)

# macOS only: wraps the onedir build into a proper double-clickable .app
if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="Cartolith.app",
        icon=None,
        bundle_identifier="edu.utk.geography.cartolith",
    )
