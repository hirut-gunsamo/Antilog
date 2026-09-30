import type { FastifyReply, FastifyRequest } from "fastify";

import { loadViewer } from "../../middleware/auth.js";
import { changesQuerySchema, recordsQuerySchema } from "./sync.schema.js";
import { getChanges, getRecords } from "./sync.service.js";

export async function getChangesController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = changesQuerySchema.safeParse(request.query);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid sync query",
      errors: result.error.flatten(),
    });
  }

  // Read fresh rather than from the token: a user moved between branches must
  // not be told about their old branch's changes until the token expires.
  const viewer = await loadViewer(request);

  if (!viewer) {
    return reply.status(403).send({ message: "User account is inactive" });
  }

  const changes = await getChanges(
    result.data.since,
    result.data.entities,
    viewer,
  );

  return reply.send({ changes });
}

export async function getRecordsController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = recordsQuerySchema.safeParse(request.query);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid record query",
      errors: result.error.flatten(),
    });
  }

  const payload = await getRecords(result.data.deviceId, result.data.limit);

  return reply.send(payload);
}
