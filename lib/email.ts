import nodemailer, { type Transporter } from "nodemailer";
import { BRAND_NAME, emailLogoUrl } from "@/lib/brand";

/**
 * SMTP mailer (Gmail). The transporter is created lazily and cached so we don't
 * open a connection at module load.
 *
 * Every message goes out through {@link send}, which is the only place the sender
 * identity and the message chrome are decided. Before it existed each function set
 * `from` to a bare address, so the inbox showed whatever the Google account happened
 * to be called — the mailbox name, usually — instead of the product.
 *
 * ── The sender NAME and AVATAR, on Gmail ─────────────────────────────────────
 * {@link fromHeader} sets the display name to the product, and on most transports
 * that is what an inbox shows. Sending through smtp.gmail.com with an app password
 * it is NOT: Gmail rewrites the From display name to the profile name of the Google
 * account `SMTP_USER` signs in as, so a mailbox still named after a person shows up
 * as that person even though this file sent "ATS-ALGO". The fix is to rename the
 * sending Google account, or to send from a Workspace address on the product's own
 * domain — both outside the application, like the avatar below.
 *
 * The circular avatar Gmail draws next to the sender CANNOT be set from an SMTP
 * message either; nothing in this file can influence it. It comes from one of two
 * places, both outside the application:
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

/**
 * The masthead every message opens with.
 *
 * Falls back to type when no logo URL is configured, and that fallback is the
 * default. An email client needs an ABSOLUTE url and most will not render SVG, so a
 * guessed path here would be a broken image in every message the platform sends —
 * clean type beats that. Set `BRAND_EMAIL_LOGO_URL` to a hosted PNG to switch it on.
 */
function masthead(): string {
  const logo = emailLogoUrl();
  if (logo) {
    return `<img src="${logo}" alt="${BRAND_NAME}" height="32" style="display:block;height:32px;width:auto;border:0;margin:0 0 20px" />`;
  }
  return `<p style="margin:0 0 20px;font-size:15px;font-weight:700;letter-spacing:4px;color:${ACCENT}">${BRAND_NAME}</p>`;
}

/**
 * Wrap body HTML in the branded card every message shares. Inline styles only:
 * `<style>` blocks and external stylesheets are stripped by most clients.
 */
function shell(inner: string): string {
  return `
      <div style="font-family:Inter,Arial,sans-serif;background:${BG};color:#fff;padding:32px;border-radius:16px;max-width:480px">
        ${masthead()}
        ${inner}
        <p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #2a2a2a;color:#6b7280;font-size:11px">
          ${BRAND_NAME} — automated trading. This is an automated message; replies are not monitored.
        </p>
      </div>
    `;
}

/** Send one branded message. The single place `from` is decided. */
async function send(options: { to: string; subject: string; text: string; html: string }): Promise<void> {
  await getTransporter().sendMail({
    from: fromHeader(),
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: shell(options.html),
  });
}

/** A big spaced-out one-time code — the same treatment in every code email. */
const codeBlock = (code: string) =>
  `<p style="font-size:36px;font-weight:700;letter-spacing:8px;color:${ACCENT};margin:16px 0">${code}</p>`;

/**
 * Escape a value before it goes into an HTML email body.
 *
 * Needed because one message — the access-request notification — carries a
 * string the sender chose themselves (their display name). Every other email in
 * this file interpolates only values we generated, so this is the single place
 * untrusted text reaches markup: unescaped, a member could name themselves an
 * `<a>` and have it render as a link inside a branded message to every admin.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

/**
 * Tell the admins that a member has asked for access.
 *
 * `to` may be a comma-joined list — every admin address at once, since any of
 * them can action it. Sent best-effort by the request route: the request row is
 * already committed before this runs, so a dead mailbox loses the notification,
 * never the request itself.
 */
export async function sendSubscriptionRequestEmail(
  to: string,
  member: { name: string | null; email: string },
  link: string,
): Promise<void> {
  const name = member.name?.trim();
  const who = name ? `${name} (${member.email})` : member.email;
  // The name is member-supplied; the plaintext part can take it verbatim, the
  // HTML part cannot.
  const whoHtml = escapeHtml(who);
  await send({
    to,
    subject: `Access request from ${member.email}`,
    text: `${who} has requested access to ${BRAND_NAME}.\n\nGrant or decline it from Members Management: ${link}`,
    html: `
        <h1 style="font-size:20px;margin:0 0 8px">New access request</h1>
        <p style="color:#b5b5b5;font-size:14px;line-height:21px">
          <span style="color:#fff;font-weight:600">${whoHtml}</span> has requested access to ${BRAND_NAME}.
        </p>
        ${cta(link, "Open Members Management")}
        <p style="color:#6b7280;font-size:12px;margin-top:24px">Grant access for a fixed term or for good, or decline the request — both from the member's row menu.</p>
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
