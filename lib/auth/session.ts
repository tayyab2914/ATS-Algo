import { cookies } from "next/headers";
import { createToken, verifyToken, SESSION_COOKIE, type SessionPayload } from "@/lib/auth/jwt";

/**
 * Session cookie management for server contexts (route handlers, server
 * components). The cookie is httpOnly so the JWT is never exposed to client JS.
 */

const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

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
}

/** Read and verify the current session, or `null` when signed out. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

/** Clear the session cookie. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
