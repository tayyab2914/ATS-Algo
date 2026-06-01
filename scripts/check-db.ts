import "dotenv/config";
import { prisma } from "../lib/db";

async function main() {
  const users = await prisma.user.count();
  const verificationTokens = await prisma.verificationToken.count();
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN" },
    select: { email: true, role: true, emailVerified: true },
  });

  console.log("Rows in Supabase:");
  console.log(JSON.stringify({ users, verificationTokens, admins }, null, 2));
}

main().then(() => process.exit(0));
