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
  const issue = error.issues[0];
  if (!issue) return fail("Invalid input", 422);

  // NAME THE FIELD. Zod's built-in messages describe a shape, not a form control — the admin bot
  // editor once rejected a save with a bare "Too big: expected array to have <=3 items", which
  // said nothing about WHICH field or WHY, and the real cause (a venue cap that had not been
  // updated) took a code read to find. Custom messages like "Name is required" already name
  // themselves, so the path is only prefixed when it is not already in the text.
  const field = issue.path.filter((p) => typeof p === "string" || typeof p === "number").join(".");
  const named = field && !issue.message.toLowerCase().includes(String(issue.path[0]).toLowerCase());
  return fail(named ? `${field}: ${issue.message}` : issue.message, 422);
}
