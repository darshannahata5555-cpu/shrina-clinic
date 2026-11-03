import "server-only";
import type { AttendanceMethod, AttendanceStatus, LeaveDayType, LeaveType } from "@prisma/client";
import { db, type Tx } from "./db";
import { ActionError } from "./auth";
import { addDaysKey, dbDate, fromIst, istDateKey, weekdayOfKey } from "./format";
import { getSetting, type Settings } from "./settings";
import { audit } from "./audit";

/* ───────────────────────────── Pure rules ───────────────────────────── */

export type ShiftLike = { shiftStart: string; shiftEnd: string };
type PayrollRules = Pick<
  Settings<"payroll">,
  "lateGraceMinutes" | "halfDayMinHours" | "fullDayMinHours" | "overtimeEnabled" | "overtimeMinMinutes"
>;

export function shiftBounds(dateKey: string, shift: ShiftLike) {
  const start = fromIst(dateKey, shift.shiftStart);
  let end = fromIst(dateKey, shift.shiftEnd);
  if (end <= start) end = new Date(end.getTime() + 86400000); // overnight shift
  return { start, end, minutes: Math.round((end.getTime() - start.getTime()) / 60000) };
}

/**
 * Derive attendance metrics for a day from check-in/out times.
 * - late: minutes after shift start, recorded only when beyond the grace period
 * - early: minutes before shift end at check-out
 * - overtime: minutes worked beyond the shift length, only when ≥ overtimeMinMinutes
 * - status: ≥ fullDayMinHours → PRESENT; ≥ halfDayMinHours → HALF_DAY; less → ABSENT.
 *   An open day (checked in, not yet out) is PRESENT.
 */
export function computeAttendance(
  dateKey: string,
  checkIn: Date | null,
  checkOut: Date | null,
  shift: ShiftLike,
  rules: PayrollRules,
): { workMinutes: number; lateMinutes: number; earlyMinutes: number; overtimeMinutes: number; status: AttendanceStatus } {
  if (!checkIn) return { workMinutes: 0, lateMinutes: 0, earlyMinutes: 0, overtimeMinutes: 0, status: "ABSENT" };
  const s = shiftBounds(dateKey, shift);
  const lateRaw = Math.round((checkIn.getTime() - s.start.getTime()) / 60000);
  const lateMinutes = lateRaw > rules.lateGraceMinutes ? lateRaw : 0;
  if (!checkOut) return { workMinutes: 0, lateMinutes, earlyMinutes: 0, overtimeMinutes: 0, status: "PRESENT" };

  const workMinutes = Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 60000));
  const earlyMinutes = checkOut < s.end ? Math.round((s.end.getTime() - checkOut.getTime()) / 60000) : 0;
  const extra = workMinutes - s.minutes;
  const overtimeMinutes = rules.overtimeEnabled && extra >= rules.overtimeMinMinutes ? extra : 0;
  const hours = workMinutes / 60;
  const status: AttendanceStatus = hours >= rules.fullDayMinHours ? "PRESENT" : hours >= rules.halfDayMinHours ? "HALF_DAY" : "ABSENT";
  return { workMinutes, lateMinutes, earlyMinutes, overtimeMinutes, status };
}

/** Great-circle distance in metres. */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Every "YYYY-MM-DD" from `from` to `to` inclusive. */
export function dateKeysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = from; k <= to; k = addDaysKey(k, 1)) out.push(k);
  return out;
}

export function daysInMonth(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthKeys(month: string) {
  return dateKeysBetween(`${month}-01`, `${month}-${String(daysInMonth(month)).padStart(2, "0")}`);
}

/** Date key of a @db.Date column. */
export const keyOfDbDate = (d: Date) => d.toISOString().slice(0, 10);

/* ───────────────────────────── Holidays & leave days ───────────────────────────── */

/** Set of holiday date keys applying to a branch between two keys. */
export async function holidayKeys(branchId: string | null, from: string, to: string, tx?: Tx) {
  const rows = await (tx ?? db).holiday.findMany({
    where: { date: { gte: dbDate(from), lte: dbDate(to) }, OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])] },
    select: { date: true },
  });
  return new Set(rows.map((r) => keyOfDbDate(r.date)));
}

/** Working days a leave covers (weekly offs and holidays are not counted). */
export async function leaveDayKeys(staff: { weeklyOff: number[]; branchId: string }, from: string, to: string, tx?: Tx) {
  const hol = await holidayKeys(staff.branchId, from, to, tx);
  return dateKeysBetween(from, to).filter((k) => !staff.weeklyOff.includes(weekdayOfKey(k)) && !hol.has(k));
}

export const LEAVE_TYPES: [LeaveType, string][] = [
  ["CASUAL", "Casual leave"],
  ["SICK", "Sick leave"],
  ["PAID", "Paid / earned leave"],
  ["UNPAID", "Unpaid leave"],
];

