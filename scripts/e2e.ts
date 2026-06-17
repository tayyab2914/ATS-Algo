import "dotenv/config";
import { hashPassword } from "../lib/auth/password";
import { prisma } from "../lib/db";

const BASE = "https://ats-algo.vercel.app";
const log = (label: string, ...rest: unknown[]) => console.log(`• ${label}`, ...rest);

async function main() {
  const email = `e2e${Date.now()}@example.com`;
  const password = "password123";
  const json = { "content-type": "application/json" };

  // 1. Signup — should NOT sign in (no session), should require verification.
  let r = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email, password, confirmPassword: password }),
  });
  log("signup:", r.status, await r.json());
  log("  signup set session cookie?", /ats_session/.test(r.headers.get("set-cookie") ?? "") ? "YES (bad)" : "no (correct)");

  // 2. Login before verifying — should be blocked (403).
  r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ email, password }) });
  log("login (unverified):", r.status, await r.json());

  // 3. Verify the email using the token from the DB.
  const user = await prisma.user.findUnique({ where: { email } });
  const vt = await prisma.verificationToken.findFirst({ where: { userId: user!.id } });
  r = await fetch(`${BASE}/api/auth/verify?token=${vt!.token}`, { redirect: "manual" });
  log("verify link:", r.status, "→", r.headers.get("location"));

  // 4. Login after verifying — should succeed and set a session.
  r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ email, password }) });
  const userCookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  log("login (verified):", r.status, await r.json());

  // 5. Dashboard with session.
  r = await fetch(`${BASE}/dashboard`, { headers: { cookie: userCookie }, redirect: "manual" });
  log("dashboard (with session):", r.status);

  // ── Admin OTP flow ─────────────────────────────────────────────────────────
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").toLowerCase();
  // 6. Request a code for the admin address (sends a real email).
  r = await fetch(`${BASE}/api/admin/request-code`, { method: "POST", headers: json, body: JSON.stringify({ email: adminEmail }) });
  log("admin request-code:", r.status, await r.json());

  // Seed a known code so we can test verification without reading the inbox.
  await prisma.adminLoginCode.deleteMany({});
  await prisma.adminLoginCode.create({ data: { email: adminEmail, codeHash: await hashPassword("4321"), expiresAt: new Date(Date.now() + 600000) } });

  // 7. Wrong code → 401.
  r = await fetch(`${BASE}/api/admin/unlock`, { method: "POST", headers: json, body: JSON.stringify({ email: adminEmail, code: "0000" }) });
  log("admin unlock (wrong code):", r.status, await r.json());

  // 8. Correct code → 200 + admin session.
  r = await fetch(`${BASE}/api/admin/unlock`, { method: "POST", headers: json, body: JSON.stringify({ email: adminEmail, code: "4321" }) });
  const adminCookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  log("admin unlock (correct code):", r.status, await r.json());

  // 9. Admin dashboard with admin session.
  r = await fetch(`${BASE}/admin/dashboard`, { headers: { cookie: adminCookie }, redirect: "manual" });
  log("admin/dashboard (as admin):", r.status);

  // 10. Admin dashboard as a normal user → redirected away.
  r = await fetch(`${BASE}/admin/dashboard`, { headers: { cookie: userCookie }, redirect: "manual" });
  log("admin/dashboard (as user):", r.status, "→", r.headers.get("location"));

  process.exit(0);
}

main();
