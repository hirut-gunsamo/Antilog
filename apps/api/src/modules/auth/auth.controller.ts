import type { FastifyReply, FastifyRequest } from "fastify";
import { loginSchema } from "./auth.schema.js";
import { authenticateUser } from "./auth.service.js";

export async function login(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = loginSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid login data",
      errors: result.error.flatten(),
    });
  }

  const { email, password } = result.data;

  const user = await authenticateUser(email, password);

  if (!user) {
    return reply.status(401).send({
      message: "Invalid email or password",
    });
  }

  const token = await reply.jwtSign({
    userId: user.id,
    role: user.role,
  });

  return reply.send({
    message: "Login successful",
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
}