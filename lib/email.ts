import { readFileSync } from "node:fs";
import { join } from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { BRAND_EMAIL_LOGO_PATH, BRAND_NAME, emailLogoUrl } from "@/lib/brand";

/**
 * SMTP mailer (Gmail). The transporter is created lazily and cached so we don't
 * open a connection at module load.
 *
 * Every message goes out through {@link send}, which is the only place the sender
 * identity and the message chrome are decided. Before it existed each function set
 * `from` to a bare address, so the inbox showed whatever the Google account happened
 * to be called — the mailbox name, usually — instead of the product.
 *
 * ── The sender NAME ──────────────────────────────────────────────────────────
 * {@link fromHeader} sets it to the product, and that IS what the inbox shows —
 * but only for a bare `SMTP_FROM`. A full `"Name <addr>"` in the environment is
 * used verbatim and wins, which is how production spent a release sending as
 * "Adrian Trading System": the app was doing the right thing and the env file was
 * overriding it. Keep `SMTP_FROM` a bare address unless the name is meant to
 * differ from the brand.
 *
 * ── The sender AVATAR ────────────────────────────────────────────────────────
 * The circular avatar Gmail draws next to the sender CANNOT be set from an SMTP
 * message; nothing in this file can influence it. It comes from one of two places,
 * both outside the application:
 *
 *   1. The profile photo on the Google account `SMTP_USER` signs in as. Setting
 *      that photo to the ATS mark is the whole fix, and it takes effect at once.
 *      (Workspace: admin.google.com → Directory → Users → the sending user → photo.)
 *   2. A BIMI DNS record on the sending domain, plus a Verified Mark Certificate.
 *      That is what shows the logo to recipients outside Gmail too, and it requires
 *      DMARC at enforcement first.
 *
 * What this file CAN control — and now does — is the display name and the logo
 * inside the message body. See `BRAND_EMAIL_LOGO_URL` in lib/brand.ts for the latter.
 */
let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT ?? 587);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

/**
 * The `From` header: the product name, then the address. This is the string an
 * inbox shows in its sender column.
 *
 * `SMTP_FROM` may already be a full "Name <addr>" header, in which case it is used
 * verbatim — an operator who has spelled out a sender has overridden this on
 * purpose. A bare address gets the brand name attached.
 */
function fromHeader(): string {
  const configured = (process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "").trim();
  if (!configured) return BRAND_NAME;
  if (configured.includes("<")) return configured;
  return `"${BRAND_NAME}" <${configured}>`;
}

const BG = "#0a0a0a";
const ACCENT = "#28b8d5";

/** Content-ID the masthead `<img>` points at when the logo travels with the message. */
const LOGO_CID = "ats-algo-logo";

/**
 * The logo file, read off disk once and kept, or null when it cannot be read.
 *
 * `undefined` means "not tried yet" and `null` means "tried and failed", so a
 * missing file costs one syscall for the life of the process rather than one per
 * message. Read from `public/` — the same file the site serves — so there is one
 * piece of artwork to replace, not two.
 */
let logoFile: Buffer | null | undefined;

function embeddedLogo(): Buffer | null {
  if (logoFile !== undefined) return logoFile;
  try {
    logoFile = readFileSync(join(process.cwd(), "public", BRAND_EMAIL_LOGO_PATH.replace(/^\/+/, "")));
  } catch {
    // A deployment that serves the app from somewhere the file isn't. Not fatal:
    // the masthead falls back, and an email is still perfectly readable as type.
    logoFile = null;
  }
  return logoFile;
}

/**
 * The masthead every message opens with, and the attachment it needs (if any).
 *
 * EMBEDDED BY DEFAULT, and that is the whole point. It used to be `<img src>`
 * pointing at `https://<APP_URL>/brand/ats-email-logo.png` — a correct, publicly
 * reachable URL that Gmail nonetheless drew as blank space, because a REMOTE image
 * is a tracking pixel as far as a mail client is concerned and gets blocked on
 * sight from a sender the recipient has never corresponded with. Nothing about the
 * URL can fix that; the image has to travel INSIDE the message. So it does: the
 * PNG rides along as a related part and the `<img>` addresses it by Content-ID,
 * which every mail client renders without asking.
 *
 * The order is deliberate:
 *  1. `BRAND_EMAIL_LOGO_URL`, when set — an operator hosting the artwork elsewhere
 *     has said so on purpose, and that intent outranks our default. (It is a remote
 *     image, so it inherits the blocking described above.)
 *  2. The embedded file. The default, and the only option that always renders.
 *  3. Type. Reached only when the file cannot be read; renders everywhere.
 */
