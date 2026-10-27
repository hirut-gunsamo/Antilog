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

  // A sign-in lasts a working day at most; after that the password is asked again.
  const token = await reply.jwtSign(
    {
      userId: user.id,
      role: user.role,
    },
    { expiresIn: "12h" },
  );

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