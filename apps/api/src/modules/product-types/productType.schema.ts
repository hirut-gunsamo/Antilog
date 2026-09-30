import { z } from "zod";

export const createProductTypeSchema = z.object({
  // The Owner's category; its kind is looked up from it.
  categoryId: z.string().min(1),
  name: z.string().min(1).max(80),
  // Absent for a brand or a voucher type; set for a phone model under a brand.
  parentId: z.string().min(1).optional(),
});

export const updateProductTypeSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.isActive !== undefined, {
    message: "Nothing to change",
  });

export const listProductTypesQuerySchema = z.object({
  categoryId: z.string().min(1).optional(),
});

export type CreateProductTypeInput = z.infer<typeof createProductTypeSchema>;
export type UpdateProductTypeInput = z.infer<typeof updateProductTypeSchema>;
export type ListProductTypesQuery = z.infer<typeof listProductTypesQuerySchema>;
