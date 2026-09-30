import { z } from "zod";

export const periodEnum = z.enum([
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);

export const salesReportQuerySchema = z.object({
  period: periodEnum.optional().default("daily"),
  from: z.string().optional(),
  to: z.string().optional(),
  branchId: z.string().min(1).optional(),
  salespersonId: z.string().min(1).optional(),
  format: z.enum(["json", "csv"]).optional().default("json"),
});

export const cashPositionQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  branchId: z.string().min(1).optional(),
  format: z.enum(["json", "csv"]).optional().default("json"),
});

export const inventoryReportQuerySchema = z.object({
  branchId: z.string().min(1).optional(),
  format: z.enum(["json", "csv"]).optional().default("json"),
});

export type Period = z.infer<typeof periodEnum>;
export type SalesReportQuery = z.infer<
  typeof salesReportQuerySchema
>;
export type CashPositionQuery = z.infer<
  typeof cashPositionQuerySchema
>;
export type InventoryReportQuery = z.infer<
  typeof inventoryReportQuerySchema
>;
