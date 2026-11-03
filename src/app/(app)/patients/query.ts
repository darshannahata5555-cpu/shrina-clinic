import "server-only";
import type { Prisma } from "@prisma/client";
import { addDaysKey, fromIst, istDateKey } from "@/lib/format";

export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Shared by the list page and the Excel export route. */
export async function buildPatientWhere(sp: Record<string, string | string[] | undefined>, branchIds: string[]) {
  const q = one(sp.q).trim();
  const where: Prisma.PatientWhereInput = { deletedAt: null, branchId: { in: branchIds } };
  const and: Prisma.PatientWhereInput[] = [];
  if (q) {
    const digits = q.replace(/\D/g, "");
    and.push({
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ mobile: { contains: digits } }, { altMobile: { contains: digits } }] : []),
      ],
    });
  }
  const source = one(sp.source);
  if (source) and.push({ source: source as Prisma.PatientWhereInput["source"] });
  const doctor = one(sp.doctor);
  if (doctor) and.push({ assignedDoctorId: doctor });
  const gender = one(sp.gender);
  if (gender) and.push({ gender: gender as Prisma.PatientWhereInput["gender"] });
  const from = one(sp.from);
  const to = one(sp.to);
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) and.push({ registeredAt: { gte: fromIst(from) } });
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) and.push({ registeredAt: { lt: fromIst(addDaysKey(to, 1)) } });
  if (one(sp.followup) === "1") {
    const today = istDateKey();
    and.push({
      consultations: {
        some: { deletedAt: null, followUpDate: { gte: fromIst(addDaysKey(today, -30)), lt: fromIst(addDaysKey(today, 8)) } },
      },
    });
  }
  if (one(sp.outstanding) === "1") and.push({ invoices: { some: { deletedAt: null, status: { in: ["UNPAID", "PARTIAL"] } } } });
  if (and.length) where.AND = and;
  return where;
}

export function patientOrder(sort: string): Prisma.PatientOrderByWithRelationInput[] {
  if (sort === "new") return [{ registeredAt: "desc" }];
  if (sort === "name") return [{ fullName: "asc" }];
  return [{ lastVisitAt: { sort: "desc", nulls: "last" } }, { registeredAt: "desc" }];
}
