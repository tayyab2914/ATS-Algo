import "dotenv/config";
import { hashPassword } from "../lib/auth/password";
import { prisma } from "../lib/db";

const BASE = "http://localhost:3000";
const log = (label: string, ...rest: unknown[]) => console.log(`• ${label}`, ...rest);

async function adminCookie(): Promise<string> {
  await prisma.adminLoginCode.deleteMany({});
  await prisma.adminLoginCode.create({
    data: { codeHash: await hashPassword("4321"), expiresAt: new Date(Date.now() + 600000) },
  });
  const res = await fetch(`${BASE}/api/admin/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "4321" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function uploadFile(cookie: string, name: string, content: string, type: string) {
  const form = new FormData();
  form.append("file", new File([content], name, { type }));
  const res = await fetch(`${BASE}/api/admin/uploads`, { method: "POST", headers: { cookie }, body: form });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, body: data };
}

async function main() {
  const cookie = await adminCookie();
  log("admin unlock cookie:", cookie ? "obtained" : "MISSING");

  // 1. Valid JSON → SUCCESS.
  let r = await uploadFile(cookie, "bot_metrics_v1.json", JSON.stringify({ ok: true }), "application/json");
  log("upload valid json:", r.status, r.body?.upload?.status, r.body?.upload?.version);

  // 2. Broken JSON → FAILED.
  r = await uploadFile(cookie, "broken.json", "{ not valid", "application/json");
  log("upload broken json:", r.status, r.body?.upload?.status);

  // 3. CSV with content → SUCCESS.
  r = await uploadFile(cookie, "performance.csv", "a,b\n1,2", "text/csv");
  log("upload csv:", r.status, r.body?.upload?.status);

  // 4. Disallowed type → 422.
  r = await uploadFile(cookie, "notes.txt", "hello", "text/plain");
  log("upload .txt (rejected):", r.status, r.body?.error);

  // 5. No admin auth → 403.
  const noAuth = new FormData();
  noAuth.append("file", new File(["{}"], "x.json", { type: "application/json" }));
  r = { status: (await fetch(`${BASE}/api/admin/uploads`, { method: "POST", body: noAuth })).status, body: {} };
  log("upload no auth:", r.status);

  // 6. Page renders + reflects uploads.
  const page = await fetch(`${BASE}/admin/dashboard`, { headers: { cookie } });
  const html = await page.text();
  log("/admin/dashboard:", page.status);
  const markers = [
    "Admin Staging Dashboard",
    "Upload Metrics",
    "Update Bot Cycle",
    "Dashboard Content Control",
    "Date Status Panel",
    "Upload History",
    "bot_metrics_v1.json",
    "Total Uploads",
  ];
  for (const m of markers) log(`  ${html.includes(m) ? "✓" : "✗"} ${m}`);

  const count = await prisma.metricUpload.count();
  log("metric_uploads rows in DB:", count);

  process.exit(0);
}

main();
