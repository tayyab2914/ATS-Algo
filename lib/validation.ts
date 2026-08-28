import { z } from "zod";
import { EXCHANGES } from "@/lib/account";
import { BOT_EXCHANGES } from "@/lib/bot-exchanges";
import {
  DEFAULT_SLIPPAGE_PCT,
  minDistancePct,
  nthNearestTp,
  ratchetDistancePct,
  ratchetPct,
  RISK_TO_PROFILE,
  stopBufferPct,
  type RiskClass,
  type RiskKey,
} from "@/lib/bot-config";
import { exchangeRequiresPassphrase } from "@/lib/bot-exchanges";

/** Shared field rules. */
const email = z.string().trim().toLowerCase().email("Enter a valid email address");
const password = z.string().min(8, "Password must be at least 8 characters");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Password is required"),
});

export const signupSchema = z
  .object({
    email,
    password,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

/** "Get Code" — request a one-time admin code be emailed to this address. */
export const adminRequestCodeSchema = z.object({ email });

export const adminCodeSchema = z.object({
  email,
  code: z.string().regex(/^\d{4}$/, "Enter the 4-digit code from your email"),
});

export const twoFactorCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your email"),
});

export const twoFactorToggleSchema = z.object({
  enabled: z.boolean(),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, "Missing reset token"),
    password,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

// ── Account settings ─────────────────────────────────────────────────────────

const optionalText = z.string().trim().optional().or(z.literal(""));

// Email is intentionally NOT here: it changes through the dedicated two-step
// verification flow (see lib/auth/email-change.ts), never this bulk update.
export const profileSchema = z.object({
  username: z.string().trim().max(60, "Username is too long").optional().or(z.literal("")),
  password: z.string().min(8, "Password must be at least 8 characters").optional().or(z.literal("")),
  avatarUrl: optionalText,
});

/** Start an email change — the requested new address. */
export const emailChangeStartSchema = z.object({ email });

/** A 6-digit code for either step of the email-change flow. */
export const emailChangeCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your email"),
});

/**
 * The admin-allowed venue set on a bot.
 *
 * Capped at the number of venues that EXIST, never a literal. It was `.max(3)` inline in both
 * admin bot routes, and that silently became a bug the moment a fourth venue was added: the
 * editor offered BingX, an admin ticked it, and the save failed with a raw zod message ("Too
 * big: expected array to have <=3 items") naming neither the field nor the real limit.
 *
 * Shared rather than duplicated per route so the create and update paths cannot drift, and so a
 * test can assert it accepts every venue in the registry — which is what verify-bot-editing.ts
 * now does.
 */
export const botExchangesSchema = z.array(z.string()).max(BOT_EXCHANGES.length);

export const exchangeAddSchema = z
  .object({
    exchange: z.enum(EXCHANGES),
    apiKey: z.string().trim().min(6, "API key looks too short"),
    apiSecret: z.string().trim().min(6, "API secret looks too short"),
    // Required only for venues that need it (e.g. Bitget) — enforced below.
    passphrase: z.string().trim().optional().or(z.literal("")),
    /**
     * The member declaring this is a demo/paper key. Only consulted for venues where the key
     * itself cannot reveal it (BingX). Defaults to LIVE, which is the safe direction: a live
     * key mislabelled demo would trade paper and confuse, but a demo key mislabelled live is
     * caught at once because the live host holds no funds.
     */
    sandbox: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (exchangeRequiresPassphrase(data.exchange) && !data.passphrase) {
      ctx.addIssue({
        code: "custom",
        path: ["passphrase"],
        message: "Passphrase is required for this exchange",
      });
    }
  });

export const exchangeRemoveSchema = z.object({
  exchange: z.enum(EXCHANGES),
});

// ── Bot config JSON (admin upload) ───────────────────────────────────────────

/** The reference signal payload carries tp1..tp10, so ten rungs is the ceiling. */
const MAX_TP_RUNGS = 10;

