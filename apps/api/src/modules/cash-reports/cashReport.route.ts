import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import {
  authenticate,
  authorize,
} from "../../middleware/auth.js";

import {
  createCashReportController,
  getCashReportsController,
  getCashReportController,
  submitCashReportController,
  approveCashReportController,
  rejectCashReportController,
  sendToOwnerController,
} from "./cashReport.controller.js";

type ReportParams = {
  id: string;
};

export async function cashReportRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Sales see their own reports, Supervisors their branch, Owner all.
  app.get<{ Querystring: Record<string, string> }>(
    "/",
    getCashReportsController,
  );

  app.get<{ Params: ReportParams }>(
    "/:id",
    getCashReportController,
  );

  // A salesperson reconciles a period
  app.post(
    "/",
    {
      preHandler: [authorize(UserRole.SALES)],
    },
    createCashReportController,
  );

  app.patch<{ Params: ReportParams }>(
    "/:id/submit",
    {
      preHandler: [authorize(UserRole.SALES)],
    },
    submitCashReportController,
  );

  // The supervisor checks the cash against the sales
  app.patch<{ Params: ReportParams }>(
    "/:id/approve",
    {
      preHandler: [
        authorize(UserRole.SUPERVISOR, UserRole.OWNER),
      ],
    },
    approveCashReportController,
  );

  app.patch<{ Params: ReportParams }>(
    "/:id/reject",
    {
      preHandler: [
        authorize(UserRole.SUPERVISOR, UserRole.OWNER),
      ],
    },
    rejectCashReportController,
  );

  // ... then forwards it to the Owner
  app.patch<{ Params: ReportParams }>(
    "/:id/send-to-owner",
    {
      preHandler: [authorize(UserRole.SUPERVISOR)],
    },
    sendToOwnerController,
  );
}
