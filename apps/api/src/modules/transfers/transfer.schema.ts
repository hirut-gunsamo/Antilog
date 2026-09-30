import { z } from "zod";

export const shipTransferSchema = z.object({
  notes: z.string().max(500).optional(),
});

export const receiveTransferSchema = z.object({
  notes: z.string().max(500).optional(),
});

export const cancelTransferSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const listTransfersQuerySchema = z.object({
  status: z
    .enum(["PENDING", "IN_TRANSIT", "RECEIVED", "CANCELLED"])
    .optional(),
  branchId: z.string().min(1).optional(),
});

export type ListTransfersQuery = z.infer<
  typeof listTransfersQuerySchema
>;

export const createTransferSchema = z.object({
  fromLocationId: z.string().min(1),
  toLocationId: z.string().min(1),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int().positive(),
      }),
    )
    .min(1),
  driverName: z.string().trim().min(2).max(120),
  driverPhone: z
    .string()
    .trim()
    .min(7, "A phone number needs at least 7 digits")
    .max(24)
    .regex(/^[+()\d][\d\s()+-]*$/, "Use digits, spaces, and + ( ) - only"),
  vehiclePlate: z.string().trim().min(2).max(40),
  notes: z.string().max(500).optional(),
});
