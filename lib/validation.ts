import { z } from "zod";
import { EXCHANGES } from "@/lib/account";
import { RISK_TO_PROFILE, type RiskClass, type RiskKey } from "@/lib/bot-config";
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

export const exchangeAddSchema = z
  .object({
    exchange: z.enum(EXCHANGES),
    apiKey: z.string().trim().min(6, "API key looks too short"),
    apiSecret: z.string().trim().min(6, "API secret looks too short"),
    // Required only for venues that need it (e.g. Bitget) — enforced below.
    passphrase: z.string().trim().optional().or(z.literal("")),
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
      if (Math.abs(sum - 1) > 1e-6) {
        ctx.addIssue({
          code: "custom",
          path: ["w"],
          message: `${label}: weights must sum to 1 but sum to ${sum.toFixed(6)} — otherwise the ladder never closes the whole position`,
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
      // Missing fees silently backtest as fee-free, which overstates every
      // published return — so they are required, not defaulted.
      fees: z.object(
        {
          maker_fee_pct: z.number().min(0, "fees.maker_fee_pct must be zero or greater"),
          taker_fee_pct: z.number().min(0, "fees.taker_fee_pct must be zero or greater"),
        },
        { error: "Config JSON needs a `fees` block with maker_fee_pct and taker_fee_pct." },
      ),
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
  .loose();

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

// ── Billing ──────────────────────────────────────────────────────────────────

/** Which plan a checkout request is for. Mirrors the `BillingPlan` enum. */
export const checkoutSchema = z.object({
  plan: z.enum(["MONTHLY", "YEARLY"]),
});

// ── Admin member management ───────────────────────────────────────────────────

/** An action an admin takes on a member from the Admin Management screen. */
export const adminMemberActionSchema = z.object({
  memberId: z.string().min(1, "Missing member id"),
  action: z.enum(["suspend", "ban", "reactivate", "forceLogout", "grantFree", "revokeFree", "delete", "demote"]),
  /** Length of a granted comp subscription; `0` (or omitted) means perpetual. */
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
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type AdminMemberActionInput = z.infer<typeof adminMemberActionSchema>;
export type AdminSetRoleInput = z.infer<typeof adminSetRoleSchema>;
