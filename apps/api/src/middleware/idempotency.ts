import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma, SyncOperation, SyncStatus } from "database";

import { prisma } from "../plugins/prisma.js";

const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"]);

const OPERATION: Record<string, SyncOperation> = {
  POST: SyncOperation.CREATE,
  PATCH: SyncOperation.UPDATE,
  PUT: SyncOperation.UPDATE,
  DELETE: SyncOperation.DELETE,
};

/** "/api/sales/abc/submit" -> "sales", which is what the sync log shows. */
function entityFromUrl(url: string) {
  const parts = url.split("?")[0].split("/").filter(Boolean);
  return parts[0] === "api" ? (parts[1] ?? "unknown") : (parts[0] ?? "unknown");
}

function header(request: FastifyRequest, name: string) {
  const value = request.headers[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Makes a replayed mutation safe to send twice.
 *
 * A device that goes offline mid-request cannot know whether the server
 * applied the change, so on reconnect it sends the same request again with the
 * same `X-Client-Mutation-Id`. This hook remembers ids that already succeeded
 * and answers the repeat without running the handler, so a queued sale is
 * recorded once however many times the queue is drained.
 *
 * Requests without the header are untouched, so every existing caller — the
 * app's own online path included — behaves exactly as before.
 */
export function registerIdempotency(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply: FastifyReply) => {
    if (!MUTATING.has(request.method)) return;

    const mutationId = header(request, "x-client-mutation-id");
    if (!mutationId) return;

    const seen = await prisma.syncRecord.findUnique({
      where: { clientMutationId: mutationId },
      select: { id: true, status: true, entityId: true },
    });

    // Only a completed mutation short-circuits. A previous failure is allowed
    // through so a retry can genuinely retry.
    if (seen?.status === SyncStatus.COMPLETED) {
      return reply.status(200).send({
        message: "Already applied",
        replayed: true,
        id: seen.entityId,
      });
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (!MUTATING.has(request.method)) return payload;

    const mutationId = header(request, "x-client-mutation-id");
    if (!mutationId) return payload;

    // A replay answered by the preHandler above must not be recorded again.
    if (reply.statusCode === 200 && typeof payload === "string") {
      try {
        if ((JSON.parse(payload) as { replayed?: boolean }).replayed) {
          return payload;
        }
      } catch {
        // Not JSON; fall through and record it like any other response.
      }
    }

    const deviceId = header(request, "x-device-id") ?? "unknown-device";
    const ok = reply.statusCode >= 200 && reply.statusCode < 300;

    // The new record's own id, so the log can link a queue entry to the row
    // it created. Best-effort: a handler that returns no id is still recorded.
    let entityId: string | null = null;
    let errorMessage: string | null = null;

    if (typeof payload === "string") {
      try {
        const body = JSON.parse(payload) as Record<string, unknown>;
        const nested = Object.values(body).find(
          (value): value is { id: string } =>
            typeof value === "object" &&
            value !== null &&
            typeof (value as { id?: unknown }).id === "string",
        );

        entityId =
          (typeof body.id === "string" ? body.id : null) ?? nested?.id ?? null;

        if (!ok && typeof body.message === "string") errorMessage = body.message;
      } catch {
        // A non-JSON body (a file, an empty 204) carries no id to record.
      }
    }

    try {
      await prisma.syncRecord.upsert({
        where: { clientMutationId: mutationId },
        create: {
          clientMutationId: mutationId,
          deviceId,
          entityType: entityFromUrl(request.url),
          entityId,
          operation: OPERATION[request.method] ?? SyncOperation.UPDATE,
          status: ok ? SyncStatus.COMPLETED : SyncStatus.FAILED,
          errorMessage,
          processedAt: new Date(),
        },
        update: {
          status: ok ? SyncStatus.COMPLETED : SyncStatus.FAILED,
          entityId,
          errorMessage,
          processedAt: new Date(),
        },
      });
    } catch (caught) {
      // Two drains of the same queue can race on the unique id. Losing that
      // race is harmless — the winner recorded the same outcome — and the
      // response must not fail because the ledger did.
      if (!(caught instanceof Prisma.PrismaClientKnownRequestError)) {
        request.log.error({ err: caught }, "could not record sync mutation");
      }
    }

    return payload;
  });
}
