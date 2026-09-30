import type { FastifyReply, FastifyRequest } from "fastify";

import { loadViewer } from "../../middleware/auth.js";

import {
  createAssetSchema,
  listAssetsQuerySchema,
  updateAssetSchema,
} from "./asset.schema.js";

import {
  createAsset,
  deleteAsset,
  getAssets,
  updateAsset,
} from "./asset.service.js";

type AssetParams = { id: string };

function handleError(
  error: unknown,
  reply: FastifyReply,
): FastifyReply | null {
  if (!(error instanceof Error)) return null;

  switch (error.message) {
    case "BRANCH_NOT_FOUND":
      return reply.status(404).send({ message: "Branch not found" });

    case "BRANCH_INACTIVE":
      return reply.status(400).send({
        message: "That branch is closed",
      });

    case "ASSET_NOT_FOUND":
      return reply.status(404).send({ message: "Equipment not found" });

    default:
      return null;
  }
}

async function withViewer(request: FastifyRequest, reply: FastifyReply) {
  const viewer = await loadViewer(request);

  if (!viewer) {
    reply.status(403).send({ message: "User account is inactive" });
    return null;
  }

  return viewer;
}

export async function getAssetsController(
  request: FastifyRequest<{ Querystring: Record<string, string> }>,
  reply: FastifyReply,
) {
  const result = listAssetsQuerySchema.safeParse(request.query);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid filters",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const assets = await getAssets(result.data, viewer);

  return reply.send({ assets });
}

export async function createAssetController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = createAssetSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid equipment data",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const asset = await createAsset(result.data, viewer);

    return reply.status(201).send({ message: "Equipment recorded", asset });
  } catch (error) {
    return handleError(error, reply) ?? Promise.reject(error);
  }
}

export async function updateAssetController(
  request: FastifyRequest<{ Params: AssetParams }>,
  reply: FastifyReply,
) {
  const result = updateAssetSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid equipment data",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const asset = await updateAsset(request.params.id, result.data, viewer);

    return reply.send({ message: "Equipment updated", asset });
  } catch (error) {
    return handleError(error, reply) ?? Promise.reject(error);
  }
}

export async function deleteAssetController(
  request: FastifyRequest<{ Params: AssetParams }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    await deleteAsset(request.params.id);

    return reply.send({ message: "Equipment removed" });
  } catch (error) {
    return handleError(error, reply) ?? Promise.reject(error);
  }
}
