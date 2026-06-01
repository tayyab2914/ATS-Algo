import type { Metadata } from "next";
import { AdminAccessCard } from "@/components/admin/AdminAccessCard";
import { AdminBrand } from "@/components/brand/AdminBrand";
import { SplitScreen } from "@/components/layout/SplitScreen";

export const metadata: Metadata = {
  title: "Admin Access · Adrian Trading System",
  description: "Enter your PIN to access the admin dashboard.",
};

export default function AdminPage() {
  return (
    <SplitScreen brand={<AdminBrand />}>
      <AdminAccessCard />
    </SplitScreen>
  );
}
