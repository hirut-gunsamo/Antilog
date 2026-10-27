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
    .default([]),

  // How many SIM transfers were done in this sale, at the Owner's fixed
  // price. A service, not stock; the details live in Ethio telecom's system.
  simTransferCount: z.coerce.number().int().min(0).max(10_000).default(0),

  // Bills the customer paid through this sale (WiFi, electricity, water...).
  // Money taken, not stock.
  bills: z
    .array(
      z.object({
        type: z.string().trim().min(1).max(40),
        amount: z.coerce.number().positive().max(10_000_000),
        account: z.string().trim().max(60).optional(),
      }),
    )
    .max(50)
    .default([]),

  // The amount the customer paid, however they paid it. For MIXED it is the
  // cash part only, and transferReceived is the part sent to the bank.
  cashReceived: z.coerce.number().nonnegative(),
  transferReceived: z.coerce.number().nonnegative().optional(),

  // Cash, a bank transfer (which names the bank it went to), or some of each.
  // Sales queued offline before this existed send neither and are cash.
  paymentMethod: z.enum(["CASH", "TRANSFER", "MIXED"]).default("CASH"),
  bankName: z.string().trim().min(1).max(80).optional(),

  customerNote: z.string().max(500).optional(),
}).refine((sale) => sale.items.length + sale.simTransferCount + sale.bills.length > 0, {
  message: "A sale needs at least one item, SIM transfer or bill",
  path: ["items"],
}).refine((sale) => sale.paymentMethod === "CASH" || Boolean(sale.bankName), {
  message: "Choose the bank the transfer went to",
  path: ["bankName"],
}).refine(
  (sale) =>
    sale.paymentMethod !== "MIXED" ||
    (sale.cashReceived > 0 && (sale.transferReceived ?? 0) > 0),
  {
    message: "Enter both the cash and the transfer amount",
    path: ["transferReceived"],
  },
);

// How a sale was really paid, as the salesperson corrects it.
export const paymentFixSchema = z
  .object({
    paymentMethod: z.enum(["CASH", "TRANSFER", "MIXED"]),
    cashReceived: z.coerce.number().min(0).max(100_000_000).default(0),
    transferReceived: z.coerce.number().min(0).max(100_000_000).default(0),
    bankName: z.string().trim().min(1).max(80).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .refine((fix) => fix.paymentMethod === "CASH" || Boolean(fix.bankName), {
    message: "Choose the bank the transfer went to",
    path: ["bankName"],
  })
  .refine((fix) => fix.paymentMethod !== "TRANSFER" || fix.transferReceived > 0, {
    message: "Enter the transfer amount",
    path: ["transferReceived"],
  })
  .refine((fix) => fix.paymentMethod !== "MIXED" || (fix.cashReceived > 0 && fix.transferReceived > 0), {
    message: "Enter both the cash and the transfer amount",
    path: ["transferReceived"],
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
  // Only the newest few, for a dashboard that shows a short list.
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;
