import type { FastifyInstance, FastifyReply } from "fastify";
import { UserRole } from "database";
import { z } from "zod";

import { authenticate, authorize } from "../../middleware/auth.js";
import { prisma } from "../../plugins/prisma.js";

/**
 * The Owner's categories: SIM Cards, Phones and Airtime to start, plus any
 * they add. An added category is OTHER in kind — counted and sold by quantity
 * and price. The three built-ins keep their own rules and cannot be removed.
 */

const nameSchema = z.object({ name: z.string().trim().min(2).max(60) });

// How the category's goods are counted: SIM cards by ICCID, phones by IMEI,
// airtime by value, anything else by quantity and price.
const createSchema = nameSchema.extend({
  kind: z.enum(["SIM_CARD", "PHONE", "AIRTIME_VOUCHER", "OTHER"]).optional().default("OTHER"),
});

const select = { id: true, name: true, kind: true, isActive: true } as const;

function clash(reply: FastifyReply) {
  return reply.status(409).send({ message: "A category with that name already exists" });
}

export async function categoryRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Everyone reads them: every stock and sales form groups by category.
  app.get("/", async () => {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      select: {
        ...select,
        _count: { select: { products: { where: { status: "ACTIVE" } }, types: { where: { isActive: true } } } },
      },
      orderBy: { createdAt: "asc" },
    });

    // The three built-ins first, in their usual order; added ones after.
    const rank = (id: string) => ["cat_sim", "cat_phone", "cat_airtime"].indexOf(id);
    categories.sort((a, b) => {
      const ra = rank(a.id), rb = rank(b.id);
      if (ra !== -1 || rb !== -1) return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
      return 0;
    });

    return { categories };
  });

  app.post("/", { preHandler: [authorize(UserRole.OWNER)] }, async (request, reply) => {
    const result = createSchema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ message: "Enter a name of at least 2 letters" });

    const existing = await prisma.category.findUnique({ where: { name: result.data.name } });

    // A retired category with the same name comes back rather than clashing.
    if (existing) {
      if (existing.isActive) return clash(reply);
      const category = await prisma.category.update({
        where: { id: existing.id },
        data: { isActive: true, kind: result.data.kind },
        select,
      });
      return reply.status(201).send({ category });
    }

    const category = await prisma.category.create({
      data: { name: result.data.name, kind: result.data.kind },
      select,
    });

    return reply.status(201).send({ category });
  });

  app.patch<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authorize(UserRole.OWNER)] },
    async (request, reply) => {
      const result = nameSchema.safeParse(request.body);
      if (!result.success) return reply.status(400).send({ message: "Enter a name of at least 2 letters" });

      const other = await prisma.category.findUnique({ where: { name: result.data.name } });
      if (other && other.id !== request.params.id) return clash(reply);

      const { count } = await prisma.category.updateMany({
        where: { id: request.params.id },
        data: { name: result.data.name },
      });
      if (count === 0) return reply.status(404).send({ message: "Category not found" });

      return reply.send({ message: "Renamed" });
    },
  );

  // Only a category with nothing live in it can go. It is retired, so old
  // products and sales keep their category name.
  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authorize(UserRole.OWNER)] },
    async (request, reply) => {
      const id = request.params.id;

      const [types, products] = await Promise.all([
        prisma.productType.count({ where: { categoryId: id, isActive: true } }),
        prisma.product.count({ where: { categoryId: id, status: "ACTIVE" } }),
      ]);

      if (products > 0) return reply.status(409).send({ message: "Delete the products in this category first" });
      if (types > 0) return reply.status(409).send({ message: "Delete the types in this category first" });

      const { count } = await prisma.category.updateMany({
        where: { id },
        data: { isActive: false },
      });
      if (count === 0) return reply.status(404).send({ message: "Category not found" });

      return reply.send({ message: "Deleted" });
    },
  );
}
