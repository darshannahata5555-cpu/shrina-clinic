/**
 * Bootstrap a production database: creates the default roles (if missing), a first branch and the owner login.
 *   npx tsx scripts/create-owner.ts "Owner Name" owner@clinic.in "StrongPass#2026" "SHRINA Flagship" FLG
 */
import { readFileSync, existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_ROLES, ROLE_KEYS } from "../src/lib/permissions";

if (existsSync(".env"))
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2];
  }

async function main() {
  const [name, email, password, branchName = "SHRINA Flagship", code = "FLG"] = process.argv.slice(2);
  if (!name || !email || !password || password.length < 10) {
    console.error('Usage: npx tsx scripts/create-owner.ts "Name" email password(10+ chars) ["Branch name"] [CODE]');
    process.exit(1);
  }
  const db = new PrismaClient();
  for (const key of ROLE_KEYS) {
    await db.role.upsert({ where: { key }, create: { key, ...DEFAULT_ROLES[key] }, update: {} });
  }
  const owner = await db.role.findUniqueOrThrow({ where: { key: "OWNER" } });
  const branch = (await db.branch.findFirst()) ?? (await db.branch.create({ data: { name: branchName, code: code.toUpperCase() } }));
  const user = await db.user.upsert({
    where: { email: email.toLowerCase() },
    create: { name, email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 10), roleId: owner.id, allBranches: true, branchId: branch.id },
    update: { passwordHash: await bcrypt.hash(password, 10), roleId: owner.id, allBranches: true, isActive: true },
  });
  await db.auditLog.create({ data: { userId: user.id, action: "CREATE", entity: "User", entityId: user.id, summary: `Owner account ${user.email} bootstrapped` } });
  console.log(`Owner ready: ${user.email} · branch ${branch.name} (${branch.code})`);
  await db.$disconnect();
}
main();
