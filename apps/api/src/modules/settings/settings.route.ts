import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import { authenticate, authorize } from "../../middleware/auth.js";

import {
  backupController,
  getPermissionsController,
  getSettingsController,
  resetSettingsController,
  restoreController,
  updateSettingsController,
} from "./settings.controller.js";

export async function settingsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Everyone reads: the system name, currency and formats are used on every
  // screen, whatever the role.
  app.get("/", getSettingsController);

  // A description of the route guards, for the Settings page.
  app.get("/permissions", getPermissionsController);

  // Everything below changes or exposes the whole organisation's data.
  app.patch(
    "/",
    { preHandler: [authorize(UserRole.OWNER)] },
    updateSettingsController,
  );

  app.post(
    "/reset",
    { preHandler: [authorize(UserRole.OWNER)] },
    resetSettingsController,
  );

  // The backup contains password hashes, so it is as sensitive as the database.
  app.get(
    "/backup",
    { preHandler: [authorize(UserRole.OWNER)] },
    backupController,
  );

  app.post(
    "/restore",
    { preHandler: [authorize(UserRole.OWNER)] },
    restoreController,
  );
}
