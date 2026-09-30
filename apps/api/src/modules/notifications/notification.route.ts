import type { FastifyInstance } from "fastify";

import { authenticate } from "../../middleware/auth.js";
import { notificationsController } from "./notification.controller.js";

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Everything waiting on the signed-in user, scoped to what they may see.
  app.get("/", notificationsController);
}
