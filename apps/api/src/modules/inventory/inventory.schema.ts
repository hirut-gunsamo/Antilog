import { z } from "zod";

// Stock arrives as a count, for every category. ICCIDs and IMEIs are recorded
// when a unit is sold, not when it is delivered.
export const stockInSchema = z.object({
  productId: z.string().min(1),
  // Where it arrives; defaults to the main store when it is for a branch.
  locationId: z.string().min(1).optional(),
  // The branch the Owner bought it for: it joins that branch's share.
  forBranchId: z.string().min(1).optional(),

  // Up to a billion at once: a big purchase fits, a mistyped extra zero is refused.
  quantity: z.coerce.number().int().positive().max(1_000_000_000),

  note: z.string().max(500).optional(),
});

// Filters for inventory reads. A locationId is always re-checked against the
// caller's own branch in the service - it can narrow a query, never widen it.
export const inventoryQuerySchema = z.object({
  locationId: z.string().min(1).optional(),
  // A salesperson's own stock: only what was issued to them and not yet sold.
  mine: z.enum(["1", "true"]).optional(),
});

export const unitsQuerySchema = z.object({
  productId: z.string().min(1).optional(),
  locationId: z.string().min(1).optional(),
  status: z
    .enum(["IN_STOCK", "RESERVED", "SOLD", "DAMAGED", "LOST"])
    .optional(),
});

// Correcting a balance sets the quantity outright rather than nudging it:
// the Owner is saying what the shelf actually holds, not how far it was out.
export const adjustBalanceSchema = z.object({
  quantity: z.coerce.number().int().min(0),
  reason: z.string().min(1).max(500),
});

// Editing the product behind a row. Only the fields a mis-keyed entry would
// get wrong; category and SKU stay fixed because stock already refers to them.
export const updateProductSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    price: z.coerce.number().nonnegative().optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });

export const removeBalanceSchema = z.object({
  reason: z.string().min(1).max(500),
});

export type AdjustBalanceInput = z.infer<typeof adjustBalanceSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type RemoveBalanceInput = z.infer<typeof removeBalanceSchema>;
// Setting a branch's share of the Owner's stock to its true figure.
export const branchStockSchema = z.object({
  branchId: z.string().min(1),
  productId: z.string().min(1),
  quantity: z.coerce.number().int().min(0).max(1_000_000_000),
});

export type StockInInput = z.infer<typeof stockInSchema>;
export type InventoryQuery = z.infer<typeof inventoryQuerySchema>;
export type UnitsQuery = z.infer<typeof unitsQuerySchema>;