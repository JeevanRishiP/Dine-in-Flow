import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * k6 Load Test Scenario: Flash Crowd QR Scan Burst
 * Reference: ARCH §24, §25
 * Target SLO: Menu fetch p95 < 200 ms (cached / 304 Not Modified)
 */
export const options = {
  scenarios: {
    qr_flash_crowd: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 200 },  // Rapid ramp-up
        { duration: '30s', target: 500 },  // Sustained flash crowd peak
        { duration: '15s', target: 0 },    // Ramp-down
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<200', 'p(99)<400'], // ARCH §24: menu fetch p95 < 200ms
    http_req_failed: ['rate<0.01'],                 // Error rate < 1%
  },
};

const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3000';
const ORG_ID = __ENV.ORG_ID || '00000000-0000-0000-0000-000000000001';
const OUTLET_ID = __ENV.OUTLET_ID || '00000000-0000-0000-0000-000000000002';

export default function () {
  const menuUrl = `${BASE_URL}/v1/public/menu/${ORG_ID}?outlet_id=${OUTLET_ID}`;

  // 1. Initial QR scan (cold fetch)
  const initialRes = http.get(menuUrl, {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    },
    tags: { name: 'InitialMenuScan' },
  });

  const hasEtag = check(initialRes, {
    'Initial menu fetch status is 200': (r) => r.status === 200,
    'ETag header is present': (r) => r.headers['Etag'] !== undefined || r.headers['etag'] !== undefined,
    'Cache-Control is public': (r) => (r.headers['Cache-Control'] || r.headers['cache-control'] || '').includes('public'),
  });

  const etag = initialRes.headers['Etag'] || initialRes.headers['etag'];

  sleep(1);

  // 2. Subsequent client request with If-None-Match (304 Not Modified verification)
  if (hasEtag && etag) {
    const cachedRes = http.get(menuUrl, {
      headers: {
        Accept: 'application/json',
        'If-None-Match': etag,
      },
      tags: { name: 'CachedMenuPoll' },
    });

    check(cachedRes, {
      'Cached menu returns 304 Not Modified': (r) => r.status === 304,
    });
  }

  sleep(2);
}
