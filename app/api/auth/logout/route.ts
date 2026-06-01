import { ok } from "@/lib/api";
import { destroySession } from "@/lib/auth/session";

export async function POST() {
  await destroySession();
  return ok({ ok: true });
}
