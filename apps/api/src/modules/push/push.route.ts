import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { authenticate, loadViewer } from "../../middleware/auth.js";
import {
  PUSH_ROLES,
  publicKey,
  subscribe,
  unsubscribe,
} from "./push.service.js";

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
  lang: z.string().max(5).optional(),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().min(1).max(2000),
});

export async function pushRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // The key the phone needs to subscribe, and whether this person may.
  // `key` is null when the server has no keys set, which hides the switch.
  app.get("/key", async (request, reply) => {
    const viewer = await loadViewer(request);

    return reply.send({
      key: publicKey(),
      allowed: viewer != null && PUSH_ROLES.has(viewer.role),
    });
  });

  app.post("/subscribe", async (request, reply) => {
    const viewer = await loadViewer(request);

    if (!viewer || !PUSH_ROLES.has(viewer.role)) {
      return reply
        .status(403)
        .send({ message: "Phone notifications are for the Owner and supervisors" });
    }

    if (!publicKey()) {
      return reply
        .status(503)
        .send({ message: "Phone notifications are not set up on the server" });
    }

    const result = subscribeSchema.safeParse(request.body);

    if (!result.success) {
      return reply.status(400).send({ message: "Invalid subscription" });
    }

    await subscribe(viewer, {
      endpoint: result.data.endpoint,
      p256dh: result.data.keys.p256dh,
      auth: result.data.keys.auth,
      lang: result.data.lang ?? "en",
    });

    return reply.status(201).send({ message: "Notifications turned on" });
  });

  // Any signed-in user may remove a phone: signing out calls this.
  app.post("/unsubscribe", async (request, reply) => {
    const result = unsubscribeSchema.safeParse(request.body);

    if (!result.success) {
      return reply.status(400).send({ message: "Invalid subscription" });
    }

    await unsubscribe(result.data.endpoint);
    return reply.send({ message: "Notifications turned off" });
  });
}