function masthead(): { html: string; logo: Buffer | null } {
  const style = "display:block;height:32px;width:auto;border:0;margin:0 0 20px";

  const configured = emailLogoUrl();
  if (configured) {
    return { html: `<img src="${configured}" alt="${BRAND_NAME}" height="32" style="${style}" />`, logo: null };
  }

  const embedded = embeddedLogo();
  if (embedded) {
    return { html: `<img src="cid:${LOGO_CID}" alt="${BRAND_NAME}" height="32" style="${style}" />`, logo: embedded };
  }

  return {
    html: `<p style="margin:0 0 20px;font-size:15px;font-weight:700;letter-spacing:4px;color:${ACCENT}">${BRAND_NAME}</p>`,
    logo: null,
  };
}

/**
 * Wrap body HTML in the branded card every message shares. Inline styles only:
 * `<style>` blocks and external stylesheets are stripped by most clients.
 *
 * Returns the attachment alongside the markup, because the two cannot be decided
 * apart: the `cid:` reference is only valid if the part it names is actually on the
 * message.
 */
function shell(inner: string): { html: string; logo: Buffer | null } {
  const brand = masthead();
  return {
    logo: brand.logo,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;background:${BG};color:#fff;padding:32px;border-radius:16px;max-width:480px">
        ${brand.html}
        ${inner}
        <p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #2a2a2a;color:#6b7280;font-size:11px">
          ${BRAND_NAME} — automated trading. This is an automated message; replies are not monitored.
        </p>
      </div>
    `,
  };
}

/** Send one branded message. The single place `from` is decided. */
async function send(options: { to: string; subject: string; text: string; html: string }): Promise<void> {
  const body = shell(options.html);
  await getTransporter().sendMail({
    from: fromHeader(),
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: body.html,
    // `cid` + `contentDisposition: "inline"` is what makes this a RELATED part the
    // markup can address, rather than a file chip hanging off the bottom of the
    // message. Omitted entirely when there is no logo, so no message carries an
    // empty attachments array.
    ...(body.logo
      ? {
          attachments: [
            {
              filename: "ats-algo.png",
              content: body.logo,
              cid: LOGO_CID,
              contentType: "image/png",
              contentDisposition: "inline" as const,
            },
          ],
        }
      : {}),
  });
}

/** A big spaced-out one-time code — the same treatment in every code email. */
const codeBlock = (code: string) =>
  `<p style="font-size:36px;font-weight:700;letter-spacing:8px;color:${ACCENT};margin:16px 0">${code}</p>`;

/** The primary action button — the same treatment in every link email. */
const cta = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;margin-top:16px;background:${ACCENT};color:#121212;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:12px">${label}</a>`;

/** Email a one-time admin sign-in code. */
export async function sendAdminCodeEmail(to: string, code: string): Promise<void> {
  await send({
    to,
    subject: `${BRAND_NAME} admin access code: ${code}`,
    text: `Your ${BRAND_NAME} admin access code is ${code}.\n\nIt expires in 10 minutes. If you didn't request this, you can ignore this email.`,
    html: `
        <h1 style="font-size:20px;margin:0 0 8px">Admin access code</h1>
        <p style="color:#b5b5b5;font-size:14px;line-height:21px">Use this one-time code to verify your admin sign-in:</p>
        ${codeBlock(code)}
        <p style="color:#6b7280;font-size:12px">This code expires in 10 minutes. If you didn't request it, ignore this email.</p>
    `,
  });
}

/** Email a one-time login verification code to a 2FA-enabled user. */
export async function sendTwoFactorCodeEmail(to: string, code: string): Promise<void> {
  await send({
    to,
    subject: `${BRAND_NAME} login verification code: ${code}`,
    text: `Your ${BRAND_NAME} login verification code is ${code}.\n\nIt expires in 10 minutes. If you didn't try to sign in, change your password — someone may have it.`,
    html: `
        <h1 style="font-size:20px;margin:0 0 8px">Login verification code</h1>
        <p style="color:#b5b5b5;font-size:14px;line-height:21px">Enter this one-time code to finish signing in:</p>
        ${codeBlock(code)}
        <p style="color:#6b7280;font-size:12px">This code expires in 10 minutes. If you didn't try to sign in, change your password — someone may have it.</p>
    `,
  });
}

/** Send a password-reset email containing the reset link. */
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await send({
    to,
    subject: `Reset your ${BRAND_NAME} password`,
    text: `We received a request to reset your password.\n\nReset it here: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
    html: `
        <h1 style="font-size:20px;margin:0 0 8px">Reset your password</h1>
        <p style="color:#b5b5b5;font-size:14px;line-height:21px">We received a request to reset your ${BRAND_NAME} password.</p>
        ${cta(resetUrl, "Reset password")}
        <p style="color:#6b7280;font-size:12px;margin-top:24px">This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email.</p>
    `,
  });
}

/**
 * Email a team invitation, tailored to the granted role:
 *  - ADMIN  → "you've been invited as an admin", CTA to the admin sign-in.
 *  - USER   → "you've been added as a member", CTA to create their account.
 */
export async function sendTeamInviteEmail(
  to: string,
  role: "ADMIN" | "USER",
  link: string,
): Promise<void> {
  const isAdminInvite = role === "ADMIN";
  const subject = isAdminInvite
    ? `You've been invited as an admin on ${BRAND_NAME}`
    : `You've been added to the ${BRAND_NAME} team`;
  const heading = isAdminInvite ? `You're now an ${BRAND_NAME} admin` : `Welcome to the ${BRAND_NAME} team`;
  const body = isAdminInvite
    ? "An administrator has granted you admin access. Open the admin sign-in to request your one-time access code and get started."
    : "An administrator has added you as a team member. Create your account to access your trading dashboard.";
  const label = isAdminInvite ? "Go to admin sign-in" : "Create your account";

  await send({
    to,
    subject,
    text: `${body}\n\n${label}: ${link}\n\nIf you weren't expecting this, you can ignore this email.`,
    html: `
        <h1 style="font-size:20px;margin:0 0 8px">${heading}</h1>
        <p style="color:#b5b5b5;font-size:14px;line-height:21px">${body}</p>
        ${cta(link, label)}
        <p style="color:#6b7280;font-size:12px;margin-top:24px">If you weren't expecting this invitation, you can safely ignore this email.</p>
    `,
  });
}

/**
 * Email a one-time code for the two-step email-change flow.
 *  - "current" goes to the EXISTING address: prove you own the account.
 *  - "new"     goes to the DESTINATION address: prove you own where it's headed.
 */
export async function sendEmailChangeCode(
  to: string,
  code: string,
  purpose: "current" | "new",
): Promise<void> {
  const heading = purpose === "current" ? "Confirm your email change" : "Verify your new email";
  const lead =
    purpose === "current"
      ? `Someone (hopefully you) asked to change the email on your ${BRAND_NAME} account. Enter this code to confirm it's you:`
      : `Enter this code to confirm this is the new email address for your ${BRAND_NAME} account:`;
  const footer =
    purpose === "current"
      ? "If you didn't request this, ignore this email and your address stays unchanged."
      : "If you didn't request this, you can safely ignore this email.";

  await send({
    to,
    subject: `${BRAND_NAME} email change code: ${code}`,
    text: `${lead}\n\n${code}\n\nThis code expires in 15 minutes. ${footer}`,
    html: `
        <h1 style="font-size:20px;margin:0 0 8px">${heading}</h1>
        <p style="color:#b5b5b5;font-size:14px;line-height:21px">${lead}</p>
        ${codeBlock(code)}
        <p style="color:#6b7280;font-size:12px">This code expires in 15 minutes. ${footer}</p>
    `,
  });
}

/** Send the account verification email containing a confirmation link. */
export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
  await send({
    to,
    subject: `Verify your ${BRAND_NAME} account`,
    text: `Welcome to ${BRAND_NAME}!\n\nConfirm your email address: ${verifyUrl}\n\nThis link expires in 24 hours.`,
    html: `
        <h1 style="font-size:20px;margin:0 0 8px">Welcome to ${BRAND_NAME}</h1>
        <p style="color:#b5b5b5;font-size:14px;line-height:21px">Confirm your email address to activate your account.</p>
        ${cta(verifyUrl, "Verify email")}
        <p style="color:#6b7280;font-size:12px;margin-top:24px">This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>
    `,
  });
}
