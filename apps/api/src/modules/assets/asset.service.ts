import { Prisma } from "database";

import { prisma } from "../../plugins/prisma.js";
import type { Viewer } from "../../middleware/auth.js";
import type {
  CreateAssetInput,
  ListAssetsQuery,
  UpdateAssetInput,
} from "./asset.schema.js";

/**
 * The branch's office equipment: what was delivered, what it is, and whether
 * it still works.
 *
 * This is a register, not stock: nothing here is sold, issued or counted at
 * the end of a shift. It answers "what does this branch have, and what does
 * it still owe the business" — the question an audit asks and a sales report
 * cannot.
 */

const assetDetail = {
  id: true,
  name: true,
  category: true,
  status: true,
  quantity: true,
  serialNumber: true,
  cost: true,
  receivedAt: true,
  note: true,
  createdAt: true,
  location: { select: { id: true, name: true } },
  recordedBy: { select: { id: true, name: true, role: true } },
};

/** The Owner sees every branch; everyone else only their own. */
function scopeFor(
  viewer: Viewer,
  query: ListAssetsQuery,
): Prisma.OfficeAssetWhereInput {
  const branch =
    viewer.role === "OWNER"
      ? query.locationId
      : (viewer.branchId ?? "__none__");

  return {
    ...(branch ? { locationId: branch } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.status ? { status: query.status } : {}),
  };
}

export async function getAssets(query: ListAssetsQuery, viewer: Viewer) {
  return prisma.officeAsset.findMany({
    where: scopeFor(viewer, query),
    select: assetDetail,
    orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
  });
}

export async function createAsset(data: CreateAssetInput, viewer: Viewer) {
  const branch = await prisma.stockLocation.findUnique({
    where: { id: data.locationId },
    select: { id: true, isActive: true },
  });

  if (!branch) {
    throw new Error("BRANCH_NOT_FOUND");
  }

  // Equipment goes to a branch that is trading. A closed branch's equipment
  // is recorded history, not a new delivery.
  if (!branch.isActive) {
    throw new Error("BRANCH_INACTIVE");
  }

  return prisma.officeAsset.create({
    data: {
      locationId: branch.id,
      name: data.name,
      category: data.category,
      quantity: data.quantity,
      serialNumber: data.serialNumber || null,
      cost: data.cost === undefined ? null : new Prisma.Decimal(data.cost),
      ...(data.receivedAt ? { receivedAt: new Date(data.receivedAt) } : {}),
      note: data.note || null,
      recordedById: viewer.userId,
    },
    select: assetDetail,
  });
}

export async function updateAsset(
  id: string,
  data: UpdateAssetInput,
  viewer: Viewer,
) {
  const asset = await prisma.officeAsset.findUnique({
    where: { id },
    select: { id: true, locationId: true },
  });

  if (!asset) {
    throw new Error("ASSET_NOT_FOUND");
  }

  // Report another branch's equipment as missing rather than forbidden.
  if (viewer.role !== "OWNER" && asset.locationId !== viewer.branchId) {
    throw new Error("ASSET_NOT_FOUND");
  }

  return prisma.officeAsset.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.category !== undefined ? { category: data.category } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.quantity !== undefined ? { quantity: data.quantity } : {}),
      ...(data.serialNumber !== undefined
        ? { serialNumber: data.serialNumber || null }
        : {}),
      ...(data.cost !== undefined
        ? { cost: new Prisma.Decimal(data.cost) }
        : {}),
      ...(data.receivedAt !== undefined
        ? { receivedAt: new Date(data.receivedAt) }
        : {}),
      ...(data.note !== undefined ? { note: data.note || null } : {}),
    },
    select: assetDetail,
  });
}

export async function deleteAsset(id: string) {
  const asset = await prisma.officeAsset.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!asset) {
    throw new Error("ASSET_NOT_FOUND");
  }

  await prisma.officeAsset.delete({ where: { id } });
}
