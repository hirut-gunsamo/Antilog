import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import {
  authenticate,
  authorize,
} from "../../middleware/auth.js";

import {
  getTransfersController,
  getTransferController,
  shipTransferController,
  receiveTransferController,
  cancelTransferController,
  createTransferController,
} from "./transfer.controller.js";

type TransferParams = {
  id: string;
};

export async function transferRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // The Owner moves stock between branches; it leaves the source at once.
  app.post(
    "/",
    { preHandler: [authorize(UserRole.OWNER)] },
    createTransferController,
  );

  // Both ends of a transfer can watch it: the sending branch and the
  // receiving branch. Scoping happens in the controller.
  app.get<{ Querystring: Record<string, string> }>(
    "/",
    {
      preHandler: [
        authorize(UserRole.OWNER, UserRole.SUPERVISOR),
      ],
    },
    getTransfersController,
  );

  app.get<{ Params: TransferParams }>(
    "/:id",
    {
      preHandler: [
        authorize(UserRole.OWNER, UserRole.SUPERVISOR),
      ],
    },
    getTransferController,
  );

  // The Owner dispatches the goods: stock leaves the source branch here.
  app.patch<{ Params: TransferParams }>(
    "/:id/ship",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    shipTransferController,
  );

  // The receiving supervisor confirms what arrived: branch stock goes up
  // here and the original request is closed.
  app.patch<{ Params: TransferParams }>(
    "/:id/receive",
    {
      preHandler: [
        authorize(UserRole.OWNER, UserRole.SUPERVISOR),
      ],
    },
    receiveTransferController,
  );

  app.patch<{ Params: TransferParams }>(
    "/:id/cancel",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    cancelTransferController,
  );
}
