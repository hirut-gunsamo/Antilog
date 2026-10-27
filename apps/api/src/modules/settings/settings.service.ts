import { prisma } from "../../plugins/prisma.js";
import type { UpdateSettingsInput } from "./settings.schema.js";

// The table is a singleton pinned to this id by a CHECK constraint, so every
// read and write names it directly rather than searching for a row.
const ID = "app";

const DEFAULTS = {
  systemName: "AntiLog",
  defaultLanguage: "en",
  currency: "ETB",
  dateFormat: "medium",
  timeFormat: "24h",
  itemsPerPage: 10,
  lowHoldingSim: 5,
  lowHoldingPhone: 2,
  lowHoldingVoucher: 20,
  notifySales: true,
  notifyRequests: true,
  notifyApprovals: true,
  notifyLowStock: true,
  notifySystem: false,
};

const withEditor = {
  include: {
    updatedBy: { select: { id: true, name: true, role: true } },
  },
};

/**
 * Reads the settings, creating the row if a database predates the migration
 * that seeds it. Callers can therefore assume settings always exist.
 */
export async function getSettings() {
  return prisma.appSetting.upsert({
    where: { id: ID },
    create: { id: ID },
    update: {},
    ...withEditor,
  });
}

export async function updateSettings(
  data: UpdateSettingsInput,
  updatedById: string,
) {
  return prisma.appSetting.upsert({
    where: { id: ID },
    create: { id: ID, ...data, updatedById },
    update: { ...data, updatedById },
    ...withEditor,
  });
}

/** Puts every setting back to the value a fresh install would have. */
export async function resetSettings(updatedById: string) {
  return prisma.appSetting.upsert({
    where: { id: ID },
    create: { id: ID, ...DEFAULTS, updatedById },
    update: { ...DEFAULTS, updatedById },
    ...withEditor,
  });
}

// The order matters on restore: a row cannot reference a row that does not
// exist yet. Reading uses the same order reversed for deletion.
// Ordered so that every row's references already exist by the time it is
// inserted. Two of these are easy to get wrong and both were:
//   Sale          -> CashReport   (so cash reports come first)
//   InventoryUnit -> SaleItem     (so sale items come first)
const TABLES = [
  "stockLocation",
  "user",
  "bank",
  "category",
  "productType",
  "product",
  "productBranchPrice",
  "simProduct",
  "voucherProduct",
  "phoneProduct",
  "inventoryBalance",
  "branchStock",
  "stockRequest",
  "stockRequestItem",
  "stockTransfer",
  "stockTransferItem",
  "cashReport",
  "sale",
  "saleSimTransfer",
  "saleBillPayment",
  "editGrant",
  "paymentEditGrant",
  "saleItem",
  "inventoryUnit",
  "bankReceipt",
  "ibidLoad",
  "ibidPrint",
  "commissionRate",
  "payrollPayment",
  "commissionPayment",
  "commissionLine",
  "deduction",
  "deductionLine",
  "telebirrLoad",
  "telebirrTransaction",
  "expense",
  "nationalIdRequest",
  "nationalIdOrder",
  "nationalIdBranchPrice",
  "stockMovement",
  "auditLog",
  "appSetting",
] as const;

type TableName = (typeof TABLES)[number];

/**
 * A full export of the business data, as JSON.
 *
 * Password hashes are included deliberately: without them a restored backup
 * would lock every user out. The file is therefore as sensitive as the
 * database itself, which is why only the Owner may fetch it.
 */
export async function exportBackup() {
  const tables: Record<string, unknown[]> = {};

  for (const table of TABLES) {
    const model = prisma[table] as unknown as {
      findMany: () => Promise<unknown[]>;
    };

    tables[table] = await model.findMany();
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    tables,
  };
}

/**
 * Replaces everything with the contents of a backup, inside one transaction:
 * either the whole restore lands or none of it does, so a failure halfway
 * cannot leave the system with half its data.
 */
export async function restoreBackup(backup: {
  version: number;
  tables: Record<string, Record<string, unknown>[]>;
}) {
  if (backup.version !== 1) {
    throw new Error("UNSUPPORTED_BACKUP_VERSION");
  }

  const known = new Set<string>(TABLES);

  for (const name of Object.keys(backup.tables)) {
    if (!known.has(name)) {
      throw new Error("UNKNOWN_TABLE_IN_BACKUP");
    }
  }

  return prisma.$transaction(
    async (tx) => {
      // Children first, so no foreign key is left dangling mid-delete.
      for (const table of [...TABLES].reverse()) {
        if (table === "appSetting") continue;

        const model = tx[table as TableName] as unknown as {
          deleteMany: (args: Record<string, unknown>) => Promise<unknown>;
        };

        await model.deleteMany({});
      }

      for (const table of TABLES) {
        const rows = backup.tables[table];
        if (!rows || rows.length === 0) continue;

        if (table === "appSetting") {
          // The singleton is updated rather than inserted; its id is fixed.
          const [row] = rows;
          const { id: _id, updatedBy: _updatedBy, ...rest } = row;

          await tx.appSetting.update({
            where: { id: ID },
            data: rest as never,
          });

          continue;
        }

        const model = tx[table as TableName] as unknown as {
          createMany: (args: {
            data: unknown[];
            skipDuplicates?: boolean;
          }) => Promise<unknown>;
        };

        await model.createMany({ data: rows });
      }

      return { tables: Object.keys(backup.tables).length };
    },
    // A full restore is far slower than an ordinary write.
    { timeout: 120_000 },
  );
}

// Day-to-day activity and the whole catalogue, emptied to start fresh. Kept:
// logins, branches, banks, office equipment, commission rates, settings and
// phone-notification subscriptions.
const ACTIVITY_TABLES = [
  "Sale",
  "SaleSimTransfer",
  "SaleBillPayment",
  "EditGrant",
  "PaymentEditGrant",
  "SaleItem",
  "StockRequest",
  "StockRequestItem",
  "StockTransfer",
  "StockTransferItem",
  "StockMovement",
  "InventoryBalance",
  "BranchStock",
  "InventoryUnit",
  "SalespersonHolding",
  "StockLossReport",
  "CashCollection",
  "CashReport",
  "BankReceipt",
  "Expense",
  "PayrollPayment",
  "CommissionPayment",
  "CommissionLine",
  "Deduction",
  "DeductionLine",
  "NationalIdStockEntry",
  "NationalIdRecord",
  "NationalIdRequest",
  "NationalIdOrder",
  "IbidLoad",
  "IbidPrint",
  "TelebirrLoad",
  "TelebirrTransaction",
  "SyncRecord",
  "AuditLog",
  // The catalogue: categories, types and products are all made again, with
  // each product's branch prices.
  "ProductBranchPrice",
  "SimProduct",
  "VoucherProduct",
  "PhoneProduct",
  "Product",
  "ProductType",
  "Category",
];

/** Erases every record and the catalogue. Owner only. */
export async function eraseActivity(actorId: string) {
  const tables = ACTIVITY_TABLES.map((name) => `"${name}"`).join(", ");

  await prisma.$transaction(async (tx) => {
    // No CASCADE: if a kept table pointed at one of these, Postgres refuses
    // rather than quietly emptying that table too.
    await tx.$executeRawUnsafe(`TRUNCATE TABLE ${tables}`);
    await tx.auditLog.create({
      data: { actorId, action: "ERASE_ALL_DATA", entityType: "System" },
    });
  });
}
