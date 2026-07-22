import { fail } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

/**
 * Serve a bot's stored signal CSV on demand.
 *
 * The editor deliberately doesn't receive `csvData` in its page payload — the
 * file can be megabytes, and embedding it in the RSC stream made every edit-page
 * load pay for signals the admin usually never touches. It's pulled from here
 * instead, only when a backtest re-run actually needs the signals on file.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return fail("Admin access required", 403);

  const { id } = await params;
  const bot = await prisma.bot.findUnique({ where: { id }, select: { csvData: true } });
  if (!bot) return fail("Bot not found", 404);
  if (!bot.csvData) return fail("This bot has no signal CSV on file — upload one to re-run the backtest.", 404);

  return new Response(bot.csvData, { headers: { "Content-Type": "text/csv; charset=utf-8" } });
}
