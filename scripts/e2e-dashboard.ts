import "dotenv/config";
import { hashPassword } from "../lib/auth/password";
import { prisma } from "../lib/db";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
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

  // A brand-new account has deployed nothing, so the bots section renders its
  // fallback heading. Match either — the section is what's being smoke-tested,
  // not which of its three states a fresh user happens to land in.
  const markers: [string, string[]][] = [
    ["Dashboard Overview", ["Dashboard Overview"]],
    ["Performance Metrics", ["Performance Metrics"]],
    ["Active Bots", ["Active Bots"]],
    ["bots section", ["Your Top Active Bots", "Your Bots", "Top Published Bots"]],
    ["My Bots Performance", ["My Bots Performance"]],
    ["Portfolio Balance", ["Portfolio Balance"]],
    ["Spot Holdings Overview", ["Spot Holdings Overview"]],
    ["Top Assets Performance", ["Top Assets Performance"]],
    ["Binance API", ["Binance API"]],
  ];
  for (const [label, any] of markers) {
    console.log(`   ${any.some((m) => html.includes(m)) ? "✓" : "✗"} ${label}`);
  }

  process.exit(0);
}

main();
