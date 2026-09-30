import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import {
  authenticate,
  authorize,
} from "../../middleware/auth.js";

import {
  createBranchController,
  getBranchesController,
  getBranchController,
  updateBranchController,
  changeBranchStatusController,
  setMainStockController,
  deleteBranchController,
} from "./branch.controller.js";

type BranchParams = {
  id: string;
};

export async function branchRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Any signed-in user may list branches: Sales and Supervisors need them for
  // request destinations and stock views. Filter with ?isActive=&isMainStock=
  app.get<{ Querystring: Record<string, string> }>(
    "/",
    getBranchesController,
  );

  app.get<{ Params: BranchParams }>(
    "/:id",
    getBranchController,
  );

  // Everything below changes the branch structure - Owner only.
  app.post(
    "/",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    createBranchController,
  );

  app.patch<{ Params: BranchParams }>(
    "/:id",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    updateBranchController,
  );

  // Close / reopen a branch
  app.patch<{ Params: BranchParams }>(
    "/:id/status",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    changeBranchStatusController,
  );

  // Designate (or clear) a branch as a main stock source
  app.patch<{ Params: BranchParams }>(
    "/:id/main-stock",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    setMainStockController,
  );

  // Delete a branch that has never been used
  app.delete<{ Params: BranchParams }>(
    "/:id",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    deleteBranchController,
  );
}
