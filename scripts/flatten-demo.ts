/**
 * Cancel every resting order and close any open position on the Bitget PAPER
 * account. Refuses to touch anything that isn't sandbox.
 *
 * Verification scripts open real demo positions; if one dies before its cleanup
 * runs, the leftover position makes the NEXT run fail with 45117 ("leverage or
 * margin mode can't change while a position is open"). Run this to reset.
 *
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/flatten-demo.ts
 */
import "dotenv/config";
import { prisma } from "../lib/db";
import { exchangeClient, getMarket } from "../lib/execution/client";
import { closeAll } from "../lib/execution/execute";

const SYMBOL = "BTC/USDT:USDT";

async function main() {
  const creds = {
    apiKey: process.env.BITGET_DEMO_KEY ?? "",
    apiSecret: process.env.BITGET_DEMO_SECRET ?? "",
    passphrase: process.env.BITGET_DEMO_PASSPHRASE ?? "",
    sandbox: true as const,
  };
  if (!creds.apiKey || !creds.apiSecret || !creds.passphrase) throw new Error("BITGET_DEMO_* missing from .env");

  const market = await getMarket("Bitget", SYMBOL, true);
  if (!market) throw new Error("BTC not listed on the paper venue");
  const ex = await exchangeClient("Bitget", creds, [market]);
  if (ex.options["sandboxMode"] !== true) throw new Error("REFUSING TO RUN: not in sandbox mode");

  const before = Number((await ex.fetchPositions([SYMBOL]))[0]?.contracts ?? 0);
  const result = await closeAll(ex, SYMBOL);
  const after = Number((await ex.fetchPositions([SYMBOL]))[0]?.contracts ?? 0);

  console.log(`  contracts before : ${before}`);
  console.log(`  flattened        : ${result.flattened} (${result.contracts})`);
  console.log(`  contracts after  : ${after}`);
  console.log(`  resting orders   : ${(await ex.fetchOpenOrders(SYMBOL)).length}`);
  console.log(`  trigger orders   : ${(await ex.fetchOpenOrders(SYMBOL, undefined, undefined, { trigger: true })).length}`);
  if (after !== 0) throw new Error("account is still not flat");
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(0); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
