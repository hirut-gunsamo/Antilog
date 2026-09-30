# Product Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the catalogue an owner-managed type tree, generate product names and codes, and move ICCID/IMEI capture from stock-in to the sale.

**Architecture:** One new table (`ProductType`) holds a tree scoped to the three fixed categories; `Product` gains a required `typeId`. Stock-in becomes balance-only for every category, and `InventoryUnit` rows are created at sale time with `status = SOLD` instead of being created at stock-in and retired at sale. The three category enums and the three detail tables stay exactly as they are, so the sixteen web files and eight API files that branch on category keep working untouched.

**Tech Stack:** Fastify 5, Prisma 7 (hand-written migrations), zod 4, React 19, Vite 8, CSS Modules, Postgres.

**Spec:** [docs/superpowers/specs/2026-09-25-product-structure-design.md](../specs/2026-09-25-product-structure-design.md)

## Global Constraints

- **Migrations are hand-written.** Never run `prisma migrate dev`. Two hidden Postgres guards exist on this database that do not appear in `schema.prisma`; drift detection will offer to drop them. Write `migration.sql` by hand in `packages/database/prisma/migrations/<UTC timestamp>_<name>/`, then `pnpm --filter database exec prisma migrate deploy`.
- **Both languages, always.** Every key added to `apps/web/src/lib/i18n.ts` must exist in both the `en` and the `am` object, or the file will not type-check.
- **No test framework exists in this repo.** Verification is by driving the real API with a signed JWT and the real browser over CDP. Every task's "test" step is a command with expected output.
- **The three categories are fixed:** `SIM_CARD`, `PHONE`, `AIRTIME_VOUCHER`. Do not add a fourth.
- **`PhoneProduct.brand` and `.model` keep being written** as copies of the chosen type path. Sixteen web files read them.
- **Prisma serialises `Decimal` as a string.** Product `price` is a string in JSON.
- **Type-check with** `pnpm exec tsc --noEmit -p tsconfig.app.json` in `apps/web`, and `pnpm exec tsc --noEmit` in `apps/api`.

## Review Focus

Five things the spec implies but no single task's happy path exercises. Each has a test added to the task that owns it.

1. **A type with children is retired or deleted.** Retiring "iPhone" should not orphan "15 Pro Max" or silently hide products. Covered in Task 3.
2. **Two products generate the same code.** "iPhone 15 Pro Max" entered twice, or two variants whose parts collapse to the same slug, must not 500 on the unique index. Covered in Task 4.
3. **A sale sends the wrong number of serials.** 2 phones with 1 IMEI, or 3 IMEIs, must be refused before any stock moves. Covered in Task 6.
4. **The same IMEI is sold twice.** The second sale must fail cleanly with a readable message, not a raw Prisma unique-violation. Covered in Task 6.
5. **A voucher sale asks for no serials.** Sending serials for a non-serialised line must be rejected rather than quietly creating stray unit rows. Covered in Task 6.

---

