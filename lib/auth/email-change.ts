import crypto from "node:crypto";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db";
import { sendEmailChangeCode } from "@/lib/email";
import type { UserModel } from "@/lib/generated/prisma/models";

/**
 * Two-step email change.
 *
 * Changing the account address requires proving control of BOTH mailboxes:
 *   1. a code emailed to the CURRENT address — you own the account, and
 *   2. a code emailed to the NEW address — you own the destination.
 *
 * The pending change is staged in `EmailChangeRequest` and only committed to
 * `users.email` once both codes pass, so an abandoned or failed flow never
 * touches the live address. Availability of the new address is re-checked at
 * every step (and again immediately before the write) so a race with another
 * signup can't slip a duplicate through the `email @unique` constraint.
 */

const TTL_MS = 1000 * 60 * 15; // 15 minutes for the whole flow; reset on each send
const MAX_ATTEMPTS = 5; // wrong codes on the active stage before the request self-destructs
const RESEND_COOLDOWN_MS = 1000 * 30; // minimum gap between code sends

/** Which mailbox the user is currently proving control of. */
export type EmailChangeStage = "current" | "new";

/** A cryptographically-random, zero-padded 6-digit code. */
function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Mask an address for display: `alice@example.com` → `a****@example.com`. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  return `${local.slice(0, 1)}${"*".repeat(Math.max(local.length - 1, 1))}${email.slice(at)}`;
}

/**
 * Is `email` free — i.e. owned by nobody, or only by the requester themselves?
 * `exceptId` ignores the requester's own row so a no-op resubmit isn't flagged
 * as taken. Emails are stored lowercased; the caller normalizes.
 */
async function isEmailAvailable(email: string, exceptId: string): Promise<boolean> {
  const owner = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return !owner || owner.id === exceptId;
}

// ── Stage 0: start ────────────────────────────────────────────────────────────

export type StartResult =
  | { ok: true; sentTo: string }
  | { ok: false; reason: "SAME" | "TAKEN" | "SEND_FAILED" };

/**
 * Begin a change to `rawNewEmail`. Validates the address is different and not
 * already taken, then stages the request and emails a code to the CURRENT
 * address. Replaces any prior pending request for this user (single active flow).
 */
export async function requestEmailChange(
  userId: string,
  currentEmail: string,
  rawNewEmail: string,
): Promise<StartResult> {
  const newEmail = rawNewEmail.trim().toLowerCase();
  if (newEmail === currentEmail.trim().toLowerCase()) return { ok: false, reason: "SAME" };
  if (!(await isEmailAvailable(newEmail, userId))) return { ok: false, reason: "TAKEN" };

  const code = generateCode();
  const codeHash = await hashPassword(code);
  const expiresAt = new Date(Date.now() + TTL_MS);
  const fields = {
    newEmail,
    currentCodeHash: codeHash,
    newCodeHash: null,
    currentVerified: false,
    attempts: 0,
    expiresAt,
  };
  await prisma.emailChangeRequest.upsert({
    where: { userId },
    create: { userId, ...fields },
    update: fields,
  });

  try {
    await sendEmailChangeCode(currentEmail, code, "current");
  } catch (error) {
    // Don't strand the user with a request they can never satisfy.
    console.error("Email-change code (current) send failed:", error);
    await prisma.emailChangeRequest.deleteMany({ where: { userId } });
    return { ok: false, reason: "SEND_FAILED" };
  }
  return { ok: true, sentTo: maskEmail(currentEmail) };
}

// ── Stage 1: confirm the current address ──────────────────────────────────────

export type ConfirmCurrentResult =
  | { ok: true; sentTo: string }
  | { ok: false; reason: "NONE" | "EXPIRED" | "LOCKED" | "INVALID" | "TAKEN" | "SEND_FAILED" };

/**
 * Verify the stage-1 code (sent to the current address). On success, re-checks
 * availability, issues a stage-2 code to the NEW address, and emails it.
 */
