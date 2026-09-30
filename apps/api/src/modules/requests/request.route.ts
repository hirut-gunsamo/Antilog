import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import {
  authenticate,
  authorize,
} from "../../middleware/auth.js";

import {
  createRequestController,
  getRequestsController,
  getRequestController,
  approveRequestController,
  rejectRequestController,
  cancelRequestController,
  decideRequestItemsController,
} from "./request.controller.js";

type RequestParams = {
  id: string;
};

export async function requestRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Restock requests run one level up: Sales -> Supervisor -> Owner.
  // Reads are branch-scoped in the controller; the Owner sees every branch.
  app.get<{ Querystring: Record<string, string> }>(
    "/",
    getRequestsController,
  );

  app.get<{ Params: RequestParams }>("/:id", getRequestController);

  // Anyone below the Owner raises one for their own branch.
  app.post(
    "/",
    {
      preHandler: [authorize(UserRole.SUPERVISOR, UserRole.SALES)],
    },
    createRequestController,
  );

  // Whoever the request was addressed to decides it. The service checks that
  // this viewer is that person, so a supervisor cannot decide another
  // branch's request and the Owner cannot be bypassed.
  app.patch<{ Params: RequestParams }>(
    "/:id/approve",
    {
      preHandler: [authorize(UserRole.OWNER, UserRole.SUPERVISOR)],
    },
    approveRequestController,
  );

  // A request is decided one category at a time: the items sent together.
  app.patch<{ Params: RequestParams; Body: { itemIds?: unknown; approve?: unknown } }>(
    "/:id/items/decide",
    {
      preHandler: [authorize(UserRole.OWNER, UserRole.SUPERVISOR)],
    },
    decideRequestItemsController,
  );

  app.patch<{ Params: RequestParams }>(
    "/:id/reject",
    {
      preHandler: [authorize(UserRole.OWNER, UserRole.SUPERVISOR)],
    },
    rejectRequestController,
  );

  // A supervisor may withdraw their own request while it is still pending
  app.patch<{ Params: RequestParams }>(
    "/:id/cancel",
    {
      preHandler: [
        authorize(UserRole.OWNER, UserRole.SUPERVISOR, UserRole.SALES),
      ],
    },
    cancelRequestController,
  );
}
