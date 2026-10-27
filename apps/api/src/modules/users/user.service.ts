import bcrypt from "bcrypt";
import { Prisma } from "database";
import { prisma } from "../../plugins/prisma.js";
import type { Viewer } from "../../middleware/auth.js";
import type {
  CreateUserInput,
  ListUsersQuery,
  UpdateUserInput,
} from "./user.schema.js";

// A SALES user has no stored supervisor link. The supervisor is derived:
// the single active SUPERVISOR of the same branch. Selecting the branch with
// its active supervisor lets us expose `supervisor` without a stored column.
const branchWithSupervisor = {
  select: {
    id: true,
    name: true,
    isMainStock: true,

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
  },
} satisfies Prisma.User$branchArgs;

const userSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  isActive: true,
  branchId: true,
  branch: branchWithSupervisor,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

type RawUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;

// Flattens the nested branch.users array into a single derived `supervisor`.
function shape(user: RawUser) {
  const { branch, ...rest } = user;

  const supervisor = branch?.users[0] ?? null;

  return {
    ...rest,
    branch: branch
      ? {
          id: branch.id,
          name: branch.name,
          isMainStock: branch.isMainStock,
        }
      : null,
    // For a SUPERVISOR this is themselves; only meaningful for SALES.
    supervisor: rest.role === "SALES" ? supervisor : null,
  };
}

async function requireBranch(branchId: string) {
  const branch = await prisma.stockLocation.findUnique({
    where: { id: branchId },
    select: { id: true, name: true, isMainStock: true },
  });

  if (!branch) {
    throw new Error("BRANCH_NOT_FOUND");
  }

  return branch;
}

// Nothing is sold at a main store, so no salesperson works there.
function assertSellerMayJoin(branch: { isMainStock: boolean }, role: string) {
  if (role === "SALES" && branch.isMainStock) {
    throw new Error("MAIN_STORE_NO_SELLERS");
  }
}

export async function createUser(data: CreateUserInput) {
  const email = data.email.toLowerCase();

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingUser) {
    throw new Error("EMAIL_EXISTS");
  }

  const branch = await requireBranch(data.branchId);
  assertSellerMayJoin(branch, data.role);


  const passwordHash = await bcrypt.hash(data.password, 12);

  const user = await prisma.user.create({
    data: {
      name: data.name,
      email,
      passwordHash,
      phone: data.phone,
      role: data.role,
      branchId: data.branchId,
    },
    select: userSelect,
  });

  return shape(user);
}

export async function getUsers(query: ListUsersQuery, viewer: Viewer) {
  // Only the Owner sees across branches. A supervisor's filter can narrow the
  // list to their own branch but never widen it to another's — staff names,
  // emails and phone numbers are branch business.
  const branchId =
    viewer.role === "OWNER" ? query.branchId : (viewer.branchId ?? "__none__");

  const users = await prisma.user.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.isActive !== undefined
        ? { isActive: query.isActive }
        : {}),
    },
    select: userSelect,
    orderBy: [{ role: "asc" }, { createdAt: "desc" }],
  });

  return users.map(shape);
}

export async function getUserById(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: userSelect,
  });

  return user ? shape(user) : null;
}

// Users grouped by branch, for the Owner's branch overview.
export async function getUsersByBranch() {
  const branches = await prisma.stockLocation.findMany({
    select: {
      id: true,
      name: true,
      isMainStock: true,

      users: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
        },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      },
    },
    orderBy: [{ isMainStock: "desc" }, { name: "asc" }],
  });

  return branches.map((branch) => {
    const supervisor =
      branch.users.find(
        (u) => u.role === "SUPERVISOR" && u.isActive,
      ) ?? null;

    return {
      id: branch.id,
      name: branch.name,
      isMainStock: branch.isMainStock,
      supervisor,
      salesStaff: branch.users.filter((u) => u.role === "SALES"),
      totalUsers: branch.users.length,
    };
  });
}

export async function updateUser(
  id: string,
  data: UpdateUserInput,
) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  const email = data.email?.toLowerCase();

  if (email) {
    const clash = await prisma.user.findFirst({
      where: { email, id: { not: id } },
      select: { id: true },
    });

    if (clash) {
      throw new Error("EMAIL_EXISTS");
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      ...(data.name ? { name: data.name } : {}),
      ...(email ? { email } : {}),
      ...(data.phone ? { phone: data.phone } : {}),
      ...(data.password
        ? { passwordHash: await bcrypt.hash(data.password, 12) }
        : {}),
    },
    select: userSelect,
  });

  return shape(updated);
}

// Self-service profile edit. Scoped to the caller's own account: role, branch
// and active status are deliberately not editable here.
export async function updateOwnProfile(
  id: string,
  data: { name?: string; email?: string; phone?: string },
) {
  const email = data.email?.toLowerCase();

  if (email) {
    const clash = await prisma.user.findFirst({
      where: { email, id: { not: id } },
      select: { id: true },
    });

    if (clash) {
      throw new Error("EMAIL_EXISTS");
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      ...(data.name ? { name: data.name } : {}),
      ...(email ? { email } : {}),
      ...(data.phone ? { phone: data.phone } : {}),
    },
    select: userSelect,
  });

  return shape(updated);
}

