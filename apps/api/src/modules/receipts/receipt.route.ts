import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import {
  authenticate,
  authorize,
} from "../../middleware/auth.js";

import {
  uploadReceiptController,
  getReceiptFileController,
  getReceiptsController,
  getReceiptController,
  getDaySummaryController,
  verifyReceiptController,
  rejectReceiptController,
  deleteReceiptController,
} from "./receipt.controller.js";

type ReceiptParams = {
  id: string;
};

export async function receiptRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Sales see their own uploads, Supervisors their branch, Owner all.
  app.get<{
    Querystring: { status?: string; branchId?: string };
  }>("/", getReceiptsController);

  // Registered before "/:id" for readability; Fastify prefers static paths.
  app.get<{ Params: { filename: string } }>(
    "/file/:filename",
    getReceiptFileController,
  );

  app.get<{ Querystring: { date?: string; branchId?: string } }>(
    "/day-summary",
    {
      preHandler: [authorize(UserRole.SUPERVISOR, UserRole.OWNER)],
    },
    getDaySummaryController,
  );

  app.get<{ Params: ReceiptParams }>(
    "/:id",
    getReceiptController,
  );

  // multipart/form-data: the image plus amount, receiptDate, bankName,
  // referenceNumber and an optional cashReportId.
  //
  // The supervisor banks the branch's takings and uploads the slip. A
  // salesperson hands their cash to the supervisor and never goes to the
  // bank, so they have no receipt to upload.
  app.post(
    "/",
    {
      preHandler: [
        authorize(UserRole.SUPERVISOR, UserRole.OWNER),
      ],
    },
    uploadReceiptController,
  );

  app.patch<{ Params: ReceiptParams; Body: { notes?: string } }>(
    "/:id/verify",
    {
      preHandler: [
        authorize(UserRole.SUPERVISOR, UserRole.OWNER),
      ],
    },
    verifyReceiptController,
  );

  app.patch<{ Params: ReceiptParams; Body: { notes?: string } }>(
    "/:id/reject",
    {
      preHandler: [
        authorize(UserRole.SUPERVISOR, UserRole.OWNER),
      ],
    },
    rejectReceiptController,
  );

  app.delete<{ Params: ReceiptParams }>(
    "/:id",
    deleteReceiptController,
  );
}
