import Link from "next/link";
import { Archive, Banknote, Building2, DatabaseBackup, KeyRound, ReceiptText, ScrollText, ShieldCheck, Store, Users, Bell } from "lucide-react";
import { canAny, requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page";
import type { Permission } from "@/lib/permissions";

export const metadata = { title: "Settings & Permissions" };

const SECTIONS: { href: string; title: string; body: string; icon: React.ComponentType<{ className?: string }>; any: Permission[] }[] = [
  { href: "/settings/users", title: "Users & access", body: "Logins for staff, their role, branches and individual permission overrides.", icon: Users, any: ["users.manage"] },
  { href: "/settings/roles", title: "Roles & permissions", body: "What each role (Doctor, Receptionist, Accounts…) can see and do by default.", icon: KeyRound, any: ["users.manage"] },
  { href: "/settings/clinic", title: "Clinic, GST & invoices", body: "Legal name, GSTIN, invoice numbering, GST rates, discount limits, invoice footer.", icon: ReceiptText, any: ["settings.manage"] },
  { href: "/payroll/settings", title: "Payroll & attendance rules", body: "Working-day basis, weekly offs, late & half-day rules, overtime, leave entitlements, check-in methods.", icon: Banknote, any: ["settings.manage", "payroll.manage"] },
  { href: "/notifications?tab=rules", title: "Reminders & messaging", body: "WhatsApp / SMS / email reminder timings and message templates.", icon: Bell, any: ["notifications.manage"] },
  { href: "/branches", title: "Branches", body: "Add branches, opening hours, GSTIN and GPS check-in point.", icon: Building2, any: ["branches.manage"] },
  { href: "/treatments?tab=catalog", title: "Treatment catalogue", body: "Treatments, prices, session counts, validity and product usage per session.", icon: Store, any: ["treatments.manage"] },
  { href: "/settings/audit", title: "Activity log", body: "Every login, edit, deletion, approval and financial change — who, what, when.", icon: ScrollText, any: ["audit.view"] },
  { href: "/settings/recycle-bin", title: "Recycle bin", body: "Restore patients, invoices, expenses and other records that were deleted.", icon: Archive, any: ["recycle.manage"] },
  { href: "/settings/backups", title: "Backups & data", body: "Database backups, restore guidance and full data export.", icon: DatabaseBackup, any: ["settings.manage"] },
  { href: "/settings/clinic#security", title: "Security", body: "Two-factor sign-in policy. Your own password & 2FA are under My account.", icon: ShieldCheck, any: ["settings.manage"] },
];

export default async function SettingsPage() {
  const user = await requirePermission(["settings.manage", "users.manage", "audit.view", "recycle.manage"]);
  const visible = SECTIONS.filter((s) => canAny(user, s.any));
  return (
    <>
      <PageHeader title="Settings & Permissions" description="Configure how SHRINA's system works for every branch and role." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((s) => (
          <Link key={s.href} href={s.href} className="group flex gap-3.5 rounded-xl border border-border bg-surface p-4 shadow-card transition-colors hover:border-border-strong">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
              <s.icon className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-ink group-hover:text-accent">{s.title}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-muted">{s.body}</span>
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
