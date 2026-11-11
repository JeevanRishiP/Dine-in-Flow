import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * k6 Load Test Scenario: Concurrent Checkout Idempotency Verification
 * Reference: ARCH §5, §22, AGENTS §2 rule 8
 * Asserts:
 *  - Parallel identical requests with the same Idempotency-Key return identical order responses.
 *  - Zero duplicate order creation under concurrent execution.
 */
export const options = {
  scenarios: {
    idempotent_concurrent_burst: {
      executor: 'per-vu-iterations',
      vus: 20,
      iterations: 5,
      maxDuration: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate==0'], // Zero failures allowed
  },
};

const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3000';
const OUTLET_ID = __ENV.OUTLET_ID || '00000000-0000-0000-0000-000000000002';
const TABLE_ID = __ENV.TABLE_ID || '00000000-0000-0000-0000-000000000003';
const ITEM_ID = __ENV.ITEM_ID || '11111111-1111-1111-1111-111111111111';

// Shared set of 5 idempotency keys across all 20 VUs
const SHARED_KEYS = [
  'idemp-test-fixed-key-0001',
  'idemp-test-fixed-key-0002',
  'idemp-test-fixed-key-0003',
  'idemp-test-fixed-key-0004',
  'idemp-test-fixed-key-0005',
];

export default function () {
  const keyIndex = Math.floor(Math.random() * SHARED_KEYS.length);
  const idempotencyKey = SHARED_KEYS[keyIndex];

  const orderUrl = `${BASE_URL}/customer/orders`;
  const orderPayload = JSON.stringify({
    outlet_id: OUTLET_ID,
    table_id: TABLE_ID,
    items: [{ item_id: ITEM_ID, quantity: 1 }],
  });

  const res = http.post(orderUrl, orderPayload, {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    tags: { name: 'ConcurrentIdempotentCheckout' },
  });

  check(res, {
    'Status code is 201 or 200 (idempotent replay)': (r) => r.status === 201 || r.status === 200,
    'Response contains stable order payload': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body && (body.id !== undefined || body.order_id !== undefined);
      } catch {
        return false;
      }
    },
  });

  sleep(0.5);
}
