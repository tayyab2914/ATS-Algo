import type { Metadata } from "next";
import { ForgotPasswordCard } from "@/components/auth/ForgotPasswordCard";

export const metadata: Metadata = {
  description: "Request a password reset link.",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordCard />;
}
