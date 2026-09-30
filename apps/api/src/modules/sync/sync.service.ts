import { SyncStatus } from "database";

import { prisma } from "../../plugins/prisma.js";
import type { Viewer } from "../../middleware/auth.js";
import { SYNC_ENTITIES, type SyncEntity } from "./sync.schema.js";

/**
 * How many records a device has not seen yet, per entity.
 *
 * Every count is a real query against `updatedAt`, scoped exactly as the
 * corresponding list endpoint is: a salesperson is told about their own sales,
 * a supervisor about their branch, the Owner about everything. A device is
 * therefore never told that something changed which it would not be allowed
 * to read.
 */
async function countChanges(
  entity: SyncEntity,
  since: Date | null,
  viewer: Viewer,
): Promise<number> {
  // No `since` means this device has never synced, so everything is new.
  const changed = since ? { updatedAt: { gt: since } } : {};
  const isOwner = viewer.role === "OWNER";

  // A supervisor or salesperson with no branch can see nothing branch-scoped.
  // "__none__" is the same impossible id the list services use.
  const branch = viewer.branchId ?? "__none__";

  switch (entity) {
    case "sales":
      return prisma.sale.count({
        where: {
          ...changed,
          ...(isOwner
            ? {}
            : viewer.role === "SALES"
              ? { salespersonId: viewer.userId }
              : { locationId: branch }),
        },
      });

    case "requests":
      return prisma.stockRequest.count({
        where: {
          ...changed,
          ...(isOwner ? {} : { requestedBy: { branchId: branch } }),
        },
      });

    case "inventory":
      return prisma.inventoryBalance.count({
        where: { ...changed, ...(isOwner ? {} : { locationId: branch }) },
      });

    case "receipts":
      return prisma.bankReceipt.count({
        where: {
          ...changed,
          ...(isOwner ? {} : { uploadedBy: { branchId: branch } }),
        },
      });

    // The catalogue is the same for every branch.
    case "products":
      return prisma.product.count({ where: changed });

    case "users":
      return prisma.user.count({
        where: { ...changed, ...(isOwner ? {} : { branchId: branch }) },
      });

    case "branches":
      return prisma.stockLocation.count({
        where: { ...changed, ...(isOwner ? {} : { id: branch }) },
      });
  }
}

export async function getChanges(
  since: string | undefined,
  entities: readonly SyncEntity[] | undefined,
  viewer: Viewer,
) {
  const cutoff = since ? new Date(since) : null;
  const wanted = entities?.length ? entities : SYNC_ENTITIES;

  const counts = await Promise.all(
    wanted.map(async (entity) => [
      entity,
      await countChanges(entity, cutoff, viewer),
    ]),
  );

  const byEntity = Object.fromEntries(counts) as Record<SyncEntity, number>;
  const total = Object.values(byEntity).reduce((sum, n) => sum + n, 0);

  return {
    // Echoed back so the client stores a server clock, not its own. A device
    // with a fast clock would otherwise skip records written in the gap.
    serverTime: new Date().toISOString(),
    since: cutoff?.toISOString() ?? null,
    total,
    entities: byEntity,
  };
}

/** This device's replayed mutations, newest first. */
export async function getRecords(deviceId: string, limit: number) {
  const records = await prisma.syncRecord.findMany({
    where: { deviceId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      clientMutationId: true,
      entityType: true,
      entityId: true,
      operation: true,
      status: true,
      errorMessage: true,
      processedAt: true,
      createdAt: true,
    },
  });

  const pending = await prisma.syncRecord.count({
    where: { deviceId, status: SyncStatus.PENDING },
  });

  const failed = await prisma.syncRecord.count({
    where: { deviceId, status: SyncStatus.FAILED },
  });

  return { records, pending, failed };
}
