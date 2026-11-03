import "server-only";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { verifyToken } from "@/lib/auth";

export const KIOSK_COOKIE = "shrina_kiosk";

/** The branch this device is registered to as an attendance kiosk, or null. */
export async function kioskBranchId(): Promise<string | null> {
  const t = await verifyToken<{ kiosk?: string }>((await cookies()).get(KIOSK_COOKIE)?.value);
  if (!t?.kiosk) return null;
  const b = await db.branch.findFirst({ where: { id: t.kiosk, isActive: true }, select: { id: true } });
  return b?.id ?? null;
}
