import { z } from "zod";

/**
 * The entity types a client can sync.
 *
 * Each maps to one Prisma model that carries `updatedAt`, which is what makes
 * a "changed since" count possible at all. Models without `updatedAt` (line
 * items, movements, audit rows) are deliberately absent: they only change as
 * part of their parent, so counting them would double-count the same edit.
 */
export const SYNC_ENTITIES = [
  "sales",
  "requests",
  "inventory",
  "receipts",
  "products",
  "users",
  "branches",
] as const;

export type SyncEntity = (typeof SYNC_ENTITIES)[number];

export const changesQuerySchema = z.object({
  // Absent on a first-ever sync, which then reports everything as new.
  since: z.string().datetime().optional(),

  // Lets a device sync only what it cares about, as the settings card offers.
  entities: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((part) => part.trim())
            .filter((part): part is SyncEntity =>
              (SYNC_ENTITIES as readonly string[]).includes(part),
            )
        : undefined,
    ),
});

export type ChangesQuery = z.infer<typeof changesQuerySchema>;

export const recordsQuerySchema = z.object({
  deviceId: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type RecordsQuery = z.infer<typeof recordsQuerySchema>;
