import type { FastifyReply, FastifyRequest } from "fastify";

import {
  createProductTypeSchema,
  listProductTypesQuerySchema,
  updateProductTypeSchema,
} from "./productType.schema.js";

import {
  createType,
  deleteType,
  getTypeTree,
  updateType,
} from "./productType.service.js";

const MESSAGES: Record<string, { status: number; message: string }> = {
  PARENT_NOT_FOUND: { status: 404, message: "That parent type no longer exists" },
  PARENT_INACTIVE: {
    status: 400,
    message: "That brand has been retired",
  },
  PARENT_WRONG_CATEGORY: {
    status: 400,
    message: "A type can only sit under one of its own category",
  },
  TYPE_EXISTS: { status: 409, message: "That name is already in this list" },
  CATEGORY_NOT_FOUND: { status: 404, message: "That category no longer exists" },
  TYPE_NOT_FOUND: { status: 404, message: "That type no longer exists" },
  TYPE_HAS_CHILDREN: {
    status: 409,
    message: "Delete the types under it first",
  },
  TYPE_HAS_PRODUCTS: {
    status: 409,
    message: "Delete the products using it first",
  },
};

function fail(reply: FastifyReply, error: unknown) {
  const known = error instanceof Error ? MESSAGES[error.message] : undefined;

  if (!known) throw error;

  return reply.status(known.status).send({ message: known.message });
}

export async function getProductTypesController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const query = listProductTypesQuerySchema.safeParse(request.query);

  if (!query.success) {
    return reply.status(400).send({ message: "Invalid filter" });
  }

  return reply.send({ types: await getTypeTree(query.data.categoryId) });
}

export async function createProductTypeController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = createProductTypeSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid type",
      errors: result.error.flatten(),
    });
  }

  try {
    return reply.status(201).send({ type: await createType(result.data) });
  } catch (error) {
    return fail(reply, error);
  }
}

export async function updateProductTypeController(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const result = updateProductTypeSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid change",
      errors: result.error.flatten(),
    });
  }

  try {
    return reply.send({
      type: await updateType(request.params.id, result.data),
    });
  } catch (error) {
    return fail(reply, error);
  }
}

export async function deleteProductTypeController(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  try {
    return reply.send({ outcome: await deleteType(request.params.id) });
  } catch (error) {
    return fail(reply, error);
  }
}
