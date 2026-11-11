import { z } from 'zod';

export const CustomerAnonymizeSchema = z
  .object({
    reason: z.string().max(250).optional(),
  })
  .strict();

export type CustomerAnonymizeDto = z.infer<typeof CustomerAnonymizeSchema>;

export const StaffAnonymizeSchema = z
  .object({
    customerId: z.string().uuid(),
    reason: z.string().min(5).max(250),
  })
  .strict();

export type StaffAnonymizeDto = z.infer<typeof StaffAnonymizeSchema>;

export const StaffExportSchema = z
  .object({
    customerId: z.string().uuid(),
  })
  .strict();

export type StaffExportDto = z.infer<typeof StaffExportSchema>;
