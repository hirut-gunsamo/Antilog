import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import {
  authenticate,
  authorize,
} from "../../middleware/auth.js";

import {
  createUserController,
  getOwnProfileController,
  updateOwnProfileController,
  changeOwnPasswordController,
  getUsersController,
  getUsersByBranchController,
  getUserController,
  updateUserController,
  changeUserStatusController,
  moveUserToBranchController,
  replaceSupervisorController,
  deleteUserController,
} from "./user.controller.js";

type UserParams = {
  id: string;
};

type BranchParams = {
  branchId: string;
};

export async function userRoutes(app: FastifyInstance) {
  // All routes in this module require authentication
  app.addHook("preHandler", authenticate);

  // --- Self-service: every signed-in user manages their own login ----------
  // Registered before "/:id" for readability; Fastify matches static paths
  // ahead of parametric ones regardless of order.

  app.get("/me", getOwnProfileController);

  // Edit your own name / email (your username)
  app.patch("/me", updateOwnProfileController);

  // Change your own password, proving the current one
  app.patch("/me/password", changeOwnPasswordController);

  // --- Owner / Supervisor --------------------------------------------------

  // List users, optionally filtered by ?branchId=&role=&isActive=
  // Owner sees every branch; a Supervisor is scoped to their own branch.
  app.get<{ Querystring: Record<string, string> }>(
    "/",
    {
      preHandler: [
        authorize(UserRole.OWNER, UserRole.SUPERVISOR),
      ],
    },
    getUsersController,
  );

  // Branch overview: each branch with its supervisor and sales staff - Owner only
  app.get(
    "/by-branch",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    getUsersByBranchController,
  );

  // Get one user - Owner only
  app.get<{ Params: UserParams }>(
    "/:id",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    getUserController,
  );

  // Create Supervisor or Sales user on a branch - Owner only
  app.post(
    "/",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    createUserController,
  );

  // Edit name / email / password - Owner only
  app.patch<{ Params: UserParams }>(
    "/:id",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    updateUserController,
  );

  // Activate / deactivate user - Owner only
  app.patch<{ Params: UserParams }>(
    "/:id/status",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    changeUserStatusController,
  );

  // Move a Sales or Supervisor user to another branch - Owner only
  app.patch<{ Params: UserParams }>(
    "/:id/branch",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    moveUserToBranchController,
  );

  // Replace a branch's supervisor atomically - Owner only
  app.patch<{ Params: BranchParams }>(
    "/branches/:branchId/supervisor",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    replaceSupervisorController,
  );

  // Delete a user that has no business records - Owner only
  app.delete<{ Params: UserParams }>(
    "/:id",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    deleteUserController,
  );
}
