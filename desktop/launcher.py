"""
Cartolith -- Desktop Launcher
--------------------------------------
Single entry point that:
  1. Imports the existing FastAPI app from backend/main.py (unmodified).
  2. Mounts the built React frontend (frontend/dist) as static files on
     that SAME app, so everything is served from one origin/one port --
     no separate Vite dev server, no CORS, no proxy needed.
  3. Runs uvicorn in a background thread.
  4. Opens the user's default browser pointed at that local server.

This is what PyInstaller bundles into the double-click executable.
Students see a terminal-less background process and their normal browser
opens a tab -- no native window toolkit (pywebview) involved at all.
"""
import os
import sys
import threading
import time
import socket
import webbrowser
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

# ---------------------------------------------------------------------
# Auto-shutdown: the frontend pings /__heartbeat__ every few seconds
# while a tab is open, and fires a "closing" beacon on tab close/refresh.
# A background thread here watches both signals and exits the whole
# process once it's confident no browser tab is left open -- so closing
# the browser is enough; nobody has to remember to close a console
# window separately.
#
# These routes MUST be registered before app.mount("/", StaticFiles...)
# below -- Starlette checks routes in registration order, and a mount at
# "/" matches every path as a prefix, so it would otherwise swallow
# these requests before they ever reach this handler.
# ---------------------------------------------------------------------
_last_heartbeat = time.time()
_closing_since = None
_shutdown_lock = threading.Lock()


@app.post("/__heartbeat__")
async def _heartbeat():
    global _last_heartbeat, _closing_since
    with _shutdown_lock:
        _last_heartbeat = time.time()
        _closing_since = None  # any live tab cancels a pending shutdown
    return {"ok": True}


@app.post("/__closing__")
async def _closing():
    # Sent via navigator.sendBeacon on pagehide (tab close OR refresh).
    # We don't shut down immediately, since a refresh triggers this too --
    # we just start a short grace-period timer that a fresh heartbeat
    # (from the reloaded page) will cancel.
    global _closing_since
    with _shutdown_lock:
        _closing_since = time.time()
    return {"ok": True}


def _watch_for_shutdown(idle_timeout=20, close_grace_period=3):
    while True:
        time.sleep(2)
        with _shutdown_lock:
            idle = time.time() - _last_heartbeat
            closing_elapsed = (
                time.time() - _closing_since if _closing_since else None
            )
        if closing_elapsed is not None and closing_elapsed > close_grace_period:
            print("[launcher] Browser tab closed -- shutting down.")
            os._exit(0)
        if idle > idle_timeout:
            print("[launcher] No browser activity detected -- shutting down.")
            os._exit(0)


threading.Thread(target=_watch_for_shutdown, daemon=True).start()

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

    webbrowser.open(url)

    print(f"[launcher] Cartolith is running at {url}")
    print("[launcher] This will close automatically when you close the browser tab.")
    print("[launcher] (You can also close this window or press Ctrl+C to stop it manually.)")

    # No native window to hold the process open (we're just a background
    # server now), so block on the server thread instead.
    try:
        server_thread.join()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
