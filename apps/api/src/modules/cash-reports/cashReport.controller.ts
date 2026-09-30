import type {
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { loadViewer } from "../../middleware/auth.js";

import {
  createCashReportSchema,
  rejectCashReportSchema,
  listCashReportsQuerySchema,
} from "./cashReport.schema.js";

import {
  createCashReport,
  getCashReports,
  getCashReportById,
  submitCashReport,
  approveCashReport,
  rejectCashReport,
  sendCashReportToOwner,
} from "./cashReport.service.js";

type ReportParams = {
  id: string;
};

function handleReportError(
  error: unknown,
  reply: FastifyReply,
): FastifyReply | null {
  if (!(error instanceof Error)) {
    return null;
  }

  switch (error.message) {
    case "ONLY_SALES_MAY_REPORT":
      return reply.status(403).send({
        message: "Only a Sales user can submit a cash report",
      });

    case "INVALID_PERIOD":
      return reply.status(400).send({
        message: "The reporting period is not a valid date range",
      });

    case "NO_SALES_IN_PERIOD":
      return reply.status(409).send({
        message:
          "There are no unreconciled approved sales in this period",
      });

    case "REPORT_NOT_FOUND":
      return reply.status(404).send({
        message: "Cash report not found",
      });

    case "NOT_YOUR_REPORT":
      return reply.status(403).send({
        message: "You can only submit your own cash report",
      });

    case "NOT_YOUR_BRANCH":
      return reply.status(403).send({
        message:
          "You can only review cash reports from your own branch",
      });

    case "REPORT_NOT_DRAFT":
      return reply.status(409).send({
        message: "This report has already been submitted",
      });

    case "REPORT_NOT_SUBMITTED":
      return reply.status(409).send({
        message:
          "Only a report awaiting review can be approved or rejected",
      });

    case "REPORT_NOT_APPROVED":
      return reply.status(409).send({
        message:
          "Only an approved report can be sent to the Owner",
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

export async function createCashReportController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = createCashReportSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid cash report data",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const report = await createCashReport(result.data, viewer);

    return reply.status(201).send({
      message: "Cash report drafted",
      report,
    });
  } catch (error) {
    return (
      handleReportError(error, reply) ?? Promise.reject(error)
    );
  }
}

export async function getCashReportsController(
  request: FastifyRequest<{
    Querystring: Record<string, string>;
  }>,
  reply: FastifyReply,
) {
  const result = listCashReportsQuerySchema.safeParse(
    request.query,
  );

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid filters",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const reports = await getCashReports(result.data, viewer);

  return reply.send({ reports });
}

export async function getCashReportController(
  request: FastifyRequest<{
    Params: ReportParams;
  }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const report = await getCashReportById(
    request.params.id,
    viewer,
  );

  if (!report) {
    return reply.status(404).send({
      message: "Cash report not found",
    });
  }

  return reply.send({ report });
}

function transition(
  action: (id: string, viewer: Awaited<ReturnType<typeof loadViewer>> & object) => Promise<unknown>,
  message: string,
) {
  return async function (
    request: FastifyRequest<{ Params: ReportParams }>,
    reply: FastifyReply,
  ) {
    const viewer = await withViewer(request, reply);
    if (!viewer) return reply;

    try {
      const report = await action(request.params.id, viewer);

      return reply.send({ message, report });
    } catch (error) {
      return (
        handleReportError(error, reply) ?? Promise.reject(error)
      );
    }
  };
}

export const submitCashReportController = transition(
  submitCashReport,
  "Cash report submitted to your supervisor",
);

export const approveCashReportController = transition(
  approveCashReport,
  "Cash report approved",
);

export const sendToOwnerController = transition(
  sendCashReportToOwner,
  "Cash report sent to the Owner",
);

export async function rejectCashReportController(
  request: FastifyRequest<{
    Params: ReportParams;
  }>,
  reply: FastifyReply,
) {
  const result = rejectCashReportSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "A rejection reason is required",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const report = await rejectCashReport(
      request.params.id,
      result.data.rejectionReason,
      viewer,
    );

    return reply.send({
      message: "Cash report rejected",
      report,
    });
  } catch (error) {
    return (
      handleReportError(error, reply) ?? Promise.reject(error)
    );
  }
}
