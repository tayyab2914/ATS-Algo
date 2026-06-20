import { prisma } from "@/lib/db";

/** Categories seeded for every install; also used as a fallback if the table is empty. */
export const DEFAULT_CATEGORIES = ["Crypto", "Forex", "Commodities", "Stocks"] as const;

/** Managed bot-category names, alphabetical. Falls back to the defaults if none exist. */
export async function getCategoryNames(): Promise<string[]> {
  const cats = await prisma.category.findMany({ orderBy: { name: "asc" }, select: { name: true } });
  return cats.length ? cats.map((c) => c.name) : [...DEFAULT_CATEGORIES];
}
