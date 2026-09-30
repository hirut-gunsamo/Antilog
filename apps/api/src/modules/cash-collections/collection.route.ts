import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import { authenticate, authorize } from "../../middleware/auth.js";

import {
  collectCashController,
  getCollectionsController,
  getTeamCashController,
} from "./collection.controller.js";

export async function collectionRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Handovers, scoped in the service: a seller sees their own, a supervisor
  // what they collected, the Owner any branch.
  app.get<{ Querystring: Record<string, string> }>(
    "/",
    getCollectionsController,
  );

  // Who in the branch is still holding cash, largest first.
  app.get("/team", getTeamCashController);

  app.post(
    "/",
    { preHandler: [authorize(UserRole.SUPERVISOR)] },
    collectCashController,
  );
}
