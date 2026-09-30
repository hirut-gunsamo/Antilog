import { prisma } from "../../plugins/prisma.js";
import { Prisma } from "database";
import type {
  CreateProductInput,
  UpdateProductInput,
} from "./product.schema.js";
import { buildName, buildSku } from "./product.naming.js";

/** Airtime is sold by the carta: 20 cards. */
export const CARDS_PER_CARTA = 20;

/** A carta sells at 5% off its 20 cards: 10 -> 190, 25 -> 475, 100 -> 1,900. */
export const CARTA_DISCOUNT = 0.05;

export function cartaPrice(denomination: number) {
  return Math.round(denomination * CARDS_PER_CARTA * (1 - CARTA_DISCOUNT) * 100) / 100;
}

/** Root first: ["iPhone", "15 Pro Max"]. At most three deep. */
async function pathOf(typeId: string): Promise<{ category: string; path: string[] }> {
  const path: string[] = [];
  let category = "";
  let current: string | null = typeId;

  for (let depth = 0; current && depth < 5; depth++) {
    const node: {
      name: string;
      parentId: string | null;
      category: string;
    } | null = await prisma.productType.findUnique({
      where: { id: current },
      select: { name: true, parentId: true, category: true },
    });

    if (!node) throw new Error("TYPE_NOT_FOUND");

    path.unshift(node.name);
    category = node.category;
    current = node.parentId;
  }

  return { category, path };
}

/** Appends -2, -3 … until the code is free. */
async function freeSku(base: string): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;

    const taken = await prisma.product.findUnique({
      where: { sku: candidate },
      select: { id: true },
    });

    if (!taken) return candidate;
  }

  throw new Error("SKU_EXHAUSTED");
}

export async function createProduct(data: CreateProductInput) {
  const { category, path } = await pathOf(data.typeId);

  // A retired type keeps its old products readable but takes no new ones.
  const chosen = await prisma.productType.findUnique({
    where: { id: data.typeId },
    select: { isActive: true, categoryId: true },
  });

  if (!chosen?.isActive) {
    throw new Error("TYPE_INACTIVE");
  }

  if (category === "AIRTIME_VOUCHER" && data.denomination == null) {
    throw new Error("DENOMINATION_REQUIRED");
  }

  const parts = {
    category,
    typePath: path,
    model: data.model?.trim() || null,
    storage: data.storage ?? null,
    color: data.color ?? null,
    denomination: data.denomination ?? null,
  };

  const name = data.name?.trim() || buildName(parts);
  const base = buildSku(parts);

  // Airtime sells by the carta at its fixed price, so the price is not asked for.
  const price =
    category === "AIRTIME_VOUCHER" ? cartaPrice(data.denomination!) : data.price;

  // freeSku() checks the SKU is free, then we insert it afterwards — those
  // two steps are not atomic, so two requests can both see the same code
  // as free and race to insert it. The unique index on Product.sku is the
  // real guard: when we lose that race (P2002), recompute the next free
  // code from the same base and try again, up to a few attempts.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const sku = await freeSku(base);

    try {
      return await prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            sku,
            name,
            description: data.description,
            price,
            category: category as never,
            typeId: data.typeId,
            categoryId: chosen.categoryId,
          },
        });

        if (category === "SIM_CARD") {
          await tx.simProduct.create({
            data: { productId: product.id, network: null },
          });
        }

        if (category === "AIRTIME_VOUCHER") {
          await tx.voucherProduct.create({
            data: { productId: product.id, denomination: data.denomination! },
          });
        }

        if (category === "PHONE") {
          // Copies of the type path. Sixteen web files read these.
          await tx.phoneProduct.create({
            data: {
              productId: product.id,
              brand: path[0] ?? "",
              model:
                data.model?.trim() ||
                path.slice(1).join(" ") ||
                (path[0] ?? ""),
              storage: data.storage,
              color: data.color,
            },
          });
        }

        return getProductById(product.id, tx);
      });
    } catch (error) {
      const isDuplicateSku =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002";

      if (!isDuplicateSku || attempt === 3) {
        throw error;
      }
    }
  }

  throw new Error("SKU_EXHAUSTED");
}

