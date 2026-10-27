import { prisma } from "../plugins/prisma.js";

/** A date as the local YYYY-MM-DD it falls on. */
export function localDay(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

/** The past days the Owner has opened for this person to correct, right now. */
export async function grantedDays(userId: string) {
  const rows = await prisma.editGrant.findMany({
    where: { userId, until: { gt: new Date() } },
    select: { day: true },
  });
  return new Set(rows.map((row) => row.day));
}

/**
 * Whether a salesperson may still correct their own entry: on its own day,
 * or a past day the Owner has opened for them.
 */
export function ownEntryEditable(createdAt: Date, granted: Set<string>) {
  const day = localDay(createdAt);
  return day === localDay(new Date()) || granted.has(day);
}
