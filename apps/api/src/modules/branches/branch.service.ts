import { Prisma } from "database";
import { prisma } from "../../plugins/prisma.js";
import type { Viewer } from "../../middleware/auth.js";
import type {
  CreateBranchInput,
  ListBranchesQuery,
  UpdateBranchInput,
} from "./branch.schema.js";

const branchSelect = {
  id: true,
  name: true,
  type: true,
  isMainStock: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,

  users: {
    where: {
      role: "SUPERVISOR" as const,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      email: true,
    },
  },

  _count: {
    select: {
      users: true,
      balances: true,
      // Stock is a count now. Unit rows exist only for items already sold,
      // so this is "units sold at this branch", not stock on the shelf.
      units: { where: { status: "SOLD" } },
    },
  },
} satisfies Prisma.StockLocationSelect;

type RawBranch = Prisma.StockLocationGetPayload<{
  select: typeof branchSelect;
}>;

function shape(branch: RawBranch) {
  const { users, _count, ...rest } = branch;

  return {
    ...rest,
    supervisor: users[0] ?? null,
    counts: {
      users: _count.users,
      products: _count.balances,
      unitsSold: _count.units,
    },
  };
}

async function requireBranch(id: string) {
  const branch = await prisma.stockLocation.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      isActive: true,
      isMainStock: true,
    },
  });

  if (!branch) {
    throw new Error("BRANCH_NOT_FOUND");
  }

  return branch;
}

