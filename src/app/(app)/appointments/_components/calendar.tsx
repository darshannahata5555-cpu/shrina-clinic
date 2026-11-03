import Link from "next/link";
import type { AppointmentStatus } from "@prisma/client";
import { Plus } from "lucide-react";
import { addDaysKey, cn, fmtTime, istDateKey, istTimeKey } from "@/lib/format";
import { STATUS, type Tone } from "@/lib/status";
import { toneClass } from "@/components/ui/card";

export type CalAppt = {
  id: string;
  startAt: Date;
  endAt: Date;
  status: AppointmentStatus;
  patientName: string;
  treatment: string | null;
  doctorId: string | null;
  doctor: string | null;
  therapistId: string | null;
  therapist: string | null;
  branchCode: string;
  packageLabel: string | null;
};

const ROW_H = 44; // px per 30 minutes
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const DOT: Record<Tone, string> = {
  neutral: "bg-muted",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  violet: "bg-violet",
};
const tone = (s: string): Tone => (STATUS.appointment as Record<string, [Tone, string]>)[s]?.[0] ?? "neutral";
const short = (name: string) => {
  const [f, l] = name.split(" ");
  return l ? `${f} ${l[0]}.` : f!;
};

function Chip({ a, showBranch, compact }: { a: CalAppt; showBranch: boolean; compact?: boolean }) {
  const dim = a.status === "CANCELLED" || a.status === "NO_SHOW" || a.status === "RESCHEDULED";
  return (
    <Link
      href={`/appointments/${a.id}`}
      className={cn(
        "block overflow-hidden rounded-md border-l-[3px] border-current px-2 py-1 text-left text-[12px] leading-tight transition hover:brightness-95",
        toneClass(tone(a.status)),
        dim && "line-through opacity-60",
      )}
      title={`${fmtTime(a.startAt)} ${a.patientName} — ${a.treatment ?? "Consultation"}`}
    >
      <span className="block truncate font-semibold text-ink">
        {fmtTime(a.startAt)} {compact ? short(a.patientName) : a.patientName}
      </span>
      {!compact && (
        <span className="block truncate text-ink-2">
          {a.treatment ?? "Consultation"}
          {showBranch ? ` · ${a.branchCode}` : ""}
        </span>
      )}
    </Link>
  );
}

/** Assign side-by-side lanes to overlapping appointments within one column. */
function layout(items: CalAppt[]) {
  const sorted = [...items].sort((x, y) => x.startAt.getTime() - y.startAt.getTime());
  const out: { a: CalAppt; lane: number; lanes: number }[] = [];
  let cluster: { a: CalAppt; lane: number }[] = [];
  let clusterEnd = 0;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) out.push({ ...c, lanes });
    cluster = [];
  };
  for (const a of sorted) {
    if (cluster.length && a.startAt.getTime() >= clusterEnd) flush();
    const used = new Set(cluster.filter((c) => c.a.endAt.getTime() > a.startAt.getTime()).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ a, lane });
    clusterEnd = Math.max(clusterEnd, a.endAt.getTime());
  }
  if (cluster.length) flush();
  return out;
}