### Task 1: The ProductType table

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260925090000_product_types/migration.sql`

**Interfaces:**
- Consumes: nothing
- Produces: model `ProductType { id, category, parentId, name, isActive, createdAt, updatedAt }`; `Product.typeId String?` and `Product.type ProductType?`

`typeId` is nullable in this task so the migration can run against a database that already holds products. Task 4 backfills it and the API requires it from then on; the column stays nullable in the database so no existing row is invalidated.

- [ ] **Step 1: Add the model to schema.prisma**

Add after the `Product` model:

```prisma
/// A brand, a voucher type, or a phone model — the level between a fixed
/// category and a sellable product. Self-referencing so phones can go
/// brand -> model while SIM and voucher types stay one level deep.
model ProductType {
  id String @id @default(cuid())

  category ProductCategory
  parentId String?
  name     String

  isActive Boolean @default(true)

  parent   ProductType?  @relation("ProductTypeTree", fields: [parentId], references: [id])
  children ProductType[] @relation("ProductTypeTree")

  products Product[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([category, parentId, name])
  @@index([category])
  @@index([parentId])
}
```

And inside `model Product`, beside the existing `category` field:

```prisma
  typeId String?
  type   ProductType? @relation(fields: [typeId], references: [id])
```

- [ ] **Step 2: Write the migration**

Create `packages/database/prisma/migrations/20260925090000_product_types/migration.sql`:

```sql
-- The level between a fixed category and a sellable product: a brand, a
-- voucher type, a phone model.
--
-- Self-referencing rather than one table per level, because SIM and voucher
-- types are one level deep while phones are two, and a third level may be
-- wanted later without another migration.
--
-- Hand-written like every migration here: guards exist on this database that
-- do not appear in schema.prisma, and drift detection would offer to drop them.

CREATE TABLE "ProductType" (
    "id" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductType_pkey" PRIMARY KEY ("id")
);

-- A NULL parentId does not compare equal to another NULL, so this index alone
-- would let the same top-level brand be added twice. The partial index below
-- closes that.
CREATE UNIQUE INDEX "ProductType_category_parentId_name_key"
    ON "ProductType"("category", "parentId", "name");

CREATE UNIQUE INDEX "ProductType_category_name_root_key"
    ON "ProductType"("category", "name")
    WHERE "parentId" IS NULL;

CREATE INDEX "ProductType_category_idx" ON "ProductType"("category");
CREATE INDEX "ProductType_parentId_idx" ON "ProductType"("parentId");

ALTER TABLE "ProductType"
    ADD CONSTRAINT "ProductType_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "ProductType"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Nullable: existing products have no type yet, and a later step attaches them.
ALTER TABLE "Product" ADD COLUMN "typeId" TEXT;

CREATE INDEX "Product_typeId_idx" ON "Product"("typeId");

ALTER TABLE "Product"
    ADD CONSTRAINT "Product_typeId_fkey"
    FOREIGN KEY ("typeId") REFERENCES "ProductType"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- The types the business already works with.
INSERT INTO "ProductType" ("id", "category", "parentId", "name", "updatedAt") VALUES
    ('pt_sim_standard',  'SIM_CARD',        NULL, 'Standard', CURRENT_TIMESTAMP),
    ('pt_sim_esim',      'SIM_CARD',        NULL, 'eSIM',     CURRENT_TIMESTAMP),
    ('pt_av_ibid',       'AIRTIME_VOUCHER', NULL, 'Ibid',     CURRENT_TIMESTAMP),
    ('pt_av_voucher',    'AIRTIME_VOUCHER', NULL, 'Voucher',  CURRENT_TIMESTAMP),
    ('pt_av_wereket',    'AIRTIME_VOUCHER', NULL, 'Wereket',  CURRENT_TIMESTAMP);
```

- [ ] **Step 3: Verify it fails before applying**

Run:

```bash
cd /Users/mac/Desktop/sim-management-system
DB=$(grep -m1 DATABASE_URL apps/api/.env | cut -d'"' -f2)
psql "$DB" -c 'select count(*) from "ProductType";'
```

Expected: `ERROR: relation "ProductType" does not exist`

- [ ] **Step 4: Apply and generate**

```bash
cd /Users/mac/Desktop/sim-management-system
pnpm --filter database exec prisma migrate deploy
pnpm --filter database exec prisma generate
```

- [ ] **Step 5: Verify the tree and the guard**

```bash
DB=$(grep -m1 DATABASE_URL apps/api/.env | cut -d'"' -f2)
psql "$DB" -c 'select category, name from "ProductType" order by category, name;'
psql "$DB" -c $'insert into "ProductType" (id, category, "parentId", name, "updatedAt") values (\'x\', \'SIM_CARD\', NULL, \'Standard\', CURRENT_TIMESTAMP);'
```

Expected: five rows listed, then `ERROR: duplicate key value violates unique constraint "ProductType_category_name_root_key"`.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260925090000_product_types
git commit -m "feat(db): add ProductType tree and Product.typeId

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Make SimProduct.network optional

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260925091000_sim_network_optional/migration.sql`

**Interfaces:**
- Consumes: nothing
- Produces: `SimProduct.network` is `String?`

- [ ] **Step 1: Change the field**

In `model SimProduct`, change `network String` to:

```prisma
  /// Ethio Telecom is the only network, so the form no longer asks. Kept
  /// nullable rather than dropped so existing rows keep their value.
  network String?
```

- [ ] **Step 2: Write the migration**

Create `packages/database/prisma/migrations/20260925091000_sim_network_optional/migration.sql`:

```sql
-- Ethio Telecom is the only network the business sells, so the product form
-- stopped asking. The column stays for the rows that already carry a value.

ALTER TABLE "SimProduct" ALTER COLUMN "network" DROP NOT NULL;
```

- [ ] **Step 3: Verify it is NOT NULL first**

```bash
DB=$(grep -m1 DATABASE_URL apps/api/.env | cut -d'"' -f2)
psql "$DB" -c $'select is_nullable from information_schema.columns where table_name=\'SimProduct\' and column_name=\'network\';'
```

Expected: `NO`

- [ ] **Step 4: Apply and verify**

```bash
pnpm --filter database exec prisma migrate deploy
pnpm --filter database exec prisma generate
psql "$DB" -c $'select is_nullable from information_schema.columns where table_name=\'SimProduct\' and column_name=\'network\';'
```

Expected: `YES`

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260925091000_sim_network_optional
git commit -m "feat(db): make SimProduct.network optional

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Product type API

**Files:**
- Create: `apps/api/src/modules/product-types/productType.schema.ts`
- Create: `apps/api/src/modules/product-types/productType.service.ts`
- Create: `apps/api/src/modules/product-types/productType.controller.ts`
- Create: `apps/api/src/modules/product-types/productType.route.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/modules/settings/settings.service.ts:78-92`

**Interfaces:**
- Consumes: `ProductType` model from Task 1
- Produces:
  - `GET /api/product-types?category=PHONE` → `{ types: TypeNode[] }` where `TypeNode = { id, category, parentId, name, isActive, children: TypeNode[] }`
  - `POST /api/product-types` body `{ category, name, parentId? }` → `201 { type }`
  - `PATCH /api/product-types/:id` body `{ name?, isActive? }` → `{ type }`
  - Service exports `getTypeTree(category?)`, `createType(input)`, `updateType(id, input)`

- [ ] **Step 1: Write the schema**

Create `apps/api/src/modules/product-types/productType.schema.ts`:

```ts
import { z } from "zod";

export const createProductTypeSchema = z.object({
  category: z.enum(["SIM_CARD", "PHONE", "AIRTIME_VOUCHER"]),
  name: z.string().min(1).max(80),
  // Absent for a brand or a voucher type; set for a phone model under a brand.
  parentId: z.string().min(1).optional(),
});

export const updateProductTypeSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.isActive !== undefined, {
    message: "Nothing to change",
  });

export const listProductTypesQuerySchema = z.object({
  category: z.enum(["SIM_CARD", "PHONE", "AIRTIME_VOUCHER"]).optional(),
});

export type CreateProductTypeInput = z.infer<typeof createProductTypeSchema>;
export type UpdateProductTypeInput = z.infer<typeof updateProductTypeSchema>;
export type ListProductTypesQuery = z.infer<typeof listProductTypesQuerySchema>;
```

- [ ] **Step 2: Write the service**

Create `apps/api/src/modules/product-types/productType.service.ts`:

```ts
import { prisma } from "../../plugins/prisma.js";
import type {
  CreateProductTypeInput,
  UpdateProductTypeInput,
} from "./productType.schema.js";

const typeSelect = {
  id: true,
  category: true,
  parentId: true,
  name: true,
  isActive: true,
} as const;

export type TypeNode = {
  id: string;
  category: string;
  parentId: string | null;
  name: string;
  isActive: boolean;
  children: TypeNode[];
};

/**
 * The whole tree for a category, or for every category.
 *
 * Built in memory from one flat query: the tree is at most three deep and
 * holds tens of rows, so a recursive query would cost more than it saves.
 */
export async function getTypeTree(category?: string): Promise<TypeNode[]> {
  const rows = await prisma.productType.findMany({
    where: category ? { category: category as never } : {},
    select: typeSelect,
    orderBy: [{ name: "asc" }],
  });

  const byId = new Map<string, TypeNode>();
  for (const row of rows) {
    byId.set(row.id, { ...row, children: [] });
  }

  const roots: TypeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
}

export async function createType(data: CreateProductTypeInput) {
  if (data.parentId) {
    const parent = await prisma.productType.findUnique({
      where: { id: data.parentId },
      select: { id: true, category: true },
    });

    if (!parent) {
      throw new Error("PARENT_NOT_FOUND");
    }

    // A phone model cannot hang off a voucher type.
    if (parent.category !== data.category) {
      throw new Error("PARENT_WRONG_CATEGORY");
    }
  }

  const clash = await prisma.productType.findFirst({
    where: {
      category: data.category,
      parentId: data.parentId ?? null,
      name: data.name,
    },
    select: { id: true },
  });

  if (clash) {
    throw new Error("TYPE_EXISTS");
  }

  return prisma.productType.create({
    data: {
      category: data.category,
      name: data.name,
      parentId: data.parentId ?? null,
    },
    select: typeSelect,
  });
}

export async function updateType(id: string, data: UpdateProductTypeInput) {
  const type = await prisma.productType.findUnique({
    where: { id },
    select: { id: true, category: true, parentId: true },
  });

  if (!type) {
    throw new Error("TYPE_NOT_FOUND");
  }

  // Retiring a brand would hide its models without saying so, and the
  // products under them would still be on sale. Empty it first.
  if (data.isActive === false) {
    const children = await prisma.productType.count({
      where: { parentId: id, isActive: true },
    });

    if (children > 0) {
      throw new Error("TYPE_HAS_CHILDREN");
    }

    const products = await prisma.product.count({
      where: { typeId: id, status: "ACTIVE" },
    });

    if (products > 0) {
      throw new Error("TYPE_HAS_PRODUCTS");
    }
  }

  if (data.name) {
    const clash = await prisma.productType.findFirst({
      where: {
        category: type.category,
        parentId: type.parentId,
        name: data.name,
        id: { not: id },
      },
      select: { id: true },
    });

    if (clash) {
      throw new Error("TYPE_EXISTS");
    }
  }

  return prisma.productType.update({
    where: { id },
    data: {
      ...(data.name ? { name: data.name } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
    select: typeSelect,
  });
}
```

- [ ] **Step 3: Write the controller**

Create `apps/api/src/modules/product-types/productType.controller.ts`:

```ts
import type { FastifyReply, FastifyRequest } from "fastify";

import {
  createProductTypeSchema,
  listProductTypesQuerySchema,
  updateProductTypeSchema,
} from "./productType.schema.js";

import { createType, getTypeTree, updateType } from "./productType.service.js";

const MESSAGES: Record<string, { status: number; message: string }> = {
  PARENT_NOT_FOUND: { status: 404, message: "That parent type no longer exists" },
  PARENT_WRONG_CATEGORY: {
    status: 400,
    message: "A type can only sit under one of its own category",
  },
  TYPE_EXISTS: { status: 409, message: "That name is already in this list" },
  TYPE_NOT_FOUND: { status: 404, message: "That type no longer exists" },
  TYPE_HAS_CHILDREN: {
    status: 409,
    message: "Retire the models under it first",
  },
  TYPE_HAS_PRODUCTS: {
    status: 409,
    message: "Retire the products using it first",
  },
};

function fail(reply: FastifyReply, error: unknown) {
  const known = error instanceof Error ? MESSAGES[error.message] : undefined;

  if (!known) throw error;

  return reply.status(known.status).send({ message: known.message });
}

export async function getProductTypesController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const query = listProductTypesQuerySchema.safeParse(request.query);

  if (!query.success) {
    return reply.status(400).send({ message: "Invalid filter" });
  }

  return reply.send({ types: await getTypeTree(query.data.category) });
}

export async function createProductTypeController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = createProductTypeSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid type",
      errors: result.error.flatten(),
    });
  }

  try {
    return reply.status(201).send({ type: await createType(result.data) });
  } catch (error) {
    return fail(reply, error);
  }
}

export async function updateProductTypeController(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const result = updateProductTypeSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid change",
      errors: result.error.flatten(),
    });
  }

  try {
    return reply.send({
      type: await updateType(request.params.id, result.data),
    });
  } catch (error) {
    return fail(reply, error);
  }
}
```

- [ ] **Step 4: Write the route**

Create `apps/api/src/modules/product-types/productType.route.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import { authenticate, authorize } from "../../middleware/auth.js";

import {
  createProductTypeController,
  getProductTypesController,
  updateProductTypeController,
} from "./productType.controller.js";

export async function productTypeRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Everyone reads them: the request and stock-in forms group by type.
  app.get("/", getProductTypesController);

  // Only the Owner decides what the business sells.
  app.post(
    "/",
    { preHandler: [authorize(UserRole.OWNER)] },
    createProductTypeController,
  );

  app.patch<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authorize(UserRole.OWNER)] },
    updateProductTypeController,
  );
}
```

- [ ] **Step 5: Register it**

In `apps/api/src/server.ts`, add the import beside the other module imports:

```ts
import { productTypeRoutes } from "./modules/product-types/productType.route.js";
```

and register it next to where `productRoutes` is registered, with the prefix `/api/product-types`. Match the exact registration style already used for `productRoutes` in that file.

In `apps/api/src/modules/settings/settings.service.ts`, add `"productType",` to the `TABLES` array immediately after `"phoneProduct",`.

- [ ] **Step 6: Verify against the running API**

Start the API if it is not running (`pnpm dev:api`). Mint an owner token and exercise the endpoints:

```bash
cd /Users/mac/Desktop/sim-management-system
T=$(node -e '
const c=require("crypto");const S="change-this-to-a-long-random-secret-before-production";
const b=(o)=>Buffer.from(JSON.stringify(o)).toString("base64url");
const h=b({alg:"HS256",typ:"JWT"}),p=b({userId:"cmu24uc4o0000lmrxg88tlgsu",role:"OWNER",iat:Math.floor(Date.now()/1000)});
console.log(h+"."+p+"."+c.createHmac("sha256",S).update(h+"."+p).digest("base64url"))')

# the seeded tree
curl -s "http://127.0.0.1:3000/api/product-types?category=AIRTIME_VOUCHER" -H "Authorization: Bearer $T"

# add a brand, then a model under it
BRAND=$(curl -s -X POST http://127.0.0.1:3000/api/product-types -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d '{"category":"PHONE","name":"ZZ Probe Brand"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).type.id))')

curl -s -X POST http://127.0.0.1:3000/api/product-types -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d "{\"category\":\"PHONE\",\"name\":\"ZZ Model\",\"parentId\":\"$BRAND\"}"

# duplicate name is refused
curl -s -X POST http://127.0.0.1:3000/api/product-types -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d '{"category":"PHONE","name":"ZZ Probe Brand"}'

# Review Focus 1: retiring a parent that still has a child is refused
curl -s -X PATCH "http://127.0.0.1:3000/api/product-types/$BRAND" -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d '{"isActive":false}'
```

Expected in order: three voucher types; a brand with an id; a model carrying `parentId`; `{"message":"That name is already in this list"}`; `{"message":"Retire the models under it first"}`.

- [ ] **Step 7: Clean up the probe rows**

```bash
DB=$(grep -m1 DATABASE_URL apps/api/.env | cut -d'"' -f2)
psql "$DB" -c $'delete from "ProductType" where name like \'ZZ %\';'
psql "$DB" -c $'select count(*) from "ProductType";'
```

Expected: `5`

- [ ] **Step 8: Type-check and commit**

```bash
cd apps/api && pnpm exec tsc --noEmit && cd ..
git add apps/api/src/modules/product-types apps/api/src/server.ts apps/api/src/modules/settings/settings.service.ts
git commit -m "feat(api): product type tree endpoints

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Product create takes a type, generates name and code

**Files:**
- Modify: `apps/api/src/modules/products/product.schema.ts`
- Modify: `apps/api/src/modules/products/product.service.ts:4-57,80-98`
- Create: `apps/api/src/modules/products/product.naming.ts`
- Create: `packages/database/prisma/backfill-product-types.ts`

**Interfaces:**
- Consumes: `getTypeTree` is not used here; this task reads `prisma.productType` directly. `createType` from Task 3 is not called.
- Produces:
  - `buildName(parts: NameParts): string` and `buildSku(parts: NameParts): string` from `product.naming.ts`, where
    `NameParts = { category: string; typePath: string[]; storage?: string | null; color?: string | null; denomination?: number | null }`
  - `POST /api/products` now takes `{ typeId, price, name?, storage?, color?, denomination? }` — `sku` and `network` are gone from the input.
  - `getProducts()` rows gain `type: { id, name, parentId }`.

- [ ] **Step 1: Write the naming helper**

Create `apps/api/src/modules/products/product.naming.ts`:

```ts
/**
 * Names and codes are built from the parts rather than typed.
 *
 * There is no reason for a person to invent a code for every storage and
 * colour variant, and hand-typed ones drift: "15 Pro Max" one month,
 * "15 pro max" the next.
 */
export type NameParts = {
  category: string;
  /** Root first: ["iPhone", "15 Pro Max"] or ["Ibid"]. */
  typePath: string[];
  storage?: string | null;
  color?: string | null;
  denomination?: number | null;
};

export function buildName(parts: NameParts): string {
  if (parts.category === "AIRTIME_VOUCHER") {
    return [...parts.typePath, parts.denomination].filter(Boolean).join(" ");
  }

  if (parts.category === "SIM_CARD") {
    return `${parts.typePath.join(" ")} SIM card`;
  }

  return [...parts.typePath, parts.storage, parts.color]
    .filter(Boolean)
    .join(" ");
}

const PREFIX: Record<string, string> = {
  SIM_CARD: "SIM",
  PHONE: "PH",
  AIRTIME_VOUCHER: "AV",
};

/** Initials of each word, so "15 Pro Max" becomes "15PM". */
function slug(value: string): string {
  const words = value.trim().split(/\s+/);

  if (words.length === 1) {
    return words[0].replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
  }

  return words
    .map((word) => word.replace(/[^A-Za-z0-9]/g, ""))
    .map((word) => (/^\d/.test(word) ? word : word.slice(0, 1)))
    .join("")
    .toUpperCase()
    .slice(0, 8);
}

export function buildSku(parts: NameParts): string {
  const pieces = [
    PREFIX[parts.category] ?? "PR",
    ...parts.typePath.map(slug),
    parts.denomination != null ? String(parts.denomination) : null,
    parts.storage ? slug(parts.storage) : null,
    parts.color ? slug(parts.color) : null,
  ].filter(Boolean);

  return pieces.join("-");
}
```

- [ ] **Step 2: Replace the create schema**

In `apps/api/src/modules/products/product.schema.ts`, replace the whole discriminated union with:

```ts
import { z } from "zod";

// The type carries the brand and model; the category comes from the type.
// A name may be supplied to override the generated one, but never a code.
const baseProductSchema = z.object({
  typeId: z.string().min(1),
  name: z.string().min(2).max(150).optional(),
  description: z.string().max(500).optional(),
  price: z.coerce.number().nonnegative(),
});

export const createProductSchema = baseProductSchema.extend({
  // Phones only.
  storage: z.string().max(40).optional(),
  color: z.string().max(40).optional(),
  // Vouchers only; the price is taken from it.
  denomination: z.coerce.number().int().positive().optional(),
});

export const updateProductStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
```

- [ ] **Step 3: Rewrite createProduct**

In `apps/api/src/modules/products/product.service.ts`, replace `createProduct` with:

```ts
import { buildName, buildSku } from "./product.naming.js";

/** Root first: ["iPhone", "15 Pro Max"]. At most three deep. */
async function pathOf(typeId: string): Promise<{ category: string; path: string[] }> {
  const path: string[] = [];
  let category = "";
  let current: string | null = typeId;

  for (let depth = 0; current && depth < 5; depth++) {
    const node = await prisma.productType.findUnique({
      where: { id: current },
      select: { name: true, parentId: true, category: true },
    });

    if (!node) throw new Error("TYPE_NOT_FOUND");

    path.unshift(node.name);
    category = node.category;
    current = node.parentId;
  }

  return { category, path };
}

/** Appends -2, -3 … until the code is free. */
async function freeSku(base: string): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;

    const taken = await prisma.product.findUnique({
      where: { sku: candidate },
      select: { id: true },
    });

    if (!taken) return candidate;
  }

  throw new Error("SKU_EXHAUSTED");
}

