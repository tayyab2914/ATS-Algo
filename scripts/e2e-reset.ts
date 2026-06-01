import "dotenv/config";
import crypto from "node:crypto";
import { hashPassword } from "../lib/auth/password";
import { prisma } from "../lib/db";

const BASE = "http://localhost:3000";
const json = { "content-type": "application/json" };
const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
const log = (label: string, ...rest: unknown[]) => console.log(`• ${label}`, ...rest);

async function main() {
  const email = `reset${Date.now()}@example.com`;

  // A verified user with a known password.
  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword("oldpass123"), emailVerified: new Date() },
  });

  // 1. Request reset — always 200, creates a token row.
  let r = await fetch(`${BASE}/api/auth/forgot-password`, { method: "POST", headers: json, body: JSON.stringify({ email }) });
  log("forgot-password:", r.status, await r.json());
  log("  token row created?", (await prisma.passwordResetToken.count({ where: { userId: user.id } })) > 0 ? "yes" : "no");

  // 2. Reset with an INVALID token → 400.
  r = await fetch(`${BASE}/api/auth/reset-password`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ token: "deadbeef", password: "newpass456", confirmPassword: "newpass456" }),
  });
  log("reset (invalid token):", r.status, await r.json());

  // Seed a known token so we can complete the reset without reading the inbox.
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
  await prisma.passwordResetToken.create({
    data: { tokenHash: sha256("KNOWNTOKEN"), userId: user.id, expiresAt: new Date(Date.now() + 3600000) },
  });

  // 3. Mismatched passwords → 422.
  r = await fetch(`${BASE}/api/auth/reset-password`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ token: "KNOWNTOKEN", password: "newpass456", confirmPassword: "different" }),
  });
  log("reset (mismatch):", r.status, await r.json());

  // 4. Valid reset → 200.
  r = await fetch(`${BASE}/api/auth/reset-password`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ token: "KNOWNTOKEN", password: "newpass456", confirmPassword: "newpass456" }),
  });
  log("reset (valid):", r.status, await r.json());

  // 5. Old password no longer works.
  r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ email, password: "oldpass123" }) });
  log("login old password:", r.status);

  // 6. New password works.
  r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ email, password: "newpass456" }) });
  log("login new password:", r.status);

  // 7. Token was consumed (can't be reused).
  r = await fetch(`${BASE}/api/auth/reset-password`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ token: "KNOWNTOKEN", password: "again789", confirmPassword: "again789" }),
  });
  log("reset (reuse consumed token):", r.status, await r.json());

  process.exit(0);
}

main();
