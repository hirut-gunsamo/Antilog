import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import { authenticate, authorize } from "../../middleware/auth.js";

import {
  blanksController,
  deleteBlanksController,
  updateBlanksController,
  createRecordController,
  deleteRecordController,
  listRecordsController,
  receiveBlanksController,
  summaryController,
  updateRecordController,
} from "./nationalId.controller.js";

export async function nationalIdRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Branch-scoped in the service rather than by role: a salesperson sees their
  // branch's records, the Owner sees every branch.
  app.get("/", listRecordsController);

  // The dashboard figures: today, this week, this month, and by branch.
  app.get("/summary", summaryController);

  // Anyone who does the printing records it.
  app.post("/", createRecordController);

  // Blank ID card stock. What is left is derived from these arrivals minus
  // the print work above, so the two can never disagree.
  app.get("/blanks", blanksController);
  app.post("/blanks", receiveBlanksController);
  // The Owner corrects or removes an arrival typed by mistake.
  app.patch<{ Params: { id: string } }>("/blanks/:id", { preHandler: [authorize(UserRole.OWNER)] }, updateBlanksController);
  app.delete<{ Params: { id: string } }>("/blanks/:id", { preHandler: [authorize(UserRole.OWNER)] }, deleteBlanksController);

  app.patch<{ Params: { id: string } }>("/:id", updateRecordController);
  app.delete<{ Params: { id: string } }>("/:id", deleteRecordController);
}
