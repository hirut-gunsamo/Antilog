import "dotenv/config";
import { PrismaClient, LocationType } from "database";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

const adapter = new PrismaPg({
  connectionString,
});

const prisma = new PrismaClient({
  adapter,
});

const locations = [
  "Hawassa",
  "Balela",
  "Bensa Daye",
  "Arroresa",
];

async function main() {
  for (const name of locations) {
    const existing = await prisma.stockLocation.findFirst({
      where: {
        name,
      },
    });

    if (existing) {
      console.log(`${name} already exists`);
      continue;
    }

    const location = await prisma.stockLocation.create({
      data: {
        name,
        type: LocationType.WAREHOUSE,
      },
    });

    console.log(`Created: ${location.name}`);
  }

  console.log("Locations setup completed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });