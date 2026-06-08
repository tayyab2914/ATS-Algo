import type { Metadata } from "next";
import { ForgotPasswordCard } from "@/components/auth/ForgotPasswordCard";

export const metadata: Metadata = {
  title: "Reset Password · ATS-ALGO",
  description: "Request a password reset link.",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordCard />;
}
