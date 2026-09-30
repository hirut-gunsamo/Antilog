import bcrypt from "bcrypt";
import { prisma } from "../../plugins/prisma.js";

export async function authenticateUser(
  email: string,
  password: string,
) {
  const user = await prisma.user.findUnique({
    where: {
      email: email.toLowerCase(),
    },
  });

  if (!user || !user.isActive) {
    return null;
  }

  const passwordMatches = await bcrypt.compare(
    password,
    user.passwordHash,
  );

  if (!passwordMatches) {
    return null;
  }

  return user;
}