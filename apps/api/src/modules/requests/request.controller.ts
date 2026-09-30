import type {
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { loadViewer } from "../../middleware/auth.js";

import {
  createRequestSchema,
  approveRequestSchema,
  rejectRequestSchema,
  listRequestsQuerySchema,
} from "./request.schema.js";

import {
  createRequest,
  getRequests,
  getRequestById,
  approveRequest,
  rejectRequest,
  cancelRequest,
  decideRequestItems,
} from "./request.service.js";

type RequestParams = {
  id: string;
};

type Shortage = {
  productId: string;
  requested: number;
  available: number;
};

function handleRequestError(
  error: unknown,
  reply: FastifyReply,
): FastifyReply | null {
  if (!(error instanceof Error)) {
    return null;
  }

  switch (error.message) {
    case "SOURCE_REQUIRED":
      return reply.status(400).send({
        message: "Name the branch the stock ships from",
      });

    case "DRIVER_REQUIRED":
      return reply.status(400).send({
        message:
          "Name the driver, their phone number and the vehicle plate",
      });

    case "NOT_THE_ADDRESSEE":
      return reply.status(403).send({
        message: "This request was not addressed to you",
      });

    case "OWNER_CANNOT_REQUEST":
      return reply.status(403).send({
        message:
          "The Owner receives restock requests rather than raising them",
      });

    case "NO_BRANCH_SUPERVISOR":
      return reply.status(409).send({
        message: "Your branch has no active supervisor to receive this request",
      });

    case "NO_BRANCH":
      return reply.status(400).send({
        message: "You are not assigned to a branch",
      });

    case "NO_ACTIVE_OWNER":
      return reply.status(409).send({
        message: "There is no active Owner to receive this request",
      });

    case "INVALID_PRODUCT":
      return reply.status(400).send({
        message: "One or more products are unknown or inactive",
      });

    case "UNKNOWN_REQUEST_ITEM":
      return reply.status(400).send({
        message: "One or more lines do not belong to this request",
      });

    case "APPROVED_EXCEEDS_REQUESTED":
      return reply.status(400).send({
        message: "You cannot approve more than was requested",
      });

    case "NOTHING_APPROVED":
      return reply.status(400).send({
        message:
          "Approve at least one unit, or reject the request with a reason",
      });

    case "KIND_NOT_ALLOWED":
      return reply.status(400).send({
        message: "That is not a request your role can raise",
      });

    case "MORE_THAN_HELD":
      return reply.status(409).send({
        message: "That is more than the salesperson is holding",
      });

    case "INSUFFICIENT_BRANCH_STOCK":
      return reply.status(409).send({
        message:
          "The branch does not have that much free to issue. Some of it is already with salespeople",
        shortages: (error as Error & { shortages?: unknown }).shortages,
      });

    case "REQUEST_NOT_FOUND":
      return reply.status(404).send({
        message: "Request not found",
      });

    case "REQUEST_NOT_PENDING":
      return reply.status(409).send({
        message: "This request has already been reviewed",
      });

    case "NOT_YOUR_REQUEST":
      return reply.status(403).send({
        message: "You can only cancel your own request",
      });

    case "SOURCE_NOT_FOUND":
      return reply.status(404).send({
        message: "Source branch not found",
      });

    case "SOURCE_INACTIVE":
      return reply.status(400).send({
        message: "The source branch is closed",
      });

    case "SAME_BRANCH":
      return reply.status(400).send({
        message:
          "A branch cannot restock from itself. Choose a different source.",
      });

    case "INSUFFICIENT_SOURCE_STOCK":
      return reply.status(409).send({
        message:
          "The source branch does not have enough stock. Approve less, or ship from another branch",
        shortages: (error as Error & { shortages?: Shortage[] })
          .shortages,
      });

    case "DECIDE_EACH_ITEM":
      return reply.status(409).send({
        message: "Approve or reject every item first",
      });

    case "ITEM_NOT_FOUND":
      return reply.status(404).send({
        message: "That item is not on this request",
      });

    case "ITEM_ALREADY_DECIDED":
      return reply.status(409).send({
        message: "This item has already been decided",
      });

    case "PARTLY_DECIDED":
      return reply.status(409).send({
        message: "Some items were already decided. Decide the rest one by one",
      });

    default:
      return null;
  }
}

async function withViewer(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const viewer = await loadViewer(request);

  if (!viewer) {
    reply.status(403).send({
      message: "User account is inactive",
    });

    return null;
  }

  return viewer;
}

export async function createRequestController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = createRequestSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid request data",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const created = await createRequest(result.data, viewer);

    return reply.status(201).send({
      message: "Restock request submitted",
      request: created,
    });
  } catch (error) {
    return (
      handleRequestError(error, reply) ?? Promise.reject(error)
    );
  }
}

