#!/bin/zsh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

APP_PORT="${APP_PORT:-3000}"
APP_HOST="${APP_HOST:-0.0.0.0}"

get_lan_ip() {
  local network_interface
  local ip

  for network_interface in en0 en1; do
    ip="$(ipconfig getifaddr "$network_interface" 2>/dev/null || true)"
    if [[ -n "$ip" ]]; then
      echo "$ip"
      return 0
    fi
  done

  # Fallback for environments where ipconfig is restricted.
  ip="$(ifconfig | awk '/inet / {print $2}' | grep -E '^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[0-1])\.' | head -n 1)"
  if [[ -n "$ip" ]]; then
    echo "$ip"
    return 0
  fi

  return 1
}

if ! command -v php >/dev/null 2>&1; then
  echo "PHP is required to run this app."
  echo "Install PHP 8 or newer, then try again."
  read "?Press Enter to close..."
  exit 1
fi

PUBLIC_URL="https://arathamizh.com"
LOCAL_URL="http://localhost:${APP_PORT}"
LAN_IP="$(get_lan_ip || true)"

echo "Starting Tamil News App"
echo "Browser: ${PUBLIC_URL}"

if [[ -n "$LAN_IP" ]]; then
  echo "Mobile:  http://${LAN_IP}:${APP_PORT}"
else
  echo "Mobile:  Could not detect LAN IP automatically."
  echo "         Run 'ifconfig | grep "'"'inet '"'"'' and use your 192.168.x.x address."
fi

if lsof -nP -iTCP:"$APP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port ${APP_PORT} is already in use."
  echo "If this app is already running, use the URLs above."
  open "$LOCAL_URL" || true
  exit 0
fi

open "$LOCAL_URL" || true
php -S "${APP_HOST}:${APP_PORT}" -t "$SCRIPT_DIR"