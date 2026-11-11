import { z } from 'zod';
import { ErrorCode } from './error-codes.js';

/**
 * RFC 7807 Problem Detail schema.
 * Used in all error responses from the API.
 * Reference: ARCH §13
 */
export const ProblemDetailSchema = z.object({
  type: z.string().url().optional(),
  title: z.string(),
  status: z.number().int().min(100).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.nativeEnum(ErrorCode),
  requestId: z.string().optional(),
  errors: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
});

export type ProblemDetail = z.infer<typeof ProblemDetailSchema>;
