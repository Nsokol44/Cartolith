# Cartolith

A desktop data-exploration tool for spatial and tabular datasets —
shapefiles, GeoJSON, CSV, raster — built with FastAPI + React, and
packaged as a native double-click app for Windows, macOS, and Linux.

This folder is the complete, ready-to-push project: the renamed
app source (formerly "DataLens Explorer") plus the desktop packaging
that turns it into a one-click executable.

## For students: quick start

1. Go to **[the latest release](https://github.com/Nsokol44/Cartolith/releases/latest)**.
2. Under "Assets", download the one file for your computer:
   - **Windows** → `Cartolith-windows.zip`
   - **Mac, 2020 or newer (M1/M2/M3/M4 chip)** → `Cartolith-macos-apple-silicon.zip`
   - **Mac, older (Intel chip)** → `Cartolith-macos-intel.zip`
   - Not sure which Mac you have? Apple menu → **About This Mac** → look for "Chip" (Apple M-something) or "Processor" (Intel).
3. Unzip it, then:
   - **Windows:** run the installer inside (a `.msi` or `*-setup.exe` file — not a plain `Cartolith.exe`). Windows will likely warn "Windows protected your PC" — click **More info → Run anyway**. Once installed, open Cartolith from the Start Menu.
   - **Mac:** double-click **`Install and Run Cartolith.command`** the *first* time (not `Cartolith.app` directly) — this clears the "not verified" security block for you. After that, open `Cartolith.app` normally.
4. First launch can take a minute or two to fully start — that's expected, not frozen. Leave the window open.

You don't need Python, Node, GDAL, or this source code to run Cartolith. If someone points you at `./start.sh` or `pip install`, that's the instructor's dev setup, not meant for students — let your instructor know if that happens.

**If the app still won't launch after trying the above,** see "Running from source as a last resort" further down — it's a fallback for exactly this situation, with the caveat that it can hit different problems of its own.

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

### For Windows students

The Windows zip contains an **installer** (a `.msi` file, or something
named like `Cartolith_1.0.0_x64-setup.exe`) — not a ready-to-run
`Cartolith.exe`. Students need to run that installer and let it finish;
Cartolith then shows up in the Start Menu like any normal installed
program, which is what they actually open afterward — not anything in
the originally downloaded/unzipped folder. Windows SmartScreen will
likely warn "Windows protected your PC" the first time the installer
runs, since it's unsigned — clicking **"More info" → "Run anyway"** is
expected and safe, not a sign of a problem. Worth stating this
explicitly to the class up front; "I can't find Cartolith.exe" is an
easy thing to get stuck on otherwise.

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

## Running from source as a last resort

If a student's packaged app genuinely won't launch no matter what (rare,
but possible — different Windows/Mac security software, an unusual
system config, etc.), running Cartolith directly from source is a
legitimate fallback. It is **not** a simpler alternative to the
packaged app — it trades "installer/security-prompt friction" for
"your Python environment has to cooperate," which is exactly the
problem the packaged app exists to avoid for everyone else. Only reach
for this with a specific stuck student, not as a general recommendation.

```bash
git clone https://github.com/Nsokol44/Cartolith.git
cd Cartolith
./start.sh
```

A few things that measurably improve the odds of this working:

- **Use Python 3.10–3.12.** The geospatial packages (`fiona`, `rasterio`,
  `geopandas`, `pyproj`) have the best prebuilt-wheel coverage on these
  versions. Very new (3.13+) or very old Python is more likely to force
  a from-source build, which then needs a system GDAL install to even
  attempt and often fails without one.
- **Upgrade pip first:** `pip install --upgrade pip setuptools wheel`
  before running `./start.sh` — an outdated resolver is a common cause
  of "tries to build from source and fails" even when a working
  prebuilt wheel exists.
- **On Mac, if it still tries to build from source:** `brew install gdal`
  gives pip a system GDAL to link against.
- **On Apple Silicon specifically:** make sure Terminal itself isn't
  running under Rosetta (check with `arch` — it should print `arm64`,
  not `i386`/`x86_64`).

If a student hits an error here, get the exact `pip install` error text
(not just "it failed") before troubleshooting further — the fix is
usually specific to which package failed and why.

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
