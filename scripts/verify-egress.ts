// Static-egress preflight: the IP we advertise to members is the IP we actually
// leave from.
//
// On EC2 there is no proxy to verify — connections go out direct and the
// exchange sees the instance's Elastic IP. What CAN silently go wrong is
// STATIC_EGRESS_IP drifting away from that address (EIP released, instance
// rebuilt, box moved behind a different NAT gateway). Members who whitelisted
// the published value then get auth failures that look, from their side, like a
// bad API key — so run this on the box after any infrastructure change.
//
// Uses only public endpoints — no API keys anywhere.
// Run on the server: npx tsx scripts/verify-egress.ts
import { staticEgressIp } from "../lib/execution/egress.ts";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};

/** Ask two independent reflectors, so one lying or stale service can't pass us. */
async function observedIp(): Promise<string> {
  const reflectors = ["https://api.ipify.org", "https://checkip.amazonaws.com"];
  const seen: string[] = [];
  for (const url of reflectors) {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    seen.push((await res.text()).trim());
  }
  if (new Set(seen).size !== 1) throw new Error(`reflectors disagree: ${seen.join(" vs ")}`);
  return seen[0];
}

async function main() {
  console.log("── env plumbing ──");
  const saved = process.env.STATIC_EGRESS_IP;

  delete process.env.STATIC_EGRESS_IP;
  check("unset → nothing published (UI tells members to leave keys open)", staticEgressIp() === null);

  process.env.STATIC_EGRESS_IP = " 203.0.113.7 ";
  check("the value is trimmed", staticEgressIp() === "203.0.113.7");

  if (saved === undefined) delete process.env.STATIC_EGRESS_IP;
  else process.env.STATIC_EGRESS_IP = saved;

  console.log("\n── published IP matches real egress ──");
  const published = staticEgressIp();
  if (!published) {
    console.log("  – STATIC_EGRESS_IP is unset; skipping. Set it to the Elastic IP to run this check.");
  } else {
    try {
      const actual = await observedIp();
      check(
        "exchange traffic leaves from the address we publish",
        actual === published,
        actual === published ? actual : `published ${published}, actual ${actual}`,
      );
    } catch (error) {
      check("could reach an IP reflector", false, String(error).slice(0, 120));
    }
  }

  console.log("\n── a real ccxt client goes out direct ──");
  const ccxt = await import("ccxt");
  const ex = new ccxt.bitget({ enableRateLimit: true, timeout: 20_000, options: { defaultType: "swap" } });
  check("no proxy is configured on the client", ex.httpsProxy === undefined && ex.socksProxy === undefined);
  try {
    const price = Number((await ex.fetchTicker("BTC/USDT:USDT")).last);
    check("public ticker succeeds", Number.isFinite(price) && price > 0, `BTC ${price}`);
  } catch (error) {
    check("public ticker succeeds", false, String(error).slice(0, 120));
  }

  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
