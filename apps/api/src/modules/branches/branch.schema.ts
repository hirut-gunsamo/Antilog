import { z } from "zod";

// Branches are created and retired through the API. There is no limit on how
// many a client may have.
export const createBranchSchema = z.object({
  name: z.string().min(2).max(100),
  // A branch that can also act as a stock source for other branches.
  isMainStock: z.boolean().optional().default(false),
});

export const updateBranchSchema = z.object({
  name: z.string().min(2).max(100),
});

export const updateBranchStatusSchema = z.object({
  isActive: z.boolean(),
});

export const updateMainStockSchema = z.object({
  isMainStock: z.boolean(),
});

export const listBranchesQuerySchema = z.object({
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  isMainStock: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
export type ListBranchesQuery = z.infer<
  typeof listBranchesQuerySchema
>;
