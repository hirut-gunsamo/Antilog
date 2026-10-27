import type {
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { Prisma } from "database";
import { z } from "zod";

import { loadViewer } from "../../middleware/auth.js";
import { prisma } from "../../plugins/prisma.js";
import { branchPrices } from "./branchPrice.js";

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

      if (error.message === "PHONE_DETAILS_REQUIRED") {
        return reply.status(400).send({
          message: "Enter the phone's model and storage",
        });
      }
    }

    throw error;
  }
}

type Listed = Awaited<ReturnType<typeof getProducts>>[number];

/**
 * The Owner sees every product's own price and each branch's price. Everyone
 * else sees the price at their own branch, and never the buying price.
 */
export async function getProductsController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const products = await getProducts();

  if (request.user?.role === "OWNER") {
    return reply.send({
      products: products.map(({ branchPrices: set, ...product }: Listed) => ({
        ...product,
        branchPrices: set.map((row) => ({ branchId: row.locationId, name: row.location.name, price: row.price })),
      })),
    });
  }

  const viewer = await loadViewer(request);
  const prices = await branchPrices(viewer?.branchId, products.map((product) => product.id));
  return reply.send({
    products: products.map(({ branchPrices: _set, ...product }: Listed) => ({
      ...product,
      price: prices.get(product.id) ?? product.price,
      costPrice: null,
    })),
  });
}

const branchPriceSchema = z.object({ price: z.coerce.number().nonnegative().max(100_000_000) });

/** The Owner sets what a product sells for at one branch... */
export async function setBranchPriceController(
  request: FastifyRequest<{ Params: { id: string; branchId: string } }>,
  reply: FastifyReply,
) {
  const result = branchPriceSchema.safeParse(request.body);
  if (!result.success) return reply.status(400).send({ message: "Enter a price" });

  const [product, branch] = await Promise.all([
    prisma.product.findUnique({ where: { id: request.params.id }, select: { id: true, status: true } }),
    prisma.stockLocation.findUnique({ where: { id: request.params.branchId }, select: { id: true } }),
  ]);
  if (!product || product.status !== "ACTIVE") return reply.status(404).send({ message: "Product not found" });
  if (!branch) return reply.status(404).send({ message: "Branch not found" });

  await prisma.productBranchPrice.upsert({
    where: { productId_locationId: { productId: product.id, locationId: branch.id } },
    create: { productId: product.id, locationId: branch.id, price: result.data.price },
    update: { price: result.data.price },
  });
  return reply.send({ message: "Saved" });
}

/** ...or takes it off, so the branch sells at the product's own price again. */
export async function removeBranchPriceController(
  request: FastifyRequest<{ Params: { id: string; branchId: string } }>,
  reply: FastifyReply,
) {
  await prisma.productBranchPrice.deleteMany({
    where: { productId: request.params.id, locationId: request.params.branchId },
  });
  return reply.send({ message: "Using the product's own price" });
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

  if (request.user?.role === "OWNER") return reply.send({ product });

  // Everyone else: their branch's price, and never the buying price.
  const viewer = await loadViewer(request);
  const prices = await branchPrices(viewer?.branchId, [product.id]);
  return reply.send({
    product: { ...product, price: prices.get(product.id) ?? product.price, costPrice: null },
  });
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
