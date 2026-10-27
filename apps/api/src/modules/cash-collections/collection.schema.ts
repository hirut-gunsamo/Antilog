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

export const declareYadereSchema = z.object({
  amount: z.coerce.number().min(0).max(1_000_000_000),
});

export type CollectCashInput = z.infer<typeof collectCashSchema>;
export type DeclareYadereInput = z.infer<typeof declareYadereSchema>;
