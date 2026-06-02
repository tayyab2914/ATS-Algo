import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

const COLUMNS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "Platform", href: "#platform" },
      { label: "How it works", href: "#how" },
      { label: "Reviews", href: "#reviews" },
    ],
  },
  {
    heading: "Account",
    links: [
      { label: "Log in", href: "/login" },
      { label: "Sign up", href: "/signup" },
      { label: "Forgot password", href: "/forgot-password" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "#top" },
      { label: "Security", href: "#features" },
      { label: "Contact", href: "#top" },
    ],
  },
];

/** Marketing footer: brand lockup, link columns and a legal bar. */
export function LandingFooter() {
  return (
    <footer className="border-t border-line bg-surface/40 px-5 py-14 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="flex flex-col gap-4">
            <Logo />
            <p className="max-w-xs text-sm leading-relaxed text-muted">
              Institutional-grade algorithmic trading automation for crypto, forex and
              commodities.
            </p>
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success">
              <span className="size-2 rounded-full bg-success animate-blink" />
              All systems operational
            </span>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading} className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-white">{col.heading}</h3>
              <ul className="flex flex-col gap-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted transition-colors hover:text-accent"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-line pt-6 sm:flex-row">
          <p className="text-xs text-muted">
            © {new Date().getFullYear()} Adrian Trading System. All rights reserved.
          </p>
          <p className="max-w-md text-center text-[11px] leading-relaxed text-muted/70 sm:text-right">
            Trading involves risk. Past performance is not indicative of future results.
          </p>
        </div>
      </div>
    </footer>
  );
}
