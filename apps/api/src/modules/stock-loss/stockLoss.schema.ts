import { z } from "zod";

export const LOSS_KINDS = ["DAMAGED", "LOST"] as const;

// Stock is a count for every category now. A write-off is always a
// quantity — there are no unit rows left pre-sale to name individually.
export const reportLossSchema = z.object({
  kind: z.enum(LOSS_KINDS),

  productId: z.string().min(1),

  // Only the Owner may name a branch; everyone else reports against their
  // own, so this is ignored for them.
  locationId: z.string().min(1).optional(),

  quantity: z.coerce.number().int().min(1).max(10_000),

  // Required: a write-off without a stated cause is not reviewable.
  reason: z.string().trim().min(3).max(500),
});

export type ReportLossInput = z.infer<typeof reportLossSchema>;

export const rejectLossSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export type RejectLossInput = z.infer<typeof rejectLossSchema>;

export const listLossQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  kind: z.enum(LOSS_KINDS).optional(),
  locationId: z.string().min(1).optional(),
});

export type ListLossQuery = z.infer<typeof listLossQuerySchema>;
