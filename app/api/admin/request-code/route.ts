import { ok, fail } from "@/lib/api";
import { createAndSendAdminCode } from "@/lib/auth/admin-code";

/** Generate a one-time admin code and email it to the configured admin. */
export async function POST() {
  try {
    await createAndSendAdminCode();
  } catch (error) {
    console.error("Admin code email failed:", error);
    return fail("Could not send the code. Please try again.", 500);
  }
  return ok({ sent: true });
}
