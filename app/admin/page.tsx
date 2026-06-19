import type { Metadata } from "next";
import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { AdminBrand } from "@/components/brand/AdminBrand";
import { SplitScreen } from "@/components/layout/SplitScreen";

export const metadata: Metadata = {
  title: "Admin Access · ATS-ALGO",
  description: "Enter your PIN to access the admin dashboard.",
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  return (
    <SplitScreen brand={<AdminBrand />}>
      <AdminAccessCard initialEmail={email ?? ""} />
    </SplitScreen>
  );
}