export async function createProduct(data: CreateProductInput) {
  const { category, path } = await pathOf(data.typeId);

  if (category === "AIRTIME_VOUCHER" && data.denomination == null) {
    throw new Error("DENOMINATION_REQUIRED");
  }

  const parts = {
    category,
    typePath: path,
    storage: data.storage ?? null,
    color: data.color ?? null,
    denomination: data.denomination ?? null,
  };

  const name = data.name?.trim() || buildName(parts);
  const sku = await freeSku(buildSku(parts));

  // A voucher sells for its face value, so the price is not asked for.
  const price =
    category === "AIRTIME_VOUCHER" ? data.denomination! : data.price;

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        sku,
        name,
        description: data.description,
        price,
        category: category as never,
        typeId: data.typeId,
      },
    });

    if (category === "SIM_CARD") {
      await tx.simProduct.create({
        data: { productId: product.id, network: null },
      });
    }

    if (category === "AIRTIME_VOUCHER") {
      await tx.voucherProduct.create({
        data: { productId: product.id, denomination: data.denomination! },
      });
    }

    if (category === "PHONE") {
      // Copies of the type path. Sixteen web files read these.
      await tx.phoneProduct.create({
        data: {
          productId: product.id,
          brand: path[0] ?? "",
          model: path.slice(1).join(" ") || (path[0] ?? ""),
          storage: data.storage,
          color: data.color,
        },
      });
    }

    return getProductById(product.id, tx);
  });
}
```

In `getProducts()` and `getProductById()`, add `type: { select: { id: true, name: true, parentId: true } },` to the `include` block beside `simDetails`.

- [ ] **Step 4: Add the new error messages**

In `apps/api/src/modules/products/product.controller.ts`, extend the `catch` in `createProductController` so these map to readable replies alongside the existing `SKU_EXISTS`:

```ts
    if (error instanceof Error) {
      if (error.message === "TYPE_NOT_FOUND") {
        return reply.status(404).send({
          message: "That product type no longer exists",
        });
      }

      if (error.message === "DENOMINATION_REQUIRED") {
        return reply.status(400).send({
          message: "A voucher needs its value",
        });
      }
    }
