import "dotenv/config";
import { prisma } from "../lib/db";
import { auditPnl } from "../lib/execution/manage";

/**
 * Audit every closed position's realized PnL against the venue's own fills.
 *
 * Why this exists: PnL used to be reconstructed from whatever fills the venue happened to
 * return, and when a closing fill was still unpublished the calculation "widened" to every
 * fill on the symbol — which, on a reversal, meant the PREVIOUS trade's closing fill. One
 * $300 trade booked +$2,669.12 against a true +$18.22 that way. The engine no longer does
 * either thing, but rows booked before the fix are still wrong, and they feed the member's
 * balance and (with compounding on) the size of their next trade.
 *
 * The `--conditions` flag is the `server-only` guard, exactly as the probe scripts need it:
 *
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-pnl-attribution.ts
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-pnl-attribution.ts --repair
 *
 * `--repair` does NOT write a PnL. It sets `pnlPending`, which is the engine's own "this
 * number is provisional" flag, and the next reconcile pass re-reads the venue and applies the
 * difference through `resettlePnl` — the same path every close now takes, with its own
 * `pnl.settled` audit line. Nothing here invents a figure of its own.
 *
 * Only rows the venue can ACCOUNT FOR COMPLETELY are flagged. A position that cannot be
 * fully attributed (a liquidation, a fill the member closed by hand) is reported and left
 * alone, because re-settling it would replace one unverifiable number with another.
 */

const repair = process.argv.includes("--repair");
const money = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(2)}`;
/** A cent of float noise is not drift. */
const DRIFT_TOLERANCE = 0.01;

async function main() {
  const positions = await prisma.position.findMany({
    where: { status: "CLOSED" },
    orderBy: { closedAt: "asc" },
    select: { id: true },
  });

  console.log(`Auditing ${positions.length} closed position(s) against the venue.\n`);

  const drifted: { id: string; userBotId: string; stored: number; truth: number }[] = [];
  const unverifiable: string[] = [];

  for (const { id } of positions) {
    const audit = await auditPnl(id);
    if (!audit) {
      console.log(`  ${id}  SKIPPED — no exchange connection to read from`);
      continue;
    }

    const head = `  ${audit.symbol} ${audit.side} closed ${audit.closedAt?.toISOString().slice(0, 16) ?? "?"} (${audit.closedReason})`;
    if (!audit.complete) {
      unverifiable.push(id);
      console.log(
        `${head}\n     booked ${money(audit.stored)} — CANNOT VERIFY: ` +
          `opened ${audit.openedAmount} / closed ${audit.closedAmount} of ${audit.size} across ${audit.fills} fill(s)`,
      );
      continue;
    }

    const truth = audit.attributed!;
    const delta = audit.stored - truth;
    if (Math.abs(delta) <= DRIFT_TOLERANCE) {
      console.log(`${head}\n     booked ${money(audit.stored)} — agrees with the venue`);
      continue;
    }

    drifted.push({ id, userBotId: audit.userBotId, stored: audit.stored, truth });
    console.log(
      `${head}\n     booked ${money(audit.stored)} — VENUE SAYS ${money(truth)}` +
        `${audit.venue !== null ? ` (venue's own figure ${money(audit.venue)})` : ""}  →  overstated by ${money(delta)}`,
    );
  }

  console.log(
    `\n${drifted.length} position(s) drifted, ${unverifiable.length} unverifiable, ` +
      `${positions.length - drifted.length - unverifiable.length} correct.`,
  );

  if (drifted.length === 0) return;

  const total = drifted.reduce((sum, d) => sum + (d.stored - d.truth), 0);
  console.log(`Members' balances are out by ${money(total)} in total.`);

  if (!repair) {
    console.log("\nRe-run with --repair to flag these for re-settlement (the next reconcile pass corrects them).");
    return;
  }

  const flagged = await prisma.position.updateMany({
    where: { id: { in: drifted.map((d) => d.id) } },
    data: { pnlPending: true },
  });
  console.log(
    `\nFlagged ${flagged.count} position(s) as provisional. The reconcile pass (every minute) will\n` +
      "re-read the venue and apply the difference to the position and the deployment balance.\n" +
      "Watch for `pnl.settled` in execution_logs, then re-run this script to confirm.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
