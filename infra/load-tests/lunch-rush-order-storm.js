import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * k6 Load Test Scenario: Peak Lunch-Rush Order Storm
 * Reference: ARCH §24, §25
 * Target SLO: Order placement p95 < 500 ms, error rate < 1%
 */
export const options = {
  scenarios: {
    lunch_rush_orders: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 500,
      stages: [
        { duration: '30s', target: 20 },  // Ramp to 20 orders/sec platform peak (ARCH §25)
        { duration: '1m', target: 25 },   // Sustained peak load
        { duration: '20s', target: 0 },   // Ramp-down
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'], // ARCH §24: order placement p95 < 500ms
    http_req_failed: ['rate<0.01'],                  // Error rate < 1%
  },
};

const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3000';
const QR_TOKEN = __ENV.QR_TOKEN || '';
const SESSION_ID = __ENV.SESSION_ID || '00000000-0000-0000-0000-000000000003';
const GUEST_SESSION_TOKEN = __ENV.GUEST_SESSION_TOKEN || '';
const ITEM_ID = __ENV.ITEM_ID || '11111111-1111-1111-1111-111111111111';

// Generate UUID v4 for unique idempotency key
function generateUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

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
  const idempotencyKey = generateUuid();
  const orderUrl = `${BASE_URL}/v1/customer/orders`;

  const orderPayload = JSON.stringify({
    session_id: data.sessionId,
    idempotency_key: idempotencyKey,
    items: [
      {
        menu_item_id: ITEM_ID,
        quantity: 2,
        portion: 'FULL',
        notes: 'Extra spicy',
      },
    ],
  });

  const res = http.post(orderUrl, orderPayload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.token}`,
      'Idempotency-Key': idempotencyKey,
    },
    tags: { name: 'PlaceOrder' },
  });

  check(res, {
    'Order created successfully (201 or 200)': (r) => r.status === 201 || r.status === 200,
    'Response contains order id': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body && (body.id !== undefined || body.order_id !== undefined);
      } catch {
        return false;
      }
    },
  });

  sleep(1);
}
