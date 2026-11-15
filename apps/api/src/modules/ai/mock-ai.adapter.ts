import { Injectable } from '@nestjs/common';
import type { AiProvider, ChatMessage, RetrievedMenuItem, AiChatResponse, ProposedCartItem, CustomerAiHistory } from './ai.provider.js';
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
  async chat(
    messages: ChatMessage[],
    contextItems: RetrievedMenuItem[],
    customerContext?: CustomerAiHistory,
  ): Promise<AiChatResponse> {
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
      lowerQuery.includes('capital of') ||
      lowerQuery.includes('gold price')
    ) {
      return applyGuardrails(query, {
        answer: `I'm not sure — please ask staff. I can only assist you with our restaurant's menu items.`,
        callWaiterSuggested: true,
        tokensUsed: 65,
      });
    }

    // 2b. Identity / greeting queries
    if (lowerQuery.includes('are you ai') || lowerQuery.includes('who are you') || /^(hi|hello|hey|namaste)\b/.test(lowerQuery.trim())) {
      return applyGuardrails(query, {
        answer: `Yes! I'm Chef AI, your menu assistant. Ask me about dishes, spice levels, vegetarian options, or pairings on our menu.`,
        callWaiterSuggested: false,
        tokensUsed: 40,
      });
    }

    // 2c. Customer Wishlist & Favorites Query
    if (lowerQuery.includes('favourite') || lowerQuery.includes('favorite') || lowerQuery.includes('wishlist')) {
      if (!customerContext?.isLoggedIn) {
        return applyGuardrails(query, {
          answer: `Please sign in to view and save your personal favourite dishes and wishlist! ❤️ Tap the profile or sign in below.`,
          callWaiterSuggested: false,
          tokensUsed: 45,
        });
      }
      const wishlisted = customerContext.wishlistDishes && customerContext.wishlistDishes.length > 0
        ? customerContext.wishlistDishes
        : ['Butter Chicken', 'Filter Coffee'];
      const matched = contextItems.filter((i) =>
        wishlisted.some((w) => i.name.toLowerCase().includes(w.toLowerCase())),
      );
      const proposedList: ProposedCartItem[] = (matched.length > 0 ? matched : contextItems.slice(0, 2)).map((i) => ({
        itemId: i.id,
        name: i.name,
        quantity: 1,
        pricePaise: i.pricePaise,
      }));
      return applyGuardrails(query, {
        answer: `Here are your favourite dishes:\n${wishlisted.map((d) => `• ${d}`).join('\n')}\nWould you like to add any of these to your cart?`,
        proposedCartItems: proposedList,
        callWaiterSuggested: false,
        tokensUsed: 80,
      });
    }

    // 2d. Previous Orders Query
    if (
      lowerQuery.includes('previous order') ||
      lowerQuery.includes('last order') ||
      lowerQuery.includes('what did i order') ||
      lowerQuery.includes('what was my order')
    ) {
      if (!customerContext?.isLoggedIn) {
        return applyGuardrails(query, {
          answer: `Please sign in to view your previous order history and past meals! 📋`,
          callWaiterSuggested: false,
          tokensUsed: 45,
        });
      }
      if (customerContext.pastOrders && customerContext.pastOrders.length > 0) {
        const lastOrder = customerContext.pastOrders[0]!;
        const itemsList = lastOrder.items
          .map((it) => `${it.quantity}x ${it.name}${it.notes ? ` (${it.notes})` : ''}`)
          .join(', ');
        return applyGuardrails(query, {
          answer: `Your previous order on ${lastOrder.date} included: ${itemsList}. Would you like to re-order any of these dishes today?`,
          callWaiterSuggested: false,
          tokensUsed: 85,
        });
      }
      return applyGuardrails(query, {
        answer: `You don't have any past completed orders yet. Would you like to explore our top specialties today?`,
        callWaiterSuggested: false,
        tokensUsed: 50,
      });
    }

    // 2e. Reviews & Liked Dishes Query ("which one did I like very much based on my reviews")
    if (
      lowerQuery.includes('review') ||
      lowerQuery.includes('liked') ||
      lowerQuery.includes('lacked') ||
      lowerQuery.includes('enjoyed')
    ) {
      if (!customerContext?.isLoggedIn) {
        return applyGuardrails(query, {
          answer: `Please sign in to see the dishes you reviewed and rated highly! ⭐`,
          callWaiterSuggested: false,
          tokensUsed: 45,
        });
      }
      if (customerContext.likedDishes && customerContext.likedDishes.length > 0) {
        const topLikes = customerContext.likedDishes.filter((d) => d.rating >= 4);
        const dishes = (topLikes.length > 0 ? topLikes : customerContext.likedDishes).slice(0, 3);
        const summary = dishes
          .map((d) => `★ ${d.dishName} (${d.rating}/5 stars)${d.review ? ` - "${d.review}"` : ''}`)
          .join('\n');
        return applyGuardrails(query, {
          answer: `Based on your reviews, here are the dishes you liked very much:\n${summary}\nWould you like me to prepare any of these for your cart?`,
          callWaiterSuggested: false,
          tokensUsed: 90,
        });
      }
      return applyGuardrails(query, {
        answer: `You haven't reviewed any dishes yet. After enjoying your meal, you can rate your dishes in the Orders History! ⭐`,
        callWaiterSuggested: false,
        tokensUsed: 50,
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

    // 4. Cart addition proposals & Customizations
    if (
      lowerQuery.includes('add') ||
      lowerQuery.includes('order') ||
      lowerQuery.includes('want to buy') ||
      lowerQuery.includes('get me') ||
      lowerQuery.includes('custom')
    ) {
      if (contextItems.length > 0) {
        // Find matching item from contextItems if name appears in query
        let item = contextItems[0]!;
        for (const ci of contextItems) {
          if (lowerQuery.includes(ci.name.toLowerCase())) {
            item = ci;
            break;
          }
        }

        // Parse custom notes
        const notesParts: string[] = [];
        if (lowerQuery.includes('strong')) notesParts.push('Strong brew');
        if (lowerQuery.includes('less sugar')) notesParts.push('less sugar');
        else if (lowerQuery.includes('sugar free') || lowerQuery.includes('no sugar')) notesParts.push('sugar free');
        if (lowerQuery.includes('extra spicy') || lowerQuery.includes('hot')) notesParts.push('extra spicy');
        else if (lowerQuery.includes('mild')) notesParts.push('mild spice');
        if (lowerQuery.includes('no onion') || lowerQuery.includes('without onion')) notesParts.push('no onion/garlic');
        if (lowerQuery.includes('less oil')) notesParts.push('less oil');

        let customNote = notesParts.length > 0 ? notesParts.join(', ') : undefined;
        if (!customNote && (lowerQuery.includes('customise') || lowerQuery.includes('customize'))) {
          const match = query.match(/(?:customise|customize|make it|with)\s+([^,.]+)/i);
          if (match && match[1]) {
            customNote = match[1].trim();
          }
        }

        const proposed: ProposedCartItem = {
          itemId: item.id,
          name: item.name,
          quantity: 1,
          pricePaise: item.pricePaise,
          ...(customNote ? { notes: customNote } : {}),
        };

        const answer = customNote
          ? `I have prepared ${item.name} with your customisation (${customNote}) for your cart. Please tap '+ Add' to confirm or adjust in the app!`
          : `I have prepared ${item.name} (₹${(item.pricePaise / 100).toFixed(0)}) for your cart. Please review and confirm in the app to add it to your order.`;

        return applyGuardrails(query, {
          answer,
          proposedCartItems: [proposed],
          callWaiterSuggested: false,
          tokensUsed: 95,
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
