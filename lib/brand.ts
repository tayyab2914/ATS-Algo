/**
 * Brand assets, in one place, so swapping in the official artwork is a file drop
 * rather than a hunt through components.
 *
 * Everything under `public/brand/` and the `app/` icons is cut from the official
 * artwork in `ATS - LOGO/` (transparent padding trimmed, resized):
 *
 *  - **The mark** (`ats-mark.png`, from `ICON/icon.png`) — the gradient glyph
 *    alone. Used where only the glyph fits: the admin chip.
 *
 *  - **The lockup** (`ats-lockup.png`, from `LOGO 2/PNG-2.png`) — glyph plus the
 *    "AUTOMATED TRADING SYSTEM" wordmark in white, for the dark UI. `<Logo>`
 *    renders it whole everywhere (sidebar, landing nav, footer, auth split-screen,
 *    admin rail, community page) rather than re-typesetting the wordmark in Inter.
 *
 *  - **The icons** — `app/icon.png`, `app/apple-icon.png`, `app/favicon.ico` and
 *    `app/opengraph-image.png` are the mark (or lockup, for the share card) on the
 *    product's #0a0a0a ground.
 *
 * If the artwork changes, regenerate all of them together so the tab, the page,
 * the email and the link preview never disagree.
 */

/** Product name, wherever it is written as text (page titles, emails, alt text). */
export const BRAND_NAME = "ATS-ALGO";

/** Strapline under the wordmark in the full lockup. */
export const BRAND_TAGLINE = "AUTOMATED TRADING SYSTEM";

/** The glyph. Served from /public — swap the file, not this constant, when possible. */
export const BRAND_MARK_SRC = "/brand/ats-mark.png";

/** Intrinsic size of the mark, so `<img>` reserves the right box and never reflows. */
export const BRAND_MARK_SIZE = { width: 397, height: 160 } as const;

/**
 * The official full lockup. `<Logo>` renders this image instead of composing the
 * mark with Inter-set type; set it to `null` to fall back to that composition.
 */
export const BRAND_LOCKUP: { src: string; width: number; height: number } | null = {
  src: "/brand/ats-lockup.png",
  width: 857,
  height: 144,
};

/**
 * The PNG this app serves as its own email logo, relative to the site root.
 *
 * PNG on purpose: Gmail and Outlook do not render SVG in a message body at all.
 * It is the same lockup as {@link BRAND_LOCKUP} (white type, for the dark email
 * card), cut at 2x of its rendered size.
 */
export const BRAND_EMAIL_LOGO_PATH = "/brand/ats-email-logo.png";

/**
 * The size the email masthead renders at. Both dimensions go on the `<img>`:
 * Outlook desktop ignores `width:auto` and would otherwise draw the 2x file at
 * its native width.
 */
export const BRAND_EMAIL_LOGO_SIZE = { width: 238, height: 40 } as const;

/**
 * An operator-supplied absolute URL for the email masthead logo, or null.
 *
 * OPT-IN ONLY, and deliberately not a fallback chain. By default the masthead
 * embeds {@link BRAND_EMAIL_LOGO_PATH} in the message itself (see `lib/email.ts`),
 * which is the only form that reliably renders: a REMOTE image — however correct
 * its URL, and this app's own `APP_URL`-derived one was correct and publicly
 * reachable — is a tracking pixel as far as a mail client is concerned, and Gmail
 * drew it as blank space. Deriving a URL here just produced a well-formed link to
 * an image nobody saw.
 *
 * So this exists for the one case embedding cannot serve: artwork that must be
 * fetched from somewhere specific — a CDN, or the BIMI-aligned host that a Verified
 * Mark Certificate is issued against. Setting it accepts the blocking behaviour
 * above in exchange for that.
 *
 * NOTE: this is the logo INSIDE the message. The little avatar Gmail draws next to
 * the sender is not settable from an SMTP message at all — it comes from the
 * sending Google account's profile photo, or from a BIMI DNS record. See
 * `lib/email.ts`.
 */
export function emailLogoUrl(): string | null {
  const configured = process.env.BRAND_EMAIL_LOGO_URL?.trim();
  return configured && /^https?:\/\//i.test(configured) ? configured : null;
}
