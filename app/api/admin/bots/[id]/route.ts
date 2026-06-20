import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail, zodFail } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { type BotConfig, type RiskClass } from "@/lib/backtest/engine";
import { backtestBotColumns } from "@/lib/backtest/bot-record";
import { prisma } from "@/lib/db";

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
  const { name, category, timeframe, riskClass, config, csvText, csvFilename, message } = parsed.data;

  const existing = await prisma.bot.findUnique({ where: { id } });
  if (!existing) return fail("Bot not found", 404);

  // A new config replaces the old one only if it's valid; otherwise reuse it.
  const configProvided = config !== undefined;
  if (configProvided && (!config || typeof config !== "object" || !config.profiles?.balanced)) {
    return fail("Config JSON is missing trading profiles (safe / balanced / aggressive).", 422);
  }
  const cfg = (configProvided ? config : existing.config) as BotConfig;

  const csv = csvText ?? existing.csvData;
  if (!csv) return fail("This bot has no signal CSV — upload one to re-run the backtest.", 422);

  const effectiveRisk = (riskClass ?? existing.riskClass) as RiskClass;

  let metrics;
  try {
    metrics = backtestBotColumns(cfg, csv, effectiveRisk);
  } catch (error) {
    console.error("Backtest failed:", error);
    return fail("Backtest failed — check that the CSV matches the expected signal format.", 422);
  }

  const bot = await prisma.bot.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(timeframe !== undefined ? { timeframe } : {}),
      ...(riskClass !== undefined ? { riskClass } : {}),
      ...(configProvided
        ? { config, ticker: cfg.ticker ?? null, assetType: cfg.type ?? null, exchange: cfg.exchange ?? null }
        : {}),
      ...(csvText !== undefined ? { csvData: csvText, csvFilename: csvFilename ?? existing.csvFilename } : {}),
      ...metrics,
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
