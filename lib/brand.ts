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
 * Absolute URL of the logo to embed in emails, or null for the text lockup.
 *
 * Env-driven and off by default, on purpose. Email clients need an ABSOLUTE URL —
 * a relative path renders as a broken image — and Gmail and Outlook do not render
 * SVG at all, so this has to be a PNG that is actually reachable from the public
 * internet. A wrong value here is a broken image in every transactional email the
 * platform sends, which is worse than clean type. Set `BRAND_EMAIL_LOGO_URL` to a
 * hosted PNG once one exists.
 *
 * NOTE: this is the logo INSIDE the message. The little avatar Gmail draws next to
 * the sender is not settable from an SMTP message at all — it comes from the
 * sending Google account's profile photo, or from a BIMI DNS record. See
 * `lib/email.ts`.
 */
export function emailLogoUrl(): string | null {
  const url = process.env.BRAND_EMAIL_LOGO_URL?.trim();
  return url && /^https?:\/\//i.test(url) ? url : null;
}
