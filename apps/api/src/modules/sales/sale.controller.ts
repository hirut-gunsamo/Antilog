import type {
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { Prisma } from "database";

import { loadViewer } from "../../middleware/auth.js";

import {
  createSaleSchema,
  rejectSaleSchema,
  listSalesQuerySchema,
} from "./sale.schema.js";

import {
  createSale,
  getSales,
  getSaleById,
  submitSale,
  approveSale,
  rejectSale,
  deleteSale,
  updateSale,
  allowSaleEdits,
  requestSaleEdit,
  editDayTotals,
  requestDayEdit,
} from "./sale.service.js";

type SaleParams = {
  id: string;
};

type Shortage = {
  productId: string;
  requested: number;
  available: number;
};

function handleSaleError(
  error: unknown,
  reply: FastifyReply,
): FastifyReply | null {
  // Backstop for the SERIAL_ALREADY_SOLD race: that check is a read followed by
  // a write, so two tills entering the same handset at the same instant both
  // pass it and the second one loses on the unique index instead. The
  // transaction rolls back either way, so the stock stays right; this is only
  // so the seller reads the same sentence rather than a 500. The unique indexes
  // on iccid and imei are the only ones the sales module can trip.
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return reply.status(409).send({
      message: "That serial number has already been sold",
    });
  }

  if (!(error instanceof Error)) {
    return null;
  }

  switch (error.message) {
    case "NO_BRANCH":
      return reply.status(400).send({
        message: "You are not assigned to a branch",
      });

    case "MAIN_STORE_NO_SALES":
      return reply.status(400).send({
        message: "The main store only holds stock. Sales are recorded at a branch.",
      });

    case "INVALID_PRODUCT":
      return reply.status(400).send({
        message: "One or more products are unknown or inactive",
      });

    case "INSUFFICIENT_STOCK":
      return reply.status(409).send({
        message:
          "Your branch does not have enough stock for this sale",
        shortages: (error as Error & { shortages?: Shortage[] })
          .shortages,
      });

    case "NOT_IN_YOUR_HOLDING": {
      // Say which item and how many they hold: "25 Airtime Voucher: you hold
      // 3, this sale has 5".
      const shortages =
        (error as Error & { shortages?: { name: string; requested: number; available: number }[] }).shortages ?? [];
      const detail = shortages
        .map((row) => `${row.name}: you hold ${row.available}, this sale has ${row.requested}`)
        .join("; ");
      return reply.status(409).send({
        message: `You were not issued that much. ${detail ? `${detail}. ` : ""}Lower it, or ask your supervisor to issue more`,
        shortages,
      });
    }

    case "SERIAL_COUNT_MISMATCH":
      return reply.status(400).send({
        message: "Enter one serial number for each item sold",
      });

    case "SERIAL_REPEATED":
      return reply.status(400).send({
        message: "The same serial number was entered twice",
      });

    case "SERIAL_ALREADY_SOLD":
      return reply.status(409).send({
        message: "That serial number has already been sold",
      });

    case "SERIALS_NOT_EXPECTED":
      return reply.status(400).send({
        message: "This product does not carry serial numbers",
      });

    case "INSUFFICIENT_UNITS":
      return reply.status(409).send({
        message:
          "Not enough individual SIM or phone units are in stock at this branch",
      });

    case "EDIT_LOCKED":
      return reply.status(409).send({
        message: "A sale can only be changed on its own day. Ask the Owner to allow it.",
      });

    case "INVALID_DAY":
      return reply.status(400).send({ message: "Choose the day" });

    case "SALE_NOT_FOUND":
      return reply.status(404).send({
        message: "Sale not found",
      });

    case "NOT_YOUR_SALE":
      return reply.status(403).send({
        message: "You can only act on your own sale",
      });

    case "NOT_YOUR_BRANCH":
      return reply.status(403).send({
        message:
          "You can only approve sales made at your own branch",
      });

    case "SALE_NOT_DRAFT":
      return reply.status(409).send({
        message: "This sale has already been submitted",
      });

    case "SALE_NOT_SUBMITTED":
      return reply.status(409).send({
        message:
          "Only a sale awaiting approval can be approved or rejected",
      });

    case "SALE_ALREADY_SETTLED":
      return reply.status(409).send({
        message: "This sale has already been recorded",
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

export async function createSaleController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = createSaleSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid sale data",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const sale = await createSale(result.data, viewer);

    return reply.status(201).send({
      message: "Sale recorded",
      sale,
    });
  } catch (error) {
    return handleSaleError(error, reply) ?? Promise.reject(error);
  }
}

export async function getSalesController(
  request: FastifyRequest<{
    Querystring: Record<string, string>;
  }>,
  reply: FastifyReply,
) {
  const result = listSalesQuerySchema.safeParse(request.query);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid filters",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const sales = await getSales(result.data, viewer);

  return reply.send({ sales });
}

export async function getSaleController(
  request: FastifyRequest<{
    Params: SaleParams;
  }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const sale = await getSaleById(request.params.id, viewer);

  if (!sale) {
    return reply.status(404).send({
      message: "Sale not found",
    });
  }

  return reply.send({ sale });
}

export async function submitSaleController(
  request: FastifyRequest<{
    Params: SaleParams;
  }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const sale = await submitSale(request.params.id, viewer);

    return reply.send({
      message: "Sale submitted for supervisor approval",
      sale,
    });
  } catch (error) {
    return handleSaleError(error, reply) ?? Promise.reject(error);
  }
}

export async function approveSaleController(
  request: FastifyRequest<{
    Params: SaleParams;
  }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const sale = await approveSale(request.params.id, viewer);

    return reply.send({
      message:
        "Sale approved. Stock has been deducted from the branch.",
      sale,
    });
  } catch (error) {
    return handleSaleError(error, reply) ?? Promise.reject(error);
  }
}

