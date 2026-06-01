import type { ReactNode } from "react";
import { BrandPanel } from "@/components/marketing/BrandPanel";

/**
 * The shared two-column shell used by every full-screen surface (login,
 * signup, admin): the brand panel on the left, page content on the right.
 *
 * - `lg`+ : fluid 50/50 columns matching the Figma frame.
 * - below : stacks vertically for tablet / mobile.
 *
 * @param brand    - Optional override for the brand lockup (see {@link BrandPanel}).
 * @param children - Right-column content, vertically centred.
 */
export function SplitScreen({
  brand,
  children,
}: {
  brand?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full flex-col lg:flex-row">
      <BrandPanel brand={brand} />
      <main className="flex w-full flex-col items-center justify-center gap-6 bg-background px-6 py-12 sm:px-8 lg:flex-1 lg:px-12 lg:py-16">
        {children}
      </main>
    </div>
  );
}
