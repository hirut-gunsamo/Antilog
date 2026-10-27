import type { FastifyReply, FastifyRequest } from "fastify";

import { loadViewer } from "../../middleware/auth.js";

import {
  collectCashSchema,
  declareYadereSchema,
  listCollectionsQuerySchema,
} from "./collection.schema.js";

import {
  collectCash,
  declareYadere,
  getCollections,
  getMyYadereToday,
  getTeamCash,
} from "./collection.service.js";

function handleError(
  error: unknown,
  reply: FastifyReply,
): FastifyReply | null {
  if (!(error instanceof Error)) return null;

  switch (error.message) {
    case "ONLY_SUPERVISOR_COLLECTS":
      return reply.status(403).send({
        message: "Only a supervisor collects cash from their team",
      });

    case "NOT_A_SELLER":
      return reply.status(404).send({
        message: "That person is not an active salesperson",
      });

    case "NOT_YOUR_BRANCH":
      return reply.status(403).send({
        message: "You can only collect from your own branch",
      });

    case "MORE_THAN_IN_HAND":
      return reply.status(409).send({
        message: "That is more than this person is holding",
        inHand: (error as Error & { inHand?: number }).inHand,
      });

    case "ONLY_SALES_DECLARES_YADERE":
      return reply.status(403).send({
        message: "Only a salesperson can set daily yadere",
      });

    default:
      return null;
  }
}

async function withViewer(request: FastifyRequest, reply: FastifyReply) {
  const viewer = await loadViewer(request);

  if (!viewer) {
    reply.status(403).send({ message: "User account is inactive" });
    return null;
  }

  return viewer;
}

export async function collectCashController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = collectCashSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid collection data",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const collection = await collectCash(result.data, viewer);

    return reply.status(201).send({
      message: "Cash collected",
      collection,
    });
  } catch (error) {
    return handleError(error, reply) ?? Promise.reject(error);
  }
}

export async function getCollectionsController(
  request: FastifyRequest<{ Querystring: Record<string, string> }>,
  reply: FastifyReply,
) {
  const result = listCollectionsQuerySchema.safeParse(request.query);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid filters",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const collections = await getCollections(result.data, viewer);

  return reply.send({ collections });
}

export async function getTeamCashController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const team = await getTeamCash(viewer);

  return reply.send({ team });
}

export async function declareYadereController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = declareYadereSchema.safeParse(request.body);
  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid yadere amount",
      errors: result.error.flatten(),
    });
  }
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;
  try {
    const yadere = await declareYadere(result.data, viewer);
    return reply.send({ yadere });
  } catch (error) {
    return handleError(error, reply) ?? Promise.reject(error);
  }
}

export async function getMyYadereTodayController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;
  try {
    const yadere = await getMyYadereToday(viewer);
    return reply.send({ yadere });
  } catch (error) {
    return handleError(error, reply) ?? Promise.reject(error);
  }
}
