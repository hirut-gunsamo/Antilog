import { z } from "zod";

// A salesperson closes off a period. Both figures are computed by the system,
// never typed in: expected comes from their approved sales, banked comes from
// their verified bank receipts. The difference is what is still in hand.
export const createCashReportSchema = z.object({
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  notes: z.string().max(500).optional(),
});

export const rejectCashReportSchema = z.object({
  rejectionReason: z.string().min(1).max(500),
});

export const listCashReportsQuerySchema = z.object({
  status: z
    .enum([
      "DRAFT",
      "SUBMITTED",
      "APPROVED",
      "REJECTED",
      "SENT_TO_OWNER",
    ])
    .optional(),
  branchId: z.string().min(1).optional(),
  salespersonId: z.string().min(1).optional(),
});

export type CreateCashReportInput = z.infer<
  typeof createCashReportSchema
>;
export type ListCashReportsQuery = z.infer<
  typeof listCashReportsQuerySchema
>;
