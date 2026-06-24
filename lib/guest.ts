/**
 * Guest Mode — shared trial math and types.
 *
 * A "guest" is a signed-in, non-admin user with NO active subscription. They get
 * a short, read-only trial of the dashboard, bot library and bot profiles; once
 * it expires they are walled to the Billing tab until they pay. The trial
 * deadline lives in `User.guestExpiresAt` (set on first login).
 *
 * This module is intentionally pure (no Prisma, no Node-only imports) so the
 * countdown can be computed on both the server and the client.
 */

/** Length of the free guest trial, in days. */
export const GUEST_TRIAL_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Length of the free guest trial, in milliseconds. */
export const GUEST_TRIAL_MS = GUEST_TRIAL_DAYS * DAY_MS;

/** The lifecycle state of a guest's trial. */
export type GuestTrialState = "notStarted" | "active" | "expired";

export type GuestTrial = {
  state: GuestTrialState;
  /** The trial deadline (for `notStarted`, a hypothetical full-length window). */
  expiresAt: Date;
  /** Convenience: `state === "expired"`. */
  expired: boolean;
  /** Whole days remaining (rounded up), 0 once expired. */
  daysLeft: number;
  /** Whole hours remaining (rounded up), 0 once expired. Useful under a day. */
  hoursLeft: number;
  /** Milliseconds remaining, never negative. */
  msLeft: number;
};

/**
 * Resolve a trial from its stored deadline.
 *
 * `null` means the clock hasn't started (the user signed up but never logged in)
 * — reported as `notStarted` with a full hypothetical window rather than treated
 * as expired, so a missing timestamp can never wrongly paywall someone.
 */
export function guestTrialFrom(expiresAt: Date | null, now: number = Date.now()): GuestTrial {
  if (!expiresAt) {
    return {
      state: "notStarted",
      expiresAt: new Date(now + GUEST_TRIAL_MS),
      expired: false,
      daysLeft: GUEST_TRIAL_DAYS,
      hoursLeft: GUEST_TRIAL_DAYS * 24,
      msLeft: GUEST_TRIAL_MS,
    };
  }

  const msLeft = expiresAt.getTime() - now;
  if (msLeft <= 0) {
    return { state: "expired", expiresAt, expired: true, daysLeft: 0, hoursLeft: 0, msLeft: 0 };
  }

  return {
    state: "active",
    expiresAt,
    expired: false,
    daysLeft: Math.ceil(msLeft / DAY_MS),
    hoursLeft: Math.ceil(msLeft / (60 * 60 * 1000)),
    msLeft,
  };
}

/**
 * Short human label for the time left, e.g. "2 days left", "1 day left",
 * "5 hours left", "Less than an hour left". Returns "Trial expired" once over.
 */
export function guestTrialLabel(trial: GuestTrial): string {
  if (trial.expired) return "Trial expired";
  if (trial.daysLeft > 1) return `${trial.daysLeft} days left`;
  if (trial.hoursLeft > 1) return `${trial.hoursLeft} hours left`;
  if (trial.hoursLeft === 1) return "1 hour left";
  return "Less than an hour left";
}
