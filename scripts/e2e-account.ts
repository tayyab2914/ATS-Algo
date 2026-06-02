import "dotenv/config";
import { hashPassword, verifyPassword } from "../lib/auth/password";
import { prisma } from "../lib/db";

const BASE = "https://ats-algo.vercel.app";
const json = { "content-type": "application/json" };
const log = (label: string, ...rest: unknown[]) => console.log(`• ${label}`, ...rest);

async function main() {
  const email = `acct${Date.now()}@example.com`;
  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword("password123"), emailVerified: new Date() },
  });

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email, password: "password123" }),
  });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  log("login:", login.status);

  // 1. Update profile (username + password).
  let r = await fetch(`${BASE}/api/account/profile`, {
    method: "PATCH",
    headers: { ...json, cookie },
    body: JSON.stringify({ username: "TraderJoe", password: "newpass456" }),
  });
  log("profile update:", r.status);
  const after = await prisma.user.findUnique({ where: { id: user.id } });
  log("  name persisted:", after?.name === "TraderJoe" ? "✓" : "✗");
  log("  password changed:", (await verifyPassword("newpass456", after!.passwordHash)) ? "✓" : "✗");

  // 2. TradingView connect.
  r = await fetch(`${BASE}/api/account/connections`, {
    method: "POST",
    headers: { ...json, cookie },
    body: JSON.stringify({ target: "tradingview", connected: true }),
  });
  log("tradingview connect:", r.status);
  log("  persisted:", (await prisma.user.findUnique({ where: { id: user.id } }))?.tradingViewConnected ? "✓" : "✗");

  // 3. Wallet connect (server generates address).
  r = await fetch(`${BASE}/api/account/connections`, {
    method: "POST",
    headers: { ...json, cookie },
    body: JSON.stringify({ target: "wallet", connected: true }),
  });
  const wallet = await r.json();
  log("wallet connect:", r.status, "addr:", String(wallet.walletAddress).slice(0, 8) + "…");

  // 4. Add an exchange.
  r = await fetch(`${BASE}/api/account/exchanges`, {
    method: "POST",
    headers: { ...json, cookie },
    body: JSON.stringify({ exchange: "Bitget", apiKey: "key-abcdef123456", apiSecret: "secret-abcdef123456" }),
  });
  log("exchange add (Bitget):", r.status);
  const conn = await prisma.exchangeConnection.findFirst({ where: { userId: user.id, exchange: "Bitget" } });
  log("  row + masked key:", conn?.apiKeyMasked ?? "(none)");

  // 5. Remove the exchange.
  r = await fetch(`${BASE}/api/account/exchanges`, {
    method: "DELETE",
    headers: { ...json, cookie },
    body: JSON.stringify({ exchange: "Bitget" }),
  });
  log("exchange remove:", r.status);
  log("  row gone:", (await prisma.exchangeConnection.count({ where: { userId: user.id } })) === 0 ? "✓" : "✗");

  // 6. Auth guard: no cookie → 401.
  r = await fetch(`${BASE}/api/account/profile`, { method: "PATCH", headers: json, body: JSON.stringify({ username: "x" }) });
  log("profile update (no auth):", r.status);

  // 7. Page renders.
  r = await fetch(`${BASE}/account`, { headers: { cookie } });
  const html = await r.text();
  log("/account:", r.status);
  for (const m of ["Account Settings", "Profile Information", "TradingView Connection", "Wallet Connection", "Exchange API Connections", "Hyperliquid", "OKX"]) {
    log(`  ${html.includes(m) ? "✓" : "✗"} ${m}`);
  }

  process.exit(0);
}

main();
