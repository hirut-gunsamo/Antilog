import "dotenv/config";
import { PrismaClient, UserRole } from "database";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcrypt";

/**
 * Creates the first Owner, and nothing else.
 *
 * Everything else the business runs on — branches, staff, products — is the
 * Owner's to set up in the app, where the rules are enforced. Seeding them
 * here would put rows in the database that no one chose and that the app's
 * own guards never saw.
 *
 * The credentials come from the environment, never from this file: a password
 * written into the repository is a password everyone has. Run it as
 *
 *   OWNER_EMAIL=you@example.com OWNER_PASSWORD='...' npx tsx prisma/seed.ts
 *
 * It refuses to run twice: if an Owner already exists, it changes nothing, so
 * a second run can never quietly add a way in beside yours.
 */

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Set OWNER_EMAIL and OWNER_PASSWORD, e.g.\n" +
        "  OWNER_EMAIL=you@example.com OWNER_PASSWORD='a long password' npx tsx prisma/seed.ts",
    );
  }

  if (password.length < 8) {
    throw new Error("OWNER_PASSWORD must be at least 8 characters");
  }

  const existing = await prisma.user.findFirst({
    where: { role: UserRole.OWNER },
    select: { email: true },
  });

  if (existing) {
    console.log(
      `An Owner already exists (${existing.email}). Nothing was changed.`,
    );
    console.log(
      "To add another Owner, or to reset this one's password, use the app.",
    );
    return;
  }

  const owner = await prisma.user.create({
    data: {
      name: process.env.OWNER_NAME?.trim() || "Owner",
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: UserRole.OWNER,
    },
    select: { email: true },
  });

  console.log(`Owner created: ${owner.email}`);
  console.log("Sign in, then add your branches, staff and products in the app.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
