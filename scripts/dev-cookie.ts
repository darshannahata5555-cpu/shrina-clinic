/**
 * DEV ONLY — print a valid session cookie for a user, so pages can be checked with curl:
 *   COOKIE=$(npx tsx scripts/dev-cookie.ts owner@shrina.in)
 *   curl -s -b "$COOKIE" http://localhost:4600/patients -o /dev/null -w "%{http_code}\n"
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2];
}

async function main() {
  const email = process.argv[2] ?? "owner@shrina.in";
  const db = new PrismaClient();
  const u = await db.user.findUniqueOrThrow({ where: { email } });
  const token = await new SignJWT({ uid: u.id, sv: u.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
  process.stdout.write(`shrina_session=${token}`);
  await db.$disconnect();
}
main();
