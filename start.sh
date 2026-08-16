#!/usr/bin/env bash
# Cartolith v5 — setup and launch
# NOTE: intentionally NO "set -e" — we handle errors manually

BACKEND_PORT=8000
FRONTEND_PORT=5173
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "◈  Cartolith v5"
echo "──────────────────────────────────"

# ── Free ports if occupied ─────────────────────────────────────────────────
free_port() {
  local PORT=$1
  local PIDS=""
  if command -v lsof &>/dev/null; then
    PIDS=$(lsof -ti tcp:$PORT 2>/dev/null || true)
  fi
  if [ -n "$PIDS" ]; then
    echo "  Freeing port $PORT (killing PIDs: $PIDS)..."
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
    sleep 0.5
  fi
}

echo "→ Freeing ports $BACKEND_PORT and $FRONTEND_PORT..."
free_port $BACKEND_PORT
free_port $FRONTEND_PORT

# ── Python venv + deps ─────────────────────────────────────────────────────
echo "→ Setting up Python backend..."
cd "$SCRIPT_DIR/backend"

if ! command -v python3 &>/dev/null; then
  echo "✗  Python 3 not found. Install Python 3.10+ and try again."
  exit 1
fi

if [ ! -d ".venv" ]; then
  echo "  Creating virtual environment..."
  python3 -m venv .venv
fi

source .venv/bin/activate
echo "  Checking Python dependencies..."
pip install -q --upgrade pip
pip install -q -r requirements.txt
echo "  ✓  Python deps ready"

# ── Node deps ──────────────────────────────────────────────────────────────
echo "→ Setting up frontend..."
cd "$SCRIPT_DIR/frontend"
if ! command -v node &>/dev/null; then
  echo "✗  Node.js not found. Install Node 18+ and try again."
  exit 1
fi
if [ ! -d "node_modules" ]; then
  echo "  Installing Node dependencies (first time ~30s)..."
  npm install --silent
fi
echo "  ✓  Node deps ready"

# ── Launch backend (log to file so startup noise doesn't confuse shell) ────
echo ""
echo "──────────────────────────────────"
echo "◈  Starting services..."
echo ""

cd "$SCRIPT_DIR/backend"
source .venv/bin/activate

BACKEND_LOG="$SCRIPT_DIR/backend.log"
echo "  Starting backend (log: $BACKEND_LOG)..."
uvicorn main:app \
  --host 127.0.0.1 \
  --port $BACKEND_PORT \
  --reload \
  --http h11 \
  > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

# ── Wait for backend — up to 60 seconds ───────────────────────────────────
echo -n "  Waiting for backend to be ready"
READY=0
for i in $(seq 1 60); do
  sleep 1
  # Check process is still alive
  if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo ""
    echo ""
    echo "  ✗  Backend process died. Last log output:"
    echo "────────────────────────────────"
    tail -30 "$BACKEND_LOG"
    echo "────────────────────────────────"
    exit 1
  fi
  # Check HTTP health
  if curl -s --max-time 1 "http://127.0.0.1:$BACKEND_PORT/api/health" > /dev/null 2>&1; then
    READY=1
    echo " ✓  (${i}s)"
    break
  fi
  echo -n "."
done

if [ $READY -eq 0 ]; then
  echo ""
  echo ""
  echo "  ✗  Backend didn't respond after 60s. Last log output:"
  echo "────────────────────────────────"
  tail -30 "$BACKEND_LOG"
  echo "────────────────────────────────"
  kill $BACKEND_PID 2>/dev/null
  exit 1
fi

# ── Launch frontend ────────────────────────────────────────────────────────
cd "$SCRIPT_DIR/frontend"
npm run dev > "$SCRIPT_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
sleep 2

echo ""
echo "  ✓  Backend  →  http://localhost:$BACKEND_PORT"
echo "  ✓  Frontend →  http://localhost:$FRONTEND_PORT"
echo ""
echo "  Open http://localhost:$FRONTEND_PORT in your browser"
echo ""
echo "  Logs:  backend.log  |  frontend.log"
echo "  Stop:  press Ctrl+C  or run  ./stop.sh"
echo "──────────────────────────────────"
echo ""

# Open browser automatically on macOS
if command -v open &>/dev/null; then
  sleep 1
  open "http://localhost:$FRONTEND_PORT" 2>/dev/null || true
fi

trap "echo ''; echo 'Shutting down...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo 'Done.'; exit 0" INT TERM
wait $BACKEND_PID
