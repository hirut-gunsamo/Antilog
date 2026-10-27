import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import { authenticate, authorize } from "../../middleware/auth.js";

import {
  createAssetController,
  deleteAssetController,
  getAssetsController,
  updateAssetController,
  sendAssetController,
} from "./asset.controller.js";

type AssetParams = { id: string };

export async function assetRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Branch-scoped in the service: a supervisor sees their own branch's
  // equipment, the Owner every branch's.
  app.get<{ Querystring: Record<string, string> }>(
    "/",
    { preHandler: [authorize(UserRole.OWNER, UserRole.SUPERVISOR)] },
    getAssetsController,
  );

  // The Owner buys and ships equipment, so the Owner records it.
  app.post(
    "/",
    { preHandler: [authorize(UserRole.OWNER)] },
    createAssetController,
  );

  // A supervisor may mark their own branch's equipment as damaged or retired;
  // the service refuses anything belonging to another branch.
  app.patch<{ Params: AssetParams }>(
    "/:id",
    { preHandler: [authorize(UserRole.OWNER, UserRole.SUPERVISOR)] },
    updateAssetController,
  );

  app.delete<{ Params: AssetParams }>(
    "/:id",
    { preHandler: [authorize(UserRole.OWNER)] },
    deleteAssetController,
  );

  // Equipment sent to a branch, with the stock it goes with.
  app.post<{ Params: AssetParams }>(
    "/:id/send",
    { preHandler: [authorize(UserRole.OWNER)] },
    sendAssetController,
  );
}
