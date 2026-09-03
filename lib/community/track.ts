import "server-only";
import { createHmac } from "node:crypto";
import type { CommunityLinkModel } from "@/lib/generated/prisma/models";
import { prisma } from "@/lib/db";
import { dayKey } from "@/lib/portfolio/calendar";

/**
 * Recording a visit to a Community Access Link.
 *
 * ## Why a hash and not an IP
 *
 * Counting clicks needs to tell two visitors apart for a day. It does NOT need to
 * know who they are, and storing raw IP addresses to power a vanity counter would
 * be personal data collected for no operational reason. So the visitor key is an
 * HMAC of (IP + user agent) under the server's own secret: stable within a day,
 * useless to anyone who reads the table, and not reversible back to an address.
 *
 * The day is part of the hashed input as well, so the same visitor produces a
 * DIFFERENT key tomorrow. That means the table cannot be used to follow one
 * person across time even by whoever holds the secret — the dedupe works, the
 * tracking doesn't.
 */

/**
 * Salt for the visitor hash. `JWT_SECRET` is already required for the app to
 * serve a single authenticated request, so reusing it means there is no new
 * secret to forget to set in an environment — and no default that would make
 * hashes predictable if one were missed.
 */
function visitorSalt(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set — community link clicks cannot be recorded.");
  return secret;
}

/**
 * Best-effort client address. Behind nginx the socket address is the proxy's, so
 * the forwarded header is what identifies the visitor; the FIRST entry is the
 * client and the rest are intermediaries.
 *
 * A spoofed header can only ever cost this feature an over-count on one link's
 * click figure, which is why it is trusted here and nowhere else in the app.
 */
function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/** Opaque per-day visitor key. See the module comment for why it is shaped this way. */
export function visitorHash(headers: Headers, day: string): string {
  const material = `${day}|${clientAddress(headers)}|${headers.get("user-agent") ?? ""}`;
  return createHmac("sha256", visitorSalt()).update(material).digest("hex").slice(0, 32);
}

/**
 * Count one visit, at most once per visitor per day.
 *
 * Idempotency is the unique index `(linkId, day, visitorHash)`, not a read-then-write:
 * two tabs opened at the same instant both reach the insert, and the loser is
 * absorbed by the database instead of producing a second row.
 *
 * Never throws. A landing page whose whole job is to send somebody to the sign-up
 * form must not 500 because a counter could not be written — the click is the
 * cheap part, the registration is the valuable one.
 */
export async function recordCommunityClick(linkId: string, headers: Headers): Promise<void> {
  try {
    const day = dayKey(new Date());
    await prisma.communityLinkClick.createMany({
      data: [{ linkId, day, visitorHash: visitorHash(headers, day) }],
      skipDuplicates: true,
    });
  } catch (error) {
    console.error("recordCommunityClick: failed to record a community link visit", error);
  }
}

/**
 * Resolve an inbound `?ref=` slug to a link that may still be joined.
 *
 * Returns null for an unknown slug AND for a paused one — the two are the same
 * answer to the only question the sign-up route asks ("does this grant access?"),
 * and collapsing them means a deactivated link cannot accidentally keep letting
 * people in through a stale form.
 */
export async function activeLinkForSlug(
  slug: string | null | undefined,
): Promise<Pick<CommunityLinkModel, "id" | "name" | "slug"> | null> {
  if (!slug) return null;
  const link = await prisma.communityLink.findUnique({
    where: { slug: slug.trim().toLowerCase() },
    select: { id: true, name: true, slug: true, active: true },
  });
  if (!link || !link.active) return null;
  return { id: link.id, name: link.name, slug: link.slug };
}
