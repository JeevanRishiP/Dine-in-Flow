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
const OUTLET_ID = __ENV.OUTLET_ID || '00000000-0000-0000-0000-000000000002';
const TABLE_ID = __ENV.TABLE_ID || '00000000-0000-0000-0000-000000000003';
const ITEM_ID = __ENV.ITEM_ID || '11111111-1111-1111-1111-111111111111';

// Generate UUID v4 for unique idempotency key
function generateUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function () {
  const idempotencyKey = generateUuid();
  const orderUrl = `${BASE_URL}/customer/orders`;

  const orderPayload = JSON.stringify({
    outlet_id: OUTLET_ID,
    table_id: TABLE_ID,
    items: [
      {
        item_id: ITEM_ID,
        quantity: 2,
        notes: 'Extra spicy',
      },
    ],
  });

  const res = http.post(orderUrl, orderPayload, {
    headers: {
      'Content-Type': 'application/json',
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
