import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/AuthCard";
import { activeLinkForSlug } from "@/lib/community/track";

export const metadata: Metadata = {
  description: "Create your account and start automating your trades.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; ref?: string }>;
}) {
  // Members arrive from an emailed invite link carrying their address; pre-fill
  // it and lock the field so they can only register the invited email.
  const { email, ref } = await searchParams;

  // `ref` comes from a Community Access Link (see app/[community]/page.tsx). It
  // is resolved here purely to NAME the community on the form — the grant is
  // decided by the signup route, which resolves the slug again. A stale or
  // hand-typed ref just means no banner and an ordinary read-only guest account.
  const link = await activeLinkForSlug(ref);

  return (
    <AuthCard
      mode="signup"
      initialEmail={email ?? ""}
      lockEmail={Boolean(email)}
      community={link ? { name: link.name, slug: link.slug } : undefined}
    />
  );
}
