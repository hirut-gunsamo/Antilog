import type {
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { z } from "zod";

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
  deleteRequest,
  decideRequestItems,
  receiveIssue,
  shipRequests,
  approveQuantities,
  updateRequest,
  requestSources,
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

    case "NO_SOURCE_SUPERVISOR":
      return reply.status(409).send({
        message: "That branch has no active supervisor to send the items",
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

    case "NOT_YOUR_ISSUE":
      return reply.status(403).send({ message: "Only the person who asked can receive it" });

    case "INVALID_APPROVED_QUANTITY":
      return reply.status(400).send({ message: "Each amount must be between 0 and what was asked for" });

    case "ONE_BRANCH_PER_CAR":
      return reply.status(400).send({ message: "One car goes to one branch: send each branch on its own" });

    case "NOTHING_TO_RECEIVE":
      return reply.status(400).send({ message: "Only goods issued to you are received" });

    case "NOT_APPROVED_YET":
      return reply.status(409).send({ message: "Your supervisor has not handed this over yet" });

    case "ALREADY_RECEIVED":
      return reply.status(409).send({ message: "You have already received this" });

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

    case "REQUEST_ALREADY_DECIDED":
      return reply.status(409).send({
        message: "This request has already been decided, so it can no longer be changed",
      });

    case "NOT_YOUR_REQUEST":
      return reply.status(403).send({
        message: "You can only cancel or delete your own request",
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

    case "NOT_ENOUGH_FOR_BRANCH":
      return reply.status(409).send({
        message: "Not enough stock held for this branch. Approve less, or add stock for this branch first",
      });

    case "INSUFFICIENT_SOURCE_STOCK":
      return reply.status(409).send({
        message:
          "Not enough stock held for this branch. Approve less, or add stock for this branch first",
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
    // One request per category.
    const created = await createRequest(result.data, viewer);

    return reply.status(201).send({
      message: "Restock request submitted",
      request: created[0],
      requests: created,
    });
  } catch (error) {
    return (
      handleRequestError(error, reply) ?? Promise.reject(error)
    );
  }
}

export async function requestSourcesController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  return reply.send({ branches: await requestSources(viewer) });
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

export async function deleteRequestController(
  request: FastifyRequest<{
    Params: RequestParams;
  }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    await deleteRequest(request.params.id, viewer);

    return reply.send({ message: "Request deleted" });
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

export async function receiveIssueController(
  request: FastifyRequest<{ Params: RequestParams }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const received = await receiveIssue(request.params.id, viewer);
    return reply.send({ message: "Received", request: received });
  } catch (error) {
    return handleRequestError(error, reply) ?? Promise.reject(error);
  }
}

const shipSchema = z.object({
  requestIds: z.array(z.string().min(1)).min(1).max(100),
  sourceBranchId: z.string().min(1),
  driverName: z.string().trim().min(2).max(120),
  driverPhone: z
    .string()
    .trim()
    .min(7, "A phone number needs at least 7 digits")
    .max(24)
    .regex(/^[+()\d][\d\s()+-]*$/, "Use digits, spaces, and + ( ) - only"),
  vehiclePlate: z.string().trim().min(2).max(40),
  notes: z.string().max(500).optional(),
});

/** One car for a branch: its decided requests go out as one shipment. */
export async function shipRequestsController(request: FastifyRequest, reply: FastifyReply) {
  const result = shipSchema.safeParse(request.body);
  if (!result.success) {
    return reply.status(400).send({ message: result.error.issues[0]?.message ?? "Choose the requests and the driver" });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const { requestIds, ...data } = result.data;
    return reply.send({ message: "Sent", ...(await shipRequests(requestIds, data, viewer)) });
  } catch (error) {
    return handleRequestError(error, reply) ?? Promise.reject(error);
  }
}

const quantitiesSchema = z.object({
  items: z
    .array(z.object({ itemId: z.string().min(1), approvedQuantity: z.coerce.number().int().min(0) }))
    .max(500),
});

/** The Owner approves how many of each item go; sending is its own step. */
export async function approveQuantitiesController(
  request: FastifyRequest<{ Params: RequestParams }>,
  reply: FastifyReply,
) {
  const result = quantitiesSchema.safeParse(request.body);
  if (!result.success) return reply.status(400).send({ message: "Enter how many of each item to approve" });

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    return reply.send({
      message: "Approved",
      request: await approveQuantities(request.params.id, result.data.items, viewer),
    });
  } catch (error) {
    return handleRequestError(error, reply) ?? Promise.reject(error);
  }
}

/** The requester corrects a request nobody has decided yet. */
export async function updateRequestController(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const result = createRequestSchema.safeParse(request.body);
  if (!result.success) {
    return reply.status(400).send({ message: "Invalid request data", errors: result.error.flatten() });
  }
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;
  try {
    return reply.send({ message: "Request updated", request: await updateRequest(request.params.id, result.data, viewer) });
  } catch (error) {
    return handleRequestError(error, reply) ?? Promise.reject(error);
  }
}