```

- [ ] **Step 5: Verify, including the Review Focus case**

```bash
T=$(node -e '
const c=require("crypto");const S="change-this-to-a-long-random-secret-before-production";
const b=(o)=>Buffer.from(JSON.stringify(o)).toString("base64url");
const h=b({alg:"HS256",typ:"JWT"}),p=b({userId:"cmu24uc4o0000lmrxg88tlgsu",role:"OWNER",iat:Math.floor(Date.now()/1000)});
console.log(h+"."+p+"."+c.createHmac("sha256",S).update(h+"."+p).digest("base64url"))')

# a voucher: name and code generated, price from the denomination
curl -s -X POST http://127.0.0.1:3000/api/products -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d '{"typeId":"pt_av_ibid","denomination":25,"price":0}'

# Review Focus 2: the same product twice must get a suffixed code, not a 500
curl -s -X POST http://127.0.0.1:3000/api/products -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d '{"typeId":"pt_av_ibid","denomination":25,"price":0}'

# a voucher with no value is refused
curl -s -X POST http://127.0.0.1:3000/api/products -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d '{"typeId":"pt_av_ibid","price":10}'
```

Expected: first returns `"name":"Ibid 25"`, `"sku":"AV-IBID-25"`, `"price":"25"`; second returns `"sku":"AV-IBID-25-2"` with status 201; third returns `{"message":"A voucher needs its value"}`.

- [ ] **Step 6: Backfill the existing products**

Create `packages/database/prisma/backfill-product-types.ts`:

```ts
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
```

Run it and confirm nothing is left unattached:

```bash
pnpm --filter database exec tsx prisma/backfill-product-types.ts
DB=$(grep -m1 DATABASE_URL apps/api/.env | cut -d'"' -f2)
psql "$DB" -c 'select count(*) from "Product" where "typeId" is null;'
```

Expected: `0`

- [ ] **Step 7: Remove the probe products and commit**

```bash
psql "$DB" -c $'delete from "VoucherProduct" where "productId" in (select id from "Product" where sku like \'AV-IBID-25%\');'
psql "$DB" -c $'delete from "Product" where sku like \'AV-IBID-25%\';'
cd apps/api && pnpm exec tsc --noEmit && cd ..
git add apps/api/src/modules/products packages/database/prisma/backfill-product-types.ts
git commit -m "feat(api): products take a type, generate name and code

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Stock-in stops creating units

**Files:**
- Modify: `apps/api/src/modules/inventory/inventory.service.ts:89-99,140-152,350-369`
- Modify: `apps/api/src/modules/inventory/inventory.schema.ts:3-21`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `recordStockIn` no longer accepts or writes `units`; `adjustBalance` no longer raises `SERIALIZED_COUNT_MISMATCH`

- [ ] **Step 1: Drop `units` from the stock-in schema**

In `apps/api/src/modules/inventory/inventory.schema.ts`, replace `stockInSchema` with:

```ts
// Stock arrives as a count, for every category. ICCIDs and IMEIs are recorded
// when a unit is sold, not when it is delivered.
export const stockInSchema = z.object({
  productId: z.string().min(1),
  locationId: z.string().min(1),

  quantity: z.coerce.number().int().positive(),

  note: z.string().max(500).optional(),
});
```

- [ ] **Step 2: Remove the unit validation and creation**

In `apps/api/src/modules/inventory/inventory.service.ts`, delete the block at lines 89-99 (the `isSerialized` constant and the `INVALID_UNIT_COUNT` check) and the block at lines 140-152 (the `tx.inventoryUnit.createMany` call and its comment).

Replace the `adjustBalance` block at lines 350-369 (the second `isSerialized` constant through the `SERIALIZED_COUNT_MISMATCH` throw) with this comment and nothing else:

```ts
  // Nothing to reconcile against: stock is a count for every category, and
  // unit rows only exist for items already sold.
```

- [ ] **Step 3: Verify stock-in takes a count with no serials**

```bash
T=$(node -e '
const c=require("crypto");const S="change-this-to-a-long-random-secret-before-production";
const b=(o)=>Buffer.from(JSON.stringify(o)).toString("base64url");
const h=b({alg:"HS256",typ:"JWT"}),p=b({userId:"cmu24uc4o0000lmrxg88tlgsu",role:"OWNER",iat:Math.floor(Date.now()/1000)});
console.log(h+"."+p+"."+c.createHmac("sha256",S).update(h+"."+p).digest("base64url"))')

DB=$(grep -m1 DATABASE_URL apps/api/.env | cut -d'"' -f2)
PHONE=$(psql "$DB" -At -c $'select id from "Product" where category=\'PHONE\' limit 1;')
BRANCH=$(psql "$DB" -At -c $'select id from "StockLocation" where "isActive" limit 1;')

psql "$DB" -c "select quantity from \"InventoryBalance\" where \"productId\"='$PHONE' and \"locationId\"='$BRANCH';"

curl -s -X POST http://127.0.0.1:3000/api/inventory/stock-in -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' \
  -d "{\"productId\":\"$PHONE\",\"locationId\":\"$BRANCH\",\"quantity\":5,\"note\":\"ZZ probe\"}"

psql "$DB" -c "select quantity from \"InventoryBalance\" where \"productId\"='$PHONE' and \"locationId\"='$BRANCH';"
psql "$DB" -c "select count(*) from \"InventoryUnit\" where \"productId\"='$PHONE' and status='IN_STOCK';"
```

Expected: the balance rises by exactly 5, the request succeeds without a `units` array, and the IN_STOCK unit count is unchanged from before the call.

- [ ] **Step 4: Put the balance back and commit**

```bash
curl -s -X POST http://127.0.0.1:3000/api/inventory/adjust -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' \
  -d "{\"productId\":\"$PHONE\",\"locationId\":\"$BRANCH\",\"quantity\":<original>}"

cd apps/api && pnpm exec tsc --noEmit && cd ..
git add apps/api/src/modules/inventory
git commit -m "feat(api): stock-in records a count, not serials

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Replace `<original>` with the number the first `psql` printed. Confirm the adjust endpoint's exact path and body against `inventory.route.ts` before running it.

---

### Task 6: The sale collects serials

**Files:**
- Modify: `apps/api/src/modules/sales/sale.schema.ts:5-24`
- Modify: `apps/api/src/modules/sales/sale.service.ts:61,150-196,415-445`
- Modify: `apps/api/src/modules/sales/sale.controller.ts`

**Interfaces:**
- Consumes: Task 5's balance-only stock
- Produces: `POST /api/sales` items take `serials: string[]`; sold `InventoryUnit` rows are created with `status: "SOLD"`

- [ ] **Step 1: Take serials on the sale**

In `apps/api/src/modules/sales/sale.schema.ts`, replace the item object inside `createSaleSchema.items` with:

```ts
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int().positive(),

        // One ICCID per SIM card, one IMEI per phone. The service checks the
        // count against the quantity; vouchers must send none.
        serials: z.array(z.string().min(3).max(40)).optional(),
      }),
