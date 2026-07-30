import type { Metadata } from "next";

/**
 * Admin-surface metadata scope.
 *
 * Every admin route renders one fixed document title — `ATS:Admin` — so a browser
 * bookmark is named after the *surface*, not after whichever page happened to be
 * open when it was saved. `title.absolute` is what makes it fixed: it is the
 * default for every child segment AND it ignores the root layout's `template`, so
 * no parent can decorate it. Admin pages therefore export no `title` of their own;
 * adding one back would re-break the bookmark.
 *
 * The members' side gets the same treatment from the root layout's
 * `title.default` ("ATS-ALGO"). See app/layout.tsx.
 */
export const metadata: Metadata = {
  title: { absolute: "ATS:Admin" },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
