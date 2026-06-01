import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/AuthCard";
import type { NoticeData } from "@/components/ui/Notice";

export const metadata: Metadata = {
  title: "Login · Adrian Trading System",
  description: "Sign in to your trading dashboard.",
};

/** Map login query flags to a banner. */
function noticeFor(params: {
  registered?: string;
  verified?: string;
  verify?: string;
  reset?: string;
}): NoticeData | undefined {
  if (params.registered === "1")
    return { type: "success", message: "Email verification has been sent — please check your email, then log in." };
  if (params.verified === "1")
    return { type: "success", message: "Your email is verified. You can now log in." };
  if (params.verify === "invalid")
    return { type: "error", message: "That verification link is invalid or has expired." };
  if (params.reset === "1")
    return { type: "success", message: "Your password has been reset. You can now log in." };
  return undefined;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string; verified?: string; verify?: string; reset?: string }>;
}) {
  const notice = noticeFor(await searchParams);
  return <AuthCard mode="login" notice={notice} />;
}
