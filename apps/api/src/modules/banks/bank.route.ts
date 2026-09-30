import type { FastifyInstance } from "fastify";
import { Prisma } from "database";
import { z } from "zod";

import { authenticate, loadViewer } from "../../middleware/auth.js";
import { prisma } from "../../plugins/prisma.js";

/**
 * The banks a transfer sale can name. Anyone signed in can read them and add
 * one the list is missing; names are unique ignoring case.
 */

const addSchema = z.object({
  name: z.string().trim().min(2).max(80),
});

export async function bankRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.get("/", async (_request, reply) => {
    const banks = await prisma.bank.findMany({
      select: { id: true, name: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return reply.send({ banks });
  });

  app.post("/", async (request, reply) => {
    const viewer = await loadViewer(request);
    if (!viewer) return reply.status(403).send({ message: "User account is inactive" });

    const result = addSchema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ message: "Enter the bank's name" });

    const name = result.data.name.replace(/\s+/g, " ");

    try {
      const bank = await prisma.bank.create({
        data: { name, createdById: viewer.userId },
        select: { id: true, name: true },
      });
      return reply.status(201).send({ bank });
    } catch (error) {
      // Already on the list (perhaps in other letters): hand that one back.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const rows = await prisma.$queryRaw<{ id: string; name: string }[]>`
          SELECT "id", "name" FROM "Bank" WHERE lower("name") = lower(${name}) LIMIT 1`;
        if (rows[0]) return reply.send({ bank: rows[0] });
      }
      throw error;
    }
  });
}
