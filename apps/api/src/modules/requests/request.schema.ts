import { z } from "zod";

// A restock request: a supervisor telling the Owner their branch is running
// low. Quantities only - the Owner decides which branch fulfils it.
export const createRequestSchema = z.object({
  // What the request is for. A salesperson asks for goods to sell (ISSUE) in
  // the morning and hands back what is left (RETURN) at night; a supervisor
  // asks the Owner to restock the branch. Left out, each role gets its own
  // usual kind.
  kind: z.enum(["RESTOCK", "ISSUE", "RETURN"]).optional(),

  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int().positive(),
      }),
    )
    .min(1, "A request needs at least one item"),

  notes: z.string().max(500).optional(),
});

// The Owner approves and names the branch the stock will ship from.
//
// `items` lets the reviewer approve less than was asked for, line by line
// (50 requested, 40 approved). A line left out is approved in full, so a
// plain approval still needs no item list. 0 declines that line.
export const approveRequestSchema = z.object({
  sourceBranchId: z.string().min(1).optional(),
  notes: z.string().max(500).optional(),

  // Who is carrying it. Required for a branch restock, where goods travel by
  // road; a salesperson's issue or return never leaves the office, so these
  // are not asked for there.
  driverName: z.string().trim().min(2).max(120).optional(),
  driverPhone: z
    .string()
    .trim()
    .min(7, "A phone number needs at least 7 digits")
    .max(24)
    .regex(/^[+()\d][\d\s()+-]*$/, "Use digits, spaces, and + ( ) - only")
    .optional(),
  vehiclePlate: z.string().trim().min(2).max(40).optional(),
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        approvedQuantity: z.coerce.number().int().min(0),
      }),
    )
    .optional(),
});

export const rejectRequestSchema = z.object({
  rejectionReason: z.string().min(1).max(500),
});

export const listRequestsQuerySchema = z.object({
  kind: z.enum(["RESTOCK", "ISSUE", "RETURN"]).optional(),
  status: z
    .enum([
      "PENDING",
      "APPROVED",
      "REJECTED",
      "FULFILLED",
      "CANCELLED",
    ])
    .optional(),
  branchId: z.string().min(1).optional(),
});

export type CreateRequestInput = z.infer<
  typeof createRequestSchema
>;
export type ApproveRequestInput = z.infer<
  typeof approveRequestSchema
>;
export type ListRequestsQuery = z.infer<
  typeof listRequestsQuerySchema
>;
