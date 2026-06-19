import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/AuthCard";

export const metadata: Metadata = {
  title: "Sign Up · ATS-ALGO",
  description: "Create your account and start automating your trades.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  // Members arrive from an emailed invite link carrying their address; pre-fill
  // it and lock the field so they can only register the invited email.
  const { email } = await searchParams;
  return <AuthCard mode="signup" initialEmail={email ?? ""} lockEmail={Boolean(email)} />;
}
