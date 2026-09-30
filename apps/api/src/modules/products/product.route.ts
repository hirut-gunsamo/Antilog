import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import {
  authenticate,
  authorize,
} from "../../middleware/auth.js";

import {
  createProductController,
  getProductsController,
  getProductController,
  updateProductController,
  deleteProductController,
} from "./product.controller.js";

type ProductParams = {
  id: string;
};

export async function productRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // All logged-in users can view products
  app.get("/", getProductsController);

  app.get<{ Params: ProductParams }>(
    "/:id",
    getProductController,
  );

  // Owner controls product definitions
  app.post(
    "/",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    createProductController,
  );

  app.patch<{ Params: ProductParams }>(
    "/:id",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    updateProductController,
  );

  app.delete<{ Params: ProductParams }>(
    "/:id",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    deleteProductController,
  );
}