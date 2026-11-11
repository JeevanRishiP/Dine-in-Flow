# Dineflow Load Testing Suite (k6)

This directory contains automated k6 performance and saturation suites designed to validate the SLOs and operational limits specified in `docs/ARCHITECTURE.md` §24 and §25.

---

## 1. Scenarios & Target SLOs

| Scenario | File | Workload / Traffic Model | Target SLO (ARCH §24) | Success Criteria |
| :--- | :--- | :--- | :--- | :--- |
| **Flash Crowd QR Scan Burst** | `qr-scan-burst.js` | 500 concurrent VUs ramped up in 15s; tests cold fetch followed by conditional polling (`If-None-Match`). | Menu fetch p95 < 200 ms | • p95 < 200 ms<br>• p99 < 400 ms<br>• HTTP 304 on cache hits<br>• Error rate < 1% |
| **Peak Lunch-Rush Order Storm** | `lunch-rush-order-storm.js` | `ramping-arrival-rate` climbing from 5 to 25 orders/second (platform peak). | Order placement p95 < 500 ms | • p95 < 500 ms<br>• p99 < 1000 ms<br>• Error rate < 1%<br>• Zero deadlock errors |
| **Concurrent Checkout Idempotency** | `checkout-idempotency.js` | 20 concurrent VUs submitting duplicate orders with 5 shared `Idempotency-Key` headers. | Idempotent replay within 100 ms | • HTTP 200 / 201 only<br>• Zero duplicate DB orders<br>• Error rate = 0.00% |

---

## 2. Prerequisites

Install `k6`:
```bash
# macOS (Homebrew)
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

---

## 3. Running the Suite

Use the automated runner script:
```bash
# Run all scenarios sequentially
./infra/load-tests/run-load-tests.sh all

# Or run specific scenarios
./infra/load-tests/run-load-tests.sh qr
./infra/load-tests/run-load-tests.sh orders
./infra/load-tests/run-load-tests.sh idempotency
```

### Targeting Staging or Custom Environments

Configure test parameters via environment variables:
```bash
API_BASE_URL="https://api-staging.dineflow.internal" \
ORG_ID="your-test-org-uuid" \
OUTLET_ID="your-test-outlet-uuid" \
TABLE_ID="your-test-table-uuid" \
ITEM_ID="your-test-menu-item-uuid" \
./infra/load-tests/run-load-tests.sh all
```

---

## 4. Saturation Points & Database Tuning (ARCH §25)

When approaching platform saturation:

1. **Menu Fetch (ETag & Redis Caching)**:
   - Menu payloads are cached in Redis with an SHA-256 hash returned as `ETag`.
   - Repeated requests containing `If-None-Match` are terminated at the API layer with `304 Not Modified`, skipping PostgreSQL entirely.
   - Saturation limit without Redis: ~400 req/sec per DB core.
   - Saturation limit with Redis ETag caching: >5,000 req/sec per API replica.

2. **Order Placement Database Pool**:
   - Every order write executes inside a transaction setting `app.org_id`.
   - Database connection pool is configured to `max: 20` per replica (`apps/api/src/db/client.ts`).
   - For multi-replica production deployments, use **PgBouncer in transaction pooling mode** with `default_pool_size = 25` and `max_client_conn = 1000`.

3. **Idempotency Locking**:
   - `Idempotency-Key` utilizes Redis distributed locks (`SET key NX EX 120`).
   - Replay responses are served directly from Redis cache, preventing duplicate order event insertion into `order_events` and database transaction rollbacks.
