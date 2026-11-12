import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { Subject } from 'rxjs';
import { ZodError, z } from 'zod';
import { AiService } from '../../ai/ai.service.js';
import { MenuRetrievalService } from '../../ai/menu-retrieval.service.js';
import { GeminiAdapter } from '../../ai/gemini.adapter.js';
import { OutboxRelayService } from '../outbox-relay.service.js';
import { RealtimeService } from '../../realtime/realtime.service.js';
import { PublicMenuController } from '../../menu/public-menu.controller.js';
import { AllExceptionsFilter } from '../../../common/filters/all-exceptions.filter.js';
import * as dbClient from '../../../db/client.js';
import * as redisClient from '../../../common/redis/redis.client.js';

describe('Slice 4 Scale, Deadlock Prevention & Edge Hardening', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const outletId = '22222222-2222-4222-8222-222222222222';
  const otherOutletId = '33333333-3333-4333-8333-333333333333';
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('AiService & MenuRetrievalService DB Pool Deadlock Prevention', () => {
    it('never opens nested withTenantContextRaw transactions or holds DB lock across Gemini HTTP calls', async () => {
      let activeDbDepth = 0;
      let maxConcurrentDbDepth = 0;
      let depthDuringExternalEmbed = -1;
      let depthDuringExternalChat = -1;

      vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
        async <T>(_org: string, fn: (c: PoolClient) => Promise<T>) => {
          activeDbDepth++;
          maxConcurrentDbDepth = Math.max(maxConcurrentDbDepth, activeDbDepth);
          try {
            const mockClient = {
              query: vi.fn().mockImplementation(async (sql: string) => {
                if (sql.includes('INSERT INTO ai_sessions')) {
                  return {
                    rowCount: 1,
                    rows: [{ id: 'sess-1', org_id: orgId, outlet_id: outletId, message_count: 0, tokens_used: 0 }],
                  };
                }
                if (sql.includes('FROM ai_qa_cache')) return { rowCount: 0, rows: [] };
                if (sql.includes('FROM ai_chat_transcripts')) return { rowCount: 0, rows: [] };
                if (sql.includes('FROM menu_items')) return { rows: [] };
                return { rowCount: 1, rows: [] };
              }),
            } as unknown as PoolClient;
            return await fn(mockClient);
          } finally {
            activeDbDepth--;
          }
        },
      );

      const retrieval = new MenuRetrievalService();
      const aiSvc = new AiService(retrieval);
      aiSvc.setProvider({
        generateEmbedding: vi.fn(async () => {
          depthDuringExternalEmbed = activeDbDepth;
          return new Array(768).fill(0.01);
        }),
        chat: vi.fn(async () => {
          depthDuringExternalChat = activeDbDepth;
          return { answer: 'Try Paneer Tikka.', tokensUsed: 25, callWaiterSuggested: false };
        }),
      });

      const res = await aiSvc.chat({ orgId, outletId, message: 'Recommend a starter' }, null);
      expect(res.sessionId).toBe('sess-1');
      expect(maxConcurrentDbDepth).toBe(1);
      expect(depthDuringExternalEmbed).toBe(0);
      expect(depthDuringExternalChat).toBe(0);
    });
  });

  describe('GeminiAdapter API Key Header Security', () => {
    it('passes API key in x-goog-api-key header instead of URL query string', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ embedding: { values: new Array(768).fill(0.1) } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'Dosa is veg.' }) }] } }],
            usageMetadata: { totalTokenCount: 40 },
          }),
        });
      global.fetch = fetchMock as unknown as typeof fetch;

      const adapter = new GeminiAdapter('secret-gemini-api-key-999');
      await adapter.generateEmbedding('dosa');
      await adapter.chat([{ role: 'user', content: 'Is dosa veg?' }], []);

      for (const call of fetchMock.mock.calls) {
        const [url, init] = call as [string, RequestInit];
        expect(url).not.toContain('key=');
        expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(
          'secret-gemini-api-key-999',
        );
      }
    });
  });

  describe('OutboxRelayService Atomic Claim & Retry', () => {
    it('claims outbox batch via fetch_and_claim_outbox_events and unclaims row if Redis fails', async () => {
      const poolQuery = vi.fn().mockResolvedValueOnce({
        rows: [
          {
            id: 'ev-1',
            org_id: orgId,
            aggregate: 'order',
            aggregate_id: 'ord-1',
            event_type: 'ORDER_PLACED',
            payload: { outlet_id: outletId },
            created_at: new Date(),
          },
        ],
      });
      vi.spyOn(dbClient, 'getPool').mockReturnValue({ query: poolQuery } as unknown as Pool);
      vi.spyOn(redisClient, 'getRedis').mockReturnValue({
        publish: vi.fn().mockRejectedValueOnce(new Error('Redis disconnected')),
      } as never);

      const tenantQuery = vi.fn().mockResolvedValueOnce({ rows: [] });
      vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
        async <T>(_org: string, fn: (c: PoolClient) => Promise<T>) =>
          fn({ query: tenantQuery } as unknown as PoolClient),
      );

      const relay = new OutboxRelayService();
      await relay.relay();

      expect(poolQuery.mock.calls[0]![0]).toContain('fetch_and_claim_outbox_events');
      expect(tenantQuery.mock.calls[0]![0]).toContain('SET delivered_at = NULL, delivered = false');
      expect(tenantQuery.mock.calls[0]![1]).toEqual(['ev-1', orgId]);
    });
  });

  describe('RealtimeService Per-Org Subscriptions, Outlet Scoping & Map Cleanup', () => {
    it('subscribes/unsubscribes per org, scopes WS events by outletId, and removes empty map keys', () => {
      const subscribe = vi.fn(async () => 1);
      const unsubscribe = vi.fn(async () => 1);
      const on = vi.fn();
      vi.spyOn(redisClient, 'getRedisSubscriber').mockReturnValue({
        subscribe,
        unsubscribe,
        on,
      } as never);

      const rt = new RealtimeService();
      rt.onApplicationBootstrap();

      const sseSubj = new Subject<{ data: string; id?: string }>();
      const sseReceived: string[] = [];
      sseSubj.subscribe((v) => sseReceived.push(v.data));

      const outletAEmitter = vi.fn();
      const outletBEmitter = vi.fn();

      const unsubSse = rt.registerSseSubject(orgId, sseSubj);
      const unsubWsA = rt.registerWsEmitter(orgId, outletAEmitter, outletId);
      const unsubWsB = rt.registerWsEmitter(orgId, outletBEmitter, otherOutletId);

      // Should subscribe once for orgId instead of wildcard PSUBSCRIBE
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(subscribe).toHaveBeenCalledWith(`dineflow:orders:${orgId}`);

      // Dispatch event scoped to outletA
      rt.dispatch(
        JSON.stringify({
          id: 'evt-1',
          org_id: orgId,
          outlet_id: outletId,
          aggregate: 'order',
          aggregateId: 'ord-1',
          eventType: 'ORDER_PLACED',
          payload: { outlet_id: outletId },
          ts: new Date().toISOString(),
        }),
      );

      expect(sseReceived).toHaveLength(1);
      expect(outletAEmitter).toHaveBeenCalledTimes(1);
      expect(outletBEmitter).not.toHaveBeenCalled();

      // Releasing all listeners should unsubscribe from Redis cleanly
      unsubSse();
      unsubWsA();
      unsubWsB();
      expect(unsubscribe).toHaveBeenCalledWith(`dineflow:orders:${orgId}`);
    });
  });

  describe('PublicMenuController 304 ETag & AllExceptionsFilter ZodError Mapping', () => {
    it('returns 304 Not Modified on matching If-None-Match header', async () => {
      const menuService = {
        getPublicMenu: vi.fn().mockResolvedValue({
          version: '42',
          categories: [{ id: 'cat-1' }],
          items: [{ id: 'item-1' }],
        }),
      };
      const controller = new PublicMenuController(menuService as never);
      const replyMock = { header: vi.fn(), code: vi.fn() };
      const reqMock = { headers: { 'if-none-match': '"v42"' } };

      const res = await controller.getMenu(
        orgId,
        {},
        reqMock as never,
        replyMock as never,
      );
      expect(replyMock.code).toHaveBeenCalledWith(304);
      expect(res).toBe('');
    });

    it('maps manual ZodError parses to RFC 7807 422 VALIDATION_ERROR instead of 500', () => {
      const filter = new AllExceptionsFilter();
      let capturedZodError: ZodError | null = null;
      try {
        z.object({ count: z.number().int() }).parse({ count: 'bad' });
      } catch (e) {
        capturedZodError = e as ZodError;
      }

      const sendMock = vi.fn();
      const headerMock = vi.fn().mockReturnValue({ send: sendMock });
      const statusMock = vi.fn().mockReturnValue({ header: headerMock });
      const host = {
        switchToHttp: () => ({
          getResponse: () => ({ status: statusMock }),
          getRequest: () => ({ headers: {} }),
        }),
      };

      filter.catch(capturedZodError!, host as never);
      expect(statusMock).toHaveBeenCalledWith(422);
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'VALIDATION_ERROR', status: 422 }),
      );
    });
  });
});

