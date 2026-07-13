/**
 * End-to-end for the admin dispatch panel.
 *
 * Asserts the confirmation gate: when any member has armed LIVE trading, a
 * dispatch is refused with 409 until the admin explicitly confirms. Also checks
 * that a confirmed dispatch still cannot spend real money on an unarmed member,
 * and that a paper member trades.
 *
 * Only ever places orders on Bitget's paper engine.
 *   1. npm run build && PORT=3100 npm run start
 *   2. NODE_OPTIONS="--conditions=react-server" SIGNALS_BASE=http://localhost:3100 npx tsx scripts/verify-admin-dispatch.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import type { BotConfig } from "../lib/bot-config";
import { SESSION_COOKIE, createToken } from "../lib/auth/jwt";
import { encryptSecret } from "../lib/crypto/secrets";
import { prisma } from "../lib/db";
import { exchangeClient, getMarket } from "../lib/execution/client";
import { closeAll } from "../lib/execution/execute";

const BASE = process.env.SIGNALS_BASE ?? "http://localhost:3100";
const demo = { key: process.env.BITGET_DEMO_KEY!, secret: process.env.BITGET_DEMO_SECRET!, pass: process.env.BITGET_DEMO_PASSPHRASE! };

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};

async function main() {
  const config = JSON.parse(readFileSync("fixtures/BTC.json", "utf8")) as BotConfig;
  const stamp = Date.now();

  const admin = await prisma.user.create({
    data: { email: `admin-${stamp}@invalid.test`, passwordHash: "x", role: "ADMIN", status: "ACTIVE", emailVerified: new Date(), policyAcceptedAt: new Date() },
    select: { id: true, email: true },
  });
  const token = await createToken({ sub: admin.id, email: admin.email, role: "ADMIN", emailVerified: true, policyAccepted: true });
  const cookie = `${SESSION_COOKIE}=${token}`;

  const bot = await prisma.bot.create({
    data: { name: `ADM ${stamp}`, category: "Crypto", timeframe: "150m", riskClass: "LOW", ticker: "BTC", exchange: "Bitget", exchanges: ["Bitget"], config: config as object, status: "ACTIVE" },
    select: { id: true },
  });

  const mkUser = async (tag: string, o: { sandbox: boolean; liveArmed: boolean }) => {
    const user = await prisma.user.create({ data: { email: `adm-${tag}-${stamp}@invalid.test`, passwordHash: "x" }, select: { id: true } });
    const aad = `${user.id}:Bitget`;
    await prisma.exchangeConnection.create({
      data: { userId: user.id, exchange: "Bitget", sandbox: o.sandbox, permissions: "Read & Trade", apiKeyMasked: "••••test",
        apiKeyEnc: encryptSecret(demo.key, aad), apiSecretEnc: encryptSecret(demo.secret, aad), passphraseEnc: encryptSecret(demo.pass, aad) },
    });
    const ub = await prisma.userBot.create({
      data: { userId: user.id, botId: bot.id, active: true, allocatedCapital: 1000, capitalPerTrade: 20, allocationType: "FIXED", exchangeSource: "Bitget", liveArmed: o.liveArmed },
      select: { id: true },
    });
    return { userId: user.id, userBotId: ub.id };
  };

  const paper = await mkUser("paper", { sandbox: true, liveArmed: false });
  // Armed for live on a live-flagged key: this is what must force a confirmation.
  const liveArmed = await mkUser("livearmed", { sandbox: false, liveArmed: true });

  const post = async (body: Record<string, unknown>, withCookie = true) => {
    const res = await fetch(`${BASE}/api/admin/bots/${bot.id}/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(withCookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };

  try {
    console.log("── authorisation ──");
    check("no session → 403", (await post({ action: "exit" }, false)).status === 403);
    check("bad payload → 422", (await post({ action: "frobnicate" })).status === 422);
    check("enter without side → 422", (await post({ action: "enter" })).status === 422);

    console.log("\n── the confirmation gate ──");
    const unconfirmed = await post({ action: "enter", side: "long" });
    check("live-armed member forces 409", unconfirmed.status === 409, JSON.stringify(unconfirmed.body).slice(0, 90));
    check("…and says how many are at risk", unconfirmed.body.requiresConfirmation === true && unconfirmed.body.liveDeployments === 1, `n=${unconfirmed.body.liveDeployments}`);
    check("nothing was dispatched", (await prisma.signal.count({ where: { botId: bot.id } })) === 0);
    check("no position opened", (await prisma.position.count({ where: { userBot: { botId: bot.id } } })) === 0);

    console.log("\n── confirmed dispatch ──");
    const confirmed = await post({ action: "enter", side: "long", confirmLive: true });
    check("200 with a fan-out summary", confirmed.status === 200, JSON.stringify(confirmed.body).slice(0, 120));
    check("signal recorded as admin-sourced", (await prisma.signal.findFirst({ where: { botId: bot.id }, select: { source: true } }))?.source === "admin");
    check("price was resolved from the public feed", Number((await prisma.signal.findFirst({ where: { botId: bot.id }, select: { raw: true } }))?.raw && ((await prisma.signal.findFirst({ where: { botId: bot.id }, select: { raw: true } }))!.raw as { price?: number }).price) > 0);

    const placed = (confirmed.body.placed as string[]) ?? [];
    check("exactly one position placed (the paper member)", placed.length === 1, `placed=${placed.length}`);
    check("paper member holds it", (await prisma.position.count({ where: { userBotId: paper.userBotId, status: "OPEN" } })) === 1);
    // Armed for live, but the demo credentials cannot authenticate against the live
    // venue — so it FAILS rather than trading. Nothing real was ever at risk.
    const liveOpened = await prisma.position.count({ where: { userBotId: liveArmed.userBotId } });
    check("live-armed member opened no position (bad live creds → failure, not a trade)", liveOpened === 0, `n=${liveOpened}`);
    const failed = (confirmed.body.failed as { message: string }[]) ?? [];
    check("…and its failure is reported to the admin", failed.length === 1, failed[0]?.message ?? "");

    console.log("\n── exit ──");
    // Exits reduce exposure. Gating them behind a confirmation would put a dialog
    // between an admin and an emergency flatten, so only entries are gated.
    const exited = await post({ action: "exit" });
    check("exit is NOT gated, even with a live-armed member", exited.status === 200, JSON.stringify(exited.body).slice(0, 90));
    check("the paper position closed", (exited.body.closed as number) === 1, `closed=${exited.body.closed}`);
    const closed = await prisma.position.findFirst({ where: { userBotId: paper.userBotId }, select: { status: true, realizedPnl: true, closedReason: true } });
    check("PnL booked", closed?.status === "CLOSED" && closed.realizedPnl !== 0, `${closed?.closedReason} pnl=${closed?.realizedPnl.toFixed(4)}`);

    console.log("\n── disabled bot ──");
    await prisma.bot.update({ where: { id: bot.id }, data: { status: "DISABLED" } });
    check("a disabled bot refuses dispatch", (await post({ action: "exit" })).status === 409);
  } finally {
    console.log("\n── cleanup ──");
    // Flatten the venue BEFORE dropping the rows. A leftover demo position makes
    // the next run fail with 45117 when it tries to set leverage.
    try {
      const market = await getMarket("Bitget", "BTC/USDT:USDT", true);
      const ex = await exchangeClient("Bitget", { apiKey: demo.key, apiSecret: demo.secret, passphrase: demo.pass, sandbox: true }, [market!]);
      const result = await closeAll(ex, "BTC/USDT:USDT");
      console.log(`  venue flattened (${result.contracts} contracts)`);
    } catch (e) {
      console.log(`  venue cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const u of [paper.userId, liveArmed.userId, admin.id]) await prisma.user.delete({ where: { id: u } }).catch(() => {});
    await prisma.executionLog.deleteMany({ where: { botId: bot.id } }).catch(() => {});
    await prisma.bot.delete({ where: { id: bot.id } }).catch(() => {});
    console.log("  temp admin + members + bot deleted");
  }

  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(failures === 0 ? 0 : 1); })
  .catch(async (e) => { console.error("\nERROR:", e); await prisma.$disconnect(); process.exit(1); });
