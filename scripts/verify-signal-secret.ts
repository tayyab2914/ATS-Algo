/**
 * The shared signal secret: one value in `SIGNAL_SECRET` gates every bot.
 *
 * There is nothing per-bot left to mint — the secret is entered once in the ATS
 * indicator's settings, so the old admin rotate endpoint is gone and this asserts
 * that it stays gone.
 *
 * Places no orders — the throwaway bots have no deployments, so the fan-out finds
 * nobody to trade for.
 *
 *   1. npm run dev  (or npm run build && PORT=3100 npm run start)
 *   2. NODE_OPTIONS="--conditions=react-server" npx tsx --env-file=.env.local scripts/verify-signal-secret.ts
 */
import { readFileSync } from "node:fs";
import type { BotConfig } from "../lib/bot-config";
import { SESSION_COOKIE, createToken } from "../lib/auth/jwt";
import { prisma } from "../lib/db";
import { signalSecret } from "../lib/execution/signal-secret";

const BASE = process.env.SIGNALS_BASE ?? "http://localhost:3000";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};

async function main() {
  const secret = signalSecret();
  if (!secret) {
    console.error("SIGNAL_SECRET is not set — nothing to verify. Set it in .env.local and restart the server.");
    process.exit(1);
  }

  const config = JSON.parse(readFileSync("fixtures/BTC.json", "utf8")) as BotConfig;
  const stamp = Date.now();

  const admin = await prisma.user.create({
    data: { email: `sec-admin-${stamp}@invalid.test`, passwordHash: "x", role: "ADMIN", status: "ACTIVE", emailVerified: new Date(), policyAcceptedAt: new Date() },
    select: { id: true, email: true },
  });
  const adminCookie = `${SESSION_COOKIE}=${await createToken({ sub: admin.id, email: admin.email, role: "ADMIN", emailVerified: true, policyAccepted: true })}`;

  const mkBot = (tag: string) =>
    prisma.bot.create({
      data: { name: `SEC ${tag} ${stamp}`, category: "Crypto", timeframe: "150m", riskClass: "LOW", ticker: "BTC", exchange: "Bitget", exchanges: ["Bitget"], config: config as object, status: "ACTIVE" },
      select: { id: true },
    });
  const botA = await mkBot("A");
  const botB = await mkBot("B");

  const fire = async (botId: string, body: Record<string, unknown>) => {
    const res = await fetch(`${BASE}/api/signals/${botId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };

  try {
    console.log("── the shared secret gates the endpoint ──");
    check("missing secret → 400 (the schema catches the absent field first)", (await fire(botA.id, { action: "exit" })).status === 400);
    check("wrong secret → 401", (await fire(botA.id, { action: "exit", secret: "not-the-secret" })).status === 401);
    const accepted = await fire(botA.id, { action: "exit", secret });
    check("the configured secret works", accepted.status === 200 && accepted.body.received === true, JSON.stringify(accepted.body));

    console.log("\n── one secret, every bot ──");
    const onB = await fire(botB.id, { action: "exit", secret });
    check("the same secret works on a different bot", onB.status === 200 && onB.body.received === true, JSON.stringify(onB.body));
    check("an unknown bot id is still refused → 401", (await fire("does-not-exist", { action: "exit", secret })).status === 401);
    check("…and gives nothing away: same body as a bad secret", (await fire("does-not-exist", { action: "exit", secret })).body.error === "Invalid signal credentials");

    console.log("\n── per-bot minting is gone ──");
    const rotate = await fetch(`${BASE}/api/admin/bots/${botA.id}/signal-secret`, { method: "POST", headers: { cookie: adminCookie } });
    check("the old rotate endpoint 404s even for an admin", rotate.status === 404, String(rotate.status));
    check("no bot column holds a secret", !("signalSecretEnc" in ((await prisma.bot.findUnique({ where: { id: botA.id } })) ?? {})));

    console.log("\n── the secret never reaches the database ──");
    const logs = await prisma.executionLog.findMany({ where: { botId: { in: [botA.id, botB.id] } }, select: { detail: true } });
    check("no execution log contains it", !JSON.stringify(logs).includes(secret));
    const signals = await prisma.signal.findMany({ where: { botId: { in: [botA.id, botB.id] } }, select: { raw: true } });
    check("no accepted signal's audit copy contains it", signals.length > 0 && !JSON.stringify(signals).includes(secret), `${signals.length} signals`);
    check("…the audit copy keeps a fingerprint instead", JSON.stringify(signals).includes("chars #"), JSON.stringify(signals[0]?.raw));
  } finally {
    console.log("\n── cleanup ──");
    for (const id of [botA.id, botB.id]) {
      await prisma.executionLog.deleteMany({ where: { botId: id } }).catch(() => {});
      await prisma.bot.delete({ where: { id } }).catch(() => {});
    }
    await prisma.user.delete({ where: { id: admin.id } }).catch(() => {});
    console.log("  temp admin + bots deleted");
  }

  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(failures === 0 ? 0 : 1); })
  .catch(async (e) => { console.error("\nERROR:", e); await prisma.$disconnect(); process.exit(1); });