```

- [ ] **Step 2: Replace unit retirement with unit creation**

In `apps/api/src/modules/sales/sale.service.ts`, replace the `if (SERIALIZED.includes(item.product.category))` block at lines 165-183 with:

```ts
      if (SERIALIZED.includes(item.product.category)) {
        const serials = serialsByProduct.get(item.productId) ?? [];
        const field = item.product.category === "PHONE" ? "imei" : "iccid";

        // Each serial becomes the record of one unit leaving the business.
        // The unique index on iccid and imei is what stops the same handset
        // being sold twice, here or at another branch.
        for (const serial of serials) {
          await tx.inventoryUnit.create({
            data: {
              productId: item.productId,
              locationId: branchId,
              status: "SOLD",
              saleItemId: item.id,
              [field]: serial,
            },
          });
        }
      }
```

Immediately before the loop that walks `data.items` (above the line that creates the sale), add the validation and the lookup map:

```ts
  // Serials are checked before anything is written: a sale that is going to
  // be refused must not move stock first.
  const serialsByProduct = new Map<string, string[]>();

  for (const item of data.items) {
    const product = products.find((p) => p.id === item.productId);

    if (!product) continue;

    const serials = item.serials ?? [];

    if (SERIALIZED.includes(product.category)) {
      if (serials.length !== item.quantity) {
        throw new Error("SERIAL_COUNT_MISMATCH");
      }

      const unique = new Set(serials);

      if (unique.size !== serials.length) {
        throw new Error("SERIAL_REPEATED");
      }

      const taken = await prisma.inventoryUnit.findFirst({
        where:
          product.category === "PHONE"
            ? { imei: { in: serials } }
            : { iccid: { in: serials } },
        select: { id: true },
      });

      if (taken) {
        throw new Error("SERIAL_ALREADY_SOLD");
      }

      serialsByProduct.set(item.productId, serials);
    } else if (serials.length > 0) {
      throw new Error("SERIALS_NOT_EXPECTED");
    }
  }
