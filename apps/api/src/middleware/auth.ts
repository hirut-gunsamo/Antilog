import type { FastifyReply, FastifyRequest } from "fastify";
import type { UserRole } from "database";
import { prisma } from "../plugins/prisma.js";

// Who is asking, and which branch they belong to. The JWT carries only the
// user id and role, so the branch is read fresh - a user moved between
// branches must not keep the old scope until their token expires.
export type Viewer = {
  userId: string;
  role: UserRole;
  branchId: string | null;
};

export async function loadViewer(
  request: FastifyRequest,
): Promise<Viewer | null> {
  const user = await prisma.user.findUnique({
    where: { id: request.user.userId },
    select: { id: true, role: true, branchId: true, isActive: true },
  });

  if (!user || !user.isActive) {
    return null;
  }

  return {
    userId: user.id,
    role: user.role,
    branchId: user.branchId,
  };
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({
      message: "Unauthorized",
    });
  }
}

export function authorize(...roles: UserRole[]) {
  return async function (
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    if (!roles.includes(request.user.role as UserRole)) {
      return reply.status(403).send({
        message: "Forbidden: insufficient permissions",
      });
    }
  };
}