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
import { getRedis } from '../../common/redis/redis.client.js';
import type { AiChatDto } from './ai.dto.js';

export const MAX_SESSION_MESSAGES = 20;
export const MAX_SESSION_TOKENS = 40000;
const ORG_AI_RPM_LIMIT = 120;

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
   * Split into non-overlapping DB phases so no connection is held during external
   * Gemini HTTP calls and `hybridSearch` never opens a nested connection.
   * Reference: ARCH §21
   */
  async chat(dto: AiChatDto, customerId?: string | null): Promise<AiChatResponse & { sessionId: string }> {
    const orgId = dto.orgId;
    const outletId = dto.outletId;
    const rawMessage = dto.message;

    if (rawMessage.length > 500) {
      throw domainError(ErrorCode.AI_INPUT_TOO_LONG, 'Message cannot exceed 500 characters', 400);
    }

    if (process.env['NODE_ENV'] !== 'test') {
      try {
        const redis = getRedis();
        const rlKey = `ai:rl:org:${orgId}`;
        const count = await redis.incr(rlKey);
        if (count === 1) await redis.expire(rlKey, 60);
        if (count > ORG_AI_RPM_LIMIT) {
          throw domainError(ErrorCode.RATE_LIMITED, 'AI assistant rate limit reached. Please try again shortly.', 429);
        }
      } catch (err) {
        if (typeof err === 'object' && err !== null && 'status' in err && (err as { status: number }).status === 429) {
          throw err;
        }
      }
    }

    const cleanUserMessage = redactPii(rawMessage);
    const normalizedQ = cleanUserMessage.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const questionHash = crypto.createHash('sha256').update(normalizedQ).digest('hex');

    // ── Phase A (Short DB TX 1): Session check, Q&A cache check, history fetch ─
    const prePhase = await withTenantContextRaw(orgId, async (client: PoolClient) => {
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

      const cacheRes = await client.query(
        `SELECT answer, tool_proposals
         FROM ai_qa_cache
         WHERE org_id = $1 AND outlet_id = $2 AND question_hash = $3 AND expires_at > now();`,
        [orgId, outletId, questionHash],
      );

      if (cacheRes.rowCount && cacheRes.rowCount > 0) {
        const cached = cacheRes.rows[0] as QaCacheRow;

        await client.query(
          `INSERT INTO ai_chat_transcripts (org_id, session_id, role, content_redacted)
           VALUES ($1, $2, 'user', $3);`,
          [orgId, sessionId, cleanUserMessage],
        );

        await client.query(
          `INSERT INTO ai_chat_transcripts (org_id, session_id, role, content_redacted, tool_calls)
           VALUES ($1, $2, 'model', $3, $4);`,
          [orgId, sessionId, cached.answer, cached.tool_proposals ? JSON.stringify(cached.tool_proposals) : null],
        );

        await client.query(
          `UPDATE ai_sessions
           SET message_count = message_count + 1, updated_at = now()
           WHERE id = $1 AND org_id = $2;`,
          [sessionId, orgId],
        );

        return {
          hit: true as const,
          response: {
            sessionId,
            answer: cached.answer,
            proposedCartItems: cached.tool_proposals as AiChatResponse['proposedCartItems'],
            tokensUsed: 0,
            callWaiterSuggested: false,
          },
        };
      }

      const historyRes = await client.query(
        `SELECT role, content_redacted
         FROM ai_chat_transcripts
         WHERE org_id = $1 AND session_id = $2
         ORDER BY created_at DESC
         LIMIT 10;`,
        [orgId, sessionId],
      );

      const pastMessages: ChatMessage[] = (historyRes.rows as Array<{ role: string; content_redacted: string }>)
        .reverse()
        .map((r) => ({
          role: r.role as 'user' | 'model',
          content: r.content_redacted,
        }));
      pastMessages.push({ role: 'user', content: cleanUserMessage });

      return { hit: false as const, sessionId, pastMessages };
    });

    if (prePhase.hit) {
      return prePhase.response;
    }

    const { sessionId, pastMessages } = prePhase;

    // ── Phase B & C (No DB lock held across external HTTP calls!) ──────────────
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
      12,
    );

    let aiResult: AiChatResponse;
    let usedFallback = false;
    try {
      aiResult = await this.provider.chat(pastMessages, contextItems);
    } catch (err) {
      usedFallback = true;
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

    // Reconcile proposedCartItems against authoritative retrieved catalog (AGENTS §2 rules 1 & 2)
    if (aiResult.proposedCartItems && aiResult.proposedCartItems.length > 0) {
      const byId = new Map(contextItems.map((i) => [i.id, i]));
      const byName = new Map(contextItems.map((i) => [i.name.toLowerCase(), i]));
      aiResult.proposedCartItems = aiResult.proposedCartItems
        .map((p) => {
          const match = byId.get(p.itemId) || (p.name ? byName.get(p.name.toLowerCase()) : undefined);
          if (!match) return null;
          return {
            itemId: match.id,
            name: match.name,
            quantity: Math.max(1, Math.min(20, Math.round(Number(p.quantity) || 1))),
            pricePaise: match.pricePaise,
            ...(p.notes ? { notes: p.notes } : {}),
          };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null);
    }

    const finalResult = applyGuardrails(cleanUserMessage, aiResult);

    // ── Phase D (Short DB TX 3): Persist transcripts, usage & cache ───────────
    await withTenantContextRaw(orgId, async (client: PoolClient) => {
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

      await client.query(
        `UPDATE ai_sessions
         SET message_count = message_count + 1,
             tokens_used = tokens_used + $1,
             updated_at = now()
         WHERE id = $2 AND org_id = $3;`,
        [finalResult.tokensUsed, sessionId, orgId],
      );

      if (
        !usedFallback &&
        pastMessages.length === 1 &&
        !finalResult.callWaiterSuggested &&
        !finalResult.answer.includes('I cannot comply') &&
        normalizedQ.split(/\s+/).length >= 3
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
    });

    return {
      sessionId,
      ...finalResult,
    };
  }

  /**
   * Reindexes menu embeddings for an outlet and purges stale Q&A cache.
   * Requires AI_MANAGE permission. Runs cache delete before retrieval reindex (no nested TX).
   * Reference: ARCH §21
   */
  async reindexOutletMenu(orgId: string, outletId: string): Promise<{ itemsIndexed: number }> {
    await withTenantContextRaw(orgId, async (client: PoolClient) => {
      await client.query(
        `DELETE FROM ai_qa_cache WHERE org_id = $1 AND outlet_id = $2;`,
        [orgId, outletId],
      );
    });

    return this.retrievalService.reindexOutlet(orgId, outletId, this.provider);
  }
}
