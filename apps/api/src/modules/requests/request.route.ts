import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import {
  authenticate,
  authorize,
} from "../../middleware/auth.js";

import {
  createRequestController,
  updateRequestController,
  getRequestsController,
  getRequestController,
  approveRequestController,
  rejectRequestController,
  cancelRequestController,
  deleteRequestController,
  decideRequestItemsController,
  receiveIssueController,
  shipRequestsController,
  approveQuantitiesController,
  requestSourcesController,
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

  // Branches a supervisor can ask for stock directly.
  app.get(
    "/sources",
    { preHandler: [authorize(UserRole.SUPERVISOR)] },
    requestSourcesController,
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

  // The requester corrects a request nobody has decided yet.
  app.put<{ Params: RequestParams }>(
    "/:id",
    { preHandler: [authorize(UserRole.SUPERVISOR, UserRole.SALES)] },
    updateRequestController,
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

  // The Owner approves how many of each item go, without sending yet.
  app.patch<{ Params: RequestParams }>(
    "/:id/approve-quantities",
    { preHandler: [authorize(UserRole.OWNER)] },
    approveQuantitiesController,
  );

  // One car for a branch: its decided requests go out as one shipment.
  app.post(
    "/ship",
    { preHandler: [authorize(UserRole.OWNER)] },
    shipRequestsController,
  );

  // A salesperson confirms the goods issued to them are in their hands.
  app.patch<{ Params: RequestParams }>(
    "/:id/receive",
    {
      preHandler: [authorize(UserRole.SALES)],
    },
    receiveIssueController,
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

  // The Owner deletes any request; anyone else their own untouched pending
  // one. The service enforces which.
  app.delete<{ Params: RequestParams }>("/:id", deleteRequestController);
}
