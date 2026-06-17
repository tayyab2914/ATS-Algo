import { cookies } from "next/headers";
import { createToken, verifyToken, SESSION_COOKIE, type SessionPayload } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db";

/**
 * Session cookie management for server contexts (route handlers, server
 * components). The cookie is httpOnly so the JWT is never exposed to client JS.
 */

const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Authoritative liveness check for an already-verified token. The JWT proves the
 * cookie is genuine and unexpired; this confirms the account is still in good
 * standing right now, which a stateless token cannot. Returns false when the
 * user was deleted, suspended/banned, or force-logged-out (their token predates
 * the `sessionsValidFrom` cutoff an admin set). The edge proxy can't reach the
 * database, so this is the single place these revocations actually take effect.
 */
async function isSessionLive(session: SessionPayload): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { status: true, sessionsValidFrom: true },
  });
  if (!user || user.status !== "ACTIVE") return false;
  if (user.sessionsValidFrom && session.iat != null) {
    // `iat` is whole seconds; the cutoff is a precise instant.
    return session.iat * 1000 >= user.sessionsValidFrom.getTime();
  }
  return true;
}

/** Sign `payload` and write it to the session cookie. */
export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await createToken(payload);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  // Record the login so admins can see who currently holds a live session.
  // `updateMany` so a missing row (shouldn't happen here) is a no-op, not a throw.
  await prisma.user.updateMany({
    where: { id: payload.sub },
    data: { lastLoginAt: new Date() },
  });
}

/**
 * Read and verify the current session, or `null` when signed out — or when the
 * account has since been suspended, banned, or force-logged-out by an admin.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifyToken(token);
  if (!session) return null;
  return (await isSessionLive(session)) ? session : null;
}

/** Clear the session cookie. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * Best-effort answer to "does this user currently hold a live session?", derived
 * without a session store. True when their most recent login is inside the
 * token window and newer than any revocation (sign-out, force-logout, or a
 * suspend/ban, all of which bump `sessionsValidFrom`). Mirrors the token check
 * in {@link getSession}, using `lastLoginAt` as a stand-in for the token's `iat`.
 */
export function hasLiveSession(user: {
  status: string;
  lastLoginAt: Date | null;
  sessionsValidFrom: Date | null;
}): boolean {
  if (user.status !== "ACTIVE" || !user.lastLoginAt) return false;
  if (Date.now() - user.lastLoginAt.getTime() > MAX_AGE_SECONDS * 1000) return false;
  if (user.sessionsValidFrom && user.lastLoginAt < user.sessionsValidFrom) return false;
  return true;
}
