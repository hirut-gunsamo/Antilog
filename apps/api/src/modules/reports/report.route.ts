import type { FastifyInstance } from "fastify";

import { UserRole } from "database";

import { authenticate, authorize, loadViewer } from "../../middleware/auth.js";
import { getProfitAndLoss } from "./profit.service.js";
import { getBankReport, getDailyMoney, getOtherDaily, getPersonReport, openingBalances, branchYadereBefore, getSoldUnits } from "./report.service.js";

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

  // Profit and loss: the Owner only. ?from=YYYY-MM-DD &to= &branchId=
  app.get<{ Querystring: { from?: string; to?: string; branchId?: string } }>(
    "/profit",
    { preHandler: [authorize(UserRole.OWNER)] },
    async (request, reply) => {
      const day = /^\d{4}-\d{2}-\d{2}$/;
      const { from, to, branchId } = request.query;
      if ((from && !day.test(from)) || (to && !day.test(to))) {
        return reply.status(400).send({ message: "Use YYYY-MM-DD dates" });
      }
      return reply.send({ report: await getProfitAndLoss({ from, to, branchId }) });
    },
  );

  // Each phone and SIM card sold, with its IMEI or ICCID. Scoped like sales:
  // the Owner every branch, a supervisor theirs. ?from= &to= &branchId=
  app.get<{ Querystring: { from?: string; to?: string; branchId?: string } }>(
    "/sold-units",
    async (request, reply) => {
      const viewer = await loadViewer(request);
      if (!viewer) return reply.status(403).send({ message: "User account is inactive" });
      const { from, to, branchId } = request.query;
      return reply.send({ units: await getSoldUnits({ from, to, branchId }, viewer) });
    },
  );

  // The money each branch took each day: item sales,
  // National ID and Telebirr, each split into cash and transfer. ?from= &to= &branchId=
  app.get<{ Querystring: { from?: string; to?: string; branchId?: string } }>(
    "/daily-money",
    async (request, reply) => {
      const viewer = await loadViewer(request);
      if (!viewer) return reply.status(403).send({ message: "User account is inactive" });
      const { from, to, branchId } = request.query;
      return reply.send({ days: await getDailyMoney({ from, to, branchId }, viewer) });
    },
  );

  // Money credited to each bank, by person: deposits and customer
  // transfers. ?from= &to= &branchId=
  app.get<{ Querystring: { from?: string; to?: string; branchId?: string } }>(
    "/banks",
    async (request, reply) => {
      const viewer = await loadViewer(request);
      if (!viewer) return reply.status(403).send({ message: "User account is inactive" });
      const { from, to, branchId } = request.query;
      return reply.send(await getBankReport({ from, to, branchId }, viewer));
    },
  );

  // One person's sales item by item, and their deductions, expenses, losses
  // and deposits. ?userId= &from= &to=
  app.get<{ Querystring: { userId?: string; from?: string; to?: string } }>(
    "/person",
    async (request, reply) => {
      const viewer = await loadViewer(request);
      if (!viewer) return reply.status(403).send({ message: "User account is inactive" });
      const { userId, from, to } = request.query;
      if (!userId && viewer.role !== "SALES") return reply.status(400).send({ message: "Choose the salesperson" });
      try {
        return reply.send(await getPersonReport({ userId: userId ?? viewer.userId, from, to }, viewer));
      } catch (error) {
        if (error instanceof Error && error.message === "PERSON_NOT_FOUND") {
          return reply.status(404).send({ message: "That person is not in your branch" });
        }
        throw error;
      }
    },
  );

  // National ID and Telebirr per person per day, for the day of sales.
  // ?from= &to=
  app.get<{ Querystring: { from?: string; to?: string; branchId?: string } }>("/other-daily", async (request, reply) => {
    const viewer = await loadViewer(request);
    if (!viewer) return reply.status(403).send({ message: "User account is inactive" });
    // Cash each person already held before the first day (yadere brought
    // forward), so a day's yadere carries on from the day before.
    const opening = request.query.from
      ? Object.fromEntries(await openingBalances(request.query.from, viewer, { branchId: request.query.branchId }))
      : {};
    const { days, branchDeposits, branchYadereDaily } = await getOtherDaily(request.query, viewer);
    // Each branch's yadere when the first day began.
    const branchOpening = request.query.from ? await branchYadereBefore(request.query.from, viewer, request.query.branchId) : {};
    return reply.send({ days, opening, branchDeposits, branchYadereDaily, branchOpening });
  });

  // Stock remaining per branch. ?format=csv
  app.get<{ Querystring: Record<string, string> }>(
    "/inventory",
    inventoryReportController,
  );
}
