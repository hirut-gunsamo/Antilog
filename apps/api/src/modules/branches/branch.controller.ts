import type {
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { loadViewer } from "../../middleware/auth.js";

import {
  createBranchSchema,
  updateBranchSchema,
  updateBranchStatusSchema,
  updateMainStockSchema,
  listBranchesQuerySchema,
} from "./branch.schema.js";

import {
  createBranch,
  getBranches,
  getBranchById,
  updateBranch,
  changeBranchStatus,
  setMainStock,
  deleteBranch,
} from "./branch.service.js";

type BranchParams = {
  id: string;
};

type DetailedError = Error & {
  history?: Record<string, number>;
  activeUsers?: number;
  remainingQuantity?: number;
};

function handleBranchError(
  error: unknown,
  reply: FastifyReply,
): FastifyReply | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const detailed = error as DetailedError;

  switch (error.message) {
    case "BRANCH_NOT_FOUND":
      return reply.status(404).send({
        message: "Branch not found",
      });

    case "BRANCH_NAME_EXISTS":
      return reply.status(409).send({
        message: "A branch with this name already exists",
      });

    case "BRANCH_INACTIVE":
      return reply.status(400).send({
        message:
          "A closed branch cannot be made a stock source. Reopen it first.",
      });

    case "BRANCH_HAS_SELLERS":
      return reply.status(409).send({
        message:
          "Nothing is sold at a main store. Move this branch's salespeople to a selling branch first.",
      });

    case "LAST_MAIN_STOCK_BRANCH":
      return reply.status(409).send({
        message:
          "This is the last active main-stock branch. Designate another one first.",
      });

    case "BRANCH_HAS_ACTIVE_USERS":
      return reply.status(409).send({
        message:
          "This branch still has active staff. Move or deactivate them first.",
        activeUsers: detailed.activeUsers,
      });

    case "BRANCH_HAS_STOCK":
      return reply.status(409).send({
        message:
          "This branch still holds stock. Transfer it out before closing.",
        remainingQuantity: detailed.remainingQuantity,
      });

    case "BRANCH_HAS_HISTORY":
      return reply.status(409).send({
        message:
          "This branch has existing records and cannot be deleted. Close it instead.",
        blockedBy: detailed.history,
      });

    default:
      return null;
  }
}

export async function createBranchController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = createBranchSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid branch data",
      errors: result.error.flatten(),
    });
  }

  try {
    const branch = await createBranch(result.data);

    return reply.status(201).send({
      message: "Branch created successfully",
      branch,
    });
  } catch (error) {
    return handleBranchError(error, reply) ?? Promise.reject(error);
  }
}

export async function getBranchesController(
  request: FastifyRequest<{
    Querystring: Record<string, string>;
  }>,
  reply: FastifyReply,
) {
  const result = listBranchesQuerySchema.safeParse(request.query);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid filters",
      errors: result.error.flatten(),
    });
  }

  const viewer = await loadViewer(request);

  if (!viewer) {
    return reply.status(403).send({
      message: "User account is inactive",
    });
  }

  const branches = await getBranches(result.data, viewer);

  return reply.send({ branches });
}

export async function getBranchController(
  request: FastifyRequest<{
    Params: BranchParams;
  }>,
  reply: FastifyReply,
) {
  const viewer = await loadViewer(request);

  if (!viewer) {
    return reply.status(403).send({
      message: "User account is inactive",
    });
  }

  const branch = await getBranchById(request.params.id, viewer);

  if (!branch) {
    return reply.status(404).send({
      message: "Branch not found",
    });
  }

  return reply.send({ branch });
}

export async function updateBranchController(
  request: FastifyRequest<{
    Params: BranchParams;
  }>,
  reply: FastifyReply,
) {
  const result = updateBranchSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid branch data",
      errors: result.error.flatten(),
    });
  }

  try {
    const branch = await updateBranch(
      request.params.id,
      result.data,
    );

    return reply.send({
      message: "Branch updated successfully",
      branch,
    });
  } catch (error) {
    return handleBranchError(error, reply) ?? Promise.reject(error);
  }
}

export async function changeBranchStatusController(
  request: FastifyRequest<{
    Params: BranchParams;
  }>,
  reply: FastifyReply,
) {
  const result = updateBranchStatusSchema.safeParse(
    request.body,
  );

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid status data",
      errors: result.error.flatten(),
    });
  }

  try {
    const branch = await changeBranchStatus(
      request.params.id,
      result.data.isActive,
    );

    return reply.send({
      message: result.data.isActive
        ? "Branch reopened successfully"
        : "Branch closed successfully",
      branch,
    });
  } catch (error) {
    return handleBranchError(error, reply) ?? Promise.reject(error);
  }
}

export async function setMainStockController(
  request: FastifyRequest<{
    Params: BranchParams;
  }>,
  reply: FastifyReply,
) {
  const result = updateMainStockSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid stock source data",
      errors: result.error.flatten(),
    });
  }

  try {
    const branch = await setMainStock(
      request.params.id,
      result.data.isMainStock,
    );

    return reply.send({
      message: result.data.isMainStock
        ? "Branch is now a main stock source"
        : "Branch is no longer a main stock source",
      branch,
    });
  } catch (error) {
    return handleBranchError(error, reply) ?? Promise.reject(error);
  }
}

export async function deleteBranchController(
  request: FastifyRequest<{
    Params: BranchParams;
  }>,
  reply: FastifyReply,
) {
  try {
    const deleted = await deleteBranch(request.params.id);

    return reply.send({
      message: `${deleted.name} was deleted successfully`,
      branch: deleted,
    });
  } catch (error) {
    return handleBranchError(error, reply) ?? Promise.reject(error);
  }
}
