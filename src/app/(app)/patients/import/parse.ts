import "server-only";
import ExcelJS from "exceljs";
import { normalizeMobile } from "@/lib/format";

export type ImportRecord = {
  fullName: string;
  mobile: string;
  altMobile: string | null;
  email: string | null;
  dob: string | null; // YYYY-MM-DD
  gender: "FEMALE" | "MALE" | "OTHER" | null;
  address: string | null;
  city: string | null;
  source: string | null;
  referredBy: string | null;
  skinType: string | null;
  allergies: string | null;
  medicalHistory: string | null;
  notes: string | null;
  registeredAt: string | null; // YYYY-MM-DD
  legacyId: string | null;
};

export type PreviewRow = {
  row: number;
  data: ImportRecord;
  errors: string[];
  duplicate: string | null; // reason, if any
};

export const TEMPLATE_COLUMNS: [keyof ImportRecord, string, string][] = [
  ["fullName", "Full Name*", "Priya Sharma"],
  ["mobile", "Mobile*", "9876543210"],
  ["altMobile", "Alternate Mobile", ""],
  ["email", "Email", "priya@example.com"],
  ["dob", "Date of Birth (YYYY-MM-DD)", "1994-06-18"],
  ["gender", "Gender (Female/Male/Other)", "Female"],
  ["address", "Address", "Bandra West"],
  ["city", "City", "Mumbai"],
  ["source", "Source (Instagram/Google/Referral/Walk-in/…)", "Instagram"],
  ["referredBy", "Referred By", ""],
  ["skinType", "Skin Type", "Combination"],
  ["allergies", "Allergies", "None"],
  ["medicalHistory", "Medical History", ""],
  ["notes", "Notes", ""],
  ["registeredAt", "Registration Date (YYYY-MM-DD)", "2023-02-14"],
  ["legacyId", "Old Patient ID", "OLD-0042"],
];

const ALIASES: Record<string, keyof ImportRecord> = {
  "full name": "fullName", name: "fullName", "patient name": "fullName",
  mobile: "mobile", "mobile number": "mobile", phone: "mobile", "phone number": "mobile", contact: "mobile",
  "alternate mobile": "altMobile", "alt mobile": "altMobile", "alternate phone": "altMobile",
  email: "email", "email address": "email",
  "date of birth": "dob", dob: "dob", birthday: "dob",
  gender: "gender", sex: "gender",
  address: "address", city: "city",
  source: "source", "patient source": "source", "lead source": "source",
  "referred by": "referredBy", referral: "referredBy",
  "skin type": "skinType", allergies: "allergies", allergy: "allergies",
  "medical history": "medicalHistory", notes: "notes", remarks: "notes",
  "registration date": "registeredAt", registered: "registeredAt", "first visit": "registeredAt",
  "old patient id": "legacyId", "legacy id": "legacyId", "patient id": "legacyId", "old id": "legacyId",
};

const SOURCE_MAP: Record<string, string> = {
  instagram: "INSTAGRAM", insta: "INSTAGRAM", ig: "INSTAGRAM",
  facebook: "FACEBOOK", fb: "FACEBOOK", "facebook ads": "FACEBOOK", meta: "FACEBOOK",
  google: "GOOGLE", "google ads": "GOOGLE",
  whatsapp: "WHATSAPP", website: "WEBSITE", web: "WEBSITE",
  referral: "REFERRAL", reference: "REFERRAL", referred: "REFERRAL",
  "walk-in": "WALK_IN", walkin: "WALK_IN", "walk in": "WALK_IN", walk_in: "WALK_IN",
  phone: "PHONE", call: "PHONE", "phone call": "PHONE", other: "OTHER", others: "OTHER",
};

function headerKey(raw: string): keyof ImportRecord | null {
  const h = raw.toLowerCase().replace(/\*/g, "").replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
  return ALIASES[h] ?? null;
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === "string") return v.trim();
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("").trim();
    if ("text" in v) return String(v.text).trim();
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
  }
  return String(v).trim();
}