export function DayGrid({
  date,
  appts,
  columns,
  groupKey,
  openTime,
  closeTime,
  showBranch,
  canBook,
}: {
  date: string;
  appts: CalAppt[];
  columns: { id: string | null; name: string }[];
  groupKey: "doctorId" | "therapistId";
  openTime: string;
  closeTime: string;
  showBranch: boolean;
  canBook: boolean;
}) {
  let startMin = Math.floor(toMin(openTime) / 30) * 30;
  let endMin = Math.ceil(toMin(closeTime) / 30) * 30;
  for (const a of appts) {
    startMin = Math.min(startMin, Math.floor(toMin(istTimeKey(a.startAt)) / 30) * 30);
    const e = istDateKey(a.endAt) !== date ? 24 * 60 : toMin(istTimeKey(a.endAt));
    endMin = Math.max(endMin, Math.ceil(e / 30) * 30);
  }
  const rows = Math.max(2, (endMin - startMin) / 30);
  const height = rows * ROW_H;
  const isToday = date === istDateKey();
  const nowMin = toMin(istTimeKey(new Date()));
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const label = (m: number) => {
    const h = Math.floor(m / 60);
    return `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;
  };

  return (
    <div className="scroll-thin overflow-x-auto">
      <div className="grid min-w-full" style={{ gridTemplateColumns: `56px repeat(${columns.length}, minmax(160px, 1fr))` }}>
        {/* header */}
        <div className="sticky top-0 z-20 border-b border-border bg-surface-2" />
        {columns.map((c) => {
          const n = appts.filter((a) => (a[groupKey] ?? null) === c.id && !["CANCELLED", "RESCHEDULED"].includes(a.status)).length;
          return (
            <div key={c.id ?? "none"} className="sticky top-0 z-20 border-b border-l border-border bg-surface-2 px-3 py-2.5">
              <p className="truncate text-[13px] font-medium text-ink">{c.name}</p>
              <p className="text-[11px] text-muted">{n} appointment{n === 1 ? "" : "s"}</p>
            </div>
          );
        })}

        {/* time labels */}
        <div className="relative" style={{ height }}>
          {Array.from({ length: rows }, (_, i) => startMin + i * 30)
            .filter((m) => m % 60 === 0)
            .map((m) => (
              <span key={m} className="absolute right-2 -translate-y-1/2 text-[10.5px] text-muted" style={{ top: ((m - startMin) / 30) * ROW_H }}>
                {label(m)}
              </span>
            ))}
        </div>

        {columns.map((c) => {
          const items = layout(appts.filter((a) => (a[groupKey] ?? null) === c.id));
          return (
            <div
              key={c.id ?? "none"}
              className="relative border-l border-border"
              style={{
                height,
                backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${ROW_H * 2}px), repeating-linear-gradient(to bottom, transparent 0, transparent ${ROW_H}px, color-mix(in oklab, var(--border) 45%, transparent) ${ROW_H}px, color-mix(in oklab, var(--border) 45%, transparent) ${ROW_H + 1}px, transparent ${ROW_H + 1}px, transparent ${ROW_H * 2}px)`,
              }}
            >
              {canBook &&
                Array.from({ length: rows }, (_, i) => startMin + i * 30).map((m) => (
                  <Link
                    key={m}
                    href={`/appointments/new?date=${date}&time=${hhmm(m)}${c.id ? `&${groupKey === "doctorId" ? "doctorId" : "therapistId"}=${c.id}` : ""}`}
                    className="group absolute inset-x-0 flex items-center justify-center hover:bg-accent-soft/50"
                    style={{ top: ((m - startMin) / 30) * ROW_H, height: ROW_H }}
                    aria-label={`Book ${c.name} at ${hhmm(m)}`}
                  >
                    <Plus className="h-3.5 w-3.5 text-accent opacity-0 group-hover:opacity-100" />
                  </Link>
                ))}
              {items.map(({ a, lane, lanes }) => {
                const s = toMin(istTimeKey(a.startAt));
                const e = istDateKey(a.endAt) !== date ? 24 * 60 : toMin(istTimeKey(a.endAt));
                return (
                  <div
                    key={a.id}
                    className="absolute z-10 p-0.5"
                    style={{
                      top: ((s - startMin) / 30) * ROW_H,
                      height: Math.max(ROW_H * 0.8, ((e - s) / 30) * ROW_H),
                      left: `${(lane / lanes) * 100}%`,
                      width: `${100 / lanes}%`,
                    }}
                  >
                    <div className="h-full [&>a]:h-full">
                      <Chip a={a} showBranch={showBranch} compact={lanes > 2} />
                    </div>
                  </div>
                );
              })}
              {isToday && nowMin >= startMin && nowMin <= endMin && (
                <div className="pointer-events-none absolute inset-x-0 z-[15] border-t-2 border-danger" style={{ top: ((nowMin - startMin) / 30) * ROW_H }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function WeekGrid({ start, appts, showBranch, dayHref }: { start: string; appts: CalAppt[]; showBranch: boolean; dayHref: (d: string) => string }) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysKey(start, i));
  const today = istDateKey();
  return (
    <div className="grid grid-cols-1 divide-y divide-border md:grid-cols-7 md:divide-x md:divide-y-0">
      {days.map((d) => {
        const list = appts.filter((a) => istDateKey(a.startAt) === d).sort((x, y) => x.startAt.getTime() - y.startAt.getTime());
        const dt = new Date(`${d}T06:30:00Z`);
        return (
          <div key={d} className="min-h-28 md:min-h-[420px]">
            <Link href={dayHref(d)} className={cn("flex items-baseline justify-between gap-2 border-b border-border px-3 py-2 hover:bg-surface-2", d === today && "bg-accent-soft")}>
              <span className="text-[12px] font-medium text-muted uppercase">{dt.toLocaleDateString("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" })}</span>
              <span className={cn("tabular text-[15px] font-semibold", d === today ? "text-accent" : "text-ink")}>{Number(d.slice(8))}</span>
            </Link>
            <div className="space-y-1 p-1.5">
              {list.length === 0 ? <p className="px-1.5 py-2 text-[12px] text-muted/70">—</p> : list.map((a) => <Chip key={a.id} a={a} showBranch={showBranch} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MonthGrid({ month, appts, dayHref }: { month: string; appts: CalAppt[]; dayHref: (d: string) => string }) {
  const first = `${month}-01`;
  const wd = new Date(`${first}T00:00:00Z`).getUTCDay();
  const gridStart = addDaysKey(first, -((wd + 6) % 7));
  const days: string[] = [];
  for (let d = gridStart; days.length < 42; d = addDaysKey(d, 1)) {
    days.push(d);
    if (days.length % 7 === 0 && d.slice(0, 7) > month) break;
  }
  while (days.length % 7) days.push(addDaysKey(days[days.length - 1]!, 1));
  const weeks = days.length / 7;
  const today = istDateKey();
  const byDay = new Map<string, CalAppt[]>();
  for (const a of appts) {
    const k = istDateKey(a.startAt);
    byDay.set(k, [...(byDay.get(k) ?? []), a]);
  }
  return (
    <div>
      <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-center text-[11px] font-medium text-muted uppercase">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="py-2">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7" style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}>
        {days.map((d) => {
          const list = (byDay.get(d) ?? []).filter((a) => !["CANCELLED", "RESCHEDULED"].includes(a.status)).sort((x, y) => x.startAt.getTime() - y.startAt.getTime());
          const inMonth = d.slice(0, 7) === month;
          return (
            <Link
              key={d}
              href={dayHref(d)}
              className={cn("min-h-16 border-b border-r border-border p-1.5 hover:bg-surface-2 sm:min-h-28", !inMonth && "bg-surface-2/60 text-muted", d === today && "bg-accent-soft/60")}
            >
              <div className="flex items-center justify-between">
                <span className={cn("tabular text-[12.5px] font-medium", d === today ? "grid h-6 w-6 place-items-center rounded-full bg-accent text-accent-ink" : inMonth ? "text-ink" : "text-muted")}>
                  {Number(d.slice(8))}
                </span>
                {list.length > 0 && <span className="tabular rounded-full bg-surface-3 px-1.5 text-[10.5px] font-medium text-ink-2">{list.length}</span>}
              </div>
              <ul className="mt-1 hidden space-y-0.5 sm:block">
                {list.slice(0, 3).map((a) => (
                  <li key={a.id} className="flex items-center gap-1 truncate text-[11px] text-ink-2">
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[tone(a.status)])} />
                    <span className="truncate">
                      {fmtTime(a.startAt).replace(":00", "")} {short(a.patientName)}
                    </span>
                  </li>
                ))}
                {list.length > 3 && <li className="text-[11px] text-muted">+{list.length - 3} more</li>}
              </ul>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
