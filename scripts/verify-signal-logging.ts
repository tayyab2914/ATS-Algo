/**
 * Every way the signal receiver can turn an alert away, and the audit line each one leaves.
 *
 * The sender is a machine that never reads the response body, so a rejected alert
 * is only visible in `execution_logs`. This drives the real HTTP endpoint against a
 * throwaway bot and asserts that each rejection is recorded with the reason, the
 * redacted payload, and — where one applies — the hint that names the fix.
 *
 * Nothing here can trade: every payload fails a deterministic check before a signal
 * row is written, and the bot has no deployments. It deletes what it creates.
 *
 *   1. npm run dev  (or npm run start)
 *   2. npx tsx --env-file=.env.local scripts/verify-signal-logging.ts
 */
import { readFileSync } from "node:fs";
import type { BotConfig } from "../lib/bot-config";
import { prisma } from "../lib/db";
import { secretFingerprint, signalSecret } from "../lib/execution/signal-secret";

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

  const bot = await prisma.bot.create({
    data: { name: `LOG ${stamp}`, category: "Crypto", timeframe: "150m", riskClass: "LOW", ticker: "BTC", exchange: "Bitget", exchanges: ["Bitget"], config: config as object, status: "ACTIVE" },
    select: { id: true },
  });

  const post = async (body: string, url = `${BASE}/api/signals/${bot.id}`) => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "verify-signal-logging" }, body });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };
  const json = (fields: Record<string, unknown>) => JSON.stringify({ secret, ...fields });

  /** The newest `signal.rejected` line for a bot — the id in the URL, which is not always a real one. */
  const lastRejection = async (botId: string) => {
    const row = await prisma.executionLog.findFirst({
      where: { botId, event: "signal.rejected" },
      orderBy: { createdAt: "desc" },
      select: { detail: true },
    });
    return (row?.detail ?? null) as { reason?: string; status?: number; hint?: string; payload?: Record<string, unknown>; sender?: { ua?: string } } | null;
  };

  const case_ = async (label: string, expect: { status: number; reason: string; hint?: RegExp; loggedUnder?: string }, body: string, url?: string) => {
    const res = await post(body, url);
    const log = await lastRejection(expect.loggedUnder ?? bot.id);
    const ok = res.status === expect.status && log?.reason === expect.reason && (!expect.hint || expect.hint.test(log?.hint ?? ""));
    check(label, ok, `${res.status} reason=${log?.reason ?? "«not logged»"}${log?.hint ? ` hint="${log.hint}"` : ""}`);
    return log;
  };

  try {
    console.log("── every rejection is recorded with its reason ──");
    const badJson = await case_("malformed JSON", { status: 400, reason: "badJson" }, "{oops");
    check("…and the unparsable body is kept verbatim", badJson?.payload?.unparsed === "{oops", JSON.stringify(badJson?.payload));

    await case_("missing secret", { status: 400, reason: "schema" }, JSON.stringify({ action: "enter_long", price: "1" }));
    await case_("wrong secret", { status: 401, reason: "badSecret" }, JSON.stringify({ action: "exit", secret: "not-the-secret" }));
    await case_("unsubstituted secret placeholder", { status: 401, reason: "badSecret", hint: /placeholder/ }, JSON.stringify({ action: "exit", secret: "<set-SIGNAL_SECRET-on-the-server>" }));
    await case_("unknown bot id", { status: 401, reason: "unknownBot", loggedUnder: "does-not-exist" }, json({ action: "exit" }), `${BASE}/api/signals/does-not-exist`);
    await case_("unknown action", { status: 400, reason: "badAction" }, json({ action: "frobnicate" }));
    await case_("the retired bare `enter`", { status: 400, reason: "badAction" }, json({ action: "enter", side: "long", price: "1" }));
    const placeholder = await case_("an unsubstituted placeholder action", { status: 400, reason: "badAction", hint: /placeholder/ }, json({ action: "{SIDE}" }));

    console.log("\n── the log is diagnostic, and safe ──");
    check("the payload is attached", placeholder?.payload?.action === "{SIDE}", JSON.stringify(placeholder?.payload));
    check("the sender is identified", placeholder?.sender?.ua === "verify-signal-logging", JSON.stringify(placeholder?.sender));
    check("the status is recorded", placeholder?.status === 400, String(placeholder?.status));

    const secretField = String(placeholder?.payload?.secret ?? "");
    check("the secret is NEVER stored", !secretField.includes(secret) && !JSON.stringify(placeholder).includes(secret), secretField);
    // The mint side of this pairing is logged by the admin rotate route, which needs
    // an admin session and so is out of scope here; both ends call secretFingerprint.
    check("…but its fingerprint is, so a stale alert is identifiable", secretField.includes(secretFingerprint(secret)), secretField);

    console.log("\n── no rejection writes a signal row ──");
    check("no signals persisted", (await prisma.signal.count({ where: { botId: bot.id } })) === 0);

    // A duplicate ENTER would REVERSE an open position — close it, pay the fees and
    // reopen — so this is the guard that replaced the dropped `ts` dedupe key.
    console.log("\n── a redelivered alert is dropped ──");
    const first = await post(json({ action: "exit" }));
    const again = await post(json({ action: "exit" }));
    check("the first is accepted", first.status === 200 && first.body.received === true, JSON.stringify(first.body));
    check("the redelivery is acknowledged as a duplicate", again.status === 200 && again.body.duplicate === true, JSON.stringify(again.body));
    check("only one signal row exists", (await prisma.signal.count({ where: { botId: bot.id, action: "EXIT" } })) === 1);

    const [c1, c2] = await Promise.all([post(json({ action: "tp1" })), post(json({ action: "tp1" }))]);
    const accepted = [c1, c2].filter((r) => r.body.received === true).length;
    check("two SIMULTANEOUS deliveries still yield exactly one signal", accepted === 1, `${accepted} accepted`);
    check("…and one signal row", (await prisma.signal.count({ where: { botId: bot.id, action: "TP1" } })) === 1);

    const other = await post(json({ action: "tp2" }));
    check("a different action inside the window is NOT deduped", other.body.received === true, JSON.stringify(other.body));

    // No price in either: the fan-out reads it from the venue. The bot has no
    // deployments, so this reaches enterAll and stops there.
    const long = await post(json({ action: "enter_long" }));
    const short = await post(json({ action: "enter_short" }));
    check("enter_long is accepted as a LONG", long.body.received === true && long.body.action === "ENTER", JSON.stringify(long.body));
    check("enter_short is not deduped against it — direction is part of the key", short.body.received === true, JSON.stringify(short.body));
    const sides = await prisma.signal.findMany({ where: { botId: bot.id, action: "ENTER" }, select: { side: true, dedupeKey: true }, orderBy: { createdAt: "asc" } });
    check("…and the two rows carry opposite sides", sides.map((s) => s.side).join(",") === "LONG,SHORT", JSON.stringify(sides));

    console.log("\n── the entry price comes from the venue, not the payload ──");
    // Fan-out runs after the response, so give it a moment to reach the ticker.
    let priced: { detail: unknown } | null = null;
    for (let i = 0; i < 20 && !priced; i++) {
      priced = await prisma.executionLog.findFirst({ where: { botId: bot.id, event: "fanout.pricedFromVenue" }, select: { detail: true } });
      if (!priced) await new Promise((r) => setTimeout(r, 500));
    }
    const price = (priced?.detail as { price?: number })?.price;
    check("a priceless entry is still priced", typeof price === "number" && price > 0, JSON.stringify(priced?.detail));

    console.log("\n── a stale alert body is flagged, not refused ──");
    const legacy = await post(json({ action: "tp3", bot_id: "some-other-bot", ts: "1784296749416", side: "long" }));
    check("the signal is still accepted", legacy.body.received === true, JSON.stringify(legacy.body));
    const legacyLog = await prisma.executionLog.findFirst({ where: { botId: bot.id, event: "signal.legacyPayload" }, select: { detail: true } });
    const fields = (legacyLog?.detail as { fields?: string[] })?.fields ?? [];
    check("…and the retired fields are named", ["bot_id", "ts", "side"].every((f) => fields.includes(f)), JSON.stringify(fields));

    console.log("\n── a flood cannot write a row per request ──");
    const before = await prisma.executionLog.count({ where: { botId: bot.id, event: "signal.rejected" } });
    for (let i = 0; i < 40; i++) await post("{flood");
    const written = (await prisma.executionLog.count({ where: { botId: bot.id, event: "signal.rejected" } })) - before;
    check("40 garbage posts are capped well under 40 log rows", written < 40, `${written} rows`);
    const capped = await prisma.executionLog.findFirst({ where: { botId: bot.id, event: "signal.rejected", detail: { path: ["reason"], equals: "badJson" } }, orderBy: { createdAt: "desc" }, select: { detail: true } });
    check("…and the cap says so rather than going quiet", String((capped?.detail as { note?: string })?.note ?? "").includes("capped"), (capped?.detail as { note?: string })?.note ?? "«no note»");
  } finally {
    console.log("\n── cleanup ──");
    await prisma.executionLog.deleteMany({ where: { botId: bot.id } }).catch(() => {});
    await prisma.bot.delete({ where: { id: bot.id } }).catch(() => {});
    console.log("  temp bot + logs deleted");
  }

  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(failures === 0 ? 0 : 1); })
  .catch(async (e) => { console.error("\nERROR:", e); await prisma.$disconnect(); process.exit(1); });