/**
 * How far a ladder's weights may sum from 1 before it is a real error.
 *
 * It was an exact match (`1e-6`), and that rejected the Bot Sim's own official
 * output: the simulator publishes each weight rounded to TWO DECIMALS, so
 * `[0.08, 0.22, 0.19, 0.22, 0.22, 0.08]` — a ladder that sums to 1 before
 * rounding — reaches us summing to 1.01, and the upload failed with "weights must
 * sum to 1 but sum to 1.010000".
 *
 * The envelope is exactly what that rounding can hide: each of `n` weights can be
 * off by up to half a step (0.005), so the sum can be off by up to `n * 0.005` —
 * 0.03 across six rungs. Anything beyond that is not rounding, it is a wrong
 * ladder, and is still rejected (a 0.9 or a 1.2 sum both remain errors).
 *
 * Accepting the drift is safe on both sides of the seam, and deliberately so
 * rather than by luck: `rungSizes` clamps the total weight to 1 before splitting
 * the position, so a 1.01 ladder still places exactly one position's worth, and
 * the backtest clamps each rung to the size still open. Neither over-closes.
 */
function weightSumTolerance(rungs: number): number {
  return rungs * 0.005 + 1e-6;
}

/**
 * One risk profile of an uploaded bot config. The live executor places a resting
 * limit order per `tp[k]` sized `w[k]` of the position, so a malformed ladder is
 * a real-money bug: mismatched `tp`/`w` lengths silently drop rungs, and weights
 * that don't sum to 1 leave part of every position with no take-profit.
 *
 * `zodFail` only surfaces the first issue's message and drops the path, so each
 * message names its own profile.
 */
function profileConfigSchema(label: string) {
  return z
    .object(
      {
        tp: z
          .array(
            z
              .number()
              .positive(`${label}: take-profit distances must be positive percentages`)
              .lt(100, `${label}: a take-profit of 100% or more is not a valid percentage distance`),
          )
          .min(1, `${label}: needs at least one take-profit rung`)
          .max(MAX_TP_RUNGS, `${label}: at most ${MAX_TP_RUNGS} take-profit rungs`),
        w: z
          .array(z.number().min(0, `${label}: weights cannot be negative`).max(1, `${label}: a weight cannot exceed 1`))
          .min(1, `${label}: needs a weight for every take-profit rung`)
          .max(MAX_TP_RUNGS),
        sl: z
          .number()
          .positive(`${label}: stop-loss must be a positive percentage`)
          .lt(100, `${label}: a stop-loss of 100% or more would put the stop at or below zero`),
        // 1-based rung INDEX that arms break-even; null/0 means never.
        be: z.number().int(`${label}: be must be a whole rung number`).min(0).nullable().optional(),
        // The progressive ratchet. Its PRESENCE switches the engine off the one-shot
        // `be` and onto the ladder — so a bot only gets the ladder once the simulator
        // emits this field. Geometry (G2/G3) is checked on the whole config, where the
        // fee and slippage assumptions live.
        sl_tighten_pct: z
          .number()
          .positive(`${label}: sl_tighten_pct must be a positive percentage of the original stop distance`)
          .max(100, `${label}: sl_tighten_pct above 100 would jump the stop past entry on the very first rung`)
          .nullable()
          .optional(),
        lev: z
          .number()
          .min(1, `${label}: leverage must be at least 1`)
          .max(125, `${label}: leverage above 125x is not supported`),
      },
      { error: `Config JSON is missing the ${label} (it needs safe, balanced and aggressive).` },
    )
    .loose()
    .superRefine((p, ctx) => {
      if (p.tp.length !== p.w.length) {
        ctx.addIssue({
          code: "custom",
          path: ["w"],
          message: `${label}: ${p.tp.length} take-profit rungs but ${p.w.length} weights — they must match one-to-one`,
        });
        return; // the remaining checks are meaningless once the ladder is misaligned
      }
      const sum = p.w.reduce((total, x) => total + x, 0);
      const tolerance = weightSumTolerance(p.w.length);
      if (Math.abs(sum - 1) > tolerance) {
        ctx.addIssue({
          code: "custom",
          path: ["w"],
          message:
            `${label}: weights must sum to 1 but sum to ${sum.toFixed(6)} — that is more than rounding can explain ` +
            `(at most ${tolerance.toFixed(2)} across ${p.w.length} rungs), so the ladder either leaves part of every position with no take-profit or tries to close more than it holds`,
        });
      }
      if (p.be != null && p.be > p.tp.length) {
        ctx.addIssue({
          code: "custom",
          path: ["be"],
          message: `${label}: be=${p.be} but there are only ${p.tp.length} rungs (be is the 1-based index of the rung that arms break-even)`,
        });
      }
    });
}

