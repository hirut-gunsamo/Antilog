import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import type {
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { loadViewer } from "../../middleware/auth.js";

import {
  UPLOAD_ROOT,
  storeReceiptFile,
  createReceipt,
  getReceipts,
  getReceiptById,
  setReceiptStatus,
  deleteReceipt,
  getDaySummary,
  receiptBranch,
} from "./receipt.service.js";

type ReceiptParams = {
  id: string;
};

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

function handleReceiptError(
  error: unknown,
  reply: FastifyReply,
): FastifyReply | null {
  if (!(error instanceof Error)) {
    return null;
  }

  switch (error.message) {
    case "UNSUPPORTED_FILE_TYPE":
      return reply.status(400).send({
        message:
          "Receipts must be a JPG, PNG, WebP image or a PDF",
      });

    case "EMPTY_FILE":
      return reply.status(400).send({
        message: "The uploaded file is empty",
      });

    case "FILE_TOO_LARGE":
      return reply.status(413).send({
        message: "Receipt files must be 10MB or smaller",
      });

    case "INVALID_DATE":
      return reply.status(400).send({
        message: "The receipt date is not a valid date",
      });

    case "BRANCH_REQUIRED":
      return reply.status(400).send({
        message: "Choose the branch this money is for",
      });

    case "REPORT_NOT_FOUND":
      return reply.status(404).send({
        message: "Cash report not found",
      });

    case "NOT_YOUR_REPORT":
      return reply.status(403).send({
        message:
          "You can only attach receipts to your own cash report",
      });

    case "RECEIPT_NOT_FOUND":
      return reply.status(404).send({
        message: "Receipt not found",
      });

    case "NOT_YOUR_RECEIPT":
      return reply.status(403).send({
        message: "You can only remove your own receipt",
      });

    case "NOT_YOUR_BRANCH":
      return reply.status(403).send({
        message:
          "You can only verify receipts from your own branch",
      });

    case "RECEIPT_ALREADY_REVIEWED":
      return reply.status(409).send({
        message: "This receipt has already been reviewed",
      });

    case "RECEIPT_VERIFIED":
      return reply.status(409).send({
        message:
          "A verified receipt is part of the record and cannot be deleted",
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

// Multipart upload: the image plus the receipt's details in the same form.
export async function uploadReceiptController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  if (!request.isMultipart()) {
    return reply.status(400).send({
      message:
        "Send the receipt as multipart/form-data with a 'file' field",
    });
  }

  const fields: Record<string, string> = {};
  let stored: Awaited<ReturnType<typeof storeReceiptFile>> | null =
    null;

  try {
    for await (const part of request.parts()) {
      if (part.type === "file") {
        const bytes = await part.toBuffer();
        stored = await storeReceiptFile(
          part.filename,
          part.mimetype,
          bytes,
        );
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }

    // No file is fine: the bankers often credit the account through their
    // app and hand over no slip.
    if (!fields.amount || !fields.receiptDate) {
      return reply.status(400).send({
        message: "amount and receiptDate are required",
      });
    }

    const amount = Number(fields.amount);

    if (!Number.isFinite(amount) || amount < 0) {
      return reply.status(400).send({
        message: "amount must be a positive number",
      });
    }

    const receipt = await createReceipt(
      {
        fileUrl: stored?.fileUrl,
        amount,
        locationId: receiptBranch(viewer, fields.branchId),
        receiptDate: fields.receiptDate,
        bankName: fields.bankName,
        referenceNumber: fields.referenceNumber,
        cashReportId: fields.cashReportId,
        notes: fields.notes,
      },
      viewer,
    );

    return reply.status(201).send({
      message: "Receipt uploaded",
      receipt,
    });
  } catch (error) {
    return (
      handleReceiptError(error, reply) ?? Promise.reject(error)
    );
  }
}

// Serves the stored image. Access is checked against the receipt row, so a
// leaked filename alone does not expose another branch's receipt.
export async function getReceiptFileController(
  request: FastifyRequest<{
    Params: { filename: string };
  }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const { filename } = request.params;

  // Reject anything that is not a plain stored filename.
  if (!/^[A-Za-z0-9-]+\.(jpg|png|webp|pdf)$/.test(filename)) {
    return reply.status(400).send({
      message: "Invalid file name",
    });
  }

  const receipts = await getReceipts({}, viewer);
  const permitted = receipts.some((r) =>
    r.fileUrl?.endsWith(`/${filename}`),
  );

  if (!permitted) {
    return reply.status(404).send({
      message: "Receipt not found",
    });
  }

  const filePath = path.join(UPLOAD_ROOT, filename);

  if (!existsSync(filePath)) {
    return reply.status(404).send({
      message: "Receipt file is missing",
    });
  }

  const extension = path.extname(filename);

  return reply
    .type(CONTENT_TYPES[extension] ?? "application/octet-stream")
    .send(createReadStream(filePath));
}

export async function getReceiptsController(
  request: FastifyRequest<{
    Querystring: { status?: string; branchId?: string };
  }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const receipts = await getReceipts(request.query, viewer);

  return reply.send({ receipts });
}

export async function getReceiptController(
  request: FastifyRequest<{
    Params: ReceiptParams;
  }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const receipt = await getReceiptById(request.params.id, viewer);

  if (!receipt) {
    return reply.status(404).send({
      message: "Receipt not found",
    });
  }

  return reply.send({ receipt });
}

export async function verifyReceiptController(
  request: FastifyRequest<{
    Params: ReceiptParams;
    Body: { notes?: string };
  }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const receipt = await setReceiptStatus(
      request.params.id,
      "VERIFIED",
      request.body?.notes,
      viewer,
    );

    return reply.send({
      message: "Receipt verified",
      receipt,
    });
  } catch (error) {
    return (
      handleReceiptError(error, reply) ?? Promise.reject(error)
    );
  }
}

export async function rejectReceiptController(
  request: FastifyRequest<{
    Params: ReceiptParams;
    Body: { notes?: string };
  }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const receipt = await setReceiptStatus(
      request.params.id,
      "REJECTED",
      request.body?.notes,
      viewer,
    );

    return reply.send({
      message: "Receipt rejected",
      receipt,
    });
  } catch (error) {
    return (
      handleReceiptError(error, reply) ?? Promise.reject(error)
    );
  }
}

export async function deleteReceiptController(
  request: FastifyRequest<{
    Params: ReceiptParams;
  }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    await deleteReceipt(request.params.id, viewer);

    return reply.send({ message: "Receipt deleted" });
  } catch (error) {
    return (
      handleReceiptError(error, reply) ?? Promise.reject(error)
    );
  }
}

// What the upload form shows before saving: the branch's sales for the day,
// what has been credited already, and what is still left (yadere).
export async function getDaySummaryController(
  request: FastifyRequest<{
    Querystring: { date?: string; branchId?: string };
  }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const branchId = receiptBranch(viewer, request.query.branchId);
    const day = await getDaySummary(
      branchId,
      request.query.date ?? new Date().toISOString(),
    );

    return reply.send({ summary: day });
  } catch (error) {
    return handleReceiptError(error, reply) ?? Promise.reject(error);
  }
}
