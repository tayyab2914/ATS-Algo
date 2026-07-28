import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail, zodFail } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { type BotConfig, RISK_TO_PROFILE, type RiskClass } from "@/lib/backtest/engine";
import { backtestBotColumns } from "@/lib/backtest/bot-record";
import { profileLeverage, withLeverage, withRatchetPct } from "@/lib/bot-config";
import { matchBotExchange } from "@/lib/bot-exchanges";
import { prisma } from "@/lib/db";
import { botConfigError, ladderGeometryError, leverageError, MAX_LEVERAGE, MIN_LEVERAGE } from "@/lib/validation";

/**
 * Update a bot: optionally swap in a new config JSON and/or signal CSV, retune the
 * stop ladder or leverage in place, re-run the backtest, refresh the stored
 * metrics, and append a change-log revision describing what changed. Anything not
 * provided is carried over from the existing bot.
 *
 * `config` is a FULL replacement and is validated in full. `tightenPct` and
 * `leverage` are targeted edits: the server applies them to the config already on
 * the row, so an admin can retune a grandfathered bot without first having to
 * modernise a JSON file that predates the current schema. That asymmetry is the
 * whole point — see `ladderGeometryError`.
 */
const updateBotSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  timeframe: z.string().trim().min(1).max(20).optional(),
  exchanges: z.array(z.string()).max(3).optional(),
  exchange: z.string().trim().max(40).optional(), // legacy single
  riskClass: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  config: z.any().optional(),
  /** Stop ladder, applied to every profile. `null` clears it (legacy `be` rule). */
  tightenPct: z.number().nullable().optional(),
  /** Leverage for the ONE profile this bot's risk class trades. */
  leverage: z.number().min(MIN_LEVERAGE).max(MAX_LEVERAGE).optional(),
  csvText: z.string().min(1).optional(),
  csvFilename: z.string().max(200).optional(),
  message: z.string().trim().min(1, "A change message is required").max(1000),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return fail("Admin access required", 403);

  const { id } = await params;
  const parsed = updateBotSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);
  const { name, category, timeframe, exchanges, exchange, riskClass, config, tightenPct, leverage, csvText, csvFilename, message } =
    parsed.data;

  // Deliberately narrow: an unscoped read pulled `csvData` (megabytes) and the
  // `results` blob on every edit, including metadata-only ones that never touch
  // them. The CSV is fetched below only when a re-run actually needs it.
  const existing = await prisma.bot.findUnique({
    where: { id },
    select: { riskClass: true, config: true, csvFilename: true },
  });
  if (!existing) return fail("Bot not found", 404);

  // Admin-allowed exchange set is authoritative (over any config-derived exchange).
  let exchangeUpdate: { exchange?: string | null; exchanges?: string[] } = {};
  if (exchanges !== undefined) {
    const allowed = [...new Set(exchanges.map((e) => matchBotExchange(e)).filter(Boolean))];
    if (allowed.length === 0) return fail("Pick at least one exchange for this bot.", 422);
    exchangeUpdate = { exchange: allowed[0], exchanges: allowed };
  } else if (exchange !== undefined) {
    const m = matchBotExchange(exchange);
    exchangeUpdate = m ? { exchange: m, exchanges: [m] } : { exchange: null };
  }

  const configUploaded = config !== undefined;
  const csvProvided = csvText !== undefined;
  const effectiveRisk = (riskClass ?? existing.riskClass) as RiskClass;

  // Compose what will actually be stored: the uploaded config (or the one already
  // on the row), with the in-place ladder and leverage edits applied on top.
  const baseConfig = (configUploaded ? config : existing.config) as BotConfig;
  let nextConfig = baseConfig;
  if (tightenPct !== undefined) nextConfig = withRatchetPct(nextConfig, tightenPct);
  if (leverage !== undefined) {
    if (!nextConfig.profiles?.[RISK_TO_PROFILE[effectiveRisk]]) {
      return fail(
        `This bot's config has no ${RISK_TO_PROFILE[effectiveRisk]} profile, so there is no leverage to set for ${effectiveRisk} risk.`,
        422,
      );
    }
    const levError = leverageError(leverage);
    if (levError) return fail(levError, 422);
    nextConfig = withLeverage(nextConfig, effectiveRisk, leverage);
  }

  // Validate the COMPOSED object, never the raw upload: an admin who uploads a sound
  // config and then types an unsound ladder in the same save must be stopped, and
  // checking the upload before the edits were applied would have waved that through.
  //
  // The BAR depends on where the config came from. A file being introduced right now
  // has to satisfy the whole schema — nothing grandfathers new material. A config
  // already on the row is held to the ladder's geometry only, which is exactly the
  // bar it already meets, so retuning a bot whose JSON predates the current schema
  // stays possible. That asymmetry is the point.
  if (configUploaded) {
    const configError = botConfigError(nextConfig, effectiveRisk);
    if (configError) return fail(configError, 422);
  } else if (nextConfig !== baseConfig) {
    const geometry = ladderGeometryError(nextConfig as Parameters<typeof ladderGeometryError>[0]);
    if (geometry) return fail(geometry.message, 422);
  }

  const configChanged = nextConfig !== baseConfig || configUploaded;
  const riskChanged = riskClass !== undefined && riskClass !== existing.riskClass;

  // Only re-run the backtest when something that actually moves the metrics
  // changed. A metadata-only edit — name, category, timeframe — saves against the
  // existing stored metrics, so a small change can't be blocked by an unrelated
  // backtest failure. The ladder alone is deliberately excluded: `simulateTrade`
  // does not model `sl_tighten_pct`, so a re-run would return identical numbers.
  const levChanged = leverage !== undefined && leverage !== profileLeverage(baseConfig, effectiveRisk);
  const needsBacktest = configUploaded || csvProvided || riskChanged || levChanged;

  /** Surfaced to the admin when the save went through but the metrics could not be refreshed. */
  let warning: string | undefined;
  let metrics: ReturnType<typeof backtestBotColumns> | undefined;
  if (needsBacktest) {
    // Only reach for the stored signals when the request didn't bring its own —
    // a config, leverage or risk-class edit re-runs against the CSV already on file.
    const csv =
      csvText ??
      (await prisma.bot.findUnique({ where: { id }, select: { csvData: true } }))?.csvData ??
      null;

    // Switching an existing bot to a risk tier its (possibly legacy) config never
    // defined would publish a bot that can never open a position. Block just that
    // case — a targeted presence check, not a full re-validation of the old config.
    if (!configUploaded && riskChanged && !nextConfig.profiles?.[RISK_TO_PROFILE[effectiveRisk]]) {
      return fail(
        `This bot's config has no ${RISK_TO_PROFILE[effectiveRisk]} profile, so it can't run at ${effectiveRisk} risk. Upload a config that includes it.`,
        422,
      );
    }

    if (!csv) {
      // Used to be a hard 422, which made a bot with no signals on file completely
      // uneditable — every config-touching change was refused, including retuning
      // leverage. Save the edit and say plainly that the published metrics are now
      // one config behind; refusing helps nobody.
      warning = "Saved, but this bot has no signal CSV on file, so its published backtest metrics were left unchanged. Upload a CSV to refresh them.";
    } else {
      try {
        metrics = backtestBotColumns(nextConfig, csv, effectiveRisk);
      } catch (error) {
        console.error("Backtest failed:", error);
        return fail("Backtest failed — check that the CSV matches the expected signal format.", 422);
      }
    }
  }

  const bot = await prisma.bot.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(timeframe !== undefined ? { timeframe } : {}),
      ...(riskClass !== undefined ? { riskClass } : {}),
      ...(configChanged ? { config: nextConfig as object } : {}),
      // Only a REPLACEMENT file redefines what the bot trades. An in-place ladder or
      // leverage retune must not re-derive these from a legacy config that never
      // carried them and blank a ticker the row has had all along.
      ...(configUploaded ? { ticker: nextConfig.ticker ?? null, assetType: nextConfig.type ?? null } : {}),
      // Admin's explicit allowed set wins; a swapped config never changes it.
      ...exchangeUpdate,
      ...(csvText !== undefined ? { csvData: csvText, csvFilename: csvFilename ?? existing.csvFilename } : {}),
      ...(metrics ?? {}),
      revisions: { create: { message } },
    },
    select: { id: true, name: true },
  });

  return ok({ bot, ...(warning ? { warning } : {}) });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return fail("Admin access required", 403);

  const { id } = await params;
  const deleted = await prisma.bot.deleteMany({ where: { id } });
  if (deleted.count === 0) return fail("Bot not found", 404);

  return ok({ id });
}
