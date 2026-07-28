import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NavProgress } from "@/components/app/NavProgress";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

/**
 * `title.default` is the members' fixed document title. Every in-app page —
 * Dashboard, Portfolio, My Bots, Bot Library, Billing, Account, and the auth
 * screens — deliberately exports NO `title` of its own, so all of them inherit
 * "ATS-ALGO" and a browser bookmark is named after the product rather than after
 * whichever page happened to be open when it was saved.
 *
 * Two segments opt out on purpose:
 *  - `/admin/**` pins "ATS:Admin" (app/admin/layout.tsx).
 *  - `/` keeps a descriptive title, because it is the public marketing page and
 *    that string is what search results show.
 *
 * `template` is a bare "%s" — Next's types require one alongside `default`, and a
 * pass-through is the only value that doesn't decorate `/`'s marketing title.
 */
export const metadata: Metadata = {
  title: { default: "ATS-ALGO", template: "%s" },
  description: "Automate your trading. Maximize returns.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <NavProgress />
        {children}
      </body>
    </html>
  );
}
