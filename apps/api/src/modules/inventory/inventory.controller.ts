import type {
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { loadViewer } from "../../middleware/auth.js";

import {
  stockInSchema,
  inventoryQuerySchema,
  unitsQuerySchema,
  adjustBalanceSchema,
  removeBalanceSchema,
  updateProductSchema,
} from "./inventory.schema.js";

import {
  stockIn,
  getInventory,
  getInventoryUnits,
  getStockSummary,
  getStockMovements,
  adjustBalance,
  removeBalance,
  updateProduct,
  getHoldings,
} from "./inventory.service.js";

// Every read below is scoped to the caller's branch. Resolving the viewer in
// one place keeps that guarantee from being forgotten in a new endpoint.
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

export async function stockInController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = stockInSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid stock data",
      errors: result.error.flatten(),
    });
  }

  try {
    const balance = await stockIn(
      result.data,
      request.user.userId,
    );

    return reply.status(201).send({
      message: "Stock added successfully",
      balance,
    });
  } catch (error) {
    if (error instanceof Error) {
      const errors: Record<string, string> = {
        PRODUCT_NOT_FOUND: "Product not found",
        PRODUCT_INACTIVE: "Product is inactive",
        LOCATION_NOT_FOUND: "Branch not found",
        LOCATION_INACTIVE:
          "This branch is closed and cannot receive stock",
        INVALID_UNIT_COUNT:
          "Serialized products require one unit record for each item",
        SIM_IDENTIFIER_REQUIRED:
          "Each SIM requires an ICCID or serial number",
        IMEI_REQUIRED: "Each phone requires an IMEI",
      };

      if (errors[error.message]) {
        return reply.status(400).send({
          message: errors[error.message],
        });
      }
    }

    throw error;
  }
}

export async function getInventoryController(
  request: FastifyRequest<{
    Querystring: Record<string, string>;
  }>,
  reply: FastifyReply,
) {
  const result = inventoryQuerySchema.safeParse(request.query);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid filters",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const inventory = await getInventory(
    viewer,
    result.data.locationId,
  );

  return reply.send({ inventory });
}

export async function getLocationInventoryController(
  request: FastifyRequest<{
    Params: { locationId: string };
  }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const inventory = await getInventory(
    viewer,
    request.params.locationId,
  );

  return reply.send({ inventory });
}

// What a Sales user sees as "available stock (remaining)".
export async function getStockSummaryController(
  request: FastifyRequest<{
    Querystring: Record<string, string>;
  }>,
  reply: FastifyReply,
) {
  const result = inventoryQuerySchema.safeParse(request.query);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid filters",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const summary = await getStockSummary(
    viewer,
    result.data.locationId,
    Boolean(result.data.mine),
  );

  return reply.send({ summary });
}

export async function getInventoryUnitsController(
  request: FastifyRequest<{
    Querystring: Record<string, string>;
  }>,
  reply: FastifyReply,
) {
  const result = unitsQuerySchema.safeParse(request.query);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid filters",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const units = await getInventoryUnits(
    viewer,
    result.data.productId,
    result.data.locationId,
    result.data.status,
  );

  return reply.send({ units });
}

export async function getStockMovementsController(
  request: FastifyRequest<{
    Querystring: Record<string, string>;
  }>,
  reply: FastifyReply,
) {
  const result = inventoryQuerySchema.safeParse(request.query);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid filters",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const movements = await getStockMovements(
    viewer,
    result.data.locationId,
  );

  return reply.send({ movements });
}

// Maps the service's thrown reasons onto statuses the UI can act on. Anything
// unrecognised stays a 500 rather than being flattened into a 400.
const WRITE_ERRORS: Record<string, { status: number; message: string }> = {
  BALANCE_NOT_FOUND: { status: 404, message: "Stock row not found" },
  PRODUCT_NOT_FOUND: { status: 404, message: "Product not found" },
  LOCATION_INACTIVE: { status: 409, message: "That branch is closed" },
  BALANCE_NOT_EMPTY: {
    status: 409,
    message:
      "Set the quantity to 0 before removing this row, so the stock it holds is accounted for",
  },
  UNITS_STILL_HELD: {
    status: 409,
    message: "Serialized units are still held at this branch",
  },
  SERIALIZED_COUNT_MISMATCH: {
    status: 409,
    message:
      "SIM and phone quantities follow their unit records - add or sell units instead of editing the number",
  },
};

// An unrecognised failure is rethrown rather than flattened, so it still
// reaches the error handler and the logs, as the other writes here do.
function sendWriteError(reply: FastifyReply, error: unknown) {
  const known =
    error instanceof Error ? WRITE_ERRORS[error.message] : undefined;

  if (!known) {
    throw error;
  }

  return reply.status(known.status).send({ message: known.message });
}

export async function adjustBalanceController(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const result = adjustBalanceSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid correction",
      errors: result.error.flatten(),
    });
  }

  try {
    const balance = await adjustBalance(
      request.params.id,
      result.data,
      request.user.userId,
    );

    return reply.send({ message: "Stock corrected", balance });
  } catch (error) {
    return sendWriteError(reply, error);
  }
}

export async function removeBalanceController(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const result = removeBalanceSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "A reason is required",
      errors: result.error.flatten(),
    });
  }

  try {
    await removeBalance(
      request.params.id,
      result.data,
      request.user.userId,
    );

    return reply.send({ message: "Stock row removed" });
  } catch (error) {
    return sendWriteError(reply, error);
  }
}

export async function updateProductController(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const result = updateProductSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid product details",
      errors: result.error.flatten(),
    });
  }

  try {
    const product = await updateProduct(request.params.id, result.data);

    return reply.send({ message: "Product updated", product });
  } catch (error) {
    return sendWriteError(reply, error);
  }
}

export async function getHoldingsController(
  request: FastifyRequest<{ Querystring: Record<string, string> }>,
  reply: FastifyReply,
) {
  const result = inventoryQuerySchema.safeParse(request.query);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid filters",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const holdings = await getHoldings(viewer, result.data.locationId);

  return reply.send({ holdings });
}
