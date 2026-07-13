// Static-egress proof: exchange traffic REALLY tunnels through the configured
// CONNECT proxy, and a dead proxy fails loudly instead of silently going direct.
//
// Spins a real local HTTP CONNECT proxy, points EXCHANGE_PROXY_URL at it, makes
// a public Bitget call through ccxt, and asserts the proxy saw the CONNECT to
// api.bitget.com. Uses only public endpoints — no API keys anywhere.
// Run: npx tsx scripts/verify-egress.ts
import http from "node:http";
import net from "node:net";
import { applyEgress, egressProxyUrl, staticEgressIp } from "../lib/execution/egress.ts";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};

/** A minimal but real HTTP CONNECT proxy that records every tunnel target. */
function startConnectProxy(): Promise<{ port: number; seen: string[]; close: () => void }> {
  const seen: string[] = [];
  const server = http.createServer();
  server.on("connect", (req, clientSocket, head) => {
    seen.push(req.url ?? "?");
    const [host, port] = (req.url ?? "").split(":");
    const upstream = net.connect(Number(port || 443), host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstream.destroy());
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ port, seen, close: () => server.close() });
    });
  });
}

async function bitget() {
  const ccxt = await import("ccxt");
  const ex = new ccxt.bitget({ enableRateLimit: true, timeout: 20_000, options: { defaultType: "swap" } });
  return applyEgress(ex);
}

async function main() {
  console.log("── env plumbing ──");
  delete process.env.EXCHANGE_PROXY_URL;
  delete process.env.STATIC_EGRESS_IP;
  check("no env → no proxy URL, no published IP", egressProxyUrl() === null && staticEgressIp() === null);
  const bare = await bitget();
  check("no env → applyEgress leaves the client direct", bare.httpsProxy === undefined);
  process.env.EXCHANGE_PROXY_URL = "  http://u:p@127.0.0.1:9 ";
  process.env.STATIC_EGRESS_IP = " 203.0.113.7 ";
  check("values are trimmed", egressProxyUrl() === "http://u:p@127.0.0.1:9" && staticEgressIp() === "203.0.113.7");

  console.log("\n── traffic REALLY goes through the proxy ──");
  const proxy = await startConnectProxy();
  process.env.EXCHANGE_PROXY_URL = `http://127.0.0.1:${proxy.port}`;
  const proxied = await bitget();
  check("applyEgress sets httpsProxy on the ccxt client", proxied.httpsProxy === `http://127.0.0.1:${proxy.port}`);
  try {
    const price = Number((await proxied.fetchTicker("BTC/USDT:USDT")).last);
    check("public ticker succeeds through the tunnel", Number.isFinite(price) && price > 0, `BTC ${price}`);
  } catch (error) {
    check("public ticker succeeds through the tunnel", false, String(error).slice(0, 120));
  }
  check(
    "the proxy saw the CONNECT to Bitget (traffic did not go direct)",
    proxy.seen.some((target) => target.includes("bitget.com")),
    proxy.seen.join(", "),
  );
  proxy.close();

  console.log("\n── a dead proxy fails loudly, never silently direct ──");
  process.env.EXCHANGE_PROXY_URL = "http://127.0.0.1:1"; // nothing listens here
  const dead = await bitget();
  try {
    await dead.fetchTicker("BTC/USDT:USDT");
    check("call through a dead proxy throws", false, "it succeeded — traffic bypassed the proxy!");
  } catch {
    check("call through a dead proxy throws", true, "no hidden direct fallback");
  }

  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
