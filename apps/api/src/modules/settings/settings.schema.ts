import { z } from "zod";

// Named formats, not strftime patterns: the client decides how to render each
// one, so a bad pattern can never reach a date formatter.
export const DATE_FORMATS = [
  "medium", // Sep 17, 2026
  "short", // 17/09/2026
  "iso", // 2026-09-17
  "long", // 17 September 2026
] as const;

export const TIME_FORMATS = ["24h", "12h"] as const;

// Display only. Nothing converts between currencies anywhere in the system.
export const CURRENCIES = ["ETB", "USD", "EUR", "GBP", "KES"] as const;

export const LANGUAGES = ["en", "am"] as const;

export const updateSettingsSchema = z
  .object({
    systemName: z.string().min(2).max(120).optional(),
    defaultLanguage: z.enum(LANGUAGES).optional(),
    currency: z.enum(CURRENCIES).optional(),
    dateFormat: z.enum(DATE_FORMATS).optional(),
    timeFormat: z.enum(TIME_FORMATS).optional(),
    itemsPerPage: z.coerce.number().int().min(5).max(200).optional(),

    // What a branch charges per National ID print. Zero is allowed: a branch
    // that does not charge still records the counts.
    nationalIdOriginalRate: z.coerce.number().min(0).max(100_000).optional(),
    nationalIdCopyRate: z.coerce.number().min(0).max(100_000).optional(),

    lowHoldingSim: z.coerce.number().int().min(0).max(10_000).optional(),
    lowHoldingPhone: z.coerce.number().int().min(0).max(10_000).optional(),
    lowHoldingVoucher: z.coerce.number().int().min(0).max(10_000).optional(),

    notifySales: z.boolean().optional(),
    notifyRequests: z.boolean().optional(),
    notifyApprovals: z.boolean().optional(),
    notifyLowStock: z.boolean().optional(),
    notifySystem: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one setting to change",
  });

// Restoring replaces data. The caller has to say so in as many words, which is
// checked here rather than trusted to the UI.
export const restoreSchema = z.object({
  confirm: z.literal("REPLACE ALL DATA"),
  backup: z.object({
    version: z.number(),
    exportedAt: z.string(),
    tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  }),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type RestoreInput = z.infer<typeof restoreSchema>;