function parseDate(s: string): string | null | "invalid" {
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return "invalid";
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return "invalid";
  return dt.toISOString().slice(0, 10);
}

const opt = (s: string) => (s ? s : null);

/** Normalise + validate one raw record. Used for preview AND again on import (never trust the client). */
export function normalizeRecord(raw: Partial<Record<keyof ImportRecord, string>>): { data: ImportRecord; errors: string[] } {
  const errors: string[] = [];
  const g = (k: keyof ImportRecord) => (raw[k] ?? "").toString().trim();
  const fullName = g("fullName").replace(/\s+/g, " ");
  if (fullName.length < 2) errors.push("Name is missing");
  const mobile = normalizeMobile(g("mobile"));
  if (!/^\d{10}$/.test(mobile)) errors.push(g("mobile") ? `Mobile “${g("mobile")}” is not 10 digits` : "Mobile is missing");
  const altRaw = g("altMobile");
  const altMobile = altRaw ? normalizeMobile(altRaw) : null;
  if (altMobile && !/^\d{10}$/.test(altMobile)) errors.push("Alternate mobile is not 10 digits");
  const email = g("email") || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(`Email “${email}” looks invalid`);
  const dob = parseDate(g("dob"));
  if (dob === "invalid") errors.push(`Date of birth “${g("dob")}” is not a valid date (use YYYY-MM-DD)`);
  else if (dob && dob > new Date().toISOString().slice(0, 10)) errors.push("Date of birth is in the future");
  const reg = parseDate(g("registeredAt"));
  if (reg === "invalid") errors.push(`Registration date “${g("registeredAt")}” is not a valid date`);
  const gRaw = g("gender").toLowerCase();
  const gender = !gRaw ? null : gRaw.startsWith("f") || gRaw === "w" ? "FEMALE" : gRaw.startsWith("m") ? "MALE" : gRaw.startsWith("o") ? "OTHER" : null;
  if (gRaw && !gender) errors.push(`Gender “${g("gender")}” not recognised`);
  const sRaw = g("source").toLowerCase();
  const source = !sRaw ? null : (SOURCE_MAP[sRaw] ?? (Object.values(SOURCE_MAP).includes(sRaw.toUpperCase()) ? sRaw.toUpperCase() : "OTHER"));

  return {
    data: {
      fullName,
      mobile,
      altMobile: altMobile && /^\d{10}$/.test(altMobile) ? altMobile : null,
      email,
      dob: dob === "invalid" ? null : dob,
      gender,
      address: opt(g("address")),
      city: opt(g("city")),
      source,
      referredBy: opt(g("referredBy")),
      skinType: opt(g("skinType")),
      allergies: opt(g("allergies")),
      medicalHistory: opt(g("medicalHistory")),
      notes: opt(g("notes")),
      registeredAt: reg === "invalid" ? null : reg,
      legacyId: opt(g("legacyId")),
    },
    errors,
  };
}

export async function readWorkbook(buf: ArrayBuffer): Promise<{ rows: { row: number; raw: Partial<Record<keyof ImportRecord, string>> }[]; unknownHeaders: string[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets.find((w) => w.rowCount > 0 && w.name.toLowerCase() !== "instructions") ?? wb.worksheets[0];
  if (!ws) return { rows: [], unknownHeaders: [] };
  const header = ws.getRow(1);
  const map = new Map<number, keyof ImportRecord>();
  const unknownHeaders: string[] = [];
  header.eachCell((cell, col) => {
    const t = cellText(cell.value);
    const k = headerKey(t);
    if (k) map.set(col, k);
    else if (t) unknownHeaders.push(t);
  });
  const rows: { row: number; raw: Partial<Record<keyof ImportRecord, string>> }[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const raw: Partial<Record<keyof ImportRecord, string>> = {};
    let any = false;
    for (const [col, key] of map) {
      const t = cellText(r.getCell(col).value);
      if (t) any = true;
      raw[key] = t;
    }
    if (any) rows.push({ row: n, raw });
  });
  return { rows, unknownHeaders };
}
