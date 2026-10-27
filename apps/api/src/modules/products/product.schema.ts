import { z } from "zod";

// The type carries the brand and model; the category comes from the type.
// A name may be supplied to override the generated one, but never a code.
const baseProductSchema = z.object({
  typeId: z.string().min(1),
  name: z.string().min(2).max(150).optional(),
  description: z.string().max(500).optional(),
  price: z.coerce.number().nonnegative(),
  // What the business pays for one, for profit and loss.
  costPrice: z.coerce.number().nonnegative().nullable().optional(),
});

export const createProductSchema = baseProductSchema.extend({
  // Phones only.
  model: z.string().max(80).optional(),
  storage: z.string().max(40).optional(),
  color: z.string().max(40).optional(),
  // Vouchers only; the price is taken from it.
  denomination: z.coerce.number().int().positive().optional(),
});

// The category, type and code are fixed once a product exists: stock and
// sales are counted against them. Everything that describes it can change.
export const updateProductSchema = z
  .object({
    name: z.string().trim().min(2).max(150).optional(),
    description: z.string().max(500).nullable().optional(),
    price: z.coerce.number().nonnegative().optional(),
    costPrice: z.coerce.number().nonnegative().nullable().optional(),
    // Phones only.
    model: z.string().trim().min(1).max(80).optional(),
    storage: z.string().max(40).nullable().optional(),
    color: z.string().max(40).nullable().optional(),
    // Vouchers only; the price follows it.
    denomination: z.coerce.number().int().positive().optional(),
  })
  .refine((v) => Object.values(v).some((field) => field !== undefined), {
    message: "Nothing to change",
  });

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
