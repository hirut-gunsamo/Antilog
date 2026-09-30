import "dotenv/config";
import { PrismaClient } from "database";
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

async function main() {
  const mainWarehouse = await prisma.stockLocation.findFirst({
    where: {
      name: "Main Warehouse",
    },
  });

  const hawassaMain = await prisma.stockLocation.findFirst({
    where: {
      name: "Hawassa Main",
    },
  });

  if (!mainWarehouse) {
    console.log("Main Warehouse not found.");
    return;
  }

  if (hawassaMain) {
    const balances = await prisma.inventoryBalance.count({
      where: {
        locationId: hawassaMain.id,
      },
    });

    const units = await prisma.inventoryUnit.count({
      where: {
        locationId: hawassaMain.id,
      },
    });

    if (balances > 0 || units > 0) {
      throw new Error(
        "Hawassa Main already contains inventory. Cleanup stopped for safety.",
      );
    }

    await prisma.stockLocation.delete({
      where: {
        id: hawassaMain.id,
      },
    });

    console.log("Removed empty duplicate Hawassa Main.");
  }

  await prisma.stockLocation.update({
    where: {
      id: mainWarehouse.id,
    },
    data: {
      name: "Hawassa Main",
    },
  });

  console.log("Main Warehouse renamed to Hawassa Main.");

  const locations = await prisma.stockLocation.findMany({
    select: {
      id: true,
      name: true,
      type: true,
      userId: true,
    },
    orderBy: {
      name: "asc",
    },
  });

  console.table(locations);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
