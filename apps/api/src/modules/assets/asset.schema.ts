import { z } from "zod";

export const assetCategory = z.enum([
  "ELECTRONICS",
  "FURNITURE",
  "STATIONERY",
  "OTHER",
]);

export const assetStatus = z.enum(["IN_USE", "DAMAGED", "RETIRED"]);

export const createAssetSchema = z.object({
  locationId: z.string().min(1),
  name: z.string().trim().min(2).max(160),
  category: assetCategory,
  quantity: z.coerce.number().int().positive().default(1),
  serialNumber: z.string().trim().max(120).optional(),
  cost: z.coerce.number().min(0).max(100_000_000).optional(),
  // The day it reached the branch, which is often before it was typed in.
  receivedAt: z.string().optional(),
  note: z.string().trim().max(500).optional(),
});

export const updateAssetSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  category: assetCategory.optional(),
  status: assetStatus.optional(),
  quantity: z.coerce.number().int().positive().optional(),
  serialNumber: z.string().trim().max(120).optional(),
  cost: z.coerce.number().min(0).max(100_000_000).optional(),
  receivedAt: z.string().optional(),
  note: z.string().trim().max(500).optional(),
});

export const listAssetsQuerySchema = z.object({
  locationId: z.string().min(1).optional(),
  category: assetCategory.optional(),
  status: assetStatus.optional(),
});

export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;
export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>;
