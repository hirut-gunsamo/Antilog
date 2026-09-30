import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";

import { env } from "./config/env.js";
import { prisma } from "./plugins/prisma.js";

import { authRoutes } from "./modules/auth/auth.route.js";
import { userRoutes } from "./modules/users/user.route.js";
import { branchRoutes } from "./modules/branches/branch.route.js";
import { requestRoutes } from "./modules/requests/request.route.js";
import { transferRoutes } from "./modules/transfers/transfer.route.js";
import { saleRoutes } from "./modules/sales/sale.route.js";
import { cashReportRoutes } from "./modules/cash-reports/cashReport.route.js";
import { receiptRoutes } from "./modules/receipts/receipt.route.js";
import { assetRoutes } from "./modules/assets/asset.route.js";
import { collectionRoutes } from "./modules/cash-collections/collection.route.js";
import { reportRoutes } from "./modules/reports/report.route.js";
import { productRoutes } from "./modules/products/product.route.js";
import { productTypeRoutes } from "./modules/product-types/productType.route.js";
import { categoryRoutes } from "./modules/categories/category.route.js";
import { inventoryRoutes } from "./modules/inventory/inventory.route.js";
import { settingsRoutes } from "./modules/settings/settings.route.js";
import { syncRoutes } from "./modules/sync/sync.route.js";
import { pushRoutes } from "./modules/push/push.route.js";
import { ibidRoutes } from "./modules/ibid/ibid.route.js";
import { payrollRoutes } from "./modules/payroll/payroll.route.js";
import { telebirrRoutes } from "./modules/telebirr/telebirr.route.js";
import { expenseRoutes } from "./modules/expenses/expense.route.js";
import { nidOrderRoutes } from "./modules/nid-orders/nidOrder.route.js";
import { bankRoutes } from "./modules/banks/bank.route.js";
import { checkAndPush } from "./modules/push/push.service.js";
import { stockLossRoutes } from "./modules/stock-loss/stockLoss.route.js";
import { nationalIdRoutes } from "./modules/national-id/nationalId.route.js";
import { notificationRoutes } from "./modules/notifications/notification.route.js";
import { registerIdempotency } from "./middleware/idempotency.js";

const app = Fastify({
  logger: true,
});

// Several PATCH endpoints take an optional body (confirm receipt, cancel a
// transfer). Fastify rejects an empty body when the content type says JSON,
// so treat empty as an empty object rather than an error.
app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (_request, body: string, done) => {
    if (!body || body.trim() === "") {
      done(null, {});
      return;
    }

    try {
      done(null, JSON.parse(body));
    } catch (error) {
      done(error as Error, undefined);
    }
  },
);

// CORS
await app.register(cors, {
  origin: true,
});

// JWT authentication
await app.register(jwt, {
  secret: env.JWT_SECRET,
});

// Bank receipt image uploads
await app.register(multipart, {
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },
});

// Authentication routes
await app.register(authRoutes, {
  prefix: "/api/auth",
});

// User management routes
await app.register(userRoutes, {
  prefix: "/api/users",
});

// Branch management routes
await app.register(branchRoutes, {
  prefix: "/api/branches",
});

// Product management routes
await app.register(productRoutes, {
  prefix: "/api/products",
});
await app.register(categoryRoutes, {
  prefix: "/api/categories",
});
await app.register(productTypeRoutes, {
  prefix: "/api/product-types",
});
await app.register(inventoryRoutes, {
  prefix: "/api/inventory",
});

// Restock requests: Supervisor -> Owner
await app.register(requestRoutes, {
  prefix: "/api/requests",
});

// Stock transfers created when a request is approved
await app.register(transferRoutes, {
  prefix: "/api/transfers",
});

// Sales: recorded by Sales against the goods they were issued
await app.register(saleRoutes, {
  prefix: "/api/sales",
});

// Cash reconciliation: Sales -> Supervisor -> Owner
await app.register(cashReportRoutes, {
  prefix: "/api/cash-reports",
});

// Cash handed from a salesperson to their supervisor during the day
await app.register(collectionRoutes, {
  prefix: "/api/cash-collections",
});

// Bank receipt images
await app.register(receiptRoutes, {
  prefix: "/api/receipts",
});

// Office equipment held by each branch: computers, furniture, stationery
await app.register(assetRoutes, {
  prefix: "/api/assets",
});

// Dashboards and downloadable reports
await app.register(reportRoutes, {
  prefix: "/api/reports",
});

// Organisation settings, permissions, backup and restore
await app.register(settingsRoutes, {
  prefix: "/api/settings",
});

// Damage and loss write-offs, and their review queue
await app.register(stockLossRoutes, {
  prefix: "/api/stock-loss",
});

// National ID printing: a service, counted rather than stocked
await app.register(nationalIdRoutes, {
  prefix: "/api/national-id",
});

// What needs the signed-in user's attention, for the bell
await app.register(notificationRoutes, {
  prefix: "/api/notifications",
});

// Offline queue status and the "what changed" delta
await app.register(pushRoutes, {
  prefix: "/api/push",
});

await app.register(ibidRoutes, {
  prefix: "/api/ibid",
});

await app.register(payrollRoutes, {
  prefix: "/api/payroll",
});

await app.register(telebirrRoutes, {
  prefix: "/api/telebirr",
});

await app.register(expenseRoutes, {
  prefix: "/api/expenses",
});

await app.register(nidOrderRoutes, {
  prefix: "/api/nid",
});

await app.register(bankRoutes, {
  prefix: "/api/banks",
});

await app.register(syncRoutes, {
  prefix: "/api/sync",
});

// Makes a mutation replayed from a device's offline queue safe to send
// twice. Inert for requests without an X-Client-Mutation-Id header.
registerIdempotency(app);

// Health check
app.get("/health", async () => {
  return {
    status: "ok",
    message: "SIM Management API is running",
  };
});

// Start server
const start = async () => {
  try {
    await prisma.$connect();

    app.log.info("Database connected");

    await app.listen({
      port: env.PORT,
      host: "0.0.0.0",
    });

    // Phone notifications: look for new work once a minute.
    setInterval(() => {
      checkAndPush().catch((error) => app.log.error(error, "push check failed"));
    }, 60_000);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  try {
    await prisma.$disconnect();
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start();