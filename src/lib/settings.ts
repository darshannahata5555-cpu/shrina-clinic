import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";

/** Typed app settings with defaults. Stored as JSON rows in the `Setting` table. */
export const SETTING_DEFAULTS = {
  clinic: {
    clinicName: "SHRINA",
    legalName: "SHRINA Korean Beauty Aesthetic Clinic",
    tagline: "Korean Beauty Aesthetic Clinic",
    phone: "",
    email: "",
    website: "",
    address: "",
    gstin: "",
    state: "Maharashtra",
    stateCode: "27",
    invoiceFooter: "Thank you for choosing SHRINA. This is a computer-generated invoice.",
    terms: "Packages are non-transferable. Sessions must be used before the package expiry date. Payments once made are refundable only as per clinic policy.",
  },
  billing: {
    gstEnabled: true,
    pricesIncludeGst: false,
    defaultServiceGst: 18,
    defaultProductGst: 18,
    serviceSac: "999722",
    invoicePrefix: "",
    roundOff: true,
    maxDiscountPercentWithoutApproval: 15,
  },
  payroll: {
    /** CALENDAR = salary / days in month; WORKING = salary / working days; FIXED_30; FIXED_26 */
    salaryBasis: "CALENDAR" as "CALENDAR" | "WORKING" | "FIXED_30" | "FIXED_26",
    weeklyOffPaid: true,
    holidaysPaid: true,
    lateGraceMinutes: 10,
    latesPerHalfDay: 3,
    halfDayMinHours: 4,
    fullDayMinHours: 7,
    overtimeEnabled: true,
    overtimeMinMinutes: 30,
    overtimeRateMultiplier: 1,
    paidLeavesPerYear: 12,
    sickLeavesPerYear: 6,
    casualLeavesPerYear: 6,
  },
  attendance: {
    pinEnabled: true,
    qrEnabled: true,
    mobileEnabled: true,
    gpsRequired: false,
    gpsRadiusMeters: 150,
    /** branchId -> { lat, lng } */
    branchLocations: {} as Record<string, { lat: number; lng: number }>,
  },
  security: {
    require2faForOwner: false,
    sessionHours: 12,
  },
  backups: {
    lastBackupAt: null as string | null,
    retentionDays: 30,
  },
};

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings<K extends SettingKey> = (typeof SETTING_DEFAULTS)[K];

export async function getSetting<K extends SettingKey>(key: K): Promise<Settings<K>> {
  const row = await db.setting.findUnique({ where: { key } });
  return { ...SETTING_DEFAULTS[key], ...((row?.value as object) ?? {}) } as Settings<K>;
}

export async function saveSetting<K extends SettingKey>(key: K, value: Partial<Settings<K>>) {
  const merged = { ...(await getSetting(key)), ...value };
  await db.setting.upsert({
    where: { key },
    create: { key, value: merged as unknown as Prisma.InputJsonValue },
    update: { value: merged as unknown as Prisma.InputJsonValue },
  });
  return merged;
}
