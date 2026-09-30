import "dotenv/config";
import { PrismaClient } from "database";
import { PrismaPg } from "@prisma/adapter-pg";

// Attaches every product created before the type tree existed to a seeded
// type, so typeId can be relied on from here. Development only: production
// has no products yet.
const connectionString = process.env.DATABASE_URL;

if (!connectionString) throw new Error("DATABASE_URL is not defined");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const FALLBACK: Record<string, string> = {
  SIM_CARD: "pt_sim_standard",
  AIRTIME_VOUCHER: "pt_av_voucher",
};

async function main() {
  const products = await prisma.product.findMany({
    where: { typeId: null },
    include: { phoneDetails: true },
  });

  for (const product of products) {
    let typeId = FALLBACK[product.category];

    if (product.category === "PHONE") {
      const brandName = product.phoneDetails?.brand?.trim() || "Other";

      const brand =
        (await prisma.productType.findFirst({
          where: { category: "PHONE", parentId: null, name: brandName },
        })) ??
        (await prisma.productType.create({
          data: { category: "PHONE", name: brandName },
        }));

      const modelName = product.phoneDetails?.model?.trim() || product.name;

      const model =
        (await prisma.productType.findFirst({
          where: { category: "PHONE", parentId: brand.id, name: modelName },
        })) ??
        (await prisma.productType.create({
          data: { category: "PHONE", name: modelName, parentId: brand.id },
        }));

      typeId = model.id;
    }

    await prisma.product.update({
      where: { id: product.id },
      data: { typeId },
    });

    console.log(`${product.sku} -> ${typeId}`);
  }
}

main().finally(() => prisma.$disconnect());
