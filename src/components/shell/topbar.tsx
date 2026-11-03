"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Bell, Building2, ChevronDown, LoaderCircle, LogOut, Monitor, Moon, Search, ShieldCheck, Sun, UserRound } from "lucide-react";
import { cn, initials } from "@/lib/format";
import { logoutAction, setBranchAction } from "@/app/(app)/shell-actions";

type Hit = { id: string; code: string; fullName: string; mobile: string; branch: string; lastVisit: string | null };

export function GlobalSearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (r.ok) {
          setHits((await r.json()).patients);
          setActive(0);
          setOpen(true);
        }
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    router.push(`/patients/${h.id}`);
  };

  return (
    <div ref={box} className="relative min-w-0 flex-1 sm:max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        ref={input}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onKeyDown={(e) => {
          if (!open || !hits.length) return;
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, hits.length - 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          if (e.key === "Enter") (e.preventDefault(), go(hits[active]!));
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search name, phone or ID"
        className="h-9.5 w-full rounded-lg border border-border bg-surface pl-9 pr-14 text-sm text-ink shadow-card placeholder:text-muted/80 focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15"
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 text-[10.5px] text-muted sm:block">
        {loading ? <LoaderCircle className="my-0.5 h-3 w-3 animate-spin" /> : "⌘K"}
      </span>
      {open && q.trim().length >= 2 && (
        <div className="absolute inset-x-0 top-11 z-50 overflow-hidden rounded-xl border border-border bg-surface shadow-pop">
          {hits.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">{loading ? "Searching…" : "No patients found"}</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {hits.map((h, i) => (
                <li key={h.id}>
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(h)}
                    className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left", i === active && "bg-surface-3")}
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                      {initials(h.fullName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{h.fullName}</span>
                      <span className="block truncate text-xs text-muted">
                        {h.code} · {h.mobile} · {h.branch}
                      </span>
                    </span>
                    {h.lastVisit && <span className="hidden text-[11px] text-muted sm:block">Last visit {h.lastVisit}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/patients?q=${encodeURIComponent(q.trim())}`}
            onClick={() => setOpen(false)}
            className="block border-t border-border px-4 py-2 text-[13px] text-accent hover:bg-surface-2"
          >
            See all results in Patients →
          </Link>
        </div>
      )}
    </div>
  );
}

export function BranchSwitcher({
  branches,
  currentId,
  canAll,
  fullWidth,
}: {
  branches: { id: string; name: string }[];
  currentId: string | null;
  canAll: boolean;
  fullWidth?: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  if (branches.length <= 1) {
    return (
      <span className="hidden items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted md:inline-flex">
        <Building2 className="h-4 w-4" /> {branches[0]?.name ?? "No branch"}
      </span>
    );
  }
  return (
    <label className={cn("relative inline-flex items-center", fullWidth && "flex w-full")}>
      <Building2 className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted" />
      <select
        value={currentId ?? "all"}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            await setBranchAction(e.target.value);
            router.refresh();
          })
        }
        className={cn("h-9.5 appearance-none rounded-lg border border-border bg-surface pl-8 pr-7 text-[13px] font-medium text-ink shadow-card focus:border-accent focus:outline-none", fullWidth ? "w-full" : "max-w-56")}
        aria-label="Switch branch"
      >
        {canAll && <option value="all">All branches</option>}
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      {pending ? (
        <LoaderCircle className="pointer-events-none absolute right-2 h-3.5 w-3.5 animate-spin text-muted" />
      ) : (
        <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-muted" />
      )}
    </label>
  );
}

export function ThemeToggle() {
  const [mode, setMode] = useState<"light" | "dark" | "system">("system");
  useEffect(() => {
    try {
      setMode((localStorage.getItem("shrina-theme") as "light" | "dark" | "system") || "system");
    } catch {}
  }, []);
  const apply = (m: "light" | "dark" | "system") => {
    setMode(m);
    try {
      localStorage.setItem("shrina-theme", m);
    } catch {}
    const dark = m === "dark" || (m === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  };
  const next = mode === "light" ? "dark" : mode === "dark" ? "system" : "light";
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  return (
    <button
      onClick={() => apply(next)}
      className="grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-surface-3"
      title={`Theme: ${mode} (click for ${next})`}
      aria-label="Toggle theme"
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}

export function NotificationBell({ count }: { count: number }) {
  return (
    <Link href="/notifications" className="relative grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-surface-3" aria-label="Notifications">
      <Bell className="h-[18px] w-[18px]" />
      {count > 0 && (
        <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}

export function UserMenu({ name, role, email }: { name: string; role: string; email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 hover:bg-surface-3 sm:pr-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-ink text-xs font-semibold text-bg">{initials(name)}</span>
        <span className="hidden text-left leading-tight md:block">
          <span className="block max-w-36 truncate text-[13px] font-medium text-ink">{name}</span>
          <span className="block max-w-36 truncate text-[11px] text-muted">{role}</span>
        </span>
        <ChevronDown className="hidden h-3.5 w-3.5 text-muted md:block" />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-60 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-pop">
          <div className="border-b border-border px-3.5 py-2.5">
            <p className="truncate text-sm font-medium text-ink">{name}</p>
            <p className="truncate text-xs text-muted">{email}</p>
          </div>
          <Link href="/account" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3.5 py-2 text-sm text-ink-2 hover:bg-surface-2">
            <UserRound className="h-4 w-4" /> My account
          </Link>
          <Link href="/account#security" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3.5 py-2 text-sm text-ink-2 hover:bg-surface-2">
            <ShieldCheck className="h-4 w-4" /> Password & 2FA
          </Link>
          <div className="border-y border-border px-3.5 py-2 sm:hidden">
            <p className="mb-1.5 text-xs text-muted">Theme</p>
            <ThemeChoice />
          </div>
          <form action={logoutAction}>
            <button className="flex w-full items-center gap-2 px-3.5 py-2 text-sm text-danger hover:bg-surface-2">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function ThemeChoice() {
  const [mode, setMode] = useState<"light" | "dark" | "system">("system");
  useEffect(() => {
    try {
      setMode((localStorage.getItem("shrina-theme") as "light" | "dark" | "system") || "system");
    } catch {}
  }, []);
  const apply = (m: "light" | "dark" | "system") => {
    setMode(m);
    try {
      localStorage.setItem("shrina-theme", m);
    } catch {}
    const dark = m === "dark" || (m === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  };
  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface-3 p-0.5">
      {(["light", "dark", "system"] as const).map((m) => (
        <button key={m} onClick={() => apply(m)} className={cn("rounded-md py-1 text-xs capitalize", mode === m ? "bg-surface font-medium text-ink shadow-card" : "text-muted")}>
          {m}
        </button>
      ))}
    </div>
  );
}
