import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import { authenticate, authorize } from "../../middleware/auth.js";

import {
  createProductTypeController,
  deleteProductTypeController,
  getProductTypesController,
  updateProductTypeController,
} from "./productType.controller.js";

export async function productTypeRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Everyone reads them: the request and stock-in forms group by type.
  app.get("/", getProductTypesController);

  // Only the Owner decides what the business sells.
  app.post(
    "/",
    { preHandler: [authorize(UserRole.OWNER)] },
    createProductTypeController,
  );

  app.patch<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authorize(UserRole.OWNER)] },
    updateProductTypeController,
  );

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authorize(UserRole.OWNER)] },
    deleteProductTypeController,
  );
}
