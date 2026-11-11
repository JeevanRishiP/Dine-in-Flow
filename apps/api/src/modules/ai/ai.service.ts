import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { withTenantContextRaw } from '../../db/client.js';
import { domainError } from '../../common/errors/domain-error.js';
import { ErrorCode } from '@dineflow/contracts';
import type { AiProvider, ChatMessage, AiChatResponse } from './ai.provider.js';
import { GeminiAdapter } from './gemini.adapter.js';
import { MockAiAdapter } from './mock-ai.adapter.js';
import { MenuRetrievalService } from './menu-retrieval.service.js';
import { redactPii, applyGuardrails, MANDATORY_ALLERGEN_DISCLAIMER } from './ai-guardrails.js';
import type { AiChatDto } from './ai.dto.js';

export const MAX_SESSION_MESSAGES = 20;
export const MAX_SESSION_TOKENS = 8000;

interface AiSessionRow {
  id: string;
  org_id: string;
  outlet_id: string;
  table_session_id: string | null;
  customer_id: string | null;
  message_count: number;
  tokens_used: number;
}

interface QaCacheRow {
  answer: string;
  tool_proposals: unknown;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private provider: AiProvider;

  constructor(private readonly retrievalService: MenuRetrievalService) {
    const apiKey = process.env['GEMINI_API_KEY'];
    if (apiKey && process.env['NODE_ENV'] !== 'test') {
      this.provider = new GeminiAdapter(apiKey, process.env['GEMINI_MODEL'] || 'gemini-3.5-flash-lite');
      this.logger.log('[AI] Initialized GeminiAdapter for AI Menu Assistant');
    } else {
      this.provider = new MockAiAdapter();
      this.logger.log('[AI] Initialized MockAiAdapter for AI Menu Assistant');
    }
  }

  /**
   * For testing: allows switching provider dynamically.
   */
  setProvider(provider: AiProvider): void {
    this.provider = provider;
  }

  getProvider(): AiProvider {
    return this.provider;
  }

