#!/usr/bin/env bash
# ==============================================================================
# Dineflow k6 Load Testing Execution Script
# Reference: ARCH §24, §25 (Load & Saturation Targets)
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default environment configuration
export API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
export ORG_ID="${ORG_ID:-00000000-0000-0000-0000-000000000001}"
export OUTLET_ID="${OUTLET_ID:-00000000-0000-0000-0000-000000000002}"
export TABLE_ID="${TABLE_ID:-00000000-0000-0000-0000-000000000003}"
export ITEM_ID="${ITEM_ID:-11111111-1111-1111-1111-111111111111}"

echo "=========================================================="
echo " Dineflow Production Load Testing Suite (k6)"
echo " Target API: $API_BASE_URL"
echo " Org ID:     $ORG_ID"
echo " Outlet ID:  $OUTLET_ID"
echo "=========================================================="

if ! command -v k6 &>/dev/null; then
  echo "Error: k6 is not installed."
  echo "Install k6 via Homebrew: brew install k6"
  echo "Or via official package manager: https://k6.io/docs/get-started/installation/"
  exit 1
fi

MODE="${1:-all}"

run_qr_test() {
  echo ""
  echo "----------------------------------------------------------"
  echo " [1/3] Scenario: QR Scan Flash Crowd (500 VUs burst)"
  echo " Target SLO: Menu fetch p95 < 200ms, Error rate < 1%"
  echo "----------------------------------------------------------"
  k6 run "$SCRIPT_DIR/qr-scan-burst.js"
}

run_order_storm_test() {
  echo ""
  echo "----------------------------------------------------------"
  echo " [2/3] Scenario: Peak Lunch-Rush Order Storm (25 orders/sec)"
  echo " Target SLO: Order placement p95 < 500ms, Error rate < 1%"
  echo "----------------------------------------------------------"
  k6 run "$SCRIPT_DIR/lunch-rush-order-storm.js"
}

run_idempotency_test() {
  echo ""
  echo "----------------------------------------------------------"
  echo " [3/3] Scenario: Concurrent Checkout Idempotency (20 VUs)"
  echo " Target: Zero 500 errors, zero duplicate orders"
  echo "----------------------------------------------------------"
  k6 run "$SCRIPT_DIR/checkout-idempotency.js"
}

case "$MODE" in
  qr)
    run_qr_test
    ;;
  orders)
    run_order_storm_test
    ;;
  idempotency)
    run_idempotency_test
    ;;
  all)
    run_qr_test
    run_order_storm_test
    run_idempotency_test
    ;;
  *)
    echo "Usage: $0 [all | qr | orders | idempotency]"
    exit 1
    ;;
esac

echo ""
echo "=========================================================="
echo " Load Testing Suite Finished Successfully!"
echo "=========================================================="
