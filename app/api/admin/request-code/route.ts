import type { NextRequest } from "next/server";
import { ok, zodFail } from "@/lib/api";
import { createAndSendAdminCode } from "@/lib/auth/admin-code";
import { adminRequestCodeSchema } from "@/lib/validation";

/**
 * Email a one-time admin code to the submitted address — but only if it belongs
 * to an admin. The response is the same whether or not the address is an admin,
 * so this can't be used to discover who the admins are.
 */
export async function POST(request: NextRequest) {
  const parsed = adminRequestCodeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  try {
    await createAndSendAdminCode(parsed.data.email);
  } catch (error) {
    // Swallow send failures rather than surfacing them, so a mail outage can't
    // be used to tell an admin address apart from a non-admin one.
    console.error("Admin code email failed:", error);
  }

  return ok({ message: "If that email belongs to an admin, a 4-digit code has been sent to it." });
}
