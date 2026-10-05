"""
Cartolith -- Tauri sidecar entry point
---------------------------------------
This is what gets bundled by PyInstaller into the "cartolith-backend"
binary that the Rust/Tauri shell spawns as a sidecar process.

Unlike the old desktop/launcher.py (used by the PyInstaller+pywebview
packaging in desktop/), this does NOT:
  - mount the built frontend as static files (Tauri's own webview loads
    the frontend directly from the app bundle instead)
  - open a browser tab
  - run any heartbeat/idle-shutdown watcher (Tauri kills this process
    directly when the window closes -- see src-tauri/src/main.rs)

It only does one thing: run the existing, unmodified FastAPI app
(backend/main.py) with uvicorn, on whatever port Tauri tells it to via
--port.
"""
import argparse
import os
import sys

# Make "backend" importable whether running from source or from inside a
# PyInstaller bundle (sys._MEIPASS).
if getattr(sys, "frozen", False):
    BASE_DIR = sys._MEIPASS
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    BASE_DIR = os.path.dirname(BASE_DIR)  # project root (one level up from desktop-tauri/)

sys.path.insert(0, os.path.join(BASE_DIR, "backend"))

from main import app  # noqa: E402  (existing FastAPI app, untouched)
import uvicorn  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    # reload=False: PyInstaller bundles don't support uvicorn's reloader
    # (it re-execs the interpreter, which doesn't exist inside a frozen
    # binary).
    uvicorn.run(app, host="127.0.0.1", port=args.port, reload=False, log_level="info")


if __name__ == "__main__":
    main()
