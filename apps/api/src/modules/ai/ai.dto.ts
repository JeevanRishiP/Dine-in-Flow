import { z } from 'zod';

export const AiChatSchema = z
  .object({
    orgId: z.string().uuid(),
    outletId: z.string().uuid(),
    tableSessionId: z.string().uuid().optional(),
    sessionId: z.string().uuid().optional(),
    message: z
      .string()
      .min(1, 'Message cannot be empty')
      .max(500, 'Message cannot exceed 500 characters')
      .transform((val) => val.trim()),
    wishlistDishNames: z.array(z.string().max(255)).max(50).optional(),
  })
  .strict();

export type AiChatDto = z.infer<typeof AiChatSchema>;

export const AiReindexSchema = z
  .object({
    outletId: z.string().uuid(),
  })
  .strict();

export type AiReindexDto = z.infer<typeof AiReindexSchema>;
