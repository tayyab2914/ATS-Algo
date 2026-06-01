import { SplitScreen } from "@/components/layout/SplitScreen";

/**
 * Auth route group shell. Wraps /login and /signup in the shared split-screen
 * with the default ADRIAN brand lockup; the active route renders on the right.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <SplitScreen>{children}</SplitScreen>;
}
