import { Injectable } from '@nestjs/common';
import type { AiProvider, ChatMessage, RetrievedMenuItem, AiChatResponse, ProposedCartItem } from './ai.provider.js';
import { applyGuardrails, MANDATORY_ALLERGEN_DISCLAIMER } from './ai-guardrails.js';

@Injectable()
export class MockAiAdapter implements AiProvider {
  /**
   * Deterministic 768-dimensional embedding generation.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const vector = new Array<number>(768).fill(0);
    const clean = text.toLowerCase();
    for (let i = 0; i < clean.length; i++) {
      const code = clean.charCodeAt(i);
      const idx = (code * 13 + i * 7) % 768;
      const current = vector[idx] ?? 0;
      vector[idx] = (current + (code % 31) / 31.0 - 0.5);
    }
    // Normalize vector
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1.0;
    return vector.map((v) => Number((v / norm).toFixed(6)));
  }

  /**
   * Deterministic conversational simulation adhering to all ARCH §21 invariants.
   */
  async chat(messages: ChatMessage[], contextItems: RetrievedMenuItem[]): Promise<AiChatResponse> {
    const lastUserMsg = messages.filter((m) => m.role === 'user').pop();
    const query = lastUserMsg?.content || '';
    const lowerQuery = query.toLowerCase();

    // 1. Prompt injection & data exfiltration
    if (
      lowerQuery.includes('ignore previous') ||
      lowerQuery.includes('forget everything') ||
      lowerQuery.includes('system prompt') ||
      lowerQuery.includes('system override') ||
      lowerQuery.includes('reveal your') ||
      lowerQuery.includes('you are now') ||
      lowerQuery.includes('bypass') ||
      lowerQuery.includes('customer name') ||
      lowerQuery.includes('phone number') ||
      lowerQuery.includes('credit card') ||
      lowerQuery.includes('database table') ||
      lowerQuery.includes('drop table') ||
      lowerQuery.includes('secret key') ||
      lowerQuery.includes('api key')
    ) {
      return applyGuardrails(query, {
        answer: `I cannot comply with that request. I can only assist you with exploring our restaurant's menu.`,
        callWaiterSuggested: false,
        tokensUsed: 45,
      });
    }

    // 2. Off-topic queries
    if (
      lowerQuery.includes('prime minister') ||
      lowerQuery.includes('president') ||
      lowerQuery.includes('weather') ||
      lowerQuery.includes('poem') ||
      lowerQuery.includes('script') ||
      lowerQuery.includes('python') ||
      lowerQuery.includes('code') ||
      lowerQuery.includes('capital of')
    ) {
      return applyGuardrails(query, {
        answer: `I'm not sure — please ask staff. I can only assist you with our restaurant's menu items.`,
        callWaiterSuggested: true,
        tokensUsed: 65,
      });
    }

    // 3. Allergen inquiries
    if (
      lowerQuery.includes('allerg') ||
      lowerQuery.includes('gluten') ||
      lowerQuery.includes('celiac') ||
      lowerQuery.includes('peanut') ||
      lowerQuery.includes('nut') ||
      lowerQuery.includes('dairy') ||
      lowerQuery.includes('lactose') ||
      lowerQuery.includes('vegan') ||
      lowerQuery.includes('safe')
    ) {
      if (contextItems.length === 0) {
        return applyGuardrails(query, {
          answer: `I could not find detailed allergen records for that dish. I'm not sure — please ask staff. ${MANDATORY_ALLERGEN_DISCLAIMER}`,
          callWaiterSuggested: true,
          tokensUsed: 80,
        });
      }

      const item = contextItems[0]!;
      const allergenList = item.allergens.length > 0 ? item.allergens.join(', ') : 'no recorded common allergens';
      return applyGuardrails(query, {
        answer: `Based on our menu records, ${item.name} has ${allergenList}. However, our kitchen handles multiple ingredients. ${MANDATORY_ALLERGEN_DISCLAIMER}`,
        callWaiterSuggested: false,
        tokensUsed: 95,
      });
    }

    // 4. Cart addition proposals
    if (
      lowerQuery.includes('add') ||
      lowerQuery.includes('order') ||
      lowerQuery.includes('want to buy') ||
      lowerQuery.includes('get me')
    ) {
      if (contextItems.length > 0) {
        const item = contextItems[0]!;
        const proposed: ProposedCartItem = {
          itemId: item.id,
          name: item.name,
          quantity: 1,
          pricePaise: item.pricePaise,
        };

        return applyGuardrails(query, {
          answer: `I have prepared ${item.name} (₹${(item.pricePaise / 100).toFixed(0)}) for your cart. Please review and confirm in the app to add it to your order.`,
          proposedCartItems: [proposed],
          callWaiterSuggested: false,
          tokensUsed: 90,
        });
      }
    }

    // 5. Multilingual (Hindi / Hinglish)
    if (
      lowerQuery.includes('kuch') ||
      lowerQuery.includes('khana') ||
      lowerQuery.includes('chahiye') ||
      lowerQuery.includes('hai') ||
      lowerQuery.includes('batao')
    ) {
      const match = lowerQuery.includes('spicy')
        ? (contextItems.find((i) => i.vegType === 'VEG' && i.spiceLevel >= 2) || contextItems[0])
        : (contextItems.find((i) => i.vegType === 'VEG' && i.spiceLevel <= 1) || contextItems[0]);

      if (match) {
        return applyGuardrails(query, {
          answer: `Aapke liye humara mashhoor "${match.name}" (₹${(match.pricePaise / 100).toFixed(0)}) behtareen rahega! Iska spice level ${match.spiceLevel}/3 hai.`,
          callWaiterSuggested: false,
          tokensUsed: 110,
        });
      }
    }

    // 6. General grounded recommendations
    if (contextItems.length > 0) {
      const topItems = contextItems.slice(0, 3);
      const suggestions = topItems
        .map((i) => `• ${i.name} (₹${(i.pricePaise / 100).toFixed(0)}) - ${i.vegType}, Spice ${i.spiceLevel}/3`)
        .join('\n');

      return applyGuardrails(query, {
        answer: `Here are some recommendations from our menu that match your taste:\n${suggestions}\nWould you like me to prepare any of these for your cart?`,
        callWaiterSuggested: false,
        tokensUsed: 120,
      });
    }

    // 7. Unknown / No items found
    return applyGuardrails(query, {
      answer: `I'm not sure — please ask staff. We couldn't find items matching your request on our menu.`,
      callWaiterSuggested: true,
      tokensUsed: 50,
    });
  }
}