/**
 * The bot config JSON an admin uploads. Validated on create and whenever a new
 * config is swapped in; unknown keys (baseline, engine_version, generated_utc …)
 * pass through untouched.
 */
export const botConfigSchema = z
  .object(
    {
      name: z.string().optional(),
      ticker: z.string().optional(),
      type: z.string().optional(),
      exchange: z.string().optional(),
      timeframe: z.string().optional(),
      optimized_period: z.number().optional(),
      // OPTIONAL, and it was not always so.
      //
      // It used to be required, on the reasoning that a missing block silently
      // backtests fee-free and overstates every published return. That reasoning
      // was right for the configs of the day and is wrong for the official Bot Sim
      // output, which DELETED the block precisely because the fees are now inside
      // the numbers it emits — the take-profit distances and the picked stop are
      // already net. Requiring it would have rejected the finished file outright,
      // and adding one back would double-count.
      //
      // So: absent is fine, present is still held to shape. Everything downstream
      // already reads it as `config.fees?.taker_fee_pct ?? 0` — see `snapshotProfile`
      // and `ladderGeometryError` — so a fees-less config simply carries no extra
      // stop buffer, which is the correct reading of "already integrated".
      fees: z
        .object({
          maker_fee_pct: z.number().min(0, "fees.maker_fee_pct must be zero or greater"),
          taker_fee_pct: z.number().min(0, "fees.taker_fee_pct must be zero or greater"),
        })
        .optional(),
      // The ATR multiple the simulator sized this bot's stop from. Surfaced to
      // members on the bot's info page; never read by the executor, which places
      // `profile.sl`. Its siblings (reference_sl / picked_sl / direction) ride
      // through on `.loose()` like the other provenance fields.
      ATR_value: z.number().positive("ATR_value must be a positive number").optional(),
      // Assumed adverse fill on a market stop — an INSTRUMENT property, so it lives
      // per ticker rather than as a platform constant. Feeds the stop buffer that the
      // ladder's geometry is validated against.
      slippage_pct: z
        .number()
        .min(0, "slippage_pct must be zero or greater")
        .max(10, "slippage_pct above 10% is not a plausible market-stop assumption")
        .optional(),
      // A bot trades exactly ONE profile — the one its `riskClass` selects (see
      // `profileFor`). The live executor, the backtest columns, and both detail
      // pages all read only that profile; the other two are never surfaced. So
      // every profile here is optional and validated *when present*, and the
      // required-for-this-bot check lives in `botConfigError(config, riskClass)`.
      // Demanding all three rejected real configs — a live AAPL bot and the
      // spec's own sample — for profiles nothing would ever have read.
      profiles: z
        .object(
          {
            safe: profileConfigSchema("safe profile"),
            balanced: profileConfigSchema("balanced profile"),
            aggressive: profileConfigSchema("aggressive profile"),
          },
          { error: "Config JSON needs a `profiles` object (safe / balanced / aggressive)." },
        )
        .partial()
        .refine((p) => Boolean(p.safe || p.balanced || p.aggressive), {
          error: "Config JSON needs at least one trading profile (safe, balanced or aggressive).",
        }),
    },
    { error: "Config JSON must be an object." },
  )
  .loose()
  // The stop ladder's GEOMETRY. Checked on the whole config rather than per
  // profile, because it needs the fee and slippage assumptions that live at the
  // top. See {@link ladderGeometryError}.
  .superRefine((cfg, ctx) => {
    const found = ladderGeometryError(cfg as Parameters<typeof ladderGeometryError>[0]);
    if (found) ctx.addIssue({ code: "custom", path: ["profiles", found.profile, "sl_tighten_pct"], message: found.message });
  });