```

Use whatever local name the surrounding code already uses for the fetched product list in place of `products`; read the function before editing.

At line ~423 (`approveSale`, the second `SERIALIZED` block), delete the block entirely — units are created at sale time now, so there is nothing to retire on approval.

- [ ] **Step 3: Map the errors to readable replies**

In `apps/api/src/modules/sales/sale.controller.ts`, add to the create handler's error mapping:

```ts
      if (error.message === "SERIAL_COUNT_MISMATCH") {
        return reply.status(400).send({
          message: "Enter one serial number for each item sold",
        });
      }

      if (error.message === "SERIAL_REPEATED") {
        return reply.status(400).send({
          message: "The same serial number was entered twice",
        });
      }

      if (error.message === "SERIAL_ALREADY_SOLD") {
        return reply.status(409).send({
          message: "That serial number has already been sold",
        });
      }

      if (error.message === "SERIALS_NOT_EXPECTED") {
        return reply.status(400).send({
          message: "This product does not carry serial numbers",
        });
      }
```

- [ ] **Step 4: Verify all four Review Focus cases**

Use a SALES token (`cmu264ywa0001m8rxb2z4p3fb`, role `SALES`) and a phone the seller is holding. Sell 2 with 2 IMEIs, then repeat each failure:

```bash
# 3. wrong count
... -d '{"items":[{"productId":"<phone>","quantity":2,"serials":["ZZ1"]}],"cashReceived":0}'
# 4. same IMEI twice, in a second sale
# 5. serials on a voucher line
```

Expected, in order: a successful sale with two `InventoryUnit` rows at `status = SOLD` linked to the sale item; `"Enter one serial number for each item sold"`; `"That serial number has already been sold"`; `"This product does not carry serial numbers"`.

- [ ] **Step 5: Delete the probe sale, restore the holding and balance, commit**

Remove the probe sale, its items, its units and its stock movements, and put the seller's holding and the branch balance back to what they were. Confirm with:

```bash
psql "$DB" -c $'select count(*) from "InventoryUnit" where iccid like \'ZZ%\' or imei like \'ZZ%\';'
```

Expected: `0`

```bash
cd apps/api && pnpm exec tsc --noEmit && cd ..
git add apps/api/src/modules/sales
git commit -m "feat(api): record serials on the sale, not at stock-in

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Transfers and write-offs stop moving units

