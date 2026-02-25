#!/usr/bin/env bash
#
# Dev stack for Tron with the Wind
#
# Usage:
#   ./dev.sh          Start server + web in foreground (Ctrl+C stops both)
#   ./dev.sh start    Same as above
#   ./dev.sh bg       Start in background
#   ./dev.sh stop     Stop a backgrounded dev stack
#   ./dev.sh restart  Stop then start in foreground
#
set -e
cd "$(dirname "$0")"

PID_FILE=".dev-pids"

start_fg() {
  if [ -f "$PID_FILE" ]; then
    echo "Dev stack already running in background. Run './dev.sh stop' first."
    exit 1
  fi

  trap 'kill 0 2>/dev/null; exit' INT TERM EXIT

  echo "=== Starting Tron dev stack ==="
  echo ""

  npm run dev:server &
  SERVER_PID=$!

  # Brief pause so server output appears first
  sleep 0.5

  npm run dev:web &
  WEB_PID=$!

  echo ""
  echo "  Server: ws://localhost:2567  (PID $SERVER_PID)"
  echo "  Web:    http://localhost:5173 (PID $WEB_PID)"
  echo ""
  echo "Press Ctrl+C to stop."
  echo ""

  wait
}

start_bg() {
  if [ -f "$PID_FILE" ]; then
    echo "Dev stack already running. Run './dev.sh stop' first."
    exit 1
  fi

  npm run dev:server > /dev/null 2>&1 &
  SERVER_PID=$!

  npm run dev:web > /dev/null 2>&1 &
  WEB_PID=$!

  echo "$SERVER_PID $WEB_PID" > "$PID_FILE"
  echo "Dev stack started in background."
  echo "  Server PID: $SERVER_PID"
  echo "  Web PID:    $WEB_PID"
  echo "Run './dev.sh stop' to stop."
}

stop_stack() {
  if [ ! -f "$PID_FILE" ]; then
    echo "No backgrounded dev stack found."
    return
  fi

  read -r SERVER_PID WEB_PID < "$PID_FILE"

  echo "Stopping dev stack..."
  # Kill process trees (children spawned by npm run)
  for pid in $SERVER_PID $WEB_PID; do
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
  done

  rm -f "$PID_FILE"
  echo "Stopped."
}

case "${1:-start}" in
  start)    start_fg ;;
  bg)       start_bg ;;
  stop)     stop_stack ;;
  restart)  stop_stack; sleep 0.5; start_fg ;;
  *)
    echo "Usage: ./dev.sh [start|stop|restart|bg]"
    echo ""
    echo "  start    Run server + web in foreground (default)"
    echo "  stop     Stop a backgrounded dev stack"
    echo "  restart  Stop then start"
    echo "  bg       Start in background (use 'stop' to kill)"
    ;;
esac