/** Annual entitlement by leave type (UNPAID has none). */
export function entitlements(p: Settings<"payroll">): Record<Exclude<LeaveType, "UNPAID">, number> {
  return { CASUAL: p.casualLeavesPerYear, SICK: p.sickLeavesPerYear, PAID: p.paidLeavesPerYear };
}

/**
 * Leave balances for a calendar year: entitlement − approved days (by type).
 * `beforeDate` restricts "used" to leaves starting before that date key (used by payroll).
 */
export async function leaveBalances(staffId: string, year: number, opts: { beforeDate?: string; tx?: Tx } = {}) {
  const p = await getSetting("payroll");
  const ent = entitlements(p);
  const rows = await (opts.tx ?? db).leaveRequest.findMany({
    where: {
      staffId,
      status: "APPROVED",
      fromDate: { gte: dbDate(`${year}-01-01`), lte: dbDate(`${year}-12-31`), ...(opts.beforeDate ? { lt: dbDate(opts.beforeDate) } : {}) },
    },
    select: { type: true, days: true },
  });
  const used: Record<LeaveType, number> = { CASUAL: 0, SICK: 0, PAID: 0, UNPAID: 0 };
  for (const r of rows) used[r.type] += Number(r.days);
  return (["CASUAL", "SICK", "PAID", "UNPAID"] as LeaveType[]).map((type) => {
    const entitled = type === "UNPAID" ? null : ent[type];
    return { type, entitled, used: used[type], remaining: entitled === null ? null : Math.max(0, entitled - used[type]) };
  });
}

export function leaveDaysFor(dayType: LeaveDayType, keys: string[]) {
  return dayType === "HALF" ? (keys.length ? 0.5 : 0) : keys.length;
}

/* ───────────────────────────── Check-in / check-out ───────────────────────────── */

export type PunchResult = {
  kind: "in" | "out" | "already-in";
  staffName: string;
  at: Date;
  lateMinutes: number;
  workMinutes: number;
};

/**
 * Record a check-in or check-out for today (IST).
 * - mode "in": creates/updates today's row with checkIn; a second check-in is ignored ("already-in").
 * - mode "out": sets checkOut (re-check-out updates the time); errors if not checked in.
 * - mode "auto": in if not checked in, otherwise out (used by the kiosk).
 * Metrics are recomputed from the staff member's shift and payroll rules.
 */
export async function punch(opts: {
  staffId: string;
  mode: "in" | "out" | "auto";
  method: AttendanceMethod;
  branchId?: string | null;
  at?: Date;
  lat?: number | null;
  lng?: number | null;
  actorUserId?: string | null;
}): Promise<PunchResult> {
  const at = opts.at ?? new Date();
  const dateKey = istDateKey(at);
  const staff = await db.staff.findFirst({ where: { id: opts.staffId, deletedAt: null } });
  if (!staff) throw new ActionError("Employee not found.");
  if (staff.status === "RESIGNED" || staff.status === "TERMINATED") throw new ActionError("This employee is no longer active.");
  const rules = await getSetting("payroll");

  const existing = await db.attendance.findUnique({ where: { staffId_date: { staffId: staff.id, date: dbDate(dateKey) } } });
  const checkedIn = !!existing?.checkIn;
  const mode = opts.mode === "auto" ? (checkedIn ? "out" : "in") : opts.mode;

  if (mode === "in") {
    if (checkedIn) {
      return { kind: "already-in", staffName: staff.fullName, at: existing!.checkIn!, lateMinutes: existing!.lateMinutes, workMinutes: existing!.workMinutes };
    }
    const m = computeAttendance(dateKey, at, null, staff, rules);
    const data = {
      branchId: opts.branchId ?? staff.branchId,
      checkIn: at,
      checkOut: null,
      ...m,
      method: opts.method,
      latitude: opts.lat ?? null,
      longitude: opts.lng ?? null,
      markedById: opts.actorUserId ?? null,
    };
    await db.attendance.upsert({
      where: { staffId_date: { staffId: staff.id, date: dbDate(dateKey) } },
      create: { staffId: staff.id, date: dbDate(dateKey), ...data },
      update: data,
    });
    await audit(opts.actorUserId, "CREATE", "Attendance", staff.id, `${staff.fullName} checked in (${opts.method.toLowerCase()})${m.lateMinutes ? ` — ${m.lateMinutes} min late` : ""}`, { branchId: data.branchId });
    return { kind: "in", staffName: staff.fullName, at, lateMinutes: m.lateMinutes, workMinutes: 0 };
  }

  if (!checkedIn) throw new ActionError(`${staff.fullName} hasn't checked in today.`);
  const m = computeAttendance(dateKey, existing!.checkIn!, at, staff, rules);
  await db.attendance.update({
    where: { id: existing!.id },
    data: { checkOut: at, ...m, ...(opts.lat != null ? { latitude: opts.lat, longitude: opts.lng ?? null } : {}) },
  });
  await audit(opts.actorUserId, "UPDATE", "Attendance", staff.id, `${staff.fullName} checked out (${opts.method.toLowerCase()}) after ${Math.floor(m.workMinutes / 60)}h ${m.workMinutes % 60}m`, { branchId: existing!.branchId });
  return { kind: "out", staffName: staff.fullName, at, lateMinutes: m.lateMinutes, workMinutes: m.workMinutes };
}

