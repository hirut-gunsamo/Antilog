import { z } from "zod";

/**
 * How a customer paid for a National ID order or a Telebirr entry: the same
 * three ways as a sale. Only the transfer part is sent; the rest is cash.
 */
export const paymentFields = {
  paymentMethod: z.enum(["CASH", "TRANSFER", "MIXED"]).default("CASH"),
  // Cash + Transfer only: the part that went to the bank.
  transferAmount: z.coerce.number().min(0).max(1_000_000_000).optional(),
  bankName: z.string().trim().min(1).max(80).optional(),
};

export type PaymentInput = {
  paymentMethod: "CASH" | "TRANSFER" | "MIXED";
  transferAmount?: number;
  bankName?: string;
};

/** The columns to save for a payment of `amount`, or throws PAYMENT_INVALID. */
export function paymentColumns(input: PaymentInput, amount: number) {
  if (input.paymentMethod === "CASH") {
    return { paymentMethod: "CASH", transferAmount: 0, bankName: null };
  }

  if (!input.bankName) throw new Error("PAYMENT_INVALID");

  if (input.paymentMethod === "TRANSFER") {
    return { paymentMethod: "TRANSFER", transferAmount: amount, bankName: input.bankName };
  }

  // Cash + Transfer: some of each, so neither part may be the whole.
  const transfer = input.transferAmount ?? 0;
  if (!(transfer > 0 && transfer < amount)) throw new Error("PAYMENT_INVALID");
  return { paymentMethod: "MIXED", transferAmount: transfer, bankName: input.bankName };
}
