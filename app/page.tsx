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

export const metadata: Metadata = {
  title: "Adrian Trading System — Automated Algorithmic Trading",
  description:
    "Institutional-grade trading bots that automate crypto, forex and commodities around the clock. Real-time analytics, advanced risk controls, and millisecond execution.",
};

/**
 * Public marketing landing page. Composes the animated marketing sections and
 * funnels visitors toward /signup and /login. Replaces the old root redirect.
 */
export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <LandingNav />
      <main className="flex-1">
        <Hero />
        <PriceTicker />
        <Features />
        <Platform />
        <HowItWorks />
        <ExchangeMarquee />
        <Testimonials />
        <CtaSection />
      </main>
      <LandingFooter />
    </div>
  );
}
