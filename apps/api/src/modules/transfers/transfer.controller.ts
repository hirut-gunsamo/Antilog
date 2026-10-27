import type {
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { loadViewer } from "../../middleware/auth.js";

import {
  shipTransferSchema,
  receiveTransferSchema,
  cancelTransferSchema,
  listTransfersQuerySchema,
  createTransferSchema,
} from "./transfer.schema.js";

import {
  getTransfers,
  getTransferById,
  shipTransfer,
  receiveTransfer,
  cancelTransfer,
  createTransfer,
} from "./transfer.service.js";

type TransferParams = {
  id: string;
};

type Shortage = {
  productId: string;
  requested: number;
  available: number;
};

function handleTransferError(
  error: unknown,
  reply: FastifyReply,
): FastifyReply | null {
  if (!(error instanceof Error)) {
    return null;
  }

  switch (error.message) {
    case "SAME_BRANCH":
      return reply.status(400).send({ message: "Choose two different branches" });

    case "BRANCH_NOT_FOUND":
      return reply.status(404).send({ message: "That branch is closed or no longer exists" });

    case "TRANSFER_NOT_FOUND":
      return reply.status(404).send({
        message: "Transfer not found",
      });

    case "TRANSFER_NOT_PENDING":
      return reply.status(409).send({
        message: "This transfer has already been shipped",
      });

    case "TRANSFER_NOT_IN_TRANSIT":
      return reply.status(409).send({
        message:
          "Only a transfer that is in transit can be received",
      });

    case "TRANSFER_ALREADY_RECEIVED":
      return reply.status(409).send({
        message: "This transfer has already been received",
      });

    case "TRANSFER_ALREADY_CANCELLED":
      return reply.status(409).send({
        message: "This transfer is already cancelled",
      });

    case "NOT_YOUR_TRANSFER":
      return reply.status(403).send({
        message:
          "Only the receiving branch can confirm this transfer",
      });

    case "NOT_ENOUGH_FOR_BRANCH":
      return reply.status(409).send({
        message: "Not enough stock held for that branch to ship this transfer",
      });

    case "INSUFFICIENT_SOURCE_STOCK":
      return reply.status(409).send({
        message:
          "Not enough stock to ship this transfer (from the main store, only that branch's share counts)",
        shortages: (error as Error & { shortages?: Shortage[] })
          .shortages,
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

export async function getTransfersController(
  request: FastifyRequest<{
    Querystring: Record<string, string>;
  }>,
  reply: FastifyReply,
) {
  const result = listTransfersQuerySchema.safeParse(request.query);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid filters",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const transfers = await getTransfers(result.data, viewer);

  return reply.send({ transfers });
}

export async function getTransferController(
  request: FastifyRequest<{
    Params: TransferParams;
  }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const transfer = await getTransferById(
    request.params.id,
    viewer,
  );

  if (!transfer) {
    return reply.status(404).send({
      message: "Transfer not found",
    });
  }

  return reply.send({ transfer });
}

export async function shipTransferController(
  request: FastifyRequest<{
    Params: TransferParams;
  }>,
  reply: FastifyReply,
) {
  const result = shipTransferSchema.safeParse(request.body ?? {});

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid shipment data",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const transfer = await shipTransfer(
      request.params.id,
      result.data.notes,
      viewer,
    );

    return reply.send({
      message:
        "Transfer shipped. Stock has left the source branch and is awaiting receipt.",
      transfer,
    });
  } catch (error) {
    return (
      handleTransferError(error, reply) ?? Promise.reject(error)
    );
  }
}

export async function receiveTransferController(
  request: FastifyRequest<{
    Params: TransferParams;
  }>,
  reply: FastifyReply,
) {
  const result = receiveTransferSchema.safeParse(
    request.body ?? {},
  );

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid receipt data",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const transfer = await receiveTransfer(
      request.params.id,
      result.data.notes,
      viewer,
    );

    return reply.send({
      message:
        "Receipt confirmed. Branch stock has been updated and the request is fulfilled.",
      transfer,
    });
  } catch (error) {
    return (
      handleTransferError(error, reply) ?? Promise.reject(error)
    );
  }
}

export async function cancelTransferController(
  request: FastifyRequest<{
    Params: TransferParams;
  }>,
  reply: FastifyReply,
) {
  const result = cancelTransferSchema.safeParse(
    request.body ?? {},
  );

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid cancellation data",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const transfer = await cancelTransfer(
      request.params.id,
      result.data.reason,
      viewer,
    );

    return reply.send({
      message:
        "Transfer cancelled. Any shipped stock has been returned to the source branch.",
      transfer,
    });
  } catch (error) {
    return (
      handleTransferError(error, reply) ?? Promise.reject(error)
    );
  }
}

export async function createTransferController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const viewer = await loadViewer(request);
  if (!viewer) return reply.status(403).send({ message: "User account is inactive" });

  const result = createTransferSchema.safeParse(request.body);
  if (!result.success) {
    return reply.status(400).send({
      message: "Choose both branches, at least one item, and the driver's name, phone and plate",
      errors: result.error.flatten(),
    });
  }

  try {
    const transfer = await createTransfer(result.data, viewer);
    return reply.status(201).send({ message: "Transfer sent", transfer });
  } catch (error) {
    return handleTransferError(error, reply) ?? Promise.reject(error);
  }
}
