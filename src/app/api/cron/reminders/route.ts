import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runReminderCycle } from "@/lib/reminders";

/**
 * Reminder cron — expires overdue packages, queues due reminders and sends due WhatsApp/SMS/email messages.
 * Auth: `Authorization: Bearer $CRON_SECRET` (or `?secret=$CRON_SECRET`).
 *
 * Run every 15 minutes, e.g.
 *   crontab:      *\/15 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://clinic.example.com/api/cron/reminders
 *   vercel.json:  { "crons": [{ "path": "/api/cron/reminders", "schedule": "*\/15 * * * *" }] }
 *                 (Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when CRON_SECRET is set.)
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const given = header || req.nextUrl.searchParams.get("secret") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function run(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runReminderCycle(new Date())) });
  } catch (e) {
    console.error("[cron/reminders]", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
