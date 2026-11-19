import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthController } from '../health/health.controller.js';
import * as dbClient from '../../db/client.js';

describe('HealthController Pre-Flight Checks', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
    vi.restoreAllMocks();
  });

  it('liveness (/healthz) returns ok', () => {
    const res = controller.liveness();
    expect(res).toEqual({ status: 'ok' });
  });

  it('readiness (/readyz) returns ok and db connected when SELECT 1 succeeds', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
    vi.spyOn(dbClient, 'getPool').mockReturnValue({
      query: mockQuery,
    } as any);

    const res = await controller.readiness();
    expect(res).toEqual({ status: 'ok', db: 'connected' });
    expect(mockQuery).toHaveBeenCalledWith('SELECT 1');
  });

  it('health (/api/v1/health) executes SELECT 1 and returns status ok, db connected, and ISO timestamp', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
    vi.spyOn(dbClient, 'getPool').mockReturnValue({
      query: mockQuery,
    } as any);

    const res = await controller.health();
    expect(res.status).toBe('ok');
    expect(res.db).toBe('connected');
    expect(typeof res.timestamp).toBe('string');
    expect(new Date(res.timestamp).toISOString()).toBe(res.timestamp);
    expect(mockQuery).toHaveBeenCalledWith('SELECT 1');
  });

  it('health (/api/v1/health) returns degraded when DB query fails', async () => {
    vi.spyOn(dbClient, 'getPool').mockReturnValue({
      query: vi.fn().mockRejectedValue(new Error('Connection failed')),
    } as any);

    const res = await controller.health();
    expect(res.status).toBe('degraded');
    expect(res.db).toBe('disconnected');
    expect(typeof res.timestamp).toBe('string');
  });
});
