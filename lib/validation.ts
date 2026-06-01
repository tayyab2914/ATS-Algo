import { z } from "zod";
import { EXCHANGES } from "@/lib/account";

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

export const adminCodeSchema = z.object({
  code: z.string().regex(/^\d{4}$/, "Enter the 4-digit code from your email"),
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

export const profileSchema = z.object({
  username: z.string().trim().max(60, "Username is too long").optional().or(z.literal("")),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").optional().or(z.literal("")),
  password: z.string().min(8, "Password must be at least 8 characters").optional().or(z.literal("")),
  avatarUrl: optionalText,
});

export const connectionToggleSchema = z.object({
  target: z.enum(["tradingview", "wallet"]),
  connected: z.boolean(),
  address: z.string().trim().optional(),
});

export const exchangeAddSchema = z.object({
  exchange: z.enum(EXCHANGES),
  apiKey: z.string().trim().min(6, "API key looks too short"),
  apiSecret: z.string().trim().min(6, "API secret looks too short"),
});

export const exchangeRemoveSchema = z.object({
  exchange: z.enum(EXCHANGES),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
export type AdminCodeInput = z.infer<typeof adminCodeSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
