import type {
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { prisma } from "../../plugins/prisma.js";
import { loadViewer } from "../../middleware/auth.js";

import {
  createUserSchema,
  updateUserSchema,
  updateUserStatusSchema,
  updateOwnProfileSchema,
  changeOwnPasswordSchema,
  assignBranchSchema,
  replaceSupervisorSchema,
  listUsersQuerySchema,
} from "./user.schema.js";

import {
  createUser,
  getUsers,
  getUserById,
  getUsersByBranch,
  updateUser,
  updateOwnProfile,
  changeOwnPassword,
  changeUserStatus,
  moveUserToBranch,
  replaceBranchSupervisor,
  deleteUser,
} from "./user.service.js";

type UserParams = {
  id: string;
};

type BranchParams = {
  branchId: string;
};

// Maps service error codes to HTTP responses. Kept in one place so every
// controller below reports the same failure the same way.
function handleUserError(
  error: unknown,
  reply: FastifyReply,
): FastifyReply | null {
  if (!(error instanceof Error)) {
    return null;
  }

  switch (error.message) {
    case "EMAIL_EXISTS":
      return reply.status(409).send({
        message: "A user with this email already exists",
      });

    case "USER_NOT_FOUND":
      return reply.status(404).send({
        message: "User not found",
      });

    case "BRANCH_NOT_FOUND":
      return reply.status(404).send({
        message: "Branch not found",
      });

    case "BRANCH_HAS_SUPERVISOR":
      return reply.status(409).send({
        message:
          "This branch already has an active supervisor. Replace the existing supervisor instead.",
      });

    case "NOT_A_SUPERVISOR":
      return reply.status(400).send({
        message: "The selected user is not a Supervisor",
      });

    case "OWNER_HAS_NO_BRANCH":
      return reply.status(400).send({
        message: "The Owner cannot be assigned to a branch",
      });

    case "CANNOT_DELETE_OWNER":
      return reply.status(403).send({
        message: "The Owner account cannot be deleted",
      });

    case "INVALID_CURRENT_PASSWORD":
      return reply.status(401).send({
        message: "Your current password is incorrect",
      });

    case "USER_HAS_HISTORY":
      return reply.status(409).send({
        message:
          "This user has existing records and cannot be deleted. Deactivate the account instead.",
        blockedBy: (error as Error & {
          history?: Record<string, number>;
        }).history,
      });

    default:
      return null;
  }
}

export async function createUserController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = createUserSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid user data",
      errors: result.error.flatten(),
    });
  }

  try {
    const user = await createUser(result.data);

    return reply.status(201).send({
      message: "User created successfully",
      user,
    });
  } catch (error) {
    return handleUserError(error, reply) ?? Promise.reject(error);
  }
}

export async function getUsersController(
  request: FastifyRequest<{
    Querystring: Record<string, string>;
  }>,
  reply: FastifyReply,
) {
  const result = listUsersQuerySchema.safeParse(request.query);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid filters",
      errors: result.error.flatten(),
    });
  }

  const filters = { ...result.data };

  // A Supervisor may only see their own branch; the Owner sees everything.
  // The service applies the same rule again, so the list cannot widen even if
  // a future caller forgets this.
  const viewer = await loadViewer(request);

  if (!viewer) {
    return reply.status(403).send({ message: "User account is inactive" });
  }

  if (viewer.role === "SUPERVISOR" && !viewer.branchId) {
    return reply.status(403).send({
      message: "You are not assigned to a branch",
    });
  }

  const users = await getUsers(filters, viewer);

  return reply.send({ users });
}

// --- Self-service: the caller acting on their own account -------------------

export async function getOwnProfileController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const user = await getUserById(request.user.userId);

  if (!user) {
    return reply.status(404).send({
      message: "User not found",
    });
  }

  return reply.send({ user });
}

export async function updateOwnProfileController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = updateOwnProfileSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid profile data",
      errors: result.error.flatten(),
    });
  }

  try {
    const user = await updateOwnProfile(
      request.user.userId,
      result.data,
    );

    return reply.send({
      message: "Profile updated successfully",
      user,
    });
  } catch (error) {
    return handleUserError(error, reply) ?? Promise.reject(error);
  }
}

