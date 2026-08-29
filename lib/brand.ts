/**
 * Brand assets, in one place, so swapping in the official artwork is a file drop
 * rather than a hunt through components.
 *
 * There are two shapes a logo arrives in, and both are handled:
 *
 *  - **A mark / icon** (the glyph alone). Replace `public/brand/ats-mark.svg` —
 *    or point {@link BRAND_MARK_SRC} at a `.png`/`.webp` sitting beside it — and
 *    every logo on the site picks it up: sidebar, landing nav, footer, auth
 *    split-screen, admin rail. No code change.
 *
 *  - **A full lockup** (glyph + their own wordmark typography). Set
 *    {@link BRAND_LOCKUP} to the file and its intrinsic size. `<Logo>` then renders
 *    that image instead of composing the mark with Inter-set type, because a
 *    supplied lockup carries its own typeface and must not be re-typeset.
 *
 * `null` is the built-in behaviour and is what ships until the real files land.
 */

/** Product name, wherever it is written as text (page titles, emails, alt text). */
export const BRAND_NAME = "ATS-ALGO";

/** Strapline under the wordmark in the full lockup. */
export const BRAND_TAGLINE = "AUTOMATED TRADING SYSTEM";

/** The glyph. Served from /public — swap the file, not this constant, when possible. */
export const BRAND_MARK_SRC = "/brand/ats-mark.svg";

/** Intrinsic size of the mark, so `<img>` reserves the right box and never reflows. */
export const BRAND_MARK_SIZE = { width: 48, height: 40 } as const;

/**
 * A supplied full lockup, if there is one. Set it to e.g.
 * `{ src: "/brand/ats-lockup.svg", width: 248, height: 48 }` after dropping the
 * file into `public/brand/`, and `<Logo>` switches to it everywhere.
 */
export const BRAND_LOCKUP: { src: string; width: number; height: number } | null = null;

/**
 * The PNG this app serves as its own email logo, relative to the site root.
 *
 * PNG rather than the SVG mark on purpose: Gmail and Outlook do not render SVG in
 * a message body at all. Regenerate it from `app/icon.svg` whenever the mark
 * changes, so the tab icon and the email masthead stay the same artwork.
 */
export const BRAND_EMAIL_LOGO_PATH = "/brand/ats-email-logo.png";

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
