// Pure labels for the expenses & activities screens (client-safe).
import type { Tone } from "@/lib/status";

export const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  OPENING_CHECKLIST: "Daily opening checklist",
  CLOSING_CHECKLIST: "Daily closing checklist",
  MACHINE_MAINTENANCE: "Machine maintenance",
  EQUIPMENT_REPAIR: "Equipment repair",
  STOCK_RECEIVED: "New stock received",
  SUPPLIES_PURCHASED: "Clinic supplies purchased",
  PATIENT_COMPLAINT: "Patient complaint",
  GENERAL: "General activity",
};

export const ACTIVITY_TYPE_TONE: Record<string, Tone> = {
  OPENING_CHECKLIST: "info",
  CLOSING_CHECKLIST: "violet",
  MACHINE_MAINTENANCE: "warning",
  EQUIPMENT_REPAIR: "warning",
  STOCK_RECEIVED: "success",
  SUPPLIES_PURCHASED: "success",
  PATIENT_COMPLAINT: "danger",
  GENERAL: "neutral",
};

export const ACTIVITY_TYPES = Object.entries(ACTIVITY_TYPE_LABEL) as [string, string][];

export const DEFAULT_CHECKLISTS: Record<"OPENING_CHECKLIST" | "CLOSING_CHECKLIST", string[]> = {
  OPENING_CHECKLIST: [
    "Reception & waiting area cleaned",
    "Treatment rooms sanitised",
    "Laser machine warm-up & test fire",
    "Autoclave cycle checked",
    "Today's appointments confirmed",
    "Cash drawer float counted",
  ],
  CLOSING_CHECKLIST: [
    "All machines switched off",
    "Consumables restocked",
    "Biomedical waste sealed",
    "Cash reconciled with billing",
    "Next day appointments confirmed",
    "AC & lights off, clinic locked",
  ],
};

export const isChecklist = (t: string): t is "OPENING_CHECKLIST" | "CLOSING_CHECKLIST" => t === "OPENING_CHECKLIST" || t === "CLOSING_CHECKLIST";

export type ChecklistItem = { label: string; done: boolean };

export function parseChecklist(v: unknown): ChecklistItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is { label: unknown; done?: unknown } => !!x && typeof x === "object" && "label" in x)
    .map((x) => ({ label: String(x.label), done: !!x.done }));
}

export const EXPENSE_METHODS = [
  ["CASH", "Cash"],
  ["UPI", "UPI"],
  ["BANK_TRANSFER", "Bank transfer"],
  ["CREDIT_CARD", "Credit card"],
  ["DEBIT_CARD", "Debit card"],
  ["ONLINE", "Online payment"],
] as const;
