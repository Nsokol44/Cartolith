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

### For Mac students

The macOS zip contains **`Cartolith.app`** and **`Install and Run
Cartolith.command`**. Tell students to double-click the `.command` file
the *first* time, not the `.app` directly — it clears the "unidentified
developer" / "damaged" block macOS puts on unsigned downloaded apps,
then opens the app for them. After that first run, `Cartolith.app` can
be opened normally.

Launching now opens the app in the student's **default browser** (a
tab at `http://127.0.0.1:<port>`) instead of a native window. A small
console window opens alongside it — closing that window stops the
local server. This is a workaround for not having code-signing set up;
the actual fix for a fully invisible launch is notarizing the app with
an Apple Developer account (~$99/yr), which removes the need for the
`.command` script entirely.

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
