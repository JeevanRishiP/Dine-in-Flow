import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiService, MAX_SESSION_MESSAGES, MAX_SESSION_TOKENS } from '../ai.service.js';
import { MenuRetrievalService } from '../menu-retrieval.service.js';
import { MockAiAdapter } from '../mock-ai.adapter.js';
import * as dbClient from '../../../db/client.js';
import { ErrorCode } from '@dineflow/contracts';

describe('AiService (Phase 10)', () => {
  let service: AiService;
  let retrievalService: MenuRetrievalService;
  let mockAiAdapter: MockAiAdapter;
  let mockClient: any;

  const orgId = '00000000-0000-0000-0000-000000000001';
  const outletId = '00000000-0000-0000-0000-000000000002';
  const sessionId = '00000000-0000-0000-0000-000000000003';

  beforeEach(() => {
    retrievalService = new MenuRetrievalService();
    service = new AiService(retrievalService);
    mockAiAdapter = new MockAiAdapter();
    service.setProvider(mockAiAdapter);

    mockClient = {
      query: vi.fn(),
    };

    vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
      async (_orgId: string, fn: (client: any) => Promise<any>) => {
        return fn(mockClient);
      },
    );
  });

  describe('Session Budget and Rate Limiting (ARCH §21)', () => {
    it('blocks chat when session message count has reached limit (20 messages)', async () => {
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: sessionId,
            org_id: orgId,
            outlet_id: outletId,
            table_session_id: null,
            customer_id: null,
            message_count: MAX_SESSION_MESSAGES,
            tokens_used: 1000,
          },
        ],
      });

      await expect(
        service.chat({
          orgId,
          outletId,
          sessionId,
          message: 'What do you recommend?',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.AI_BUDGET_EXCEEDED,
        status: 429,
      });
    });

    it('blocks chat when session token budget has reached limit (8000 tokens)', async () => {
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: sessionId,
            org_id: orgId,
            outlet_id: outletId,
            table_session_id: null,
            customer_id: null,
            message_count: 5,
            tokens_used: MAX_SESSION_TOKENS,
          },
        ],
      });

      await expect(
        service.chat({
          orgId,
          outletId,
          sessionId,
          message: 'Tell me about the specials',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.AI_BUDGET_EXCEEDED,
        status: 429,
      });
    });

    it('rejects input exceeding 500 characters', async () => {
      const longMessage = 'A'.repeat(501);

      await expect(
        service.chat({
          orgId,
          outletId,
          message: longMessage,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.AI_INPUT_TOO_LONG,
        status: 400,
      });
    });
  });

  describe('Q&A Caching (ARCH §21)', () => {
    it('serves cached answer directly on question hit without calling provider', async () => {
      const cachedAnswer = 'Our Butter Naan is baked fresh in the tandoor with pure amul butter.';

      // 1. Session lookup
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: sessionId,
            org_id: orgId,
            outlet_id: outletId,
            table_session_id: null,
            customer_id: null,
            message_count: 2,
            tokens_used: 150,
          },
        ],
      });

      // 2. Cache hit
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            answer: cachedAnswer,
            tool_proposals: null,
          },
        ],
      });

      // 3. User transcript insert
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });
      // 4. Model transcript insert
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });
      // 5. Update session count
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });

      const chatSpy = vi.spyOn(mockAiAdapter, 'chat');

      const res = await service.chat({
        orgId,
        outletId,
        sessionId,
        message: 'How is the butter naan made?',
      });

      expect(res.answer).toBe(cachedAnswer);
      expect(res.tokensUsed).toBe(0);
      expect(chatSpy).not.toHaveBeenCalled();
    });
  });

  describe('PII Redaction & Transcript Auditing (ARCH §21, AGENTS §2 rule 7)', () => {
    it('redacts customer phone number and email address before storing transcript', async () => {
      // 1. Create new session
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: sessionId,
            org_id: orgId,
            outlet_id: outletId,
            table_session_id: null,
            customer_id: null,
            message_count: 0,
            tokens_used: 0,
          },
        ],
      });

      // 2. Cache miss
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      // Mock retrieval
      vi.spyOn(retrievalService, 'hybridSearch').mockResolvedValueOnce([
        {
          id: 'item-1',
          name: 'Paneer Butter Masala',
          pricePaise: 28000,
          vegType: 'VEG',
          allergens: ['DAIRY'],
          spiceLevel: 1,
          isAvailable: true,
        },
      ]);

      // 3. Recent history
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      // 4. User transcript insert
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });
      // 5. Model transcript insert
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });
      // 6. Update session
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });
      // 7. Insert Q&A cache
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });

      await service.chat({
        orgId,
        outletId,
        message: 'Call me at +91 9876543210 or email test@example.com about this dish',
      });

      // Verify the user transcript inserted has redacted PII
      const userTranscriptCall = mockClient.query.mock.calls.find((c: any) =>
        c[0].includes('INSERT INTO ai_chat_transcripts') && c[0].includes("'user'"),
      );

      expect(userTranscriptCall).toBeDefined();
      const contentRedacted = userTranscriptCall[1][2];
      expect(contentRedacted).not.toContain('+91 9876543210');
      expect(contentRedacted).not.toContain('test@example.com');
      expect(contentRedacted).toContain('[PHONE_REDACTED]');
      expect(contentRedacted).toContain('[EMAIL_REDACTED]');
    });
  });

  describe('Menu Embeddings Reindexing (ARCH §21)', () => {
    it('purges outlet Q&A cache and triggers retrieval reindexing', async () => {
      // 1. Delete Q&A cache
      mockClient.query.mockResolvedValueOnce({ rowCount: 5 });

      const reindexSpy = vi.spyOn(retrievalService, 'reindexOutlet').mockResolvedValueOnce({ itemsIndexed: 12 });

      const result = await service.reindexOutletMenu(orgId, outletId);

      expect(result.itemsIndexed).toBe(12);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM ai_qa_cache WHERE org_id = $1 AND outlet_id = $2;'),
        [orgId, outletId],
      );
      expect(reindexSpy).toHaveBeenCalledWith(orgId, outletId, expect.anything());
    });
  });

  describe('Provider Resilience and Fallback (ARCH §21)', () => {
    it('gracefully falls back to MockAiAdapter when primary provider chat fails', async () => {
      // 1. Session insert
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: sessionId, org_id: orgId, outlet_id: outletId, message_count: 0, tokens_used: 0 }],
      });
      // 2. Q&A cache check
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      // 3. Transcripts history query
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      // 4. User transcript insert
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });
      // 5. Model transcript insert
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });
      // 6. Update session
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });
      // 7. Insert Q&A cache
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });

      const failingProvider = {
        generateEmbedding: vi.fn().mockRejectedValue(new Error('503 Service Unavailable')),
        chat: vi.fn().mockRejectedValue(new Error('503 Service Unavailable')),
      };
      service.setProvider(failingProvider);

      vi.spyOn(retrievalService, 'hybridSearch').mockResolvedValueOnce([
        {
          id: 'dish-1',
          name: 'Paneer Butter Masala',
          pricePaise: 32000,
          vegType: 'VEG',
          allergens: ['Dairy'],
          spiceLevel: 1,
          isAvailable: true,
        },
      ]);

      const res = await service.chat({
        orgId,
        outletId,
        message: 'What do you recommend?',
      });

      expect(res.answer).toBeDefined();
      expect(res.answer).toContain('Paneer Butter Masala');
      expect(res.callWaiterSuggested).toBe(false);
    });
  });
});
