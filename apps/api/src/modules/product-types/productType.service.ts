import { Prisma } from "database";
import { prisma } from "../../plugins/prisma.js";
import type {
  CreateProductTypeInput,
  UpdateProductTypeInput,
} from "./productType.schema.js";

const typeSelect = {
  id: true,
  category: true,
  categoryId: true,
  parentId: true,
  name: true,
  isActive: true,
} as const;

export type TypeNode = {
  id: string;
  category: string;
  categoryId: string | null;
  parentId: string | null;
  name: string;
  isActive: boolean;
  children: TypeNode[];
};

/**
 * The whole tree for a category, or for every category.
 *
 * Built in memory from one flat query: the tree is at most three deep and
 * holds tens of rows, so a recursive query would cost more than it saves.
 */
export async function getTypeTree(categoryId?: string): Promise<TypeNode[]> {
  const rows = await prisma.productType.findMany({
    where: categoryId ? { categoryId } : {},
    select: typeSelect,
    orderBy: [{ name: "asc" }],
  });

  const byId = new Map<string, TypeNode>();
  for (const row of rows) {
    byId.set(row.id, { ...row, children: [] });
  }

  const roots: TypeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
}

export async function createType(data: CreateProductTypeInput) {
  const category = await prisma.category.findUnique({
    where: { id: data.categoryId },
    select: { id: true, kind: true, isActive: true },
  });

  if (!category || !category.isActive) {
    throw new Error("CATEGORY_NOT_FOUND");
  }

  if (data.parentId) {
    const parent = await prisma.productType.findUnique({
      where: { id: data.parentId },
      select: { id: true, categoryId: true, isActive: true },
    });

    if (!parent) {
      throw new Error("PARENT_NOT_FOUND");
    }

    if (!parent.isActive) {
      throw new Error("PARENT_INACTIVE");
    }

    // A phone model cannot hang off a voucher type.
    if (parent.categoryId !== data.categoryId) {
      throw new Error("PARENT_WRONG_CATEGORY");
    }
  }

  const clash = await prisma.productType.findFirst({
    where: {
      categoryId: data.categoryId,
      parentId: data.parentId ?? null,
      name: data.name,
    },
    select: { id: true },
  });

  if (clash) {
    throw new Error("TYPE_EXISTS");
  }

  return prisma.productType.create({
    data: {
      category: category.kind,
      categoryId: category.id,
      name: data.name,
      parentId: data.parentId ?? null,
    },
    select: typeSelect,
  });
}

export async function updateType(id: string, data: UpdateProductTypeInput) {
  const type = await prisma.productType.findUnique({
    where: { id },
    select: { id: true, categoryId: true, parentId: true },
  });

  if (!type) {
    throw new Error("TYPE_NOT_FOUND");
  }

  // Retiring a brand would hide its models without saying so, and the
  // products under them would still be on sale. Empty it first.
  if (data.isActive === false) {
    const children = await prisma.productType.count({
      where: { parentId: id, isActive: true },
    });

    if (children > 0) {
      throw new Error("TYPE_HAS_CHILDREN");
    }

    const products = await prisma.product.count({
      where: { typeId: id, status: "ACTIVE" },
    });

    if (products > 0) {
      throw new Error("TYPE_HAS_PRODUCTS");
    }
  }

  if (data.name) {
    const clash = await prisma.productType.findFirst({
      where: {
        categoryId: type.categoryId,
        parentId: type.parentId,
        name: data.name,
        id: { not: id },
      },
      select: { id: true },
    });

    if (clash) {
      throw new Error("TYPE_EXISTS");
    }
  }

  return prisma.productType.update({
    where: { id },
    data: {
      ...(data.name ? { name: data.name } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
    select: typeSelect,
  });
}

/**
 * Removes a type. Refused while live types sit under it or live products use
 * it. If only deleted products still point at it, it is retired instead, so
 * their history keeps its name.
 */
export async function deleteType(id: string): Promise<"deleted" | "archived"> {
  const type = await prisma.productType.findUnique({
    where: { id },
    select: { id: true, isActive: true },
  });

  if (!type || !type.isActive) {
    throw new Error("TYPE_NOT_FOUND");
  }

  const children = await prisma.productType.count({
    where: { parentId: id, isActive: true },
  });

  if (children > 0) {
    throw new Error("TYPE_HAS_CHILDREN");
  }

  const products = await prisma.product.count({
    where: { typeId: id, status: "ACTIVE" },
  });

  if (products > 0) {
    throw new Error("TYPE_HAS_PRODUCTS");
  }

  try {
    await prisma.productType.delete({ where: { id } });
    return "deleted";
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      await prisma.productType.update({
        where: { id },
        data: { isActive: false },
      });
      return "archived";
    }

    throw error;
  }
}
