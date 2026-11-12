import { Injectable, Logger } from '@nestjs/common';
import type { AiProvider, ChatMessage, RetrievedMenuItem, AiChatResponse } from './ai.provider.js';
import { buildSystemPrompt, applyGuardrails, MANDATORY_ALLERGEN_DISCLAIMER } from './ai-guardrails.js';

interface GeminiEmbedResponse {
  embedding?: {
    values: number[];
  };
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

@Injectable()
export class GeminiAdapter implements AiProvider {
  private readonly logger = new Logger(GeminiAdapter.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly embeddingModel = 'gemini-embedding-001';
  private readonly timeoutMs = 8000;

  constructor(apiKey?: string, model = 'gemini-3.5-flash-lite') {
    this.apiKey = apiKey || process.env['GEMINI_API_KEY'] || '';
    this.model = model;
    if (!this.apiKey) {
      this.logger.warn('[AI] GEMINI_API_KEY is not configured; AI requests will fall back gracefully');
    }
  }

  /**
   * Generates a 768-dimensional vector embedding for text using Google Gemini gemini-embedding-001.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.embeddingModel}:embedContent`;
    const payload = {
      model: `models/${this.embeddingModel}`,
      content: {
        parts: [{ text: text.trim().slice(0, 2000) }],
      },
      outputDimensionality: 768,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const errText = await res.text();
      this.logger.error(`[AI] Gemini embedContent error (${res.status}): ${errText}`);
      throw new Error(`Gemini embedContent failed: ${res.status}`);
    }

    const data = (await res.json()) as GeminiEmbedResponse;
    if (!data.embedding?.values) {
      throw new Error('Gemini embedContent returned no embedding values');
    }

    return data.embedding.values;
  }

  /**
   * Generates a menu recommendation or response strictly grounded in context items.
   */
  async chat(messages: ChatMessage[], contextItems: RetrievedMenuItem[]): Promise<AiChatResponse> {
    if (!this.apiKey) {
      return {
        answer: `I am currently in offline mode. For assistance with our menu, ${MANDATORY_ALLERGEN_DISCLAIMER}`,
        callWaiterSuggested: true,
        tokensUsed: 0,
      };
    }

    const systemPrompt = buildSystemPrompt(contextItems);
    const lastUserMessage = messages.filter((m) => m.role === 'user').pop();
    const query = lastUserMessage?.content || '';

    const demarcatedPrompt = `Here is the conversation history:
${messages
  .filter((m) => m.role !== 'system')
  .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
  .join('\n')}

<user_query>
${query}
</user_query>
`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
    const payload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: demarcatedPrompt }],
        },
      ],
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 800,
        responseMimeType: 'application/json',
      },
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!res.ok) {
        const errText = await res.text();
        this.logger.warn(`[AI] Gemini generateContent non-OK (${res.status}): ${errText}`);
        throw new Error(`Gemini generateContent failed with status ${res.status}`);
      }

      const data = (await res.json()) as GeminiGenerateResponse;
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      const tokensUsed = data.usageMetadata?.totalTokenCount || 100;

      if (!rawText) {
        return {
          answer: `I'm not sure — please ask staff. ${MANDATORY_ALLERGEN_DISCLAIMER}`,
          callWaiterSuggested: true,
          tokensUsed,
        };
      }

      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        parsed = {
          answer: rawText,
          callWaiterSuggested: false,
        };
      }

      const answerText =
        (typeof parsed['answer'] === 'string' && parsed['answer']) ||
        (typeof parsed['response'] === 'string' && parsed['response']) ||
        (typeof parsed['reply'] === 'string' && parsed['reply']) ||
        (typeof parsed['message'] === 'string' && parsed['message']) ||
        rawText ||
        "I'm not sure — please ask staff.";

      const baseResponse: AiChatResponse = {
        answer: answerText,
        proposedCartItems: Array.isArray(parsed['proposedCartItems'])
          ? (parsed['proposedCartItems'] as any)
          : undefined,
        tokensUsed,
        callWaiterSuggested: Boolean(parsed['callWaiterSuggested']),
      };

      // Apply programmatic guardrails to guarantee compliance
      return applyGuardrails(query, baseResponse);
    } catch (err) {
      this.logger.warn(`[AI] Gemini chat execution failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
}
