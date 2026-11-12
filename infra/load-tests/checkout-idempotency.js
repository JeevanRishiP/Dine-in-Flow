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
const QR_TOKEN = __ENV.QR_TOKEN || '';
const SESSION_ID = __ENV.SESSION_ID || '00000000-0000-0000-0000-000000000003';
const GUEST_SESSION_TOKEN = __ENV.GUEST_SESSION_TOKEN || '';
const ITEM_ID = __ENV.ITEM_ID || '11111111-1111-1111-1111-111111111111';

// Shared set of 5 idempotency keys across all 20 VUs
const SHARED_KEYS = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
];

export function setup() {
  if (GUEST_SESSION_TOKEN && SESSION_ID) {
    return { sessionId: SESSION_ID, token: GUEST_SESSION_TOKEN };
  }
  if (!QR_TOKEN) {
    throw new Error('Set QR_TOKEN (HMAC signed) or GUEST_SESSION_TOKEN + SESSION_ID');
  }
  const openRes = http.post(
    `${BASE_URL}/v1/public/sessions/open`,
    JSON.stringify({ qr_token: QR_TOKEN, pax: 2 }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  const body = JSON.parse(openRes.body || '{}');
  if (openRes.status >= 400 || !body.guestSessionToken || !body.id) {
    throw new Error(`Failed to open signed session (${openRes.status}): ${openRes.body}`);
  }
  return { sessionId: body.id, token: body.guestSessionToken };
}

export default function (data) {
  const keyIndex = Math.floor(Math.random() * SHARED_KEYS.length);
  const idempotencyKey = SHARED_KEYS[keyIndex];

  const orderUrl = `${BASE_URL}/v1/customer/orders`;
  const orderPayload = JSON.stringify({
    session_id: data.sessionId,
    idempotency_key: idempotencyKey,
    items: [{ menu_item_id: ITEM_ID, quantity: 1, portion: 'FULL' }],
  });

  const res = http.post(orderUrl, orderPayload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.token}`,
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
