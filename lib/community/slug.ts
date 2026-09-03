/**
 * Community Access Link slugs — the bit after the slash in `ats-algo.com/houseofcrypto`.
 *
 * These live at the ROOT of the domain, in the same namespace as every real page
 * on the site, so a slug is not just a label: it is a route. That is the whole
 * reason this module exists. `app/[community]/page.tsx` is a dynamic segment and
 * Next matches static routes first, so a community called "dashboard" would
 * silently never resolve — the admin would copy a link that opens the members'
 * dashboard and wonder why nobody joined. {@link RESERVED_SLUGS} turns that into
 * a validation error at create time, which is the only place it can still be
 * fixed cheaply.
 *
 * Pure — no Prisma, no request context — so the create form, the API and the
 * landing route all agree on what a slug is without importing each other.
 */

/**
 * Route segments a community may never claim.
 *
 * Everything Next serves from the root of this app: the page routes under
 * `app/`, the auth group's flattened routes, the API prefix, Next's own
 * internals, and the static files in `public/`. Also a small set of words held
 * back for surfaces that don't exist yet (`support`, `pricing`, …) — releasing a
 * name later is free, clawing one back from a community that has already printed
 * it in their Discord is not.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // Real routes today.
  "account",
  "admin",
  "api",
  "bot-library",
  "dashboard",
  "forgot-password",
  "login",
  "logout",
  "my-bots",
  "policy",
  "portfolio",
  "reset-password",
  "signup",
  // Retired, but old links and bookmarks still point at it.
  "billing",
  // Next internals and well-known files.
  "_next",
  "favicon",
  "favicon.ico",
  "icon",
  "apple-icon",
  "robots.txt",
  "sitemap.xml",
  ".well-known",
  // Static asset folders under public/.
  "brand",
  "exchanges",
  "guides",
  // Held back for later.
  "about",
  "blog",
  "community",
  "contact",
  "docs",
  "help",
  "home",
  "legal",
  "pricing",
  "privacy",
  "settings",
  "support",
  "terms",
]);

/** Shortest and longest a slug may be. */
export const SLUG_MIN = 3;
export const SLUG_MAX = 40;

/**
 * Normalise free text into a candidate slug: lowercase, accents folded, every run
 * of non-alphanumerics collapsed to a single hyphen, no leading/trailing hyphen.
 *
 * Used in two places that must not disagree — the create form's live preview and
 * the server that stores the value — so what the admin sees before clicking
 * Create is exactly what the link becomes.
 */
export function normalizeSlug(input: string): string {
  return input
    .normalize("NFKD")
    // Strip combining marks so "Café" becomes "cafe" rather than losing the e.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Why a slug can't be used, or `null` when it can. A message rather than a
 * boolean because every caller shows it to a human.
 */
export function slugProblem(slug: string): string | null {
  if (slug.length < SLUG_MIN) return `The link must be at least ${SLUG_MIN} characters.`;
  if (slug.length > SLUG_MAX) return `The link must be ${SLUG_MAX} characters or fewer.`;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return "Use lowercase letters, numbers and single hyphens only.";
  }
  if (RESERVED_SLUGS.has(slug)) return `"${slug}" is reserved by the platform — pick another.`;
  // A slug with a dot would shadow a static file (`/logo.svg`); one that looks
  // like a Next internal segment can't route at all.
  if (slug.startsWith("_")) return "A link can't start with an underscore.";
  return null;
}

/** The full public URL an admin copies and a community shares. */
export function communityLinkUrl(baseUrl: string, slug: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${slug}`;
}
