"""
Cartolith -- Desktop Launcher
--------------------------------------
Single entry point that:
  1. Imports the existing FastAPI app from backend/main.py (unmodified).
  2. Mounts the built React frontend (frontend/dist) as static files on
     that SAME app, so everything is served from one origin/one port --
     no separate Vite dev server, no CORS, no proxy needed.
  3. Runs uvicorn in a background thread.
  4. Opens a native OS window (pywebview) pointed at that local server.

This is what PyInstaller bundles into the double-click executable.
Students never see a terminal, a browser tab, or a port number.
"""
import os
import sys
import threading
import time
import socket
import webview
import uvicorn

# ---------------------------------------------------------------------
# Make sure "backend" is importable whether we're running from source
# or from inside a PyInstaller bundle (sys._MEIPASS).
# ---------------------------------------------------------------------
if getattr(sys, "frozen", False):
    BASE_DIR = sys._MEIPASS
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    BASE_DIR = os.path.dirname(BASE_DIR)  # project root (one level up from desktop/)

sys.path.insert(0, os.path.join(BASE_DIR, "backend"))

from main import app  # noqa: E402  (existing FastAPI app, untouched)
from fastapi.staticfiles import StaticFiles

FRONTEND_DIST = os.path.join(BASE_DIR, "frontend", "dist")

if os.path.isdir(FRONTEND_DIST):
    # Serve the built React app at "/" on the SAME FastAPI instance that
    # already serves /api/*. frontend/src/api.js uses relative paths
    # ('' + '/api/...'), so this "just works" with zero frontend changes.
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
else:
    print(f"[launcher] WARNING: {FRONTEND_DIST} not found.")
    print("[launcher] Run `npm run build` in frontend/ before packaging.")


def _free_port(preferred=8000):
    """Fall back to an OS-assigned free port if 8000 is taken."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", preferred))
            return preferred
        except OSError:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]


def _run_server(port):
    # reload=False and a single worker: PyInstaller bundles don't support
    # uvicorn's reloader (it re-execs the interpreter, which doesn't exist
    # inside a frozen binary).
    uvicorn.run(app, host="127.0.0.1", port=port, reload=False, log_level="warning")


def main():
    port = _free_port(8000)
    server_thread = threading.Thread(target=_run_server, args=(port,), daemon=True)
    server_thread.start()

    # Give uvicorn a moment to bind before pointing the window at it.
    url = f"http://127.0.0.1:{port}"
    for _ in range(50):  # up to ~5s
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                break
        except OSError:
            time.sleep(0.1)

    webview.create_window(
        "Cartolith",
        url,
        width=1400,
        height=900,
        min_size=(1000, 700),
    )
    webview.start()


if __name__ == "__main__":
    main()
