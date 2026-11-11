/**
 * AI Provider Interface & Types (ARCH §21)
 * Decouples model provider (Gemini, Claude, OpenAI, Mock) from business logic.
 */

export interface ChatMessage {
  role: 'user' | 'model' | 'system';
  content: string;
}

export interface RetrievedMenuItem {
  id: string;
  name: string;
  description?: string;
  pricePaise: number;
  vegType: string;
  allergens: string[];
  spiceLevel: number;
  prepTimeMin?: number;
  calories?: number;
  isAvailable: boolean;
}

export interface ProposedCartItem {
  itemId: string;
  name: string;
  quantity: number;
  pricePaise: number;
  notes?: string;
}

export interface AiChatResponse {
  answer: string;
  proposedCartItems?: ProposedCartItem[];
  tokensUsed: number;
  callWaiterSuggested?: boolean;
}

export interface AiProvider {
  /**
   * Generate 768-dimensional dense vector embedding for text.
   * Matches pgvector column `vector(768)`.
   */
  generateEmbedding(text: string): Promise<number[]>;

  /**
   * Generates conversational grounded response based strictly on context menu items.
   */
  chat(messages: ChatMessage[], contextItems: RetrievedMenuItem[]): Promise<AiChatResponse>;
}
