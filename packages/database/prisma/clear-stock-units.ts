import "dotenv/config";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "database";
import { PrismaPg } from "@prisma/adapter-pg";

// Stock is now a count for every category, and unit rows are only created
// when a sale records a serial. An IN_STOCK unit can no longer come about, so
// the ones left from before are removed. SOLD rows are the sales record and
// are never touched. Development only: production has no units yet.
//
// The removed rows are written to a JSON file beside this script first, so
// the run can be undone by hand.
const connectionString = process.env.DATABASE_URL;

if (!connectionString) throw new Error("DATABASE_URL is not defined");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  const units = await prisma.inventoryUnit.findMany({
    where: { status: "IN_STOCK" },
  });

  if (units.length === 0) {
    console.log("No in-stock units to remove.");
    return;
  }

  const backup = new URL(
    `./cleared-stock-units-${Date.now()}.json`,
    import.meta.url,
  );
  writeFileSync(backup, JSON.stringify(units, null, 2));

  const { count } = await prisma.inventoryUnit.deleteMany({
    where: { id: { in: units.map((unit) => unit.id) }, status: "IN_STOCK" },
  });

  console.log(`Removed ${count} in-stock units. Backup: ${backup.pathname}`);
}

main().finally(() => prisma.$disconnect());
