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
for the downloadable zips once it finishes.

There are **two packaging pipelines** in this repo, both wired up to
build on every tagged push:

- **`desktop-tauri/` + `.github/workflows/build-tauri.yml` (recommended).**
  A real native app window (dock icon, no browser tab, no console
  window) built with [Tauri](https://tauri.app). See
  `desktop-tauri/README.md` — including an honest note on what this does
  and doesn't fix about the macOS "not verified" message.
- **`desktop/` + `.github/workflows/build-desktop.yml` (older, still
  works).** Opens the app in the student's default browser instead of a
  native window. See `desktop/README.md`.

If you don't need both, delete whichever `desktop*` folder and workflow
file you don't want and the other keeps working on its own.

### For Mac students

Both pipelines ship a **`Cartolith.app`** plus an **`Install and Run
Cartolith.command`** helper in the macOS zip. Tell students to
double-click the `.command` file the *first* time, not the `.app`
directly — it clears the quarantine flag macOS puts on unsigned apps
downloaded from the internet (the thing behind the "can't be opened
because it is not verified" / "is damaged" message). After that first
run, `Cartolith.app` can be opened normally.

Neither pipeline makes that message disappear on its own — that requires
a paid Apple Developer account ($99/yr) for code signing + notarization.
The `.command` workaround is the free alternative. See
`desktop-tauri/README.md` for the full explanation and how to set up
notarization if you want to remove this step entirely.

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
