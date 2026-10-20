import { customAlphabet } from "nanoid";

// Short, URL-safe, lowercase suffix for collision-busting.
const shortId = customAlphabet("23456789abcdefghijkmnpqrstuvwxyz", 5);

export function slugify(name: string): string {
  const base = (name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "") // drop punctuation/accents
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "site";
}

/**
 * Build a unique slug from the business name. Tries the bare slug first; on
 * collision appends a short nanoid. This is a best-effort pre-check: the unique
 * index on sites.slug is the real guard, and the repository retries on a race.
 */
export async function uniqueSlug(
  name: string,
  isTaken: (slug: string) => Promise<boolean>
): Promise<string> {
  const base = slugify(name);
  if (!(await isTaken(base))) return base;

  for (let i = 0; i < 5; i++) {
    const candidate = `${base}-${shortId()}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  // Extremely unlikely fallback.
  return `${base}-${shortId()}${shortId()}`;
}
