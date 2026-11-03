import { requireUser } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { db } from "@/lib/db";
import { navFor } from "@/lib/nav";
import { MobileNav, Sidebar } from "@/components/shell/sidebar";
import { BranchSwitcher, GlobalSearch, NotificationBell, ThemeToggle, UserMenu } from "@/components/shell/topbar";
import { Toaster } from "@/components/ui/toast";
import { getSetting } from "@/lib/settings";
import Link from "next/link";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const scope = await getBranchScope();
  const unread = await db.notification.count({ where: { userId: user.id, channel: "IN_APP", readAt: null } });
  const nav = navFor(user.permissions);
  const security = await getSetting("security");
  const needs2fa = security.require2faForOwner && user.permissions.has("users.manage") && !user.totpEnabled;

  return (
    <div className="min-h-dvh">
      <Sidebar nav={nav} />
      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur-md">
          <div className="flex h-16 items-center gap-2 px-3 sm:gap-3 sm:px-6">
            <MobileNav nav={nav} />
            {user.permissions.has("patients.view") ? <GlobalSearch /> : <div className="flex-1" />}
            <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
              <div className="hidden sm:block">
                <BranchSwitcher
                  branches={scope.branches.map((b) => ({ id: b.id, name: b.name }))}
                  currentId={scope.current?.id ?? null}
                  canAll={scope.branches.length > 1}
                />
              </div>
              <div className="hidden sm:block">
                <ThemeToggle />
              </div>
              <NotificationBell count={unread} />
              <UserMenu name={user.name} role={user.roleName} email={user.email} />
            </div>
          </div>
          {scope.branches.length > 1 && (
            <div className="border-t border-border px-3 py-2 sm:hidden">
              <BranchSwitcher
                branches={scope.branches.map((b) => ({ id: b.id, name: b.name }))}
                currentId={scope.current?.id ?? null}
                canAll={scope.branches.length > 1}
                fullWidth
              />
            </div>
          )}
        </header>
        {needs2fa && (
          <div className="no-print border-b border-warning/30 bg-warning-soft px-4 py-2.5 text-center text-[13px] text-warning sm:px-6">
            Your clinic requires two-factor authentication for admin accounts.{" "}
            <Link href="/account#security" className="font-semibold underline">
              Set it up now
            </Link>
          </div>
        )}
        <main className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 sm:py-7">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
