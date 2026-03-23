#!/bin/bash
# Wrapper script to run main.py with auto-restart capability
# When main.py exits with code 42, it will automatically restart

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Default NAOqi connection parameters
IP="${1:-127.0.0.1}"
PORT="${2:-9559}"

echo "====================================="
echo "Pepper Main Application Launcher"
echo "====================================="
echo "Script directory: $SCRIPT_DIR"
echo "NAOqi IP: $IP"
echo "NAOqi Port: $PORT"
echo ""
echo "To restart the application remotely, use the Settings page."
echo "Press Ctrl+C to stop completely."
echo "====================================="
echo ""

# Trap Ctrl+C to exit cleanly
trap 'echo ""; echo "Shutting down..."; exit 0' INT TERM

# Main loop - restart on exit code 42
while true; do
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting main.py..."

    python main.py --ip "$IP" --port "$PORT"
    EXIT_CODE=$?

    echo ""
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] main.py exited with code: $EXIT_CODE"

    if [ $EXIT_CODE -eq 42 ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Restart requested - restarting in 2 seconds..."
        sleep 2
        echo ""
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Normal exit or error - stopping launcher"
        break
    fi
done

echo "Launcher stopped."