async function assertNameIsFree(name: string, exceptId?: string) {
  const clash = await prisma.stockLocation.findFirst({
    where: {
      name,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });

  if (clash) {
    throw new Error("BRANCH_NAME_EXISTS");
  }
}

// At least one active main-stock branch must remain, or supervisors would have
// nowhere to request stock from.
async function assertNotLastActiveMainStock(id: string) {
  const remaining = await prisma.stockLocation.count({
    where: {
      isMainStock: true,
      isActive: true,
      id: { not: id },
    },
  });

  if (remaining === 0) {
    throw new Error("LAST_MAIN_STOCK_BRANCH");
  }
}

export async function createBranch(data: CreateBranchInput) {
  const name = data.name.trim();

  await assertNameIsFree(name);

  const branch = await prisma.stockLocation.create({
    data: {
      name,
      // LocationType is vestigial since every location is a branch; all
      // branches are stocking locations.
      type: "WAREHOUSE",
      isMainStock: data.isMainStock,
      isActive: true,
    },
    select: branchSelect,
  });

  return shape(branch);
}

// Everything a branch's own staff may know about a DIFFERENT branch: enough to
// address a stock request to it, and nothing about its people or its stock.
function shapePublic(branch: RawBranch) {
  return {
    id: branch.id,
    name: branch.name,
    isMainStock: branch.isMainStock,
    isActive: branch.isActive,
  };
}

// The Owner sees every branch in full. A Supervisor or Sales user sees their
// own branch in full, plus the bare identity of main-stock branches so they
// have somewhere to send stock requests. Other branches are invisible.
export async function getBranches(
  query: ListBranchesQuery,
  viewer: Viewer,
) {
  const filters = {
    ...(query.isActive !== undefined
      ? { isActive: query.isActive }
      : {}),
    ...(query.isMainStock !== undefined
      ? { isMainStock: query.isMainStock }
      : {}),
  };

  const scope =
    viewer.role === "OWNER"
      ? filters
      : {
          AND: [
            filters,
            {
              OR: [
                ...(viewer.branchId
                  ? [{ id: viewer.branchId }]
                  : []),
                { isMainStock: true, isActive: true },
              ],
            },
          ],
        };

  const branches = await prisma.stockLocation.findMany({
    where: scope,
    select: branchSelect,
    orderBy: [
      { isActive: "desc" },
      { isMainStock: "desc" },
      { name: "asc" },
    ],
  });

  return branches.map((branch) =>
    viewer.role === "OWNER" || branch.id === viewer.branchId
      ? shape(branch)
      : shapePublic(branch),
  );
}

export async function getBranchById(id: string, viewer: Viewer) {
  const branch = await prisma.stockLocation.findUnique({
    where: { id },
    select: branchSelect,
  });

  if (!branch) {
    return null;
  }

  if (viewer.role === "OWNER" || branch.id === viewer.branchId) {
    return shape(branch);
  }

  // A main-stock branch is addressable by everyone, but only by identity.
  if (branch.isMainStock && branch.isActive) {
    return shapePublic(branch);
  }

  // Report another branch as missing rather than forbidden, so its existence
  // is not disclosed.
  return null;
}

export async function updateBranch(
  id: string,
  data: UpdateBranchInput,
) {
  await requireBranch(id);

  const name = data.name.trim();
  await assertNameIsFree(name, id);

  const branch = await prisma.stockLocation.update({
    where: { id },
    data: { name },
    select: branchSelect,
  });

  return shape(branch);
}

// Closing a branch must not strand staff or stock.
export async function changeBranchStatus(
  id: string,
  isActive: boolean,
) {
  const branch = await requireBranch(id);

  if (!isActive) {
    if (branch.isMainStock) {
      await assertNotLastActiveMainStock(id);
    }

    const activeUsers = await prisma.user.count({
      where: { branchId: id, isActive: true },
    });

    if (activeUsers > 0) {
      const error = new Error("BRANCH_HAS_ACTIVE_USERS");
      Object.assign(error, { activeUsers });
      throw error;
    }

    const remainingStock = await prisma.inventoryBalance.aggregate({
      where: { locationId: id },
      _sum: { quantity: true },
    });

    if ((remainingStock._sum.quantity ?? 0) > 0) {
      const error = new Error("BRANCH_HAS_STOCK");
      Object.assign(error, {
        remainingQuantity: remainingStock._sum.quantity,
      });
      throw error;
    }
  }

  const updated = await prisma.stockLocation.update({
    where: { id },
    data: { isActive },
    select: branchSelect,
  });

  return shape(updated);
}

// Several main-stock branches are allowed; at least one active one is required.
export async function setMainStock(
  id: string,
  isMainStock: boolean,
) {
  const branch = await requireBranch(id);

  if (!isMainStock && branch.isMainStock) {
    await assertNotLastActiveMainStock(id);
  }

  if (isMainStock && !branch.isActive) {
    throw new Error("BRANCH_INACTIVE");
  }

  const updated = await prisma.stockLocation.update({
    where: { id },
    data: { isMainStock },
    select: branchSelect,
  });

  return shape(updated);
}

// Only a branch that was never used can be removed outright. Anything with
// history is deactivated instead.
async function countBranchHistory(id: string) {
  const [
    users,
    balances,
    units,
    sales,
    transfersFrom,
    transfersTo,
    movementsFrom,
    movementsTo,
  ] = await prisma.$transaction([
    prisma.user.count({ where: { branchId: id } }),
    prisma.inventoryBalance.count({ where: { locationId: id } }),
    prisma.inventoryUnit.count({ where: { locationId: id } }),
    prisma.sale.count({ where: { locationId: id } }),
    prisma.stockTransfer.count({ where: { fromLocationId: id } }),
    prisma.stockTransfer.count({ where: { toLocationId: id } }),
    prisma.stockMovement.count({ where: { fromLocationId: id } }),
    prisma.stockMovement.count({ where: { toLocationId: id } }),
  ]);

  return {
    users,
    balances,
    units,
    sales,
    transfersFrom,
    transfersTo,
    movementsFrom,
    movementsTo,
  };
}

export async function deleteBranch(id: string) {
  const branch = await requireBranch(id);

  if (branch.isMainStock) {
    await assertNotLastActiveMainStock(id);
  }

  const history = await countBranchHistory(id);
  const total = Object.values(history).reduce((a, b) => a + b, 0);

  if (total > 0) {
    const error = new Error("BRANCH_HAS_HISTORY");
    Object.assign(error, {
      history: Object.fromEntries(
        Object.entries(history).filter(([, count]) => count > 0),
      ),
    });
    throw error;
  }

  await prisma.stockLocation.delete({ where: { id } });

  return { id: branch.id, name: branch.name };
}
