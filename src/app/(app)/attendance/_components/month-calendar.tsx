import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn, fmtMonth, fmtTime, istDateKey, minutesToHours, weekdayOfKey } from "@/lib/format";
import type { DayCell } from "@/lib/attendance";

const CELL: Record<string, string> = {
  PRESENT: "bg-success-soft text-success",
  HALF_DAY: "bg-warning-soft text-warning",
  ABSENT: "bg-danger-soft text-danger",
  LEAVE: "bg-violet-soft text-violet",
  WEEK_OFF: "bg-surface-3 text-muted",
  HOLIDAY: "bg-info-soft text-info",
  NOT_IN: "bg-surface-2 text-muted",
  UPCOMING: "bg-surface text-muted/60",
};
const LABEL: Record<string, string> = {
  PRESENT: "Present",
  HALF_DAY: "Half day",
  ABSENT: "Absent",
  LEAVE: "Leave",
  WEEK_OFF: "Week off",
  HOLIDAY: "Holiday",
  NOT_IN: "Not in yet",
  UPCOMING: "",
};

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function MonthNav({ month, hrefFor }: { month: string; hrefFor: (m: string) => string }) {
  const current = istDateKey().slice(0, 7);
  return (
    <div className="inline-flex items-center gap-1">
      <Link href={hrefFor(shiftMonth(month, -1))} scroll={false} className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-surface hover:bg-surface-2" aria-label="Previous month">
        <ChevronLeft className="h-4 w-4" />
      </Link>
      <span className="min-w-32 text-center text-sm font-medium">{fmtMonth(new Date(`${month}-15T00:00:00Z`))}</span>
      <Link
        href={hrefFor(shiftMonth(month, 1))}
        scroll={false}
        className={cn("grid h-8 w-8 place-items-center rounded-lg border border-border bg-surface hover:bg-surface-2", month >= current && "pointer-events-none opacity-40")}
        aria-label="Next month"
      >
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

/** Calendar grid of one employee's month. */
export function MonthCalendar({ days }: { days: DayCell[] }) {
  const lead = days.length ? weekdayOfKey(days[0]!.key) : 0;
  const today = istDateKey();
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }).map((_, i) => (
          <div key={`x${i}`} />
        ))}
        {days.map((d) => (
          <div
            key={d.key}
            title={[LABEL[d.status], d.holidayName, d.checkIn && `In ${fmtTime(d.checkIn)}`, d.checkOut && `Out ${fmtTime(d.checkOut)}`, d.lateMinutes ? `${d.lateMinutes} min late` : "", d.notes].filter(Boolean).join(" · ")}
            className={cn("min-h-16 rounded-lg p-1.5 text-left sm:min-h-20 sm:p-2", CELL[d.status] ?? CELL.UPCOMING, d.key === today && "ring-2 ring-accent")}
          >
            <div className="flex items-start justify-between gap-1">
              <span className="text-xs font-semibold">{Number(d.key.slice(8))}</span>
              {d.lateMinutes > 0 && <span className="rounded bg-danger px-1 text-[9px] font-semibold text-white">LATE</span>}
            </div>
            <p className="mt-0.5 hidden truncate text-[10.5px] sm:block">{d.holidayName ?? LABEL[d.status]}</p>
            {d.checkIn && (
              <p className="tabular hidden truncate text-[10px] opacity-80 sm:block">
                {fmtTime(d.checkIn).replace(" ", "")}
                {d.checkOut ? `–${fmtTime(d.checkOut).replace(" ", "")}` : ""}
              </p>
            )}
            {d.workMinutes > 0 && <p className="tabular hidden text-[10px] opacity-70 md:block">{minutesToHours(d.workMinutes)}</p>}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted">
        {["PRESENT", "HALF_DAY", "ABSENT", "LEAVE", "WEEK_OFF", "HOLIDAY"].map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2.5 w-2.5 rounded-sm", CELL[s])} /> {LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  );
}

export function SummaryStrip({ summary }: { summary: { present: number; halfDays: number; absent: number; leave: number; weekOff: number; holiday: number; late: number; overtimeMinutes: number; workMinutes: number } }) {
  const items: [string, string | number][] = [
    ["Present", summary.present],
    ["Half days", summary.halfDays],
    ["Absent", summary.absent],
    ["Leave", summary.leave],
    ["Late", summary.late],
    ["Hours worked", minutesToHours(summary.workMinutes)],
    ["Overtime", minutesToHours(summary.overtimeMinutes)],
  ];
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
      {items.map(([l, v]) => (
        <div key={l} className="rounded-lg bg-surface-2 px-2 py-2 text-center">
          <p className="tabular text-sm font-semibold">{v}</p>
          <p className="text-[11px] text-muted">{l}</p>
        </div>
      ))}
    </div>
  );
}
