/** The two authentication surfaces, each backed by its own route. */
export type AuthMode = "login" | "signup";

type AuthCopy = {
  /** Tab label. */
  tab: string;
  /** Route the tab links to. */
  href: string;
  /** Card heading. */
  title: string;
  /** Card sub-heading. */
  subtitle: string;
};

export const AUTH_COPY: Record<AuthMode, AuthCopy> = {
  login: {
    tab: "Login",
    href: "/login",
    title: "Welcome back",
    subtitle: "Sign in to your trading dashboard",
  },
  signup: {
    tab: "Sign Up",
    href: "/signup",
    title: "Create account",
    subtitle: "Start your automated trading journey",
  },
};

/** Ordered list used to render the tab switcher consistently. */
export const AUTH_MODES: readonly AuthMode[] = ["login", "signup"] as const;
