"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { NAV_LINKS } from "@/lib/landing-content";
import { cn } from "@/lib/cn";

/**
 * Sticky marketing header. Starts transparent over the hero and snaps to a
 * blurred glass bar once the page is scrolled. Collapses to a slide-down sheet
 * on mobile.
 */
export function LandingNav({ loggedIn = false }: { loggedIn?: boolean }) {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  // Seed from the server render, then confirm against the live session so a
  // stale tab (loaded before sign-in) self-corrects without a manual reload.
  const [authed, setAuthed] = useState(loggedIn);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => res.ok)
      .catch(() => loggedIn)
      .then((live) => {
        if (cancelled || live === loggedIn) return;
        setAuthed(live);
        // Re-render the server components (Hero / CTA) with the correct state.
        router.refresh();
      });
    return () => {
      cancelled = true;
    };
  }, [loggedIn, router]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        scrolled
          ? "border-b border-line/70 bg-background/80 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <nav className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link href="#top" className="scale-90 origin-left sm:scale-100" aria-label="Adrian Trading System — home">
          <Logo />
        </Link>

        <div className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full px-4 py-2 text-sm text-muted transition-colors hover:text-white"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-2 lg:flex">
          <Link
            href="/bot-library"
            className="rounded-full border border-accent/40 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/10"
          >
            Bot Library
          </Link>
          {authed ? (
            <Link
              href="/dashboard"
              className="group relative inline-flex h-10 items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-[#06141a] shadow-[0_0_24px_-6px_rgba(40,184,213,0.8)] transition-transform hover:-translate-y-0.5"
            >
              My Dashboard
              <span aria-hidden className="ml-1.5 transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-full px-4 py-2 text-sm font-medium text-white/90 transition-colors hover:text-accent"
              >
                Login
              </Link>
              <Link
                href="/signup"
                className="group relative inline-flex h-10 items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-[#06141a] shadow-[0_0_24px_-6px_rgba(40,184,213,0.8)] transition-transform hover:-translate-y-0.5"
              >
                Get Started
                <span aria-hidden className="ml-1.5 transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex size-10 items-center justify-center rounded-xl border border-line bg-surface/60 text-white lg:hidden"
          aria-label="Toggle navigation menu"
          aria-expanded={open}
        >
          <span className="relative block h-3.5 w-5">
            <span
              className={cn(
                "absolute left-0 top-0 h-0.5 w-full rounded bg-current transition-transform duration-300",
                open && "translate-y-[7px] rotate-45",
              )}
            />
            <span
              className={cn(
                "absolute left-0 top-[6px] h-0.5 w-full rounded bg-current transition-opacity duration-200",
                open && "opacity-0",
              )}
            />
            <span
              className={cn(
                "absolute left-0 top-[12px] h-0.5 w-full rounded bg-current transition-transform duration-300",
                open && "-translate-y-[5px] -rotate-45",
              )}
            />
          </span>
        </button>
      </nav>

      {/* Mobile sheet */}
      <div
        className={cn(
          "grid overflow-hidden border-line bg-background/95 backdrop-blur-xl transition-all duration-300 lg:hidden",
          open ? "grid-rows-[1fr] border-b" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0">
          <div className="flex flex-col gap-1 px-5 py-4">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-2.5 text-sm text-muted transition-colors hover:bg-white/5 hover:text-white"
              >
                {link.label}
              </a>
            ))}
            <Link
              href="/bot-library"
              onClick={() => setOpen(false)}
              className="rounded-xl border border-accent/40 px-3 py-2.5 text-center text-sm font-medium text-accent transition-colors hover:bg-accent/10"
            >
              Bot Library
            </Link>
            <div className="mt-2 flex gap-2">
              {authed ? (
                <Link
                  href="/dashboard"
                  onClick={() => setOpen(false)}
                  className="flex h-11 flex-1 items-center justify-center rounded-xl bg-accent text-sm font-semibold text-[#06141a]"
                >
                  My Dashboard
                </Link>
              ) : (
                <>
                  <Link
                    href="/login"
                    onClick={() => setOpen(false)}
                    className="flex h-11 flex-1 items-center justify-center rounded-xl border border-line text-sm font-medium text-white"
                  >
                    Login
                  </Link>
                  <Link
                    href="/signup"
                    onClick={() => setOpen(false)}
                    className="flex h-11 flex-1 items-center justify-center rounded-xl bg-accent text-sm font-semibold text-[#06141a]"
                  >
                    Get Started
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
