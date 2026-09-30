import type { FastifyInstance } from "fastify";

import { authenticate } from "../../middleware/auth.js";

import {
  salesReportController,
  cashPositionController,
  inventoryReportController,
  dashboardController,
} from "./report.controller.js";

export async function reportRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Every report is branch-scoped in the controller, so all roles may call
  // them: a Sales user sees their own figures, a Supervisor their branch,
  // the Owner every branch.

  // One call for a role's dashboard: today / week / month / year, stock and
  // outstanding cash.
  app.get("/dashboard", dashboardController);

  // ?period=daily|weekly|monthly|yearly &from= &to= &branchId= &format=csv
  app.get<{ Querystring: Record<string, string> }>(
    "/sales",
    salesReportController,
  );

  // What each salesperson sold, banked, and still holds. ?format=csv
  app.get<{ Querystring: Record<string, string> }>(
    "/cash-position",
    cashPositionController,
  );

  // Stock remaining per branch. ?format=csv
  app.get<{ Querystring: Record<string, string> }>(
    "/inventory",
    inventoryReportController,
  );
}
