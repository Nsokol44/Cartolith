# Cartolith

A desktop data-exploration tool for spatial and tabular datasets —
shapefiles, GeoJSON, CSV, raster — built with FastAPI + React, and
packaged as a native double-click app for Windows, macOS, and Linux.

This folder is the complete, ready-to-push project: the renamed
app source (formerly "DataLens Explorer") plus the desktop packaging
that turns it into a one-click executable.

## For students: just use the pre-built app — don't clone this repo

If you're a student in this class, you don't need Python, Node, GDAL, or
any of this source code. Go to the repo's **Releases** page, download
the zip for your OS, unzip it, and run it — see "For Mac students" below
if you're on a Mac. `./start.sh` and `pip install` are **not** for you;
they're the instructor's local dev workflow and depend on your own
machine's Python/GDAL setup being just right, which is exactly the kind
of hassle the pre-built app exists to avoid. If someone points you at
`./start.sh`, that's the wrong instructions for a student — let your
instructor know.

## For instructors/developers: run it locally (dev mode)

```bash
./start.sh
```

This installs Python + Node dependencies straight into a local venv on
*your* machine, which is why it's sensitive to your Python version,
CPU architecture, and whether GDAL is available locally — normal for a
dev workflow on one known machine, but exactly what you don't want to
depend on for a whole class of varied student laptops. That variability
is what the packaged desktop app below sidesteps entirely: GDAL gets
bundled once, in CI, into a binary each student just runs.

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
for the downloadable zips once it finishes. `desktop-tauri/` +
`.github/workflows/build-tauri.yml` builds a real native app window
(dock icon, no browser tab, no console window) using
[Tauri](https://tauri.app) — see `desktop-tauri/README.md`, including an
honest note on what this does and doesn't fix about the macOS "not
verified" message.

Look for these exact filenames on the Releases page:

| Artifact | Give it to |
|---|---|
| `Cartolith-windows.zip` | Windows students |
| `Cartolith-macos-apple-silicon.zip` | Macs from 2020+ (M1/M2/M3/M4 chip) |
| `Cartolith-macos-intel.zip` | Older Intel Macs |
| `Cartolith-linux.zip` | Linux students |

### For Mac students

The macOS zips ship **`Cartolith.app`** plus an **`Install and Run
Cartolith.command`** helper. Tell students to double-click the
`.command` file the *first* time, not the `.app` directly — it clears
the quarantine flag macOS puts on unsigned apps downloaded from the
internet (the thing behind the "can't be opened because it is not
verified" / "is damaged" message). After that first run, `Cartolith.app`
can be opened normally.

This doesn't make that message disappear on its own — that requires a
paid Apple Developer account ($99/yr) for code signing + notarization.
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
