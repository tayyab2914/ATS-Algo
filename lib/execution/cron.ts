import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Authorisation for the scheduled routes. The systemd timers call them through
 * `/usr/local/bin/ats-cron` (deploy/), which sends
 * `Authorization: Bearer $CRON_SECRET` read from the same env file the server
 * uses.
 *
 * Fails closed: with no secret configured the endpoints are unreachable rather
 * than open, because they read every member's positions.
 */
export function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const presented = request.headers.get("authorization") ?? "";
  const a = createHash("sha256").update(`Bearer ${secret}`, "utf8").digest();
  const b = createHash("sha256").update(presented, "utf8").digest();
  return timingSafeEqual(a, b);
}
