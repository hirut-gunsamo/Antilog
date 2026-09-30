import { z } from "zod";

// A salesperson records what they are selling. Prices come from the product
// catalogue, never from the client, so a sale cannot be under-reported.
export const createSaleSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int().positive(),

        // One ICCID per SIM card, one IMEI per phone. The service checks the
        // count against the quantity; vouchers must send none.
        //
        // Trimmed before anything else sees them: the unique index on iccid and
        // imei is what stops a handset being sold twice, and it would treat
        // "12345 " and "12345" as two different handsets. No length or digit
        // rule beyond this — the owner has not fixed a format, and guessing one
        // would refuse real sales. The array is capped so a pathological payload
        // cannot build a huge IN clause before the cheaper checks run.
        serials: z
          .array(z.string().trim().min(3).max(40))
          .max(500)
          .optional(),
      }),
    )
    .min(1, "A sale needs at least one item"),

  // The amount the customer paid, however they paid it.
  cashReceived: z.coerce.number().nonnegative(),

  // Cash, or a bank transfer, which names the bank it went to. Sales queued
  // offline before this existed send neither and are cash.
  paymentMethod: z.enum(["CASH", "TRANSFER"]).default("CASH"),
  bankName: z.string().trim().min(1).max(80).optional(),

  customerNote: z.string().max(500).optional(),
}).refine((sale) => sale.paymentMethod === "CASH" || Boolean(sale.bankName), {
  message: "Choose the bank the transfer went to",
  path: ["bankName"],
});

export const rejectSaleSchema = z.object({
  rejectionReason: z.string().min(1).max(500),
});

export const listSalesQuerySchema = z.object({
  status: z
    .enum(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"])
    .optional(),
  branchId: z.string().min(1).optional(),
  salespersonId: z.string().min(1).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;