**Files:**
- Modify: `apps/api/src/modules/transfers/transfer.service.ts:240-265`
- Modify: `apps/api/src/modules/stock-loss/stockLoss.service.ts:80-140,245-320`
- Modify: `apps/api/src/modules/branches/branch.service.ts:313`

**Interfaces:**
- Consumes: Task 5 and Task 6 — no `IN_STOCK` unit rows exist any more
- Produces: both services move balances only

- [ ] **Step 1: Remove unit movement from transfers**

In `apps/api/src/modules/transfers/transfer.service.ts`, delete the `tx.inventoryUnit.findMany` / `updateMany` pair around lines 245-260 and leave the balance decrement and increment untouched. Add above the balance change:

```ts
      // Stock is a count. Unit rows exist only for items already sold, and
      // those never move between branches.
```

- [ ] **Step 2: Remove unit retirement from write-offs**

In `apps/api/src/modules/stock-loss/stockLoss.service.ts`, remove the `inventoryUnit` query at line ~87 and the two `updateMany` calls at ~134 and ~254 that flip unit status. The write-off must still decrement `InventoryBalance`. Leave the `findMany` at ~311 if it serves a read endpoint; check its caller first and keep it only if it lists sold units.

- [ ] **Step 3: Fix the branch unit count**

`apps/api/src/modules/branches/branch.service.ts:313` counts every
`InventoryUnit` at a branch and reports it in the branch summary. After Tasks 5
and 6 the only rows there are sold ones, so that number silently becomes "units
sold at this branch" while still being labelled as stock. Change the count to
say what it now means:

```ts
    prisma.inventoryUnit.count({
      where: { locationId: id, status: "SOLD" },
    }),
```

and rename the property it feeds to `unitsSold`. Follow the name through to
whatever reads it — grep for the old property name across `apps/web/src` and
update the label there too, in both languages.

- [ ] **Step 4: Verify a transfer still moves the balance**

```bash
psql "$DB" -c 'select "locationId", quantity from "InventoryBalance" where "productId"='"'"'<phone>'"'"';'
# create and complete a transfer of 2 through the API, then:
psql "$DB" -c 'select "locationId", quantity from "InventoryBalance" where "productId"='"'"'<phone>'"'"';'
psql "$DB" -c $'select count(*) from "InventoryUnit" where status=\'IN_STOCK\';'
```

Expected: source down 2, destination up 2, and the IN_STOCK unit count still `0`.

- [ ] **Step 5: Undo the probe transfer, type-check, commit**

```bash
cd apps/api && pnpm exec tsc --noEmit && cd ..
git add apps/api/src/modules/transfers apps/api/src/modules/stock-loss
git commit -m "feat(api): transfers and write-offs move balances only

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Products page shows the type tree

**Files:**
- Modify: `apps/web/src/lib/types.ts` (beside `ProductRow`, added earlier)
- Create: `apps/web/src/components/products/TypeDialog.tsx`
- Modify: `apps/web/src/pages/Products.tsx`
- Modify: `apps/web/src/lib/i18n.ts`

**Interfaces:**
- Consumes: `GET /api/product-types`, `POST /api/product-types` from Task 3
- Produces: `TypeNode` type in `lib/types.ts`; `<TypeDialog category onClose onDone />`

- [ ] **Step 1: Add the type**

In `apps/web/src/lib/types.ts`, beside `ProductRow`:

```ts
/** A node in the catalogue's type tree: a brand, a model, a voucher type. */
export type TypeNode = {
  id: string
  category: string
  parentId: string | null
  name: string
  isActive: boolean
  children: TypeNode[]
}
```

and add `type: { id: string; name: string; parentId: string | null } | null` to `ProductRow`.

- [ ] **Step 2: Add the labels in both languages**

In `apps/web/src/lib/i18n.ts`, add to the English object beside the other `prod.*` keys, and the matching Amharic to the second object:

```ts
  'prod.type': 'Type',
  'prod.addType': 'Add Type',
  'prod.addTypeTitle': 'Add a type',
  'prod.addTypeNote': 'A brand, a phone model, or a voucher type.',
  'prod.typeParent': 'Under',
  'prod.typeParentNone': 'Top level',
  'prod.typeName': 'Name',
  'prod.typeSaved': '{name} added.',
```

```ts
  'prod.type': 'ዓይነት',
  'prod.addType': 'ዓይነት ጨምር',
  'prod.addTypeTitle': 'ዓይነት ጨምር',
  'prod.addTypeNote': 'ብራንድ፣ የስልክ ሞዴል ወይም የካርድ ዓይነት።',
  'prod.typeParent': 'በሥሩ',
  'prod.typeParentNone': 'ዋና ደረጃ',
  'prod.typeName': 'ስም',
  'prod.typeSaved': '{name} ተጨምሯል።',
```

- [ ] **Step 3: Write the dialog**

Create `apps/web/src/components/products/TypeDialog.tsx` modelled on `ProductDialog.tsx`: a category select, an optional parent select listing the existing top-level types of that category (so a phone model can be placed under a brand), a name box, and the same `scrim`/`panel`/`field`/`actions` classes from `../inventory/Panel.module.css`. On submit it POSTs `{ category, name, parentId? }` to `/api/product-types` and calls `onDone(type)`. Show the API's own message on failure, as `ProductDialog` does.

- [ ] **Step 4: Wire it into the page**

In `apps/web/src/pages/Products.tsx`:

- load `GET /api/product-types` alongside the products
- add a **+ Add Type** button before **+ New Product** in `styles.headActions`
- add a `Type` column to the table showing `product.type?.name ?? '—'`
- keep the four category tabs exactly as they are

- [ ] **Step 5: Verify in the browser**

Drive the page as OWNER, add a brand and a model under it, and confirm both appear. Check both languages show no raw keys.

Expected: the new brand is listed; the Type column shows a name for every seeded product.

- [ ] **Step 6: Type-check and commit**

```bash
cd apps/web && pnpm exec tsc --noEmit -p tsconfig.app.json && pnpm lint && cd ..
git add apps/web/src
git commit -m "feat(web): manage product types on the Products page

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Product form uses the type tree

