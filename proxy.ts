import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifyToken } from "@/lib/auth/jwt";

/**
 * Edge route guard (Next 16 renamed Middleware → Proxy).
 *
 * Optimistic checks only — inspects the JWT cookie to gate navigation:
 * - unauthenticated → protected routes ........ redirect to /login
 * - non-admin / signed-out → /admin/dashboard . redirect to /admin or /dashboard
 * - authenticated → auth pages ................ redirect to /dashboard
 *
 * Authoritative checks still run in route handlers / server components.
 */
const PROTECTED = ["/dashboard", "/account"];
const ADMIN_ONLY = ["/admin/dashboard"];
const AUTH_PAGES = ["/login", "/signup"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifyToken(token) : null;

  if (ADMIN_ONLY.some((path) => pathname.startsWith(path))) {
    if (!session) return NextResponse.redirect(new URL("/admin", request.url));
    if (session.role !== "ADMIN") return NextResponse.redirect(new URL("/dashboard", request.url));
    return NextResponse.next();
  }

  if (!session && PROTECTED.some((path) => pathname.startsWith(path))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (session && AUTH_PAGES.includes(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/account/:path*", "/admin/dashboard/:path*", "/login", "/signup"],
};