export async function confirmCurrentEmail(
  userId: string,
  code: string,
): Promise<ConfirmCurrentResult> {
  const req = await prisma.emailChangeRequest.findUnique({ where: { userId } });
  if (!req) return { ok: false, reason: "NONE" };
  if (req.expiresAt < new Date()) {
    await prisma.emailChangeRequest.delete({ where: { userId } });
    return { ok: false, reason: "EXPIRED" };
  }
  // Idempotent: a double-submit after stage 1 already passed just lands on stage 2.
  if (req.currentVerified) return { ok: true, sentTo: maskEmail(req.newEmail) };

  if (req.attempts >= MAX_ATTEMPTS) {
    await prisma.emailChangeRequest.delete({ where: { userId } });
    return { ok: false, reason: "LOCKED" };
  }
  if (!(await verifyPassword(code, req.currentCodeHash))) {
    await prisma.emailChangeRequest.update({
      where: { userId },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, reason: "INVALID" };
  }

  // Someone may have claimed the address while stage 1 was in flight.
  if (!(await isEmailAvailable(req.newEmail, userId))) {
    await prisma.emailChangeRequest.delete({ where: { userId } });
    return { ok: false, reason: "TAKEN" };
  }

  const newCode = generateCode();
  await prisma.emailChangeRequest.update({
    where: { userId },
    data: {
      currentVerified: true,
      newCodeHash: await hashPassword(newCode),
      attempts: 0,
      expiresAt: new Date(Date.now() + TTL_MS), // fresh window for stage 2
    },
  });
  try {
    await sendEmailChangeCode(req.newEmail, newCode, "new");
  } catch (error) {
    // Recoverable: stage 1 stands, the user can resend the stage-2 code.
    console.error("Email-change code (new) send failed:", error);
    return { ok: false, reason: "SEND_FAILED" };
  }
  return { ok: true, sentTo: maskEmail(req.newEmail) };
}

// ── Stage 2: confirm the new address and commit ───────────────────────────────

export type ConfirmNewResult =
  | { ok: true; user: UserModel }
  | { ok: false; reason: "NONE" | "STAGE" | "EXPIRED" | "LOCKED" | "INVALID" | "TAKEN" };

/**
 * Verify the stage-2 code (sent to the new address) and commit the change:
 * write `users.email`, mark it verified (ownership was just proven), and clear
 * the pending request plus any stale verification link. The session is re-issued
 * by the caller. Returns the updated user so the route can refresh the cookie
 * and sync Stripe.
 */
export async function confirmNewEmail(userId: string, code: string): Promise<ConfirmNewResult> {
  const req = await prisma.emailChangeRequest.findUnique({ where: { userId } });
  if (!req) return { ok: false, reason: "NONE" };
  if (!req.currentVerified || !req.newCodeHash) return { ok: false, reason: "STAGE" };
  if (req.expiresAt < new Date()) {
    await prisma.emailChangeRequest.delete({ where: { userId } });
    return { ok: false, reason: "EXPIRED" };
  }
  if (req.attempts >= MAX_ATTEMPTS) {
    await prisma.emailChangeRequest.delete({ where: { userId } });
    return { ok: false, reason: "LOCKED" };
  }
  if (!(await verifyPassword(code, req.newCodeHash))) {
    await prisma.emailChangeRequest.update({
      where: { userId },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, reason: "INVALID" };
  }

  // Final availability check immediately before the write closes the race window.
  if (!(await isEmailAvailable(req.newEmail, userId))) {
    await prisma.emailChangeRequest.delete({ where: { userId } });
    return { ok: false, reason: "TAKEN" };
  }

  let user: UserModel;
  try {
    user = await prisma.user.update({
      where: { id: userId },
      data: { email: req.newEmail, emailVerified: new Date() },
    });
  } catch (error) {
    // Lost the race to the unique constraint after all — treat as taken.
    if ((error as { code?: string }).code === "P2002") {
      await prisma.emailChangeRequest.delete({ where: { userId } });
      return { ok: false, reason: "TAKEN" };
    }
    throw error;
  }

  // The change is committed; tidy up the staging row and any stale verify link.
  await prisma.emailChangeRequest.deleteMany({ where: { userId } });
  await prisma.verificationToken.deleteMany({ where: { userId } });
  return { ok: true, user };
}

// ── Resend ────────────────────────────────────────────────────────────────────

export type ResendResult =
  | { ok: true; stage: EmailChangeStage; sentTo: string }
  | { ok: false; reason: "NONE" | "EXPIRED" | "COOLDOWN" | "TAKEN" | "SEND_FAILED" };

/** Re-issue the code for whichever stage is currently active. */
export async function resendEmailChangeCode(
  userId: string,
  currentEmail: string,
): Promise<ResendResult> {
  const req = await prisma.emailChangeRequest.findUnique({ where: { userId } });
  if (!req) return { ok: false, reason: "NONE" };
  if (req.expiresAt < new Date()) {
    await prisma.emailChangeRequest.delete({ where: { userId } });
    return { ok: false, reason: "EXPIRED" };
  }
  if (Date.now() - req.updatedAt.getTime() < RESEND_COOLDOWN_MS) {
    return { ok: false, reason: "COOLDOWN" };
  }

  const stage: EmailChangeStage = req.currentVerified ? "new" : "current";
  const target = stage === "new" ? req.newEmail : currentEmail;
  if (stage === "new" && !(await isEmailAvailable(req.newEmail, userId))) {
    await prisma.emailChangeRequest.delete({ where: { userId } });
    return { ok: false, reason: "TAKEN" };
  }

  const code = generateCode();
  const codeHash = await hashPassword(code);
  await prisma.emailChangeRequest.update({
    where: { userId },
    data: {
      ...(stage === "new" ? { newCodeHash: codeHash } : { currentCodeHash: codeHash }),
      attempts: 0,
      expiresAt: new Date(Date.now() + TTL_MS),
    },
  });
  try {
    await sendEmailChangeCode(target, code, stage);
  } catch (error) {
    console.error("Email-change code resend failed:", error);
    return { ok: false, reason: "SEND_FAILED" };
  }
  return { ok: true, stage, sentTo: maskEmail(target) };
}

// ── Status + cancel ─────────────────────────────────────────────────────────

export type PendingEmailChange = { stage: EmailChangeStage; sentTo: string };

/**
 * The active pending change for this user, if any — used to resume the flow
 * after a page refresh. Garbage-collects an expired request on read.
 */
export async function getPendingEmailChange(
  userId: string,
  currentEmail: string,
): Promise<PendingEmailChange | null> {
  const req = await prisma.emailChangeRequest.findUnique({ where: { userId } });
  if (!req) return null;
  if (req.expiresAt < new Date()) {
    await prisma.emailChangeRequest.delete({ where: { userId } });
    return null;
  }
  const stage: EmailChangeStage = req.currentVerified ? "new" : "current";
  return { stage, sentTo: maskEmail(stage === "new" ? req.newEmail : currentEmail) };
}

/** Abandon any pending change for this user. */
export async function cancelEmailChange(userId: string): Promise<void> {
  await prisma.emailChangeRequest.deleteMany({ where: { userId } });
}