**Files:**
- Modify: `apps/web/src/components/products/ProductDialog.tsx`

**Interfaces:**
- Consumes: `TypeNode`, `GET /api/product-types`, the Task 4 create body
- Produces: nothing new

- [ ] **Step 1: Replace the form's fields**

Category select stays. Below it:

- **Type** — a select of that category's top-level types, with **+ Add** beside it opening `TypeDialog`
- **Model** — a second select, shown only for phones, listing the chosen brand's children
- **Storage**, **Colour** — phones, optional
- **Value** — vouchers, required; the price box is hidden and the price follows it
- **Price** — SIM and phone only
- **Name** — optional, placeholder-free, with a note that it fills itself if left blank
- **SKU box removed entirely**
- **Network box removed entirely**

Submit body: `{ typeId, price, name?, description?, storage?, color?, denomination? }`.

- [ ] **Step 2: Verify each category**

Create one product of each through the real dialog and confirm the generated name and code come back, that the voucher has no price box, and that no SIM form shows a network field.

- [ ] **Step 3: Delete the three probe products, type-check, commit**

```bash
cd apps/web && pnpm exec tsc --noEmit -p tsconfig.app.json && cd ..
git add apps/web/src/components/products
git commit -m "feat(web): product form picks a type, name and code generated

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Stock-in form drops the serial box

**Files:**
- Modify: `apps/web/src/components/inventory/StockInDialog.tsx`

**Interfaces:**
- Consumes: the Task 5 stock-in body
- Produces: nothing new

- [ ] **Step 1: Remove the serial handling**

Delete the `IDENTIFIER` map, the `serials` state, the `lines` and `duplicates` memos, the `countMismatch` check, the textarea and its hint. The body sent becomes `{ productId, locationId, quantity, note? }`. Keep the Category and Product selects and the branch select exactly as they are.

- [ ] **Step 2: Verify**

Open the dialog for a phone and confirm there is no serial textarea, that the submit button enables with only a product, a branch and a quantity, and that saving raises the balance.

- [ ] **Step 3: Type-check and commit**

```bash
cd apps/web && pnpm exec tsc --noEmit -p tsconfig.app.json && cd ..
git add apps/web/src/components/inventory/StockInDialog.tsx
git commit -m "feat(web): stock-in takes a count only

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Sale form collects serials

**Files:**
- Modify: `apps/web/src/pages/Sales.tsx` and whichever dialog it opens to record a sale — read the page first and modify the component that builds the sale body.
- Modify: `apps/web/src/lib/i18n.ts`

**Interfaces:**
- Consumes: the Task 6 sale body
- Produces: nothing new

- [ ] **Step 1: Add the labels in both languages**

```ts
  'sale.serials': 'Serial numbers',
  'sale.serialsIccid': 'One ICCID per line',
  'sale.serialsImei': 'One IMEI per line',
  'sale.serialsCount': '{entered} of {needed} entered',
```

```ts
  'sale.serials': 'መለያ ቁጥሮች',
  'sale.serialsIccid': 'በየመስመሩ አንድ ICCID',
  'sale.serialsImei': 'በየመስመሩ አንድ IMEI',
  'sale.serialsCount': 'ከ{needed} {entered} ገብቷል',
```

- [ ] **Step 2: Add the box**

For any line whose product category is `SIM_CARD` or `PHONE`, show a textarea taking one serial per line, with a live count against the quantity, and block submit until they match. Split on newline and comma and trim, the way `StockInDialog` did before Task 10 — copy that parsing rather than inventing new.

- [ ] **Step 3: Verify**

Sell 2 phones as a SALES user, confirm the form refuses 1 IMEI and accepts 2, and that the sale appears with both serials recorded.

- [ ] **Step 4: Delete the probe sale, type-check, commit**

```bash
cd apps/web && pnpm exec tsc --noEmit -p tsconfig.app.json && pnpm lint && cd ..
git add apps/web/src
git commit -m "feat(web): sale records one serial per unit sold

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Clean the development database and sweep

**Files:**
- Create: `packages/database/prisma/clear-stock-units.ts`

**Interfaces:**
- Consumes: everything above
- Produces: a development database consistent with the new rules

- [ ] **Step 1: Write the cleanup**

Create `packages/database/prisma/clear-stock-units.ts` deleting every `InventoryUnit` whose `status` is `IN_STOCK` — under the new rules they cannot exist. It must not touch `SOLD` rows. Print how many it removed.

- [ ] **Step 2: Run it and confirm**

```bash
pnpm --filter database exec tsx prisma/clear-stock-units.ts
psql "$DB" -c $'select status, count(*) from "InventoryUnit" group by status;'
```

Expected: no `IN_STOCK` rows remain.

- [ ] **Step 3: Make the unit view say what it now shows**

`apps/web/src/components/inventory/UnitDetails.tsx` lists `InventoryUnit` rows
for a product and was written when those meant "the individual items on the
shelf". They now only ever mean "items sold". Change its heading and its empty
state to say sold units, in both languages, and drop any filter offering
`IN_STOCK` — that status can no longer occur. Confirm by opening the unit view
for a phone with sales against it and one without.

- [ ] **Step 4: Sweep every page, every role**

Rebuild the browser harness if the scratchpad has been cleared, then walk all fifteen routes as OWNER, SUPERVISOR and SALES at 1280px and 430px, collecting console errors. Expected: none.

- [ ] **Step 5: Full build and commit**

```bash
cd apps/web && pnpm exec tsc --noEmit -p tsconfig.app.json && pnpm lint && pnpm build && cd ..
cd apps/api && pnpm exec tsc --noEmit && cd ..
git add packages/database/prisma/clear-stock-units.ts
git commit -m "chore(db): drop in-stock unit rows, superseded by count-based stock

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