export async function getRequestsController(
  request: FastifyRequest<{
    Querystring: Record<string, string>;
  }>,
  reply: FastifyReply,
) {
  const result = listRequestsQuerySchema.safeParse(request.query);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid filters",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const requests = await getRequests(result.data, viewer);

  return reply.send({ requests });
}

export async function getRequestController(
  request: FastifyRequest<{
    Params: RequestParams;
  }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const found = await getRequestById(request.params.id, viewer);

  if (!found) {
    return reply.status(404).send({
      message: "Request not found",
    });
  }

  return reply.send({ request: found });
}

export async function approveRequestController(
  request: FastifyRequest<{
    Params: RequestParams;
  }>,
  reply: FastifyReply,
) {
  const result = approveRequestSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid approval data",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const approved = await approveRequest(
      request.params.id,
      result.data,
      viewer,
    );

    // A salesperson's request is answered inside the branch, so there is no
    // transfer to announce.
    return reply.send({
      message: approved?.transfer
        ? "Request approved. A transfer is now waiting to be shipped."
        : "Request approved.",
      request: approved,
    });
  } catch (error) {
    return (
      handleRequestError(error, reply) ?? Promise.reject(error)
    );
  }
}

export async function rejectRequestController(
  request: FastifyRequest<{
    Params: RequestParams;
  }>,
  reply: FastifyReply,
) {
  const result = rejectRequestSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "A rejection reason is required",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const rejected = await rejectRequest(
      request.params.id,
      result.data.rejectionReason,
      viewer,
    );

    return reply.send({
      message: "Request rejected",
      request: rejected,
    });
  } catch (error) {
    return (
      handleRequestError(error, reply) ?? Promise.reject(error)
    );
  }
}

export async function cancelRequestController(
  request: FastifyRequest<{
    Params: RequestParams;
  }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const cancelled = await cancelRequest(
      request.params.id,
      viewer,
    );

    return reply.send({
      message: "Request cancelled",
      request: cancelled,
    });
  } catch (error) {
    return (
      handleRequestError(error, reply) ?? Promise.reject(error)
    );
  }
}

export async function decideRequestItemsController(
  request: FastifyRequest<{
    Params: RequestParams;
    Body: { itemIds?: unknown; approve?: unknown };
  }>,
  reply: FastifyReply,
) {
  const { itemIds, approve } = request.body ?? {};

  if (
    typeof approve !== "boolean" ||
    !Array.isArray(itemIds) ||
    itemIds.length === 0 ||
    itemIds.length > 200 ||
    !itemIds.every((value) => typeof value === "string")
  ) {
    return reply.status(400).send({ message: "Approve or reject the items" });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const decided = await decideRequestItems(
      request.params.id,
      itemIds as string[],
      approve,
      viewer,
    );

    return reply.send({
      message: approve ? "Approved" : "Rejected",
      request: decided,
    });
  } catch (error) {
    return (
      handleRequestError(error, reply) ?? Promise.reject(error)
    );
  }
}
