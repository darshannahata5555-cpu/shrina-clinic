import Link from "next/link";
import { MonitorSmartphone } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { Kiosk, KioskSetup } from "./kiosk";
import { kioskBranchId } from "./kiosk-lib";

export const metadata = { title: "Attendance kiosk" };

export default async function KioskPage() {
  const [branchId, settings, user] = await Promise.all([kioskBranchId(), getSetting("attendance"), getCurrentUser()]);
  const canManage = !!user?.permissions.has("attendance.manage");

  if (!branchId) {
    const branches = canManage
      ? await db.branch.findMany({
          where: { isActive: true, ...(user!.allBranches ? {} : { id: { in: [user!.branchId, ...user!.extraBranchIds].filter(Boolean) as string[] } }) },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [];
    return (
      <main className="grid min-h-dvh place-items-center bg-bg px-5 py-10">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-7 shadow-pop">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent">
              <MonitorSmartphone className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-lg font-semibold">Set up attendance kiosk</h1>
              <p className="text-[13px] text-muted">This device isn&apos;t registered as a kiosk yet.</p>
            </div>
          </div>
          {canManage ? (
            <KioskSetup branches={branches} />
          ) : (
            <div className="space-y-4 text-sm text-ink-2">
              <p>A manager with attendance rights must sign in on this device once to register it for a branch. After that, staff can check in here without logging in.</p>
              <Link href="/login?next=/attendance/kiosk" className="inline-flex h-10 items-center rounded-lg bg-accent px-4 font-medium text-accent-ink hover:bg-accent-hover">
                Manager sign-in
              </Link>
            </div>
          )}
        </div>
      </main>
    );
  }

  const branch = await db.branch.findUniqueOrThrow({ where: { id: branchId }, select: { name: true } });
  return <Kiosk branchName={branch.name} pinEnabled={settings.pinEnabled} qrEnabled={settings.qrEnabled} canLock={canManage} />;
}
