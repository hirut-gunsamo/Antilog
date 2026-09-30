import type { FastifyInstance } from "fastify";

import { authenticate } from "../../middleware/auth.js";

import {
  getChangesController,
  getRecordsController,
} from "./sync.controller.js";

export async function syncRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // What has changed since this device last synced. Branch-scoped, so a device
  // is only ever told about records its user could already read.
  app.get("/changes", getChangesController);

  // The mutations this device has replayed, and how they landed.
  app.get("/records", getRecordsController);
}
