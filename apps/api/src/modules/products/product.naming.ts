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
  /** Phones: typed when the product is created, e.g. "A16". */
  model?: string | null;
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

  return [...parts.typePath, parts.model, parts.storage, parts.color]
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
    parts.model ? slug(parts.model) : null,
    parts.storage ? slug(parts.storage) : null,
    parts.color ? slug(parts.color) : null,
  ].filter(Boolean);

  return pieces.join("-");
}
