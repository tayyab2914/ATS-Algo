import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/AuthCard";

export const metadata: Metadata = {
  title: "Sign Up · ATS-ALGO",
  description: "Create your account and start automating your trades.",
};

export default function SignupPage() {
  return <AuthCard mode="signup" />;
}
