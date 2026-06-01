import "dotenv/config";
import { hashPassword } from "../lib/auth/password";
import { prisma } from "../lib/db";

const BASE = "http://localhost:3000";
const json = { "content-type": "application/json" };

async function main() {
  const email = `dash${Date.now()}@example.com`;
  await prisma.user.create({
    data: { email, passwordHash: await hashPassword("password123"), emailVerified: new Date() },
  });

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email, password: "password123" }),
  });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  console.log("• login:", login.status);

  const res = await fetch(`${BASE}/dashboard`, { headers: { cookie } });
  const html = await res.text();
  console.log("• /dashboard:", res.status);

  const markers = [
    "Dashboard Overview",
    "Performance Metrics",
    "Active Bots",
    "Top Active Bots",
    "My Bots Performance",
    "Portfolio Balance",
    "Spot Holdings Overview",
    "Top Assets Performance",
    "Binance API",
  ];
  for (const m of markers) console.log(`   ${html.includes(m) ? "✓" : "✗"} ${m}`);

  process.exit(0);
}

main();
