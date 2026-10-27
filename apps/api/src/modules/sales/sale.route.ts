import type { FastifyInstance } from "fastify";
import {
  declineEditRequest,
  decidePaymentFix,
  listEditRequests,
  listPaymentFixes,
  requestPaymentFix,
  requestPaymentEdit,
  paymentEditStatus,
  listPaymentEditRequests,
  decidePaymentEdit,
  updateSalePayment,
} from "./sale.service.js";
import { paymentFixSchema } from "./sale.schema.js";
import { UserRole } from "database";

import {
  authenticate,
  authorize,
  loadViewer,
} from "../../middleware/auth.js";

import {
  createSaleController,
  getSalesController,
  getSaleController,
  submitSaleController,
  approveSaleController,
  rejectSaleController,
  deleteSaleController,
  updateSaleController,
  allowSaleEditsController,
  requestSaleEditController,
  dayTotalsController,
  requestDayEditController,
} from "./sale.controller.js";

type SaleParams = {
  id: string;
};

export async function saleRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Sales see their own, Supervisors their branch, the Owner everything.
  // The narrowing happens in the controller.
  app.get<{ Querystring: Record<string, string> }>(
    "/",
    getSalesController,
  );

  app.get<{ Params: SaleParams }>(
    "/:id",
    getSaleController,
  );

  // A salesperson records a sale against their own branch's stock
  app.post(
    "/",
    {
      preHandler: [authorize(UserRole.SALES)],
    },
    createSaleController,
  );

  // ... and sends it to their supervisor for approval
  app.patch<{ Params: SaleParams }>(
    "/:id/submit",
    {
      preHandler: [authorize(UserRole.SALES)],
    },
    submitSaleController,
  );

  // Approval deducts branch stock and marks sold SIMs and phones SOLD
  app.patch<{ Params: SaleParams }>(
    "/:id/approve",
    {
      preHandler: [
        authorize(UserRole.SUPERVISOR, UserRole.OWNER),
      ],
    },
    approveSaleController,
  );

  app.patch<{ Params: SaleParams }>(
    "/:id/reject",
    {
      preHandler: [
        authorize(UserRole.SUPERVISOR, UserRole.OWNER),
      ],
    },
    rejectSaleController,
  );

  // A salesperson corrects their own sale: on its day, or while the Owner
  // allows it.
  app.put<{ Params: SaleParams }>(
    "/:id",
    { preHandler: [authorize(UserRole.SALES)] },
    updateSaleController,
  );

  // A salesperson asks the Owner to allow a correction of a past day's sale.
  app.post<{ Params: SaleParams }>(
    "/:id/request-edit",
    { preHandler: [authorize(UserRole.SALES)] },
    requestSaleEditController,
  );

  // A salesperson corrects how a sale was paid; the Owner approves it.
  app.post<{ Params: SaleParams }>(
    "/:id/payment-fix",
    { preHandler: [authorize(UserRole.SALES)] },
    async (request, reply) => {
      const parsed = paymentFixSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.issues[0]?.message ?? "Invalid payment" });
      }
      const viewer = await loadViewer(request);
      if (!viewer) return reply.status(401).send({ message: "Not signed in" });
      try {
        return reply.send({ sale: await requestPaymentFix(request.params.id, parsed.data, viewer) });
      } catch {
        return reply.status(404).send({ message: "Sale not found" });
      }
    },
  );
  // A day's payments, opened by the Owner for 24 hours on request.
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  app.post<{ Body: { day?: string } }>(
    "/request-payment-edit",
    { preHandler: [authorize(UserRole.SALES)] },
    async (request, reply) => {
      const day = request.body?.day;
      if (!day || !DAY.test(day)) return reply.status(400).send({ message: "Choose the day" });
      const viewer = await loadViewer(request);
      if (!viewer) return reply.status(401).send({ message: "Not signed in" });
      return reply.send({ grant: await requestPaymentEdit(day, viewer) });
    },
  );
  app.get<{ Querystring: { day?: string } }>(
    "/payment-edit-status",
    { preHandler: [authorize(UserRole.SALES)] },
    async (request, reply) => {
      const day = request.query.day;
      if (!day || !DAY.test(day)) return reply.status(400).send({ message: "Choose the day" });
      const viewer = await loadViewer(request);
      if (!viewer) return reply.status(401).send({ message: "Not signed in" });
      return reply.send({ grant: await paymentEditStatus(day, viewer) });
    },
  );
  app.get("/payment-edit-requests", { preHandler: [authorize(UserRole.OWNER)] }, async (_request, reply) =>
    reply.send({ requests: await listPaymentEditRequests() }),
  );
  app.post<{ Body: { salespersonId?: string; day?: string; allow?: boolean } }>(
    "/payment-edit/decide",
    { preHandler: [authorize(UserRole.OWNER)] },
    async (request, reply) => {
      const { salespersonId, day, allow } = request.body ?? {};
      if (!salespersonId || !day || !DAY.test(day)) return reply.status(400).send({ message: "Choose the salesperson and day" });
      try {
        return reply.send({ grant: await decidePaymentEdit({ salespersonId, day, allow: allow === true }) });
      } catch {
        return reply.status(404).send({ message: "Nothing to decide for that day" });
      }
    },
  );
  app.patch<{ Params: SaleParams }>(
    "/:id/payment",
    { preHandler: [authorize(UserRole.SALES)] },
    async (request, reply) => {
      const parsed = paymentFixSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ message: parsed.error.issues[0]?.message ?? "Invalid payment" });
      }
      const viewer = await loadViewer(request);
      if (!viewer) return reply.status(401).send({ message: "Not signed in" });
      try {
        return reply.send({ sale: await updateSalePayment(request.params.id, parsed.data, viewer) });
      } catch (caught) {
        if (caught instanceof Error && caught.message === "EDIT_LOCKED") {
          return reply.status(403).send({ message: "Ask the Owner to open this day's payments first" });
        }
        return reply.status(404).send({ message: "Sale not found" });
      }
    },
  );

  app.get("/payment-fixes", { preHandler: [authorize(UserRole.OWNER)] }, async (_request, reply) =>
    reply.send({ fixes: await listPaymentFixes() }),
  );
  app.post<{ Params: SaleParams; Body: { allow?: boolean } }>(
    "/:id/payment-fix/decide",
    { preHandler: [authorize(UserRole.OWNER)] },
    async (request, reply) => {
      try {
        return reply.send({ sale: await decidePaymentFix(request.params.id, request.body?.allow === true) });
      } catch {
        return reply.status(404).send({ message: "Nothing to decide on this sale" });
      }
    },
  );

  // The Owner's list of days waiting to be opened, and turning one down.
  app.get("/edit-requests", { preHandler: [authorize(UserRole.OWNER)] }, async (_request, reply) =>
    reply.send({ requests: await listEditRequests() }),
  );
  app.post<{ Body: { salespersonId?: string; day?: string } }>(
    "/decline-edit",
    { preHandler: [authorize(UserRole.OWNER)] },
    async (request, reply) => {
      const { salespersonId, day } = request.body ?? {};
      if (!salespersonId || !day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        return reply.status(400).send({ message: "Choose the salesperson and day" });
      }
      await declineEditRequest({ salespersonId, day });
      return reply.send({ message: "Declined" });
    },
  );

  // A salesperson corrects a day by its totals (SIM cards, airtime values,
  // SIM transfers); phones are corrected sale by sale.
  app.put<{ Body: { day?: string; totals?: { productId: string; quantity: number }[] } }>(
    "/day-totals",
    { preHandler: [authorize(UserRole.SALES)] },
    dayTotalsController,
  );

  // A salesperson asks the Owner to open a whole past day for correcting.
  app.post<{ Body: { day?: string } }>(
    "/request-day-edit",
    { preHandler: [authorize(UserRole.SALES)] },
    requestDayEditController,
  );

  // The Owner lets a salesperson correct a past day's sales, until tonight.
  app.post<{ Body: { salespersonId?: string; day?: string } }>(
    "/allow-edits",
    { preHandler: [authorize(UserRole.OWNER)] },
    allowSaleEditsController,
  );

  // Only an unsubmitted draft can be removed
  app.delete<{ Params: SaleParams }>(
    "/:id",
    {
      preHandler: [
        authorize(UserRole.SALES, UserRole.OWNER),
      ],
    },
    deleteSaleController,
  );
}
