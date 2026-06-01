import { NextResponse } from "next/server";
import type { ZodError } from "zod";

/** JSON success response. */
export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

/** JSON error response with a user-facing message. */
export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Turn a Zod validation error into a 422 with the first readable message. */
export function zodFail(error: ZodError) {
  return fail(error.issues[0]?.message ?? "Invalid input", 422);
}
