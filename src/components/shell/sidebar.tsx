"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Banknote, Bell, Building2, CalendarDays, CalendarOff, ChartColumn, Clock, LayoutDashboard, Megaphone, Menu,
  Package, Receipt, Settings, Sparkles, Syringe, UserCog, Users, Wallet, X, PiggyBank,
} from "lucide-react";
import type { NavGroup } from "@/lib/nav";
import { cn } from "@/lib/format";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  patients: Users,
  appointments: CalendarDays,
  treatments: Sparkles,
  sessions: Syringe,
  billing: Receipt,
  payments: Wallet,
  expenses: PiggyBank,
  inventory: Package,
  staff: UserCog,
  attendance: Clock,
  leaves: CalendarOff,
  payroll: Banknote,
  leads: Megaphone,
  reports: ChartColumn,
  branches: Building2,
  notifications: Bell,
  settings: Settings,
};

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-2">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-[13px] font-bold tracking-wider text-accent-ink">S</span>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-[0.18em] text-ink">SHRINA</span>
        <span className="block text-[10.5px] tracking-wide text-muted">Clinic Management</span>
      </span>
    </Link>
  );
}

function NavList({ nav, onNavigate }: { nav: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-5">
      {nav.map((g, gi) => (
        <div key={gi}>
          {g.label && <p className="mb-1.5 px-3 text-[11px] font-medium tracking-wider text-muted/80 uppercase">{g.label}</p>}
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const Icon = ICONS[item.icon] ?? LayoutDashboard;
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-[13.5px] transition-colors",
                      active ? "bg-surface font-medium text-ink shadow-card ring-1 ring-border" : "text-ink-2 hover:bg-surface-3 hover:text-ink",
                    )}
                  >
                    <Icon className={cn("h-[17px] w-[17px] shrink-0", active ? "text-accent" : "text-muted")} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ nav }: { nav: NavGroup[] }) {
  return (
    <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-bg lg:flex">
      <div className="flex h-16 items-center px-3">
        <Brand />
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto px-3 pb-6 pt-2">
        <NavList nav={nav} />
      </div>
    </aside>
  );
}

export function MobileNav({ nav }: { nav: NavGroup[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <>
      <button onClick={() => setOpen(true)} className="grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-surface-3 lg:hidden" aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col border-r border-border bg-bg shadow-pop">
            <div className="flex h-16 items-center justify-between px-3">
              <Brand />
              <button onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-3" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="scroll-thin flex-1 overflow-y-auto px-3 pb-6">
              <NavList nav={nav} onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