export async function changeOwnPasswordController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = changeOwnPasswordSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid password data",
      errors: result.error.flatten(),
    });
  }

  try {
    await changeOwnPassword(
      request.user.userId,
      result.data.currentPassword,
      result.data.newPassword,
    );

    return reply.send({
      message: "Password changed successfully",
    });
  } catch (error) {
    return handleUserError(error, reply) ?? Promise.reject(error);
  }
}

// --- Owner-only -------------------------------------------------------------

export async function getUsersByBranchController(
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  const branches = await getUsersByBranch();

  return reply.send({ branches });
}

export async function getUserController(
  request: FastifyRequest<{
    Params: UserParams;
  }>,
  reply: FastifyReply,
) {
  const user = await getUserById(request.params.id);

  if (!user) {
    return reply.status(404).send({
      message: "User not found",
    });
  }

  return reply.send({ user });
}

export async function updateUserController(
  request: FastifyRequest<{
    Params: UserParams;
  }>,
  reply: FastifyReply,
) {
  const result = updateUserSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid user data",
      errors: result.error.flatten(),
    });
  }

  try {
    const user = await updateUser(
      request.params.id,
      result.data,
    );

    return reply.send({
      message: "User updated successfully",
      user,
    });
  } catch (error) {
    return handleUserError(error, reply) ?? Promise.reject(error);
  }
}

export async function changeUserStatusController(
  request: FastifyRequest<{
    Params: UserParams;
  }>,
  reply: FastifyReply,
) {
  const result = updateUserStatusSchema.safeParse(
    request.body,
  );

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid status data",
      errors: result.error.flatten(),
    });
  }

  if (request.params.id === request.user.userId) {
    return reply.status(400).send({
      message: "You cannot deactivate your own account",
    });
  }

  try {
    const user = await changeUserStatus(
      request.params.id,
      result.data.isActive,
    );

    return reply.send({
      message: result.data.isActive
        ? "User activated successfully"
        : "User deactivated successfully",
      user,
    });
  } catch (error) {
    return handleUserError(error, reply) ?? Promise.reject(error);
  }
}

export async function moveUserToBranchController(
  request: FastifyRequest<{
    Params: UserParams;
  }>,
  reply: FastifyReply,
) {
  const result = assignBranchSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid branch data",
      errors: result.error.flatten(),
    });
  }

  try {
    const user = await moveUserToBranch(
      request.params.id,
      result.data.branchId,
    );

    return reply.send({
      message: "User moved to branch successfully",
      user,
    });
  } catch (error) {
    return handleUserError(error, reply) ?? Promise.reject(error);
  }
}

export async function replaceSupervisorController(
  request: FastifyRequest<{
    Params: BranchParams;
  }>,
  reply: FastifyReply,
) {
  const result = replaceSupervisorSchema.safeParse(
    request.body,
  );

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid supervisor data",
      errors: result.error.flatten(),
    });
  }

  try {
    const outcome = await replaceBranchSupervisor(
      request.params.branchId,
      result.data.newSupervisorId,
    );

    return reply.send({
      message: outcome.outgoingSupervisor
        ? `Supervisor replaced. ${outcome.outgoingSupervisor.name} was deactivated.`
        : "Supervisor assigned successfully",
      ...outcome,
    });
  } catch (error) {
    return handleUserError(error, reply) ?? Promise.reject(error);
  }
}

export async function deleteUserController(
  request: FastifyRequest<{
    Params: UserParams;
  }>,
  reply: FastifyReply,
) {
  if (request.params.id === request.user.userId) {
    return reply.status(400).send({
      message: "You cannot delete your own account",
    });
  }

  try {
    const deleted = await deleteUser(request.params.id);

    return reply.send({
      message: `${deleted.name} was deleted successfully`,
      user: deleted,
    });
  } catch (error) {
    return handleUserError(error, reply) ?? Promise.reject(error);
  }
}
