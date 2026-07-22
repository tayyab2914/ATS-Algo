import type { NextRequest } from "next/server";
import { authorizeCron } from "@/lib/execution/cron";
import { errorDetail, logExec } from "@/lib/execution/log";
import { reconcileOpenPositions, refreshCachedMarkets, scanForOrphans } from "@/lib/execution/reconcile";

/**
 * The reconcile pass.
 *
 * Four of the five ways a position can end are silent — a break-even stop firing,
 * the preset backstop firing, the ladder filling out, a liquidation. No webhook
 * arrives, from Bitget or from TradingView. Without this, a stopped-out position
 * stays `OPEN` forever and every future entry for that member is skipped with
 * `positionAlreadyOpen`: the bot quietly stops trading.
 *
 * Schedule — systemd timers, see deploy/ats-reconcile{,-deep}.timer:
 *   every minute   the fast pass — one `fetchPositions` per open position
 *   hourly         `?deep=1` — orphan scan + market descriptor refresh
 *
 * The caller sends `Authorization: Bearer $CRON_SECRET` via `ats-cron`. With no
 * secret set the route is closed, not open: it reads every member's positions.
 * nginx also refuses `/api/cron/` from the internet; the timers reach it over
 * loopback.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) return new Response("Unauthorized", { status: 401 });

  const deep = request.nextUrl.searchParams.get("deep") === "1";
  const started = Date.now();

  try {
    const reconciled = await reconcileOpenPositions();

    // Expensive: one `fetchPositions` per idle deployment, plus a full loadMarkets
    // per venue. Never on the per-minute pass.
    const orphans = deep ? await scanForOrphans() : null;
    const markets = deep ? await refreshCachedMarkets() : null;

    return Response.json({ ok: true, deep, ms: Date.now() - started, ...reconciled, orphans, markets });
  } catch (error) {
    await logExec({ level: "error", event: "cron.reconcile.failed", detail: errorDetail(error) });
    // 5xx so the scheduler's own retry sees it as a failure worth repeating.
    return Response.json({ ok: false, error: errorDetail(error).message }, { status: 500 });
  }
}
