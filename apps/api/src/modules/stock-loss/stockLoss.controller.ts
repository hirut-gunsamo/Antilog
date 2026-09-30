import type { FastifyReply, FastifyRequest } from "fastify";

import { loadViewer } from "../../middleware/auth.js";
import {
  listLossQuerySchema,
  rejectLossSchema,
  reportLossSchema,
} from "./stockLoss.schema.js";
import {
  approveLoss,
  getLossReports,
  rejectLoss,
  reportLoss,
} from "./stockLoss.service.js";

const MESSAGES: Record<string, { status: number; message: string }> = {
  NO_BRANCH: {
    status: 400,
    message: "Choose the branch this stock belongs to",
  },
  FORBIDDEN_BRANCH: {
    status: 403,
    message: "You can only report stock at your own branch",
  },
  NOT_FOUND: { status: 404, message: "Report not found" },
  LOCATION_INACTIVE: { status: 400, message: "That branch is closed" },
  INSUFFICIENT_STOCK: {
    status: 400,
    message: "That is more than the branch currently holds",
  },
  ALREADY_REVIEWED: {
    status: 409,
    message: "That report has already been reviewed",
  },
  SELF_REVIEW: {
    status: 403,
    message: "Someone else has to review a report you raised",
  },
};

function fail(reply: FastifyReply, caught: unknown) {
  const key = caught instanceof Error ? caught.message : "";
  const known = MESSAGES[key];

  if (known) {
    return reply.status(known.status).send({ message: known.message });
  }

  throw caught;
}

async function withViewer(request: FastifyRequest, reply: FastifyReply) {
  const viewer = await loadViewer(request);

  if (!viewer) {
    reply.status(403).send({ message: "User account is inactive" });
    return null;
  }

  return viewer;
}

export async function reportLossController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const parsed = reportLossSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.status(400).send({
      message: "Invalid report",
      errors: parsed.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const report = await reportLoss(parsed.data, viewer);

    return reply.status(201).send({
      message: "Report submitted for review",
      report,
    });
  } catch (caught) {
    return fail(reply, caught);
  }
}

export async function listLossController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const parsed = listLossQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return reply.status(400).send({ message: "Invalid filter" });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const reports = await getLossReports(parsed.data, viewer);

  return reply.send({ reports });
}

export async function approveLossController(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const report = await approveLoss(request.params.id, viewer);

    return reply.send({ message: "Write-off confirmed", report });
  } catch (caught) {
    return fail(reply, caught);
  }
}

export async function rejectLossController(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const parsed = rejectLossSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.status(400).send({ message: "Say why it is being rejected" });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const report = await rejectLoss(request.params.id, parsed.data, viewer);

    return reply.send({ message: "Report rejected, stock restored", report });
  } catch (caught) {
    return fail(reply, caught);
  }
}
