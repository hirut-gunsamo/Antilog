import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import { login } from "./auth.controller.js";
import {
  authenticate,
  authorize,
} from "../../middleware/auth.js";
import { prisma } from "../../plugins/prisma.js";

export async function authRoutes(app: FastifyInstance) {
  // Login
  app.post("/login", login);

  // Get currently logged-in user
  app.get(
    "/me",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const user = await prisma.user.findUnique({
        where: {
          id: request.user.userId,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });

      if (!user) {
        return reply.status(404).send({
          message: "User not found",
        });
      }

      if (!user.isActive) {
        return reply.status(403).send({
          message: "User account is inactive",
        });
      }

      return reply.send({
        user,
      });
    },
  );

  // Owner-only test route
  app.get(
    "/owner-test",
    {
      preHandler: [
        authenticate,
        authorize(UserRole.OWNER),
      ],
    },
    async (_request, reply) => {
      return reply.send({
        message: "Owner access granted",
      });
    },
  );
}