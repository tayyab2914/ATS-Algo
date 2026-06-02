import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifyToken } from "@/lib/auth/jwt";

/**
 * Edge route guard (Next 16 renamed Middleware → Proxy).
 *
 * Optimistic checks only — inspects the JWT cookie to gate navigation:
 * - non-admin / signed-out → /admin/dashboard . redirect to /admin or /dashboard
 * - authenticated, policy not yet accepted → any in-app tab . redirect to /policy
 * - authenticated → auth pages ................ redirect to /dashboard (or ?next)
 *
 * Guests are intentionally allowed to reach the in-app tabs (dashboard,
 * portfolio, my-bots, account) so the page can render a locked "login to get
 * full access" overlay over a blurred preview; the policy gate only applies to
 * signed-in users (they carry a session). The Bot Library is otherwise public.
 * Authoritative checks still run in server components.
 */
const ADMIN_ONLY = ["/admin/dashboard"];
const AUTH_PAGES = ["/login", "/signup"];
const POLICY_PATH = "/policy";

/**
 * In-app routes a signed-in user may not reach until they accept the mandatory
 * Rules & Policy. Guests (no session) still pass through to the locked preview.
 */
const POLICY_GATED = ["/dashboard", "/portfolio", "/my-bots", "/account", "/bot-library"];

/** Only allow internal, non-protocol-relative redirect targets. */
function safeNext(value: string | null): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/dashboard";
}

function isGated(pathname: string): boolean {
  return POLICY_GATED.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifyToken(token) : null;

  if (ADMIN_ONLY.some((path) => pathname.startsWith(path))) {
    if (!session) return NextResponse.redirect(new URL("/admin", request.url));
    if (session.role !== "ADMIN") return NextResponse.redirect(new URL("/dashboard", request.url));
    return NextResponse.next();
  }

  // Mandatory Rules & Policy gate: hold signed-in users on /policy until they
  // accept, then let them back to wherever they were headed.
  if (session && !session.policyAccepted && isGated(pathname)) {
    const url = new URL(POLICY_PATH, request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (pathname === POLICY_PATH) {
    if (!session) {
      return NextResponse.redirect(new URL("/login?next=/policy", request.url));
    }
    if (session.policyAccepted) {
      return NextResponse.redirect(new URL(safeNext(searchParams.get("next")), request.url));
    }
  }

  if (session && AUTH_PAGES.includes(pathname)) {
    return NextResponse.redirect(new URL(safeNext(searchParams.get("next")), request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/dashboard/:path*",
    "/login",
    "/signup",
    "/policy",
    "/dashboard/:path*",
    "/portfolio/:path*",
    "/my-bots/:path*",
    "/account/:path*",
    "/bot-library/:path*",
  ],
};
