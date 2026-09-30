import type { FastifyReply, FastifyRequest } from "fastify";

import { loadViewer } from "../../middleware/auth.js";
import {
  createRecordSchema,
  listRecordsQuerySchema,
  receiveBlanksSchema,
  summaryQuerySchema,
  updateRecordSchema,
} from "./nationalId.schema.js";
import {
  createRecord,
  deleteRecord,
  getBlankBalances,
  getBlankEntries,
  getRecords,
  getSummary,
  receiveBlanks,
  updateRecord,
} from "./nationalId.service.js";

const MESSAGES: Record<string, { status: number; message: string }> = {
  NO_BRANCH: { status: 400, message: "Choose which branch did the work" },
  FORBIDDEN_BRANCH: {
    status: 403,
    message: "You can only record work at your own branch",
  },
  FORBIDDEN_EMPLOYEE: {
    status: 403,
    message: "You can only record your own work",
  },
  EMPLOYEE_NOT_AT_BRANCH: {
    status: 400,
    message: "That employee does not work at this branch",
  },
  NOTHING_RECORDED: {
    status: 400,
    message: "Enter at least one original or copy print",
  },
  DUPLICATE_DAY: {
    status: 409,
    message: "That employee already has a record for this day — edit it instead",
  },
  LOCATION_INACTIVE: { status: 400, message: "That branch is closed" },
  NOT_FOUND: { status: 404, message: "Record not found" },
  NOT_YOURS: { status: 403, message: "You can only change your own records" },
  NOT_ENOUGH_ORIGINAL: {
    status: 400,
    message: "That is more original blanks than the branch has left",
  },
  NOT_ENOUGH_COPY: {
    status: 400,
    message: "That is more copy blanks than the branch has left",
  },
};

function fail(reply: FastifyReply, caught: unknown) {
  const known = MESSAGES[caught instanceof Error ? caught.message : ""];

  if (known) return reply.status(known.status).send({ message: known.message });

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

export async function createRecordController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const parsed = createRecordSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply
      .status(400)
      .send({ message: "Invalid record", errors: parsed.error.flatten() });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const record = await createRecord(parsed.data, viewer);

    return reply.status(201).send({ message: "Record saved", record });
  } catch (caught) {
    return fail(reply, caught);
  }
}

export async function listRecordsController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const parsed = listRecordsQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return reply.status(400).send({ message: "Invalid filter" });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const records = await getRecords(parsed.data, viewer);

  return reply.send({ records });
}

export async function summaryController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const parsed = summaryQuerySchema.safeParse(request.query);

  if (!parsed.success) {
    return reply.status(400).send({ message: "Invalid range" });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const summary = await getSummary(parsed.data, viewer);

  return reply.send({ summary });
}

export async function updateRecordController(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const parsed = updateRecordSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.status(400).send({ message: "Invalid change" });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const record = await updateRecord(request.params.id, parsed.data, viewer);

    return reply.send({ message: "Record updated", record });
  } catch (caught) {
    return fail(reply, caught);
  }
}

export async function deleteRecordController(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    await deleteRecord(request.params.id, viewer);

    return reply.send({ message: "Record deleted" });
  } catch (caught) {
    return fail(reply, caught);
  }
}

export async function blanksController(
  request: FastifyRequest<{ Querystring: { locationId?: string } }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const [balances, entries] = await Promise.all([
    getBlankBalances(viewer, request.query.locationId),
    getBlankEntries(viewer, request.query.locationId),
  ]);

  return reply.send({ balances, entries });
}

export async function receiveBlanksController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const parsed = receiveBlanksSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply
      .status(400)
      .send({ message: "Invalid arrival", errors: parsed.error.flatten() });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const entry = await receiveBlanks(parsed.data, viewer);

    return reply.status(201).send({ message: "Blanks recorded", entry });
  } catch (caught) {
    return fail(reply, caught);
  }
}
