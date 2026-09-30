import { z } from "zod";

export const collectCashSchema = z.object({
  salespersonId: z.string().min(1),
  amount: z.coerce.number().positive(),
  notes: z.string().max(500).optional(),
});

export const listCollectionsQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  branchId: z.string().min(1).optional(),
});

export type CollectCashInput = z.infer<typeof collectCashSchema>;
