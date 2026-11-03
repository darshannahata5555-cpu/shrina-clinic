// Status → badge tone + label maps used across modules. Pure module.

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "violet";

const map = (o: Record<string, [Tone, string]>) => o;

export const STATUS = {
  appointment: map({
    BOOKED: ["info", "Booked"],
    CONFIRMED: ["violet", "Confirmed"],
    CHECKED_IN: ["warning", "Checked in"],
    IN_TREATMENT: ["accent", "In treatment"],
    COMPLETED: ["success", "Completed"],
    CANCELLED: ["neutral", "Cancelled"],
    NO_SHOW: ["danger", "No show"],
    RESCHEDULED: ["neutral", "Rescheduled"],
  }),
  package: map({
    ACTIVE: ["success", "Active"],
    COMPLETED: ["info", "Completed"],
    EXPIRED: ["warning", "Expired"],
    CANCELLED: ["neutral", "Cancelled"],
  }),
  session: map({
    SCHEDULED: ["info", "Scheduled"],
    COMPLETED: ["success", "Completed"],
    MISSED: ["danger", "Missed"],
    CANCELLED: ["neutral", "Cancelled"],
    RESCHEDULED: ["warning", "Rescheduled"],
  }),
  invoice: map({
    UNPAID: ["danger", "Unpaid"],
    PARTIAL: ["warning", "Partially paid"],
    PAID: ["success", "Paid"],
    CANCELLED: ["neutral", "Cancelled"],
  }),
  approval: map({
    PENDING: ["warning", "Pending"],
    APPROVED: ["success", "Approved"],
    REJECTED: ["danger", "Rejected"],
  }),
  leave: map({
    PENDING: ["warning", "Pending"],
    APPROVED: ["success", "Approved"],
    REJECTED: ["danger", "Rejected"],
    CANCELLED: ["neutral", "Cancelled"],
  }),
  payroll: map({
    DRAFT: ["neutral", "Draft"],
    FINALIZED: ["info", "Finalized"],
    PAID: ["success", "Paid"],
  }),
  attendance: map({
    PRESENT: ["success", "Present"],
    ABSENT: ["danger", "Absent"],
    HALF_DAY: ["warning", "Half day"],
    LEAVE: ["violet", "On leave"],
    WEEK_OFF: ["neutral", "Week off"],
    HOLIDAY: ["info", "Holiday"],
  }),
  lead: map({
    NEW: ["info", "New lead"],
    CONTACTED: ["violet", "Contacted"],
    CONSULTATION_BOOKED: ["warning", "Consultation booked"],
    TREATMENT_PURCHASED: ["success", "Treatment purchased"],
    FOLLOW_UP: ["accent", "Follow-up"],
    LOST: ["neutral", "Lost"],
  }),
  activity: map({
    OPEN: ["warning", "Open"],
    RESOLVED: ["success", "Resolved"],
    REVIEWED: ["info", "Reviewed"],
  }),
  notification: map({
    QUEUED: ["warning", "Queued"],
    SENT: ["success", "Sent"],
    FAILED: ["danger", "Failed"],
    SKIPPED: ["neutral", "Skipped"],
  }),
  employment: map({
    ACTIVE: ["success", "Active"],
    ON_NOTICE: ["warning", "On notice"],
    RESIGNED: ["neutral", "Resigned"],
    TERMINATED: ["danger", "Terminated"],
  }),
} as const;

export type StatusKind = keyof typeof STATUS;

export const LEAD_SOURCES = [
  ["INSTAGRAM", "Instagram"],
  ["FACEBOOK", "Facebook Ads"],
  ["GOOGLE", "Google"],
  ["WHATSAPP", "WhatsApp"],
  ["WEBSITE", "Website"],
  ["REFERRAL", "Referral"],
  ["WALK_IN", "Walk-in"],
  ["PHONE", "Phone call"],
  ["OTHER", "Other"],
] as const;

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CREDIT_CARD: "Credit card",
  DEBIT_CARD: "Debit card",
  BANK_TRANSFER: "Bank transfer",
  ONLINE: "Online payment",
  ADVANCE: "From advance",
};

export const EXPENSE_CATEGORY_LABEL: Record<string, string> = {
  RENT: "Clinic rent",
  ELECTRICITY: "Electricity",
  INTERNET: "Internet",
  SALARIES: "Staff salaries",
  PRODUCT_PURCHASE: "Product purchases",
  EQUIPMENT_MAINTENANCE: "Equipment maintenance",
  MARKETING: "Marketing & advertising",
  HOUSEKEEPING: "Cleaning & housekeeping",
  OFFICE_SUPPLIES: "Office supplies",
  TRANSPORTATION: "Transportation",
  OTHER: "Other",
};

export const TREATMENT_CATEGORIES = [
  "Consultation",
  "Facial",
  "Laser",
  "Peel",
  "Skin Boosters",
  "Injectables",
  "Hair",
  "Body",
  "Other",
] as const;

export const SKIN_TYPES = ["Normal", "Dry", "Oily", "Combination", "Sensitive", "Acne-prone"] as const;
