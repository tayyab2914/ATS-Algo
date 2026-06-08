import nodemailer, { type Transporter } from "nodemailer";

/**
 * SMTP mailer (Gmail). The transporter is created lazily and cached so we don't
 * open a connection at module load.
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

/** Email a one-time admin sign-in code. */
export async function sendAdminCodeEmail(to: string, code: string): Promise<void> {
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject: `Your admin access code: ${code}`,
    text: `Your ATS-ALGO admin access code is ${code}.\n\nIt expires in 10 minutes. If you didn't request this, you can ignore this email.`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;background:#0a0a0a;color:#fff;padding:32px;border-radius:16px;max-width:480px">
        <h1 style="font-size:20px;margin:0 0 8px">Admin access code</h1>
        <p style="color:#b5b5b5;font-size:14px;line-height:21px">Use this one-time code to unlock the admin dashboard:</p>
        <p style="font-size:36px;font-weight:700;letter-spacing:8px;color:#28b8d5;margin:16px 0">${code}</p>
        <p style="color:#6b7280;font-size:12px">This code expires in 10 minutes. If you didn't request it, ignore this email.</p>
      </div>
    `,
  });
}

/** Email a one-time login verification code to a 2FA-enabled user. */
export async function sendTwoFactorCodeEmail(to: string, code: string): Promise<void> {
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject: `Your login verification code: ${code}`,
    text: `Your ATS-ALGO login verification code is ${code}.\n\nIt expires in 10 minutes. If you didn't try to sign in, change your password — someone may have it.`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;background:#0a0a0a;color:#fff;padding:32px;border-radius:16px;max-width:480px">
        <h1 style="font-size:20px;margin:0 0 8px">Login verification code</h1>
        <p style="color:#b5b5b5;font-size:14px;line-height:21px">Enter this one-time code to finish signing in:</p>
        <p style="font-size:36px;font-weight:700;letter-spacing:8px;color:#28b8d5;margin:16px 0">${code}</p>
        <p style="color:#6b7280;font-size:12px">This code expires in 10 minutes. If you didn't try to sign in, change your password — someone may have it.</p>
      </div>
    `,
  });
}

/** Send a password-reset email containing the reset link. */
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject: "Reset your ATS-ALGO password",
    text: `We received a request to reset your password.\n\nReset it here: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;background:#0a0a0a;color:#fff;padding:32px;border-radius:16px;max-width:480px">
        <h1 style="font-size:20px;margin:0 0 8px">Reset your password</h1>
        <p style="color:#b5b5b5;font-size:14px;line-height:21px">We received a request to reset your ATS-ALGO password.</p>
        <a href="${resetUrl}" style="display:inline-block;margin-top:16px;background:#28b8d5;color:#121212;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:12px">Reset password</a>
        <p style="color:#6b7280;font-size:12px;margin-top:24px">This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email.</p>
      </div>
    `,
  });
}

/** Send the account verification email containing a confirmation link. */
export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject: "Verify your ATS-ALGO account",
    text: `Welcome to ATS-ALGO!\n\nConfirm your email address: ${verifyUrl}\n\nThis link expires in 24 hours.`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;background:#0a0a0a;color:#fff;padding:32px;border-radius:16px;max-width:480px">
        <h1 style="font-size:20px;margin:0 0 8px">Welcome to ATS-ALGO</h1>
        <p style="color:#b5b5b5;font-size:14px;line-height:21px">Confirm your email address to activate your account.</p>
        <a href="${verifyUrl}" style="display:inline-block;margin-top:16px;background:#28b8d5;color:#121212;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:12px">Verify email</a>
        <p style="color:#6b7280;font-size:12px;margin-top:24px">This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>
      </div>
    `,
  });
}
