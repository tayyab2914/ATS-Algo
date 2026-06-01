import type { Metadata } from "next";
import { ForgotPasswordCard } from "@/components/auth/ForgotPasswordCard";

export const metadata: Metadata = {
  title: "Reset Password · Adrian Trading System",
  description: "Request a password reset link.",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordCard />;
}
