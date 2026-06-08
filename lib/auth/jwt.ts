import { SignJWT, jwtVerify } from "jose";

/**
 * Stateless JWT helpers built on `jose` so they run on both the Node and Edge
 * runtimes (the latter is required by `proxy.ts`). This module deliberately has
 * no database or Node-only imports.
 */

/** Name of the httpOnly session cookie (shared by Node + Edge code paths). */
export const SESSION_COOKIE = "ats_session";

export type SessionRole = "USER" | "ADMIN";

export type SessionPayload = {
  /** User id (JWT `sub`). */
  sub: string;
  email: string;
  role: SessionRole;
  emailVerified: boolean;
  /** Has the user accepted the mandatory Rules & Policy? Gates all in-app routes. */
  policyAccepted: boolean;
};

const ISSUER = "ats-algo";
const EXPIRY = "7d";

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
}

/** Sign a session payload into a JWT. */
export async function createToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({
    email: payload.email,
    role: payload.role,
    emailVerified: payload.emailVerified,
    policyAccepted: payload.policyAccepted,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(getSecret());
}

/** Verify a JWT and return its payload, or `null` if invalid/expired. */
export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { issuer: ISSUER });
    if (!payload.sub || typeof payload.email !== "string") return null;
    return {
      sub: payload.sub,
      email: payload.email,
      role: payload.role === "ADMIN" ? "ADMIN" : "USER",
      emailVerified: payload.emailVerified === true,
      policyAccepted: payload.policyAccepted === true,
    };
  } catch {
    return null;
  }
}
