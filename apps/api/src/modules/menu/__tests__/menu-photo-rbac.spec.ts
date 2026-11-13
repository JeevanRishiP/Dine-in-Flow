import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Permission, ROLE_PERMISSIONS } from '@dineflow/contracts';
import { MediaService, MockVideoProvider } from '../media.service.js';
import { MenuService } from '../menu.service.js';
import * as dbClient from '../../../db/client.js';

vi.mock('../../../config/config.js', () => ({
  getConfig: () => ({
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'minioadmin',
    S3_SECRET_KEY: 'minioadmin',
    S3_RAW_BUCKET: 'dineflow-raw',
    S3_PROCESSED_BUCKET: 'dineflow-processed',
    REDIS_URL: 'redis://localhost:6380',
    NODE_ENV: 'test',
  }),
}));

// Minimal valid 1x1 transparent PNG
const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('Owner & Manager Menu Editing + Food Photo Upload', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const outletId = '22222222-2222-4222-8222-222222222222';
  const itemId = '33333333-3333-4333-8333-333333333333';
  const managerId = '44444444-4444-4444-8444-444444444444';

  let mediaService: MediaService;
  let menuService: MenuService;

  beforeEach(() => {
    vi.restoreAllMocks();
    mediaService = new MediaService(new MockVideoProvider());
    menuService = new MenuService(mediaService);
  });

  it('grants MENU_WRITE/MENU_UPDATE/MENU_CREATE to both OWNER and MANAGER only', () => {
    for (const role of ['OWNER', 'MANAGER']) {
      expect(ROLE_PERMISSIONS[role]).toContain(Permission.MENU_WRITE);
      expect(ROLE_PERMISSIONS[role]).toContain(Permission.MENU_CREATE);
      expect(ROLE_PERMISSIONS[role]).toContain(Permission.MENU_UPDATE);
    }

    for (const role of ['CAPTAIN', 'KITCHEN', 'CASHIER', 'WAITER']) {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.MENU_WRITE);
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.MENU_CREATE);
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.MENU_UPDATE);
    }
  });

  it('rejects non-image payloads on sanitizeAndEncodePhoto and encodes valid PNG to WebP', async () => {
    const fakePng = `data:image/png;base64,${Buffer.from('not-actually-an-image').toString('base64')}`;
    await expect(mediaService.sanitizeAndEncodePhoto(fakePng)).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
    });

    const validDataUrl = `data:image/png;base64,${ONE_BY_ONE_PNG_BASE64}`;
    const result = await mediaService.sanitizeAndEncodePhoto(validDataUrl);
    expect(result.mimeType).toBe('image/webp');
    // RIFF....WEBP magic header
    expect(result.buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(result.buffer.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  it('persists WebP photo, updates menu_items.image_url, bumps version, and writes audit log', async () => {
    const queries: string[] = [];
    const queryMock = vi.fn().mockImplementation(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('FROM menu_items WHERE id = $1')) {
        return { rows: [{ id: itemId, outlet_id: outletId, is_available: true }] };
      }
      return { rows: [], rowCount: 1 };
    });

    vi.spyOn(dbClient, 'withTenantContext').mockImplementation(
      async <T>(_o: string, fn: (db: unknown) => Promise<T>) =>
        fn({ query: queryMock }),
    );

    const res = await menuService.uploadItemPhoto(
      orgId,
      itemId,
      `data:image/png;base64,${ONE_BY_ONE_PNG_BASE64}`,
      managerId,
    );

    expect(res.itemId).toBe(itemId);
    expect(res.imageUrl).toMatch(new RegExp(`^/api/v1/public/menu/photos/${itemId}\\?v=\\d+$`));
    expect(queries.some((q) => q.includes('INSERT INTO menu_item_photos'))).toBe(true);
    expect(queries.some((q) => q.includes('UPDATE menu_items SET image_url'))).toBe(true);
    expect(queries.some((q) => q.includes('INSERT INTO menu_versions'))).toBe(true);
    expect(queries.some((q) => q.includes('INSERT INTO audit_logs'))).toBe(true);
  });
});

