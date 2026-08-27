# Cartolith — Tauri Desktop Packaging

This turns Cartolith into a real native desktop app (dock icon, its own
window, `Cmd+Q`/`Alt+F4` quits it properly) using
[Tauri](https://tauri.app), instead of the old approach of opening the
app in a browser tab. **Nothing in `backend/` or `frontend/` had to be
rewritten** — the FastAPI backend and React frontend are unchanged. What
changed:

- **`src-tauri/`** — a small Rust shell. On launch it starts the Python
  backend as a background "sidecar" process on a free local port, opens
  a native window pointed at the built frontend, and kills the backend
  when the window closes.
- **`desktop-tauri/launcher_tauri.py`** — the sidecar's entry point. It's
  `backend/main.py`'s existing FastAPI app, run with uvicorn on whatever
  port Tauri passes it via `--port`. No browser, no static-file mounting
  (Tauri's webview loads the frontend directly).
- **`frontend/src/api.js`** — the only frontend change. It now asks the
  Rust shell which port the sidecar landed on (`initBackend()` in
  `main.jsx`) instead of assuming same-origin `/api/...` requests. In dev
  mode (`npm run dev`) this is a no-op — nothing about your normal dev
  workflow changes.

The old `desktop/` folder (PyInstaller + pywebview/browser-tab approach)
is left in place and still works if you ever want it, but `desktop-tauri/`
+ `.github/workflows/build-tauri.yml` is now the recommended path.

## Getting installers for students

Push to `main`, or push a tag like `v1.0`, exactly as before:

```bash
git add .
git commit -m "Switch to Tauri packaging"
git push
git tag v1.0
git push origin v1.0
```

Check the **Actions** tab for build progress, then **Releases** for the
downloadable zips once a tagged build finishes. The workflow builds four
artifacts:

| Artifact | Give it to |
|---|---|
| `Cartolith-windows.zip` | Windows students |
| `Cartolith-macos-apple-silicon.zip` | Macs from 2020+ (M1/M2/M3/M4 chip) |
| `Cartolith-macos-intel.zip` | Older Intel Macs |
| `Cartolith-linux.zip` | Linux students |

PyInstaller can't cross-compile, so the two Mac variants are genuinely
built on separate Intel and Apple Silicon GitHub runners — there's no way
around shipping both if your class has a mix of old and new Macs. If a
student isn't sure which chip they have: **Apple menu → About This Mac**
— it says "Chip" (Apple M-something) or "Processor" (Intel).

## Building locally instead (optional, e.g. to test before pushing)

You'll need [Rust](https://www.rust-lang.org/tools/install), Node 20+,
and Python 3.11+ installed, plus (Linux only) the packages listed in
`.github/workflows/build-tauri.yml`'s "Install Linux system dependencies"
step.

```bash
# 1. Build the frontend
cd frontend && npm ci && npm run build && cd ..

# 2. Build the backend sidecar
pip install -r backend/requirements.txt pyinstaller
cd desktop-tauri && pyinstaller backend.spec --noconfirm && cd ..

# 3. Put the sidecar where Tauri expects it (note the target-triple suffix —
#    run `rustc -Vv | grep host` to get yours, e.g. aarch64-apple-darwin)
mkdir -p src-tauri/binaries
cp desktop-tauri/dist/cartolith-backend src-tauri/binaries/cartolith-backend-<your-triple>

# 4. Build the app
npx @tauri-apps/cli@2 icon src-tauri/icons/app-icon.png   # once, or after changing the icon
npx @tauri-apps/cli@2 build
```

The finished app/installer lands in
`src-tauri/target/release/bundle/` (or `src-tauri/target/<triple>/release/bundle/`
if you passed `--target`).

## Heads-up: the same geospatial packaging caveat applies

`backend.spec` collects GDAL/PROJ data files the same way
`desktop/cartolith.spec` did (see `desktop/README.md`'s note on this) —
it's the same Python backend, so the same "PROJ: proj_create failed" /
"GDAL data not found" failure mode is possible if a new geospatial
dependency gets added later without being added to `COLLECT_ALL_PACKAGES`
in `backend.spec`. **Test each platform's build before handing it to a
full class.**

## The honest truth about the macOS "not verified" message

Switching to Tauri does **not**, by itself, make macOS Gatekeeper stop
blocking the app. That block is about code signing, not packaging
technology — a Tauri app and a PyInstaller app are equally "unsigned" to
macOS unless you pay for an Apple Developer account. Two options:

1. **Free workaround (what this build ships with):** the zip includes
   `Install and Run Cartolith.command`, which clears the quarantine flag
   that triggers the block. Tell students to double-click **that file**
   first, not `Cartolith.app` directly. This is exactly what the old
   `desktop/` packaging did — it's not a new step.
2. **The actual fix, if this keeps tripping students up:** enroll in the
   [Apple Developer Program](https://developer.apple.com/programs/) ($99/yr),
   then code-sign and notarize the app in CI. That removes every Gatekeeper
   prompt — no `.command` file needed at all. This is a bigger lift (it
   needs your Apple ID credentials as GitHub secrets) — ask if you want
   help wiring that up once you have the account.

If students are still hitting the block *after* running the `.command`
file, the most common cause is doing it in the wrong order (opening
`Cartolith.app` directly first) or a very recent macOS version (Sequoia+)
that moved the override into **System Settings → Privacy & Security →
"Open Anyway"** instead of a right-click menu — worth mentioning in your
class instructions either way.