export async function rejectSaleController(
  request: FastifyRequest<{
    Params: SaleParams;
  }>,
  reply: FastifyReply,
) {
  const result = rejectSaleSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "A rejection reason is required",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const sale = await rejectSale(
      request.params.id,
      result.data.rejectionReason,
      viewer,
    );

    return reply.send({
      message: "Sale rejected",
      sale,
    });
  } catch (error) {
    return handleSaleError(error, reply) ?? Promise.reject(error);
  }
}

export async function deleteSaleController(
  request: FastifyRequest<{
    Params: SaleParams;
  }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    await deleteSale(request.params.id, viewer);

    return reply.send({
      message: "Draft sale deleted",
    });
  } catch (error) {
    return handleSaleError(error, reply) ?? Promise.reject(error);
  }
}

/** A salesperson corrects their own sale (its day, or while the Owner allows it). */
export async function updateSaleController(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const result = createSaleSchema.safeParse(request.body);
  if (!result.success) {
    return reply.status(400).send({ message: "Invalid sale data", errors: result.error.flatten() });
  }
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;
  try {
    return reply.send({ message: "Sale updated", sale: await updateSale(request.params.id, result.data, viewer) });
  } catch (error) {
    return handleSaleError(error, reply) ?? Promise.reject(error);
  }
}

/** The Owner lets a salesperson correct one past day's sales, until tonight. */
export async function allowSaleEditsController(
  request: FastifyRequest<{ Body: { salespersonId?: string; day?: string } }>,
  reply: FastifyReply,
) {
  const { salespersonId, day } = request.body ?? {};
  if (!salespersonId || !day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return reply.status(400).send({ message: "Choose the salesperson and the day" });
  }
  try {
    return reply.send(await allowSaleEdits({ salespersonId, day }));
  } catch (error) {
    return handleSaleError(error, reply) ?? Promise.reject(error);
  }
}

/** A salesperson asks the Owner to allow a correction. */
export async function requestDayEditController(
  request: FastifyRequest<{ Body: { day?: string } }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;
  const day = request.body?.day ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return reply.status(400).send({ message: "Choose the day" });
  try {
    return reply.send(await requestDayEdit(day, viewer));
  } catch (error) {
    return handleSaleError(error, reply) ?? Promise.reject(error);
  }
}

export async function requestSaleEditController(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;
  try {
    return reply.send(await requestSaleEdit(request.params.id, viewer));
  } catch (error) {
    return handleSaleError(error, reply) ?? Promise.reject(error);
  }
}

export async function dayTotalsController(
  request: FastifyRequest<{ Body: { day?: string; totals?: { productId: string; quantity: number }[] } }>,
  reply: FastifyReply,
) {
  const day = request.body?.day ?? "";
  const totals = (request.body?.totals ?? []).filter(
    (row) => typeof row?.productId === "string" && Number.isInteger(row?.quantity) && row.quantity >= 0,
  );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || totals.length === 0) {
    return reply.status(400).send({ message: "Choose the day and the totals" });
  }
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;
  try {
    return reply.send({ message: "Day updated", ...(await editDayTotals(viewer, day, totals)) });
  } catch (error) {
    return handleSaleError(error, reply) ?? Promise.reject(error);
  }
}
