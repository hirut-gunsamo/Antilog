import type { FastifyInstance } from "fastify";
import { decideReceiptEdit, listReceiptEditRequests, requestReceiptEdit } from "./receipt.service.js";
import { sellerCashDay } from "./receipt.service.js";
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
  updateReceiptController,
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

  // A salesperson's cash still to bank for one sales day: what customers paid
  // in cash, less deductions, expenses and what they already banked. The
  // upload form fills its amount from this.
  app.get<{ Querystring: { date?: string } }>(
    "/my-day",
    { preHandler: [authorize(UserRole.SALES)] },
    async (request, reply) => {
      const date = request.query.date ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.status(400).send({ message: "Choose the day" });
      const { cash, banked } = await sellerCashDay(request.user.userId, date);
      const toBank = Math.max(0, Math.round((cash - banked) * 100) / 100);
      return reply.send({ cash, banked, toBank });
    },
  );

  app.get<{ Params: ReceiptParams }>(
    "/:id",
    getReceiptController,
  );

  // multipart/form-data: the image plus amount, receiptDate, bankName,
  // referenceNumber and an optional cashReportId.
  //
  // Salespeople bank their own takings and upload the slip; the supervisor
  // verifies it, and only then does it count as banked. Supervisors may
  // still bank cash themselves.
  app.post(
    "/",
    {
      preHandler: [
        authorize(UserRole.SALES, UserRole.SUPERVISOR, UserRole.OWNER),
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

  // The uploader corrects a slip that has not been verified yet.
  // A checked receipt is reopened for 24 hours: the uploader asks, the Owner
  // allows (or declines) from the edit requests on the Reports page.
  app.get(
    "/edit-requests",
    { preHandler: [authorize(UserRole.OWNER)] },
    async (_request, reply) => reply.send({ requests: await listReceiptEditRequests() }),
  );
  app.post<{ Params: ReceiptParams }>("/:id/request-edit", async (request, reply) => {
    try {
      return reply.send(await requestReceiptEdit(request.params.id, { userId: request.user.userId } as never));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "NOT_YOUR_RECEIPT") return reply.status(403).send({ message: "You can only change slips you uploaded" });
      if (message === "RECEIPT_NOT_FOUND") return reply.status(404).send({ message: "Receipt not found" });
      throw error;
    }
  });
  app.post<{ Params: ReceiptParams; Body: { allow?: boolean } }>(
    "/:id/decide-edit",
    { preHandler: [authorize(UserRole.OWNER)] },
    async (request, reply) => {
      try {
        await decideReceiptEdit(request.params.id, request.body?.allow !== false);
        return reply.send({ message: request.body?.allow === false ? "Declined" : "Allowed for 24 hours" });
      } catch {
        return reply.status(404).send({ message: "Receipt not found" });
      }
    },
  );

  app.patch<{ Params: ReceiptParams }>("/:id", updateReceiptController);

  app.delete<{ Params: ReceiptParams }>(
    "/:id",
    deleteReceiptController,
  );
}
