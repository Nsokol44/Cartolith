#!/usr/bin/env bash
echo "◈  Stopping Cartolith..."

for PORT in 8000 5173; do
  PIDS=$(lsof -ti tcp:$PORT 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "  Killing port $PORT (PIDs: $PIDS)"
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
  fi
done

pkill -f "uvicorn main:app" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 0.5
echo "  ✓  Ports 8000 and 5173 are free."
