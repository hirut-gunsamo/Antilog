import { Prisma } from "database";

import { prisma } from "../../plugins/prisma.js";

export type NidPrices = { ORIGINAL: Prisma.Decimal; COPY: Prisma.Decimal };

/** The Owner's default National ID prices, charged where a branch has none. */
export async function defaultNidPrices(): Promise<NidPrices> {
  const settings = await prisma.appSetting.findUnique({
    where: { id: "app" },
    select: { nationalIdOriginalRate: true, nationalIdCopyRate: true },
  });
  return {
    ORIGINAL: settings?.nationalIdOriginalRate ?? new Prisma.Decimal(0),
    COPY: settings?.nationalIdCopyRate ?? new Prisma.Decimal(0),
  };
}

/** What a branch charges: its own prices if the Owner set them, else the default. */
export async function nidPricesFor(locationId: string | null | undefined): Promise<NidPrices> {
  const own = locationId
    ? await prisma.nationalIdBranchPrice.findUnique({ where: { locationId } })
    : null;
  if (own) return { ORIGINAL: own.originalRate, COPY: own.copyRate };
  return defaultNidPrices();
}
