import { z } from "zod";

/** The ranges the Owner dashboard offers, plus a custom window. */
export const NATIONAL_ID_RANGES = [
  "today",
  "week",
  "month",
  "year",
  "custom",
] as const;

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

export const createRecordSchema = z.object({
  date: day,

  // Only the Owner may record against a branch other than their own, and they
  // have no branch of their own, so for them it is required.
  locationId: z.string().min(1).optional(),

  // Who did the work. A supervisor records for their staff; everyone else
  // records their own, so this is ignored for them.
  recordedById: z.string().min(1).optional(),

  originalCount: z.coerce.number().int().min(0).max(100_000),
  copyCount: z.coerce.number().int().min(0).max(100_000),

  notes: z.string().trim().max(500).optional(),
});

export type CreateRecordInput = z.infer<typeof createRecordSchema>;

export const updateRecordSchema = z.object({
  originalCount: z.coerce.number().int().min(0).max(100_000).optional(),
  copyCount: z.coerce.number().int().min(0).max(100_000).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export type UpdateRecordInput = z.infer<typeof updateRecordSchema>;

export const receiveBlanksSchema = z
  .object({
    locationId: z.string().min(1).optional(),
    originalAdded: z.coerce.number().int().min(0).max(1_000_000),
    copyAdded: z.coerce.number().int().min(0).max(1_000_000),
    note: z.string().trim().max(300).optional(),
  })
  .refine((data) => data.originalAdded + data.copyAdded > 0, {
    message: "Enter how many blanks arrived",
    path: ["originalAdded"],
  });

export type ReceiveBlanksInput = z.infer<typeof receiveBlanksSchema>;

export const listRecordsQuerySchema = z.object({
  from: day.optional(),
  to: day.optional(),
  locationId: z.string().min(1).optional(),
  recordedById: z.string().min(1).optional(),
});

export type ListRecordsQuery = z.infer<typeof listRecordsQuerySchema>;

export const summaryQuerySchema = z.object({
  range: z.enum(NATIONAL_ID_RANGES).default("month"),
  from: day.optional(),
  to: day.optional(),
  locationId: z.string().min(1).optional(),
});

export type SummaryQuery = z.infer<typeof summaryQuerySchema>;
