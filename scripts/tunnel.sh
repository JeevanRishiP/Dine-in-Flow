#!/usr/bin/env bash
# DineFlow Cloudflare Tunnel Runner
# Runs an independent, free HTTPS tunnel for DineFlow port 3000 without colliding with ngrok or other projects.

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$DIR/logs"
LOG_FILE="$DIR/logs/tunnel.log"

if ! command -v cloudflared &> /dev/null; then
  echo "Installing cloudflared via Homebrew..."
  brew install cloudflared
fi

echo "🚀 Starting Cloudflare Tunnel for DineFlow (http://localhost:3000)..."
echo "Logging to $LOG_FILE"

# Start cloudflared in background and extract tunnel URL
cloudflared tunnel --url http://localhost:3000 > "$LOG_FILE" 2>&1 &
TUNNEL_PID=$!

echo "Waiting for tunnel URL..."
for i in {1..20}; do
  URL=$(grep -oE "https://[a-zA-Z0-9-]+\.trycloudflare\.com" "$LOG_FILE" | head -n 1 || true)
  if [ -n "$URL" ]; then
    echo "✅ Cloudflare Tunnel is LIVE: $URL"
    echo "$URL" > /tmp/dineflow_tunnel_url.txt
    echo "Webhook URL for PhonePe: $URL/v1/webhooks/phonepe"
    break
  fi
  sleep 1
done

wait $TUNNEL_PID

