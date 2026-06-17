import type { Metadata } from "next";
import { CtaSection } from "@/components/landing/CtaSection";
import { ExchangeMarquee } from "@/components/landing/ExchangeMarquee";
import { Features } from "@/components/landing/Features";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { LandingNav } from "@/components/landing/LandingNav";
import { Platform } from "@/components/landing/Platform";
import { PriceTicker } from "@/components/landing/PriceTicker";
import { Testimonials } from "@/components/landing/Testimonials";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "ATS-ALGO — Automated Algorithmic Trading",
  description:
    "Professional-grade trading bots that automate crypto, forex and commodities around the clock. Real-time analytics, advanced risk controls, and millisecond execution.",
};

/**
 * Public marketing landing page. Composes the animated marketing sections and
 * funnels visitors toward /signup and /login. Visitors with a valid session see
 * a "My Dashboard" shortcut instead of the sign-in / get-started CTAs.
 */
export default async function Home() {
  const session = await getSession();
  const loggedIn = session !== null;
  // Admins carry an ADMIN session; their "My Dashboard" shortcut must point at
  // the admin panel, not the end-user dashboard.
  const isAdmin = session?.role === "ADMIN";

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <LandingNav loggedIn={loggedIn} isAdmin={isAdmin} />
      <main className="flex-1">
        <Hero loggedIn={loggedIn} isAdmin={isAdmin} />
        <PriceTicker />
        <Features />
        <Platform />
        <HowItWorks />
        <ExchangeMarquee />
        <Testimonials />
        <CtaSection loggedIn={loggedIn} isAdmin={isAdmin} />
      </main>
      <LandingFooter />
    </div>
  );
}
