import type { FastifyReply, FastifyRequest } from "fastify";

import { PERMISSION_MATRIX } from "./permissions.js";

import {
  restoreSchema,
  updateSettingsSchema,
} from "./settings.schema.js";

import {
  exportBackup,
  getSettings,
  resetSettings,
  restoreBackup,
  updateSettings,
} from "./settings.service.js";

export async function getSettingsController(
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  const settings = await getSettings();

  return reply.send({ settings });
}

export async function updateSettingsController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = updateSettingsSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid settings",
      errors: result.error.flatten(),
    });
  }

  const settings = await updateSettings(
    result.data,
    request.user.userId,
  );

  return reply.send({ message: "Settings saved", settings });
}

export async function resetSettingsController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const settings = await resetSettings(request.user.userId);

  return reply.send({
    message: "Settings restored to their defaults",
    settings,
  });
}

// Read-only: it describes the guards the routes already enforce.
export async function getPermissionsController(
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  return reply.send({
    permissions: PERMISSION_MATRIX,
    editable: false,
    note: "Access is enforced by route guards. This is a description of them, not a control surface.",
  });
}

export async function backupController(
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  const backup = await exportBackup();

  const stamp = new Date().toISOString().slice(0, 10);

  return reply
    .header("content-type", "application/json; charset=utf-8")
    .header(
      "content-disposition",
      `attachment; filename="sim-backup-${stamp}.json"`,
    )
    .send(backup);
}

export async function restoreController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = restoreSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message:
        "Send the backup file together with confirm: \"REPLACE ALL DATA\"",
      errors: result.error.flatten(),
    });
  }

  try {
    const summary = await restoreBackup(
      result.data.backup as Parameters<typeof restoreBackup>[0],
    );

    return reply.send({
      message: `Restored ${summary.tables} tables`,
      ...summary,
    });
  } catch (error) {
    if (error instanceof Error) {
      const known: Record<string, string> = {
        UNSUPPORTED_BACKUP_VERSION:
          "That backup was made by a different version of this system",
        UNKNOWN_TABLE_IN_BACKUP:
          "That file contains tables this system does not recognise",
      };

      if (known[error.message]) {
        return reply.status(400).send({ message: known[error.message] });
      }
    }

    throw error;
  }
}
