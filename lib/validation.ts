import { z } from "zod";
import { EXCHANGES } from "@/lib/account";
import { isCardExpired, luhnValid, normalizeCardNumber } from "@/lib/payment";

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

export const connectionToggleSchema = z.object({
  target: z.literal("tradingview"),
  connected: z.boolean(),
});

export const exchangeAddSchema = z.object({
  exchange: z.enum(EXCHANGES),
  apiKey: z.string().trim().min(6, "API key looks too short"),
  apiSecret: z.string().trim().min(6, "API secret looks too short"),
});

export const exchangeRemoveSchema = z.object({
  exchange: z.enum(EXCHANGES),
});

// ── Payment methods ───────────────────────────────────────────────────────────

/**
 * Add a saved card. The raw `number` is normalized + Luhn-checked here but only
 * its brand and last four are ever persisted (see the payment-methods route).
 * The CVV is intentionally absent from the schema — the client never sends it.
 */
export const paymentMethodAddSchema = z
  .object({
    number: z
      .string()
      .trim()
      .transform(normalizeCardNumber)
      .refine((v) => luhnValid(v), "Enter a valid card number"),
    expMonth: z.coerce.number().int().min(1, "Invalid expiry month").max(12, "Invalid expiry month"),
    expYear: z.coerce.number().int().min(2000, "Invalid expiry year").max(2099, "Invalid expiry year"),
    holderName: z.string().trim().min(2, "Enter the name on the card").max(100, "Name is too long"),
    label: z.string().trim().max(60, "Label is too long").optional().or(z.literal("")),
  })
  .refine((d) => !isCardExpired(d.expMonth, d.expYear), {
    message: "That card has already expired",
    path: ["expMonth"],
  });

/** Identify a saved card by id (remove / set-default). */
export const paymentMethodIdSchema = z.object({
  id: z.string().min(1, "Missing payment method id"),
});

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
export type PaymentMethodAddInput = z.infer<typeof paymentMethodAddSchema>;
export type PaymentMethodIdInput = z.infer<typeof paymentMethodIdSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type AdminMemberActionInput = z.infer<typeof adminMemberActionSchema>;
export type AdminSetRoleInput = z.infer<typeof adminSetRoleSchema>;
