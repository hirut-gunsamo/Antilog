import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import { authenticate, authorize } from "../../middleware/auth.js";

import {
  approveLossController,
  listLossController,
  rejectLossController,
  reportLossController,
} from "./stockLoss.controller.js";

export async function stockLossRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Reads are branch-scoped in the service rather than by role: a salesperson
  // sees their branch's reports, the Owner sees every branch.
  app.get("/", listLossController);

  // Anyone who handles stock can report damage or loss — that is the point.
  // The control is that they cannot sign their own report off.
  // Branches report losses; the Owner reviews them rather than filing them.
  app.post(
    "/",
    { preHandler: [authorize(UserRole.SUPERVISOR, UserRole.SALES)] },
    reportLossController,
  );

  app.patch<{ Params: { id: string } }>(
    "/:id/approve",
    { preHandler: [authorize(UserRole.SUPERVISOR, UserRole.OWNER)] },
    approveLossController,
  );

  app.patch<{ Params: { id: string } }>(
    "/:id/reject",
    { preHandler: [authorize(UserRole.SUPERVISOR, UserRole.OWNER)] },
    rejectLossController,
  );
}