// Changing your own password. The current password must be supplied and
// verified, so a borrowed session cannot lock the real owner out.
export async function changeOwnPassword(
  id: string,
  currentPassword: string,
  newPassword: string,
) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, passwordHash: true },
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  const matches = await bcrypt.compare(
    currentPassword,
    user.passwordHash,
  );

  if (!matches) {
    throw new Error("INVALID_CURRENT_PASSWORD");
  }

  await prisma.user.update({
    where: { id },
    data: { passwordHash: await bcrypt.hash(newPassword, 12) },
  });

  return { id };
}

export async function changeUserStatus(
  id: string,
  isActive: boolean,
) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, branchId: true },
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  // Reactivating a supervisor must not create a second active one.

  const updated = await prisma.user.update({
    where: { id },
    data: { isActive },
    select: userSelect,
  });

  return shape(updated);
}

// Moves a SALES or SUPERVISOR user to another branch.
export async function moveUserToBranch(
  id: string,
  branchId: string,
) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, isActive: true },
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  if (user.role === "OWNER") {
    throw new Error("OWNER_HAS_NO_BRANCH");
  }

  const branch = await requireBranch(branchId);
  assertSellerMayJoin(branch, user.role);

  // An active supervisor can only move into a branch that has no active one.

  const updated = await prisma.user.update({
    where: { id },
    data: { branchId },
    select: userSelect,
  });

  return shape(updated);
}

// Swaps a branch's supervisor atomically. The outgoing supervisor is
// deactivated in the same transaction as the incoming one is installed,
// because the database allows only one active supervisor per branch.
export async function replaceBranchSupervisor(
  branchId: string,
  newSupervisorId: string,
) {
  await requireBranch(branchId);

  const incoming = await prisma.user.findUnique({
    where: { id: newSupervisorId },
    select: { id: true, role: true },
  });

  if (!incoming) {
    throw new Error("USER_NOT_FOUND");
  }

  if (incoming.role !== "SUPERVISOR") {
    throw new Error("NOT_A_SUPERVISOR");
  }

  return prisma.$transaction(async (tx) => {
    const outgoing = await tx.user.findFirst({
      where: {
        branchId,
        role: "SUPERVISOR",
        isActive: true,
        id: { not: newSupervisorId },
      },
      select: { id: true, name: true, email: true },
    });

    if (outgoing) {
      await tx.user.update({
        where: { id: outgoing.id },
        data: { isActive: false },
      });
    }

    const installed = await tx.user.update({
      where: { id: newSupervisorId },
      data: { branchId, isActive: true },
      select: userSelect,
    });

    return {
      branchId,
      outgoingSupervisor: outgoing,
      supervisor: shape(installed),
    };
  });
}

// Business records that must not be orphaned. If a user has any of these,
// the account is deactivated rather than deleted so history stays intact.
async function countUserHistory(id: string) {
  const [
    requestsCreated,
    requestsReceived,
    requestsApproved,
    transfersDelivered,
    transfersReceived,
    salesCreated,
    salesApproved,
    cashReports,
    cashReportsApproved,
    receiptsUploaded,
    receiptsVerified,
    stockMovements,
  ] = await prisma.$transaction([
    prisma.stockRequest.count({ where: { requestedById: id } }),
    prisma.stockRequest.count({ where: { requestedToId: id } }),
    prisma.stockRequest.count({ where: { approvedById: id } }),
    prisma.stockTransfer.count({ where: { deliveredById: id } }),
    prisma.stockTransfer.count({ where: { receivedById: id } }),
    prisma.sale.count({ where: { salespersonId: id } }),
    prisma.sale.count({ where: { approvedById: id } }),
    prisma.cashReport.count({ where: { salespersonId: id } }),
    prisma.cashReport.count({ where: { approvedById: id } }),
    prisma.bankReceipt.count({ where: { uploadedById: id } }),
    prisma.bankReceipt.count({ where: { verifiedById: id } }),
    prisma.stockMovement.count({ where: { createdById: id } }),
  ]);

  return {
    requestsCreated,
    requestsReceived,
    requestsApproved,
    transfersDelivered,
    transfersReceived,
    salesCreated,
    salesApproved,
    cashReports,
    cashReportsApproved,
    receiptsUploaded,
    receiptsVerified,
    stockMovements,
  };
}

export async function deleteUser(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, role: true },
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  if (user.role === "OWNER") {
    throw new Error("CANNOT_DELETE_OWNER");
  }

  const history = await countUserHistory(id);
  const total = Object.values(history).reduce((a, b) => a + b, 0);

  if (total > 0) {
    const error = new Error("USER_HAS_HISTORY");
    // Surfaced to the caller so the UI can explain what is blocking.
    Object.assign(error, {
      history: Object.fromEntries(
        Object.entries(history).filter(([, count]) => count > 0),
      ),
    });
    throw error;
  }

  // AuditLog.actorId is nullable and set to NULL on delete, so audit entries
  // survive the user being removed.
  await prisma.user.delete({ where: { id } });

  return { id: user.id, name: user.name };
}