type PrismaTransaction = Parameters<
  Parameters<typeof prisma.$transaction>[0]
>[0];

export async function getProductById(
  id: string,
  db: typeof prisma | PrismaTransaction = prisma,
) {
  return db.product.findUnique({
    where: { id },

    include: {
      simDetails: true,
      voucherDetails: true,
      phoneDetails: true,
      type: { select: { id: true, name: true, parentId: true } },
      productCategory: { select: { id: true, name: true, kind: true } },
    },
  });
}

/** The live catalogue. A deleted product that sales still point at is kept
 * as INACTIVE, and is not part of it. */
export async function getProducts() {
  return prisma.product.findMany({
    where: { status: "ACTIVE" },

    include: {
      simDetails: true,
      voucherDetails: true,
      phoneDetails: true,
      type: { select: { id: true, name: true, parentId: true } },
      productCategory: { select: { id: true, name: true, kind: true } },

      inventoryBalances: {
        select: {
          quantity: true,
          locationId: true,
        },
      },
    },

    orderBy: {
      createdAt: "desc",
    },
  });
}

/** Only a product still in the catalogue can be changed or deleted. */
async function liveProduct(id: string) {
  const product = await prisma.product.findUnique({
    where: { id },
    select: { id: true, status: true, category: true },
  });

  if (!product || product.status !== "ACTIVE") {
    throw new Error("PRODUCT_NOT_FOUND");
  }

  return product;
}

export async function updateProduct(id: string, data: UpdateProductInput) {
  const product = await liveProduct(id);

  const isVoucher = product.category === "AIRTIME_VOUCHER";
  const isPhone = product.category === "PHONE";

  // The Owner may set airtime's carta price by hand (it changes over time);
  // with none given, a new value gets the standard 5%-off carta price.
  const price = isVoucher
    ? data.price !== undefined
      ? data.price
      : data.denomination !== undefined
        ? cartaPrice(data.denomination)
        : undefined
    : data.price;

  return prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined
          ? { description: data.description?.trim() || null }
          : {}),
        ...(price !== undefined ? { price } : {}),
      },
    });

    if (isVoucher && data.denomination !== undefined) {
      await tx.voucherProduct.upsert({
        where: { productId: id },
        create: { productId: id, denomination: data.denomination },
        update: { denomination: data.denomination },
      });
    }

    if (
      isPhone &&
      (data.model !== undefined ||
        data.storage !== undefined ||
        data.color !== undefined)
    ) {
      await tx.phoneProduct.updateMany({
        where: { productId: id },
        data: {
          ...(data.model !== undefined ? { model: data.model } : {}),
          ...(data.storage !== undefined
            ? { storage: data.storage?.trim() || null }
            : {}),
          ...(data.color !== undefined
            ? { color: data.color?.trim() || null }
            : {}),
        },
      });
    }

    return getProductById(id, tx);
  });
}

/**
 * Removes a product from the catalogue.
 *
 * Refused while any branch or salesperson still holds some of it: deleting
 * would make that stock vanish from every count. Once it holds nothing, it
 * is deleted outright if nothing ever referred to it; otherwise sales,
 * requests and movements still point at it, so it is kept as INACTIVE —
 * gone from the catalogue and from every form, still readable in history.
 */
export async function deleteProduct(
  id: string,
): Promise<"deleted" | "archived"> {
  await liveProduct(id);

  const [stock, held] = await Promise.all([
    prisma.inventoryBalance.aggregate({
      where: { productId: id },
      _sum: { quantity: true },
    }),
    prisma.salespersonHolding.aggregate({
      where: { productId: id },
      _sum: { quantity: true },
    }),
  ]);

  if ((stock._sum.quantity ?? 0) !== 0 || (held._sum.quantity ?? 0) !== 0) {
    throw new Error("PRODUCT_HOLDS_STOCK");
  }

  try {
    await prisma.product.delete({ where: { id } });
    return "deleted";
  } catch (error) {
    // Something in the history still refers to it.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      await prisma.product.update({
        where: { id },
        data: { status: "INACTIVE" },
      });
      return "archived";
    }

    throw error;
  }
}
