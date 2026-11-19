import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDishImageUrl, FALLBACK_DISH_IMG } from './menu-image.utils.ts';

describe('menu-image.utils - Dish Image URL Resolution', () => {
  it('returns fallback dish image when url is undefined, null, or empty', () => {
    assert.equal(resolveDishImageUrl(undefined), FALLBACK_DISH_IMG);
    assert.equal(resolveDishImageUrl(null), FALLBACK_DISH_IMG);
    assert.equal(resolveDishImageUrl(''), FALLBACK_DISH_IMG);
    assert.equal(resolveDishImageUrl('   '), FALLBACK_DISH_IMG);
  });

  it('preserves external absolute https:// and http:// image URLs', () => {
    const unsplash = 'https://images.unsplash.com/photo-1546833999-b9f581a1996d';
    assert.equal(resolveDishImageUrl(unsplash), unsplash);

    const externalHttp = 'http://example.com/food.jpg';
    assert.equal(resolveDishImageUrl(externalHttp), externalHttp);
  });

  it('preserves base64 and blob data URLs for live previews', () => {
    const dataUrl = 'data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAAAwAQCdASoBAAEAAQAcJaACdLoAAP7/2QAA';
    assert.equal(resolveDishImageUrl(dataUrl), dataUrl);

    const blobUrl = 'blob:http://localhost:3003/1234-5678';
    assert.equal(resolveDishImageUrl(blobUrl), blobUrl);
  });

  it('normalizes relative /v1/ public photo paths to /api/v1/ for Next.js rewrites', () => {
    const rawV1 = '/v1/public/menu/photos/cb000000-0000-4000-8000-000000000001?v=1731920000000';
    assert.equal(
      resolveDishImageUrl(rawV1),
      '/api/v1/public/menu/photos/cb000000-0000-4000-8000-000000000001?v=1731920000000',
    );

    const bareV1 = 'v1/public/menu/photos/cb000000-0000-4000-8000-000000000001';
    assert.equal(
      resolveDishImageUrl(bareV1),
      '/api/v1/public/menu/photos/cb000000-0000-4000-8000-000000000001',
    );
  });

  it('leaves already-prefixed /api/v1/ public photo paths intact', () => {
    const apiV1 = '/api/v1/public/menu/photos/cb000000-0000-4000-8000-000000000001?v=1731920000000';
    assert.equal(resolveDishImageUrl(apiV1), apiV1);
  });
});