/**
 * The stop ladder's GEOMETRY, for any config — including one stored before the
 * modern schema existed.
 *
 * Split out of `botConfigSchema` on purpose. A grandfathered config (no `fees`
 * block, say) fails the schema outright, but retuning its ladder or its leverage
 * must still be possible: those edits are held to the geometry rules ONLY, which
 * is exactly the bar the row already meets. A freshly UPLOADED config still has to
 * pass the whole schema — see `botConfigError`.
 *
 * The engine NEVER silently corrects an unsound ladder at runtime — it logs and
 * refuses to move the stop. So the config has to be right before it is stored, and
 * this is the only place a bad ladder can be caught.
 *
 * Returns the first offending profile and why, or null when every ladder is sound.
 */
export function ladderGeometryError(cfg: {
  fees?: { taker_fee_pct?: number } | null;
  slippage_pct?: number | null;
  profiles?: Record<string, { tp?: number[]; sl?: number; sl_tighten_pct?: number | null } | undefined> | null;
}): { profile: string; message: string } | null {
  const buffer = stopBufferPct(Number(cfg.fees?.taker_fee_pct ?? 0), Number(cfg.slippage_pct ?? DEFAULT_SLIPPAGE_PCT));

  for (const [key, profile] of Object.entries(cfg.profiles ?? {})) {
    if (!profile) continue;
    const tighten = ratchetPct(profile);
    if (tighten === null) continue; // legacy `be` config — no ladder to check
    // Under two rungs there is no ladder to have geometry: the final rung closes
    // the position outright, so a one-rung profile never carries a movable stop.
    // G3 below divides by `tp.length - 1`, so this guard is also what keeps it
    // from reporting "never locks profit / use at least ~Infinity" on such a config.
    if (!Array.isArray(profile.tp) || profile.tp.length < 2) continue;
    const tp = profile.tp;
    const sl = Number(profile.sl);
    if (!Number.isFinite(sl) || sl <= 0) continue; // caught by the profile schema

    // G2 — SOUNDNESS. After n rungs, price has touched the n-th NEAREST take-profit.
    // The stop must stay `buffer` inside that level: any tighter and it sits above
    // the market (Bitget silently re-files a wrong-side trigger, with no error) or
    // exits giving the whole gain back in fees. G2 holding is also exactly what makes
    // the PnL-if-stopped rise with every rung.
    for (let n = 1; n <= tp.length - 1; n++) {
      const d = ratchetDistancePct(sl, tighten, n);
      const nearest = nthNearestTp(tp, n)!;
      for (const side of ["LONG", "SHORT"] as const) {
        const floor = minDistancePct(nearest, buffer, side);
        if (d < floor) {
          return {
            profile: key,
            message:
              `${key} profile: sl_tighten_pct=${tighten} is too aggressive. After ${n} rung(s) it puts the stop at ${d.toFixed(2)}% from entry, ` +
              `but price has only reached the ${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}-nearest take-profit (${nearest}%) — on a ${side} the stop may be no tighter than ` +
              `${floor.toFixed(2)}% once fees and slippage (${buffer.toFixed(3)}%) are covered. It would sit beyond the market and never protect anything. Lower sl_tighten_pct.`,
          };
        }
      }
    }

    // G3 — CONFORMANCE. The weights sum to 1, so the FINAL rung closes the position
    // outright. A ladder that only reaches profit at or after it can never lock
    // anything in: the stop is dead config.
    const locksProfit = Array.from({ length: tp.length - 1 }, (_, i) => ratchetDistancePct(sl, tighten, i + 1)).some((d) => d <= -buffer);
    if (!locksProfit) {
      const needed = (100 / (tp.length - 1)) * (1 + buffer / sl);
      return {
        profile: key,
        message:
          `${key} profile: sl_tighten_pct=${tighten} never locks in profit. The last of the ${tp.length} rungs closes the position outright (the weights sum to 1), ` +
          `so the stop only ever matters up to rung ${tp.length - 1} — and by then it is still ${ratchetDistancePct(sl, tighten, tp.length - 1).toFixed(2)}% from entry, a losing stop. ` +
          `Use at least ~${needed.toFixed(1)} to move it past break-even while the trade is still open.`,
      };
    }
  }
  return null;
}

