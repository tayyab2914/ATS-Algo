import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

/**
 * Accept a metrics file (JSON/CSV) from the Admin Staging Dashboard. Validates
 * the type/content, assigns the next version, and records the upload. The file
 * itself isn't stored — this drives the Upload History + Date Status panels.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return fail("Admin access required", 403);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail("No file provided", 400);

  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext !== "json" && ext !== "csv") return fail("Only JSON or CSV files are allowed", 422);

  // Content check decides SUCCESS vs FAILED.
  const text = await file.text().catch(() => "");
  let status: "SUCCESS" | "FAILED" = "SUCCESS";
  if (ext === "json") {
    try {
      JSON.parse(text);
    } catch {
      status = "FAILED";
    }
  } else if (!text.trim()) {
    status = "FAILED";
  }

  const count = await prisma.metricUpload.count();
  const version = `v${String(count + 1).padStart(2, "0")}`;

  const upload = await prisma.metricUpload.create({
    data: { filename: file.name, version, status },
  });

  return ok({ upload }, 201);
}
