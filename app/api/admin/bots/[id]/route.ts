import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail, zodFail } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { type BotConfig, RISK_TO_PROFILE, type RiskClass } from "@/lib/backtest/engine";
import { backtestBotColumns } from "@/lib/backtest/bot-record";
import { matchBotExchange } from "@/lib/bot-exchanges";
import { prisma } from "@/lib/db";
import { botConfigError } from "@/lib/validation";

/**
 * Update a bot: optionally swap in a new config JSON and/or signal CSV, re-run
 * the backtest, refresh the stored metrics, and append a change-log revision
 * with the admin's message describing what changed. Anything not provided is
 * carried over from the existing bot.
 */
const updateBotSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  timeframe: z.string().trim().min(1).max(20).optional(),
  exchanges: z.array(z.string()).max(3).optional(),
  exchange: z.string().trim().max(40).optional(), // legacy single
  riskClass: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  config: z.any().optional(),
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
  const { name, category, timeframe, exchanges, exchange, riskClass, config, csvText, csvFilename, message } =
    parsed.data;

  const existing = await prisma.bot.findUnique({ where: { id } });
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

  const configProvided = config !== undefined;
  const csvProvided = csvText !== undefined;
  const riskChanged = riskClass !== undefined && riskClass !== existing.riskClass;

  // Only re-run the backtest when something that actually moves the metrics
  // changed (new config, new signals, or a different risk profile). A
  // metadata-only edit — name, category, timeframe — saves against the existing
  // stored metrics, so a small change can't be blocked by an unrelated backtest
  // failure (or by a bot that happens to have no CSV on file).
  const needsBacktest = configProvided || csvProvided || riskChanged;

  let metrics: ReturnType<typeof backtestBotColumns> | undefined;
  if (needsBacktest) {
    // A new config replaces the old one only if it's valid; otherwise reuse it.
    // Existing stored configs are never re-validated here, so a metadata-only or
    // risk-class edit can't be blocked by a legacy config that predates these rules.
    const effectiveRisk = (riskClass ?? existing.riskClass) as RiskClass;
    if (configProvided) {
      const configError = botConfigError(config, effectiveRisk);
      if (configError) return fail(configError, 422);
    }
    const cfg = (configProvided ? config : existing.config) as BotConfig;
    const csv = csvText ?? existing.csvData;
    if (!csv) return fail("This bot has no signal CSV — upload one to re-run the backtest.", 422);
    // Switching an existing bot to a risk tier its (possibly legacy) config never
    // defined would publish a bot that can never open a position. Block just that
    // case — a targeted presence check, not a full re-validation of the old config.
    if (!configProvided && riskChanged && !cfg.profiles?.[RISK_TO_PROFILE[effectiveRisk]]) {
      return fail(
        `This bot's config has no ${RISK_TO_PROFILE[effectiveRisk]} profile, so it can't run at ${effectiveRisk} risk. Upload a config that includes it.`,
        422,
      );
    }
    try {
      metrics = backtestBotColumns(cfg, csv, effectiveRisk);
    } catch (error) {
      console.error("Backtest failed:", error);
      return fail("Backtest failed — check that the CSV matches the expected signal format.", 422);
    }
  }

  const bot = await prisma.bot.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(timeframe !== undefined ? { timeframe } : {}),
      ...(riskClass !== undefined ? { riskClass } : {}),
      ...(configProvided
        ? {
            config,
            ticker: (config as BotConfig).ticker ?? null,
            assetType: (config as BotConfig).type ?? null,
          }
        : {}),
      // Admin's explicit allowed set wins; a swapped config never changes it.
      ...exchangeUpdate,
      ...(csvText !== undefined ? { csvData: csvText, csvFilename: csvFilename ?? existing.csvFilename } : {}),
      ...(metrics ?? {}),
      revisions: { create: { message } },
    },
    select: { id: true, name: true },
  });

  return ok({ bot });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return fail("Admin access required", 403);

  const { id } = await params;
  const deleted = await prisma.bot.deleteMany({ where: { id } });
  if (deleted.count === 0) return fail("Bot not found", 404);

  return ok({ id });
}
