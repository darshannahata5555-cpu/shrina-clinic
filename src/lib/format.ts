// Formatting + India-time (Asia/Kolkata) date helpers. Pure — safe on client and server.
// All instants are stored in UTC; the clinic operates in IST (UTC+05:30, no DST).

export const TZ = "Asia/Kolkata";
const IST_OFFSET_MS = 330 * 60 * 1000;

type Num = number | string | { toString(): string } | null | undefined;

export function toNum(v: Num): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(n) ? n : 0;
}

/** Round to 2 decimals (paise). */
export function r2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2, minimumFractionDigits: 0 });
const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

export function money(v: Num, opts?: { decimals?: boolean }) {
  const n = toNum(v);
  return opts?.decimals === false ? inr0.format(n) : inr.format(n);
}

/** Compact INR, e.g. ₹1.2L, ₹3.4Cr */
export function moneyShort(v: Num) {
  const n = toNum(v);
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${num.format(r2(n / 1e7))}Cr`;
  if (a >= 1e5) return `₹${num.format(r2(n / 1e5))}L`;
  if (a >= 1e3) return `₹${num.format(r2(n / 1e3))}K`;
  return inr0.format(n);
}

export function fmtNum(v: Num) {
  return num.format(toNum(v));
}

function dtf(opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, ...opts });
}
const F_DATE = dtf({ day: "2-digit", month: "short", year: "numeric" });
const F_DATE_SHORT = dtf({ day: "2-digit", month: "short" });
const F_TIME = dtf({ hour: "numeric", minute: "2-digit", hour12: true });
const F_DATETIME = dtf({ day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
const F_WEEKDAY = dtf({ weekday: "short" });
const F_MONTH = dtf({ month: "long", year: "numeric" });

type D = Date | string | null | undefined;
const asDate = (d: D) => (d ? (d instanceof Date ? d : new Date(d)) : null);

export const fmtDate = (d: D) => (asDate(d) ? F_DATE.format(asDate(d)!) : "—");
export const fmtDateShort = (d: D) => (asDate(d) ? F_DATE_SHORT.format(asDate(d)!) : "—");
export const fmtTime = (d: D) => (asDate(d) ? F_TIME.format(asDate(d)!).toUpperCase() : "—");
export const fmtDateTime = (d: D) => (asDate(d) ? F_DATETIME.format(asDate(d)!) : "—");
export const fmtWeekday = (d: D) => (asDate(d) ? F_WEEKDAY.format(asDate(d)!) : "");
export const fmtMonth = (d: D) => (asDate(d) ? F_MONTH.format(asDate(d)!) : "");

/** Calendar date in IST as "YYYY-MM-DD". */
export function istDateKey(d: Date = new Date()): string {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

/** "HH:mm" in IST. */
export function istTimeKey(d: Date): string {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  return shifted.toISOString().slice(11, 16);
}

/** Parse "YYYY-MM-DD" (+ optional "HH:mm") as IST wall time → UTC instant. */
export function fromIst(dateKey: string, time = "00:00"): Date {
  return new Date(`${dateKey}T${time.length === 5 ? time + ":00" : time}+05:30`);
}

/** Parse an <input type="datetime-local"> value (IST wall time). */
export function fromIstLocal(value: string): Date {
  return new Date(`${value.length === 16 ? value + ":00" : value}+05:30`);
}

/** Value for <input type="datetime-local"> in IST. */
export function toIstLocalInput(d: D): string {
  const x = asDate(d);
  if (!x) return "";
  return new Date(x.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/** Value for <input type="date"> in IST. */
export function toIstDateInput(d: D): string {
  const x = asDate(d);
  return x ? istDateKey(x) : "";
}

/** [start, end) UTC instants spanning an IST calendar day. */
export function istDayRange(dateKey: string = istDateKey()): { start: Date; end: Date } {
  const start = fromIst(dateKey);
  return { start, end: new Date(start.getTime() + 86400000) };
}

/** [start, end) for an IST calendar month "YYYY-MM". */
export function istMonthRange(month: string = istDateKey().slice(0, 7)): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  const start = fromIst(`${month}-01`);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { start, end: fromIst(`${next}-01`) };
}

/** Add days to a "YYYY-MM-DD" key. */
export function addDaysKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Day of week (0 = Sunday) for a "YYYY-MM-DD" key. */
export function weekdayOfKey(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

/** UTC-midnight Date for a @db.Date column from an IST date key. */
export function dbDate(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00Z`);
}

/** Indian financial year label for a date, e.g. "25-26". */
export function financialYear(d: Date = new Date()): string {
  const key = istDateKey(d);
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

export function ageFrom(dob: D): number | null {
  const d = asDate(dob);
  if (!d) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

export function relativeDays(d: D): string {
  const x = asDate(d);
  if (!x) return "—";
  const diff = Math.round(
    (fromIst(istDateKey(x)).getTime() - fromIst(istDateKey()).getTime()) / 86400000,
  );
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}

export function minutesToHours(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.abs(min % 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** "ON_NOTICE" → "On notice" */
export function humanize(s: string | null | undefined): string {
  if (!s) return "—";
  const t = s.replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/** Normalise Indian mobile numbers to 10 digits where possible. */
export function normalizeMobile(v: string): string {
  const digits = v.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
