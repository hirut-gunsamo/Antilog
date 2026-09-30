import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import {
  authenticate,
  authorize,
} from "../../middleware/auth.js";

import {
  createSaleController,
  getSalesController,
  getSaleController,
  submitSaleController,
  approveSaleController,
  rejectSaleController,
  deleteSaleController,
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
