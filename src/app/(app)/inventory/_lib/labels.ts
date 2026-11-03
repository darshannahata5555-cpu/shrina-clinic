// Pure labels/tones for inventory screens (client-safe).
import type { Tone } from "@/lib/status";

export const TXN_LABEL: Record<string, string> = {
  PURCHASE: "Purchase",
  SALE: "Sale",
  TREATMENT_USAGE: "Treatment usage",
  ADJUSTMENT_IN: "Adjustment in",
  ADJUSTMENT_OUT: "Adjustment out",
  DAMAGE: "Damaged",
  EXPIRED: "Expired",
  RETURN_TO_SUPPLIER: "Returned to supplier",
  CUSTOMER_RETURN: "Customer return",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
};

export const TXN_TONE: Record<string, Tone> = {
  PURCHASE: "success",
  SALE: "accent",
  TREATMENT_USAGE: "violet",
  ADJUSTMENT_IN: "info",
  ADJUSTMENT_OUT: "warning",
  DAMAGE: "danger",
  EXPIRED: "danger",
  RETURN_TO_SUPPLIER: "neutral",
  CUSTOMER_RETURN: "info",
  TRANSFER_IN: "info",
  TRANSFER_OUT: "neutral",
};

export const TXN_OPTIONS = Object.entries(TXN_LABEL) as [string, string][];

export const STOCK_OUT_TYPES = [
  ["ADJUSTMENT_OUT", "Adjustment (count correction)"],
  ["DAMAGE", "Damaged / broken"],
  ["EXPIRED", "Expired — write off"],
  ["RETURN_TO_SUPPLIER", "Return to supplier"],
] as const;

export const STOCK_IN_TYPES = [
  ["PURCHASE", "Stock received (purchase)"],
  ["ADJUSTMENT_IN", "Adjustment (count correction)"],
  ["CUSTOMER_RETURN", "Customer return"],
] as const;

export const UNITS = [
  ["pcs", "pcs (pieces)"],
  ["ml", "ml (millilitre)"],
  ["g", "g (gram)"],
  ["vial", "vial"],
  ["box", "box"],
] as const;

export const PRODUCT_CATEGORIES = ["Serum", "Peel", "Consumable", "Injectable", "Retail", "Clinic Supplies", "Equipment Supply", "Other"] as const;

export const STOCK_STATUS: Record<"OK" | "LOW" | "OUT", [Tone, string]> = {
  OK: ["success", "In stock"],
  LOW: ["warning", "Low"],
  OUT: ["danger", "Out of stock"],
};

export const EXPIRY_WINDOW_DAYS = 60;
