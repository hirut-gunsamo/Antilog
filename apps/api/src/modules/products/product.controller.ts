import type {
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { Prisma } from "database";

import {
  createProductSchema,
  updateProductSchema,
} from "./product.schema.js";

import {
  createProduct,
  getProductById,
  getProducts,
  updateProduct,
  deleteProduct,
} from "./product.service.js";

export async function createProductController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = createProductSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid product data",
      errors: result.error.flatten(),
    });
  }

  try {
    const product = await createProduct(result.data);

    return reply.status(201).send({
      message: "Product created successfully",
      product,
    });
  } catch (error) {
    // Backstop for the case where createProduct's own retries still lose
    // the race on the unique sku index.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return reply.status(409).send({
        message: "A product with this code already exists",
      });
    }

    if (error instanceof Error) {
      if (error.message === "TYPE_NOT_FOUND") {
        return reply.status(404).send({
          message: "That product type no longer exists",
        });
      }

      if (error.message === "TYPE_INACTIVE") {
        return reply.status(400).send({
          message: "That product type has been retired",
        });
      }

      if (error.message === "DENOMINATION_REQUIRED") {
        return reply.status(400).send({
          message: "A voucher needs its value",
        });
      }
    }

    throw error;
  }
}

export async function getProductsController(
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  const products = await getProducts();

  return reply.send({ products });
}

export async function getProductController(
  request: FastifyRequest<{
    Params: { id: string };
  }>,
  reply: FastifyReply,
) {
  const product = await getProductById(request.params.id);

  if (!product) {
    return reply.status(404).send({
      message: "Product not found",
    });
  }

  return reply.send({ product });
}

export async function updateProductController(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const result = updateProductSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid product data",
      errors: result.error.flatten(),
    });
  }

  try {
    const product = await updateProduct(request.params.id, result.data);

    return reply.send({ message: "Product updated", product });
  } catch (error) {
    if (error instanceof Error && error.message === "PRODUCT_NOT_FOUND") {
      return reply.status(404).send({ message: "Product not found" });
    }

    throw error;
  }
}

export async function deleteProductController(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  try {
    const outcome = await deleteProduct(request.params.id);

    return reply.send({ message: "Product deleted", outcome });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "PRODUCT_NOT_FOUND") {
        return reply.status(404).send({ message: "Product not found" });
      }

      if (error.message === "PRODUCT_HOLDS_STOCK") {
        return reply.status(409).send({
          message:
            "This product still has stock. Move, sell or write it off first.",
        });
      }
    }

    throw error;
  }
}
