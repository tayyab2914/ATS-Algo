import { z } from "zod";

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

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type AdminCodeInput = z.infer<typeof adminCodeSchema>;