  /**
   * Conversational menu assistant chat handler.
   * Scoped to outlet with strict session rate limits and token budgets.
   * Reference: ARCH §21
   */
  async chat(dto: AiChatDto, customerId?: string | null): Promise<AiChatResponse & { sessionId: string }> {
    const orgId = dto.orgId;
    const outletId = dto.outletId;
    const rawMessage = dto.message;

    if (rawMessage.length > 500) {
      throw domainError(ErrorCode.AI_INPUT_TOO_LONG, 'Message cannot exceed 500 characters', 400);
    }

    const cleanUserMessage = redactPii(rawMessage);

    return withTenantContextRaw(orgId, async (client: PoolClient) => {
      // 1. Session management & Budget check
      let sessionId = dto.sessionId;
      let session: AiSessionRow;

      if (sessionId) {
        const sessionRes = await client.query(
          `SELECT id, org_id, outlet_id, table_session_id, customer_id, message_count, tokens_used
           FROM ai_sessions
           WHERE id = $1 AND org_id = $2;`,
          [sessionId, orgId],
        );

        if (sessionRes.rowCount === 0) {
          throw domainError(ErrorCode.NOT_FOUND, 'AI session not found', 404);
        }

        session = sessionRes.rows[0] as AiSessionRow;

        if (session.message_count >= MAX_SESSION_MESSAGES || session.tokens_used >= MAX_SESSION_TOKENS) {
          throw domainError(
            ErrorCode.AI_BUDGET_EXCEEDED,
            'Session message limit reached. Please call a waiter for further assistance.',
            429,
          );
        }
      } else {
        const createRes = await client.query(
          `INSERT INTO ai_sessions (org_id, outlet_id, table_session_id, customer_id)
           VALUES ($1, $2, $3, $4)
           RETURNING id, org_id, outlet_id, table_session_id, customer_id, message_count, tokens_used;`,
          [orgId, outletId, dto.tableSessionId || null, customerId || null],
        );
        session = createRes.rows[0] as AiSessionRow;
        sessionId = session.id;
      }

      // 2. Q&A Cache Lookup
      const normalizedQ = cleanUserMessage.toLowerCase().replace(/[^\w\s]/g, '').trim();
      const questionHash = crypto.createHash('sha256').update(normalizedQ).digest('hex');

      const cacheRes = await client.query(
        `SELECT answer, tool_proposals
         FROM ai_qa_cache
         WHERE org_id = $1 AND outlet_id = $2 AND question_hash = $3 AND expires_at > now();`,
        [orgId, outletId, questionHash],
      );

      if (cacheRes.rowCount && cacheRes.rowCount > 0) {
        const cached = cacheRes.rows[0] as QaCacheRow;

        // Record user query in transcript
        await client.query(
          `INSERT INTO ai_chat_transcripts (org_id, session_id, role, content_redacted)
           VALUES ($1, $2, 'user', $3);`,
          [orgId, sessionId, cleanUserMessage],
        );

        // Record cached model response in transcript
        await client.query(
          `INSERT INTO ai_chat_transcripts (org_id, session_id, role, content_redacted, tool_calls)
           VALUES ($1, $2, 'model', $3, $4);`,
          [orgId, sessionId, cached.answer, cached.tool_proposals ? JSON.stringify(cached.tool_proposals) : null],
        );

        // Increment message count
        await client.query(
          `UPDATE ai_sessions
           SET message_count = message_count + 1, updated_at = now()
           WHERE id = $1 AND org_id = $2;`,
          [sessionId, orgId],
        );

        return {
          sessionId,
          answer: cached.answer,
          proposedCartItems: cached.tool_proposals as any,
          tokensUsed: 0,
          callWaiterSuggested: false,
        };
      }

      // 3. Hybrid search retrieval
      let queryEmbedding: number[] | undefined;
      try {
        queryEmbedding = await this.provider.generateEmbedding(cleanUserMessage);
      } catch (err) {
        this.logger.warn(`[AI] Embedding generation failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      const contextItems = await this.retrievalService.hybridSearch(
        orgId,
        outletId,
        cleanUserMessage,
        queryEmbedding,
        8,
      );

      // 4. Fetch recent conversation history
      const historyRes = await client.query(
        `SELECT role, content_redacted
         FROM ai_chat_transcripts
         WHERE org_id = $1 AND session_id = $2
         ORDER BY created_at DESC
         LIMIT 6;`,
        [orgId, sessionId],
      );

      const pastMessages: ChatMessage[] = (historyRes.rows as Array<{ role: string; content_redacted: string }>)
        .reverse()
        .map((r) => ({
          role: r.role as 'user' | 'model',
          content: r.content_redacted,
        }));

      pastMessages.push({ role: 'user', content: cleanUserMessage });

      // 5. Generate AI Response
      let aiResult: AiChatResponse;
      try {
        aiResult = await this.provider.chat(pastMessages, contextItems);
      } catch (err) {
        this.logger.warn(`[AI] Primary provider chat failed: ${err instanceof Error ? err.message : String(err)}, falling back to grounded mock provider`);
        try {
          const fallbackProvider = new MockAiAdapter();
          aiResult = await fallbackProvider.chat(pastMessages, contextItems);
        } catch {
          aiResult = {
            answer: `Our AI assistant is temporarily unavailable. Please call a waiter for assistance. ${MANDATORY_ALLERGEN_DISCLAIMER}`,
            callWaiterSuggested: true,
            tokensUsed: 0,
          };
        }
      }

      // Apply guardrails safety guarantees
      const finalResult = applyGuardrails(cleanUserMessage, aiResult);

      // 6. Append to Transcripts (Append-only)
      await client.query(
        `INSERT INTO ai_chat_transcripts (org_id, session_id, role, content_redacted)
         VALUES ($1, $2, 'user', $3);`,
        [orgId, sessionId, cleanUserMessage],
      );

      await client.query(
        `INSERT INTO ai_chat_transcripts (org_id, session_id, role, content_redacted, tool_calls)
         VALUES ($1, $2, 'model', $3, $4);`,
        [
          orgId,
          sessionId,
          finalResult.answer,
          finalResult.proposedCartItems ? JSON.stringify(finalResult.proposedCartItems) : null,
        ],
      );

      // 7. Update Session message and token budget
      await client.query(
        `UPDATE ai_sessions
         SET message_count = message_count + 1,
             tokens_used = tokens_used + $1,
             updated_at = now()
         WHERE id = $2 AND org_id = $3;`,
        [finalResult.tokensUsed, sessionId, orgId],
      );

      // 8. Cache response if eligible (not off-topic, not empty)
      if (
        !finalResult.callWaiterSuggested &&
        !finalResult.answer.includes("I cannot comply") &&
        normalizedQ.length > 3
      ) {
        await client.query(
          `INSERT INTO ai_qa_cache (org_id, outlet_id, question_hash, question_clean, answer, tool_proposals, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, now() + interval '1 hour')
           ON CONFLICT (org_id, outlet_id, question_hash)
           DO UPDATE SET answer = EXCLUDED.answer,
                         tool_proposals = EXCLUDED.tool_proposals,
                         expires_at = now() + interval '1 hour';`,
          [
            orgId,
            outletId,
            questionHash,
            cleanUserMessage,
            finalResult.answer,
            finalResult.proposedCartItems ? JSON.stringify(finalResult.proposedCartItems) : null,
          ],
        );
      }

      return {
        sessionId,
        ...finalResult,
      };
    });
  }

  /**
   * Reindexes menu embeddings for an outlet and purges stale Q&A cache.
   * Requires AI_MANAGE permission.
   * Reference: ARCH §21
   */
  async reindexOutletMenu(orgId: string, outletId: string): Promise<{ itemsIndexed: number }> {
    return withTenantContextRaw(orgId, async (client: PoolClient) => {
      // Invalidate existing Q&A cache for this outlet
      await client.query(
        `DELETE FROM ai_qa_cache WHERE org_id = $1 AND outlet_id = $2;`,
        [orgId, outletId],
      );

      return this.retrievalService.reindexOutlet(orgId, outletId, this.provider);
    });
  }
}