/** Leverage bounds, enforced identically by the schema and by the on-the-fly field. */
export const MIN_LEVERAGE = 1;
export const MAX_LEVERAGE = 125;

/** Readable reason a leverage value is unusable, or null when it's fine. */
export function leverageError(lev: number): string | null {
  if (!Number.isFinite(lev)) return "Leverage must be a number.";
  if (lev < MIN_LEVERAGE) return `Leverage must be at least ${MIN_LEVERAGE}.`;
  if (lev > MAX_LEVERAGE) return `Leverage above ${MAX_LEVERAGE}x is not supported.`;
  return null;
}

/**
 * First readable validation error for a bot config, or null when it's valid.
 *
 * Pass the bot's `riskClass` to also require the specific profile that bot will
 * trade — the one thing that actually matters, since a deployment reads no other
 * profile. Omit it (e.g. a client-side pre-check before risk is chosen) and the
 * config only has to carry at least one valid profile.
 */
export function botConfigError(config: unknown, riskClass?: RiskClass): string | null {
  const result = botConfigSchema.safeParse(config);
  if (!result.success) return result.error.issues[0]?.message ?? "Invalid bot config JSON";
  if (riskClass) {
    const key: RiskKey = RISK_TO_PROFILE[riskClass];
    if (!result.data.profiles[key]) {
      return `Config JSON has no ${key} profile, which this ${riskClass}-risk bot trades. Add the ${key} profile, or change the bot's risk class.`;
    }
  }
  return null;
}

// ── Admin member management ───────────────────────────────────────────────────

/** An action an admin takes on a member from the Admin Management screen. */
export const adminMemberActionSchema = z.object({
  memberId: z.string().min(1, "Missing member id"),
  action: z.enum([
    "suspend",
    "ban",
    "reactivate",
    "forceLogout",
    "grantFree",
    "revokeFree",
    "declineRequest",
    "delete",
    "demote",
  ]),
  /** Length of the granted access in months; `0` (or omitted) means no expiry. */
  durationMonths: z.number().int().min(0).max(120).optional(),
});

/** Grant a role to an existing account by email ("Add Team Member" form). */
export const adminSetRoleSchema = z.object({
  email,
  role: z.enum(["ADMIN", "USER"]),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
export type EmailChangeStartInput = z.infer<typeof emailChangeStartSchema>;
export type EmailChangeCodeInput = z.infer<typeof emailChangeCodeSchema>;
export type AdminRequestCodeInput = z.infer<typeof adminRequestCodeSchema>;
export type AdminCodeInput = z.infer<typeof adminCodeSchema>;
export type TwoFactorCodeInput = z.infer<typeof twoFactorCodeSchema>;
export type TwoFactorToggleInput = z.infer<typeof twoFactorToggleSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type AdminMemberActionInput = z.infer<typeof adminMemberActionSchema>;
export type AdminSetRoleInput = z.infer<typeof adminSetRoleSchema>;
