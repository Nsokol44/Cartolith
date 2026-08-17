# Cartolith

A desktop data-exploration tool for spatial and tabular datasets —
shapefiles, GeoJSON, CSV, raster — built with FastAPI + React, and
packaged as a native double-click app for Windows, macOS, and Linux.

This folder is the complete, ready-to-push project: the renamed
app source (formerly "DataLens Explorer") plus the desktop packaging
that turns it into a one-click executable.

## Run it locally (dev mode, like before)

```bash
./start.sh
```

## Ship it as a double-click desktop app

Push this whole folder to a GitHub repo, then tag a release:

```bash
git init
git add .
git commit -m "Cartolith v1.0"
git remote add origin <your-repo-url>
git push -u origin main
git tag v1.0
git push origin v1.0
```

GitHub's own Windows/macOS/Linux runners will each build a native app
automatically — check the "Actions" tab while it runs, then "Releases"
for the three downloadable zips once it finishes. See `desktop/README.md`
for how the packaging works and the one thing worth testing before
handing it to a class (GDAL/PROJ paths on geospatial builds).

## What changed from the original DataLens Explorer

"DataLens" → "Cartolith" in every user-facing string (app header,
browser tab title, welcome screen, in-app concept explanations,
`start.sh`/`stop.sh` console output), the FastAPI app title, and the
saved-project file format itself: `.datalens.json` → `.cartolith.json`,
with the internal marker key `datalens_project` → `cartolith_project`
updated consistently in both the save and load-validation code.

**Heads up:** any project files saved under the old `.datalens.json`
format won't be recognized as valid Cartolith projects unless a
backwards-compatibility check is added. Ask if you want that.

No internal logic, variable names, or file structure were changed —
only user-visible strings, the two format identifiers above, and the
addition of `desktop/` and `.github/workflows/`.
