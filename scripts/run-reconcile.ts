/**
 * Local stand-in for the production systemd timers (deploy/ats-reconcile*.timer).
 *
 * Pings the reconcile route over HTTP on the same schedule they do. It
 * deliberately calls the route rather than importing the reconciler, so it
 * exercises the exact code path production runs — and so it doesn't need to
 * satisfy the `server-only` guard.
 *
 *   npm run dev            (or: npm run build && npm start)
 *   npm run cron:local
 *
 * Env: APP_URL (default http://localhost:3000), CRON_SECRET.
 */
// `.env.local` first, the way Next loads it — plain `dotenv/config` reads only
// `.env`, which this project does not have, so CRON_SECRET would come back unset.
import { config } from "dotenv";

config({ path: [".env.local", ".env"] });

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const SECRET = process.env.CRON_SECRET;
const EVERY_MS = 60_000;
/** `?deep=1` also scans for orphans and refreshes market descriptors. Hourly. */
const DEEP_EVERY = 60;

let tick = 0;

async function ping(path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${SECRET}` } });
  const body = await res.text();
  return `${res.status} ${body.slice(0, 160)}`;
}

async function run() {
  const deep = tick % DEEP_EVERY === 0;
  const stamp = new Date().toISOString().slice(11, 19);
  try {
    console.log(`[${stamp}] reconcile${deep ? " (deep)" : ""}: ${await ping(`/api/cron/reconcile${deep ? "?deep=1" : ""}`)}`);
  } catch (error) {
    console.log(`[${stamp}] reconcile: unreachable (${error instanceof Error ? error.message : String(error)})`);
  }
  // No keep-warm ping: instrumentation.ts imports ccxt at server boot.
  tick++;
}

if (!SECRET) {
  console.error("CRON_SECRET is not set — the cron routes fail closed and will answer 401.");
  process.exit(1);
}

console.log(`Reconciling ${BASE} every ${EVERY_MS / 1000}s (deep every ${DEEP_EVERY} ticks). Ctrl-C to stop.`);
void run();
setInterval(() => void run(), EVERY_MS);
