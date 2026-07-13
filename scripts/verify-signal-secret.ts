/**
 * The per-bot signal secret: minting, rotation, and that rotation really does
 * invalidate the old value.
 *
 * Places no orders — the throwaway bot has no deployments, so the fan-out finds
 * nobody to trade for.
 *
 *   1. npm run build && PORT=3100 npm run start
 *   2. NODE_OPTIONS="--conditions=react-server" SIGNALS_BASE=http://localhost:3100 npx tsx scripts/verify-signal-secret.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import type { BotConfig } from "../lib/bot-config";
import { SESSION_COOKIE, createToken } from "../lib/auth/jwt";
import { prisma } from "../lib/db";

const BASE = process.env.SIGNALS_BASE ?? "http://localhost:3100";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};

async function main() {
  const config = JSON.parse(readFileSync("fixtures/BTC.json", "utf8")) as BotConfig;
  const stamp = Date.now();

  const admin = await prisma.user.create({
    data: { email: `sec-admin-${stamp}@invalid.test`, passwordHash: "x", role: "ADMIN", status: "ACTIVE", emailVerified: new Date(), policyAcceptedAt: new Date() },
    select: { id: true, email: true },
  });
  const member = await prisma.user.create({
    data: { email: `sec-user-${stamp}@invalid.test`, passwordHash: "x", status: "ACTIVE", emailVerified: new Date(), policyAcceptedAt: new Date() },
    select: { id: true, email: true },
  });
  const adminCookie = `${SESSION_COOKIE}=${await createToken({ sub: admin.id, email: admin.email, role: "ADMIN", emailVerified: true, policyAccepted: true })}`;
  const memberCookie = `${SESSION_COOKIE}=${await createToken({ sub: member.id, email: member.email, role: "USER", emailVerified: true, policyAccepted: true })}`;

  const bot = await prisma.bot.create({
    data: { name: `SEC ${stamp}`, category: "Crypto", timeframe: "150m", riskClass: "LOW", ticker: "BTC", exchange: "Bitget", exchanges: ["Bitget"], config: config as object, status: "ACTIVE" },
    select: { id: true },
  });

  const rotate = async (cookie?: string) => {
    const res = await fetch(`${BASE}/api/admin/bots/${bot.id}/signal-secret`, { method: "POST", headers: cookie ? { cookie } : {} });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };
  const fire = async (secret: string, ts: number) => {
    const res = await fetch(`${BASE}/api/signals/${bot.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "exit", ts: String(ts), secret }),
    });
    return res.status;
  };

  try {
    console.log("── a bot with no secret rejects everything ──");
    check("bot starts with no secret", (await prisma.bot.findUnique({ where: { id: bot.id }, select: { signalSecretEnc: true } }))?.signalSecretEnc === null);
    check("any secret is refused → 401", (await fire("anything", stamp)) === 401);

    console.log("\n── only an admin can mint one ──");
    check("no session → 403", (await rotate()).status === 403);
    check("a member → 403", (await rotate(memberCookie)).status === 403);

    console.log("\n── minting ──");
    const first = await rotate(adminCookie);
    check("admin → 200 with a secret", first.status === 200 && typeof first.body.secret === "string", String(first.body.secret).slice(0, 12) + "…");
    check("reported as new, not a replacement", first.body.replacedExisting === false);
    const secretA = first.body.secret as string;
    check("secret is long and url-safe", secretA.length >= 40 && /^[A-Za-z0-9_-]+$/.test(secretA), `len=${secretA.length}`);
    check("stored encrypted, not in the clear", (await prisma.bot.findUnique({ where: { id: bot.id }, select: { signalSecretEnc: true } }))!.signalSecretEnc!.includes(secretA) === false);
    check("it works", (await fire(secretA, stamp + 1)) === 200);

    console.log("\n── rotation invalidates the old secret at once ──");
    const second = await rotate(adminCookie);
    check("admin → 200", second.status === 200);
    check("reported as replacing an existing secret", second.body.replacedExisting === true);
    const secretB = second.body.secret as string;
    check("a different value", secretB !== secretA);
    check("the OLD secret is now rejected → 401", (await fire(secretA, stamp + 2)) === 401);
    check("the NEW secret works", (await fire(secretB, stamp + 3)) === 200);

    console.log("\n── a secret is bound to its own bot ──");
    const other = await prisma.bot.create({
      data: { name: `SEC2 ${stamp}`, category: "Crypto", timeframe: "150m", riskClass: "LOW", ticker: "BTC", exchange: "Bitget", exchanges: ["Bitget"], config: config as object, status: "ACTIVE" },
      select: { id: true },
    });
    await prisma.bot.update({ where: { id: other.id }, data: { signalSecretEnc: (await prisma.bot.findUnique({ where: { id: bot.id }, select: { signalSecretEnc: true } }))!.signalSecretEnc } });
    // The ciphertext is bound to the bot id as AAD, so copying it to another bot
    // cannot make it decrypt there.
    const res = await fetch(`${BASE}/api/signals/${other.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "exit", ts: String(stamp + 4), secret: secretB }) });
    check("a stolen ciphertext can't be transplanted to another bot → 401", res.status === 401);
    await prisma.bot.delete({ where: { id: other.id } });
  } finally {
    console.log("\n── cleanup ──");
    await prisma.executionLog.deleteMany({ where: { botId: bot.id } }).catch(() => {});
    await prisma.bot.delete({ where: { id: bot.id } }).catch(() => {});
    for (const u of [admin.id, member.id]) await prisma.user.delete({ where: { id: u } }).catch(() => {});
    console.log("  temp admin + member + bots deleted");
  }

  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(failures === 0 ? 0 : 1); })
  .catch(async (e) => { console.error("\nERROR:", e); await prisma.$disconnect(); process.exit(1); });