/** Day status for display when no attendance row exists. */
export function impliedStatus(opts: { dateKey: string; today: string; weeklyOff: number[]; holiday: boolean; onLeave: boolean }) {
  if (opts.holiday) return "HOLIDAY" as const;
  if (opts.weeklyOff.includes(weekdayOfKey(opts.dateKey))) return "WEEK_OFF" as const;
  if (opts.onLeave) return "LEAVE" as const;
  if (opts.dateKey > opts.today) return "UPCOMING" as const;
  if (opts.dateKey === opts.today) return "NOT_IN" as const;
  return "ABSENT" as const;
}

export const STATUS_LETTER: Record<string, string> = {
  PRESENT: "P",
  ABSENT: "A",
  HALF_DAY: "H",
  LEAVE: "L",
  WEEK_OFF: "WO",
  HOLIDAY: "HO",
  NOT_IN: "–",
  UPCOMING: "",
};

/* ───────────────────────────── Month view ───────────────────────────── */

export type DayCell = {
  key: string;
  status: string; // AttendanceStatus or NOT_IN / UPCOMING
  checkIn: Date | null;
  checkOut: Date | null;
  workMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  method: AttendanceMethod | null;
  notes: string | null;
  holidayName: string | null;
  rowId: string | null;
};

/** Per-day attendance for one employee and month, with implied statuses for days without a row. */
export async function staffMonth(staff: { id: string; branchId: string; weeklyOff: number[]; joiningDate: Date }, month: string) {
  const keys = monthKeys(month);
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  const today = istDateKey();
  const [rows, holidays, leaves] = await Promise.all([
    db.attendance.findMany({ where: { staffId: staff.id, date: { gte: dbDate(first), lte: dbDate(last) } } }),
    db.holiday.findMany({ where: { date: { gte: dbDate(first), lte: dbDate(last) }, OR: [{ branchId: null }, { branchId: staff.branchId }] } }),
    db.leaveRequest.findMany({ where: { staffId: staff.id, status: "APPROVED", fromDate: { lte: dbDate(last) }, toDate: { gte: dbDate(first) } } }),
  ]);
  const byKey = new Map(rows.map((r) => [keyOfDbDate(r.date), r]));
  const hol = new Map(holidays.map((h) => [keyOfDbDate(h.date), h.name]));
  const leaveKeys = new Set<string>();
  for (const l of leaves) for (const k of dateKeysBetween(keyOfDbDate(l.fromDate), keyOfDbDate(l.toDate))) leaveKeys.add(k);
  const joinKey = istDateKey(staff.joiningDate);
  const { lateGraceMinutes: grace } = await getSetting("payroll");

  const days: DayCell[] = keys.map((k) => {
    const r = byKey.get(k);
    const base = { key: k, holidayName: hol.get(k) ?? null };
    if (r)
      return { ...base, status: r.status, checkIn: r.checkIn, checkOut: r.checkOut, workMinutes: r.workMinutes, lateMinutes: r.lateMinutes > grace ? r.lateMinutes : 0, overtimeMinutes: r.overtimeMinutes, method: r.method, notes: r.notes, rowId: r.id };
    const status = k < joinKey ? "UPCOMING" : impliedStatus({ dateKey: k, today, weeklyOff: staff.weeklyOff, holiday: hol.has(k), onLeave: leaveKeys.has(k) });
    return { ...base, status, checkIn: null, checkOut: null, workMinutes: 0, lateMinutes: 0, overtimeMinutes: 0, method: null, notes: null, rowId: null };
  });
  const count = (s: string) => days.filter((d) => d.status === s).length;
  return {
    days,
    summary: {
      present: count("PRESENT"),
      halfDays: count("HALF_DAY"),
      absent: count("ABSENT"),
      leave: count("LEAVE"),
      weekOff: count("WEEK_OFF"),
      holiday: count("HOLIDAY"),
      late: days.filter((d) => d.lateMinutes > 0).length,
      overtimeMinutes: days.reduce((s, d) => s + d.overtimeMinutes, 0),
      workMinutes: days.reduce((s, d) => s + d.workMinutes, 0),
    },
  };
}
