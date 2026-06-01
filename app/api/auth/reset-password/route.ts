import type { NextRequest } from "next/server";
import { ok, fail, zodFail } from "@/lib/api";
import { consumePasswordReset } from "@/lib/auth/password-reset";
import { resetPasswordSchema } from "@/lib/validation";

/** Complete a password reset using the emailed token. */
export async function POST(request: NextRequest) {
  const parsed = resetPasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const success = await consumePasswordReset(parsed.data.token, parsed.data.password);
  if (!success) return fail("This reset link is invalid or has expired.", 400);

  return ok({ message: "Your password has been reset. You can now log in." });
}
