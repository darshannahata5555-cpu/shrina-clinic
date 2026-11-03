import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { db } from "@/lib/db";
import { advanceBalance } from "@/lib/billing";
import { toNum } from "@/lib/format";

/**
 * Billing context for a patient: advance balance, packages not yet billed, open invoices.
 * Used by the invoice builder and the payment form when a patient is picked.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !user.permissions.has("billing.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const patientId = req.nextUrl.searchParams.get("patientId") ?? "";
  const scope = await getBranchScope();
  const patient = await db.patient.findFirst({
    where: { id: patientId, deletedAt: null, branchId: { in: scope.branches.map((b) => b.id) } },
    select: { id: true, fullName: true, assignedDoctorId: true },
  });
  if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [advance, packages, openInvoices] = await Promise.all([
    advanceBalance(patient.id),
    db.treatmentPackage.findMany({
      where: {
        patientId: patient.id,
        deletedAt: null,
        status: { in: ["ACTIVE", "COMPLETED"] },
        invoiceItems: { none: { invoice: { status: { not: "CANCELLED" }, deletedAt: null } } },
      },
      select: { id: true, code: true, name: true, price: true, totalSessions: true, completedSessions: true, treatmentId: true, treatment: { select: { gstRate: true } } },
      orderBy: { purchaseDate: "desc" },
    }),
    db.invoice.findMany({
      where: { patientId: patient.id, deletedAt: null, status: { in: ["UNPAID", "PARTIAL"] }, branchId: { in: scope.branches.map((b) => b.id) } },
      select: { id: true, number: true, date: true, total: true, balance: true, branchId: true },
      orderBy: { date: "asc" },
    }),
  ]);

  return NextResponse.json({
    advance,
    unbilledPackages: packages.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      price: toNum(p.price),
      totalSessions: p.totalSessions,
      completedSessions: p.completedSessions,
      treatmentId: p.treatmentId,
      gstRate: toNum(p.treatment.gstRate),
    })),
    openInvoices: openInvoices.map((i) => ({ id: i.id, number: i.number, date: i.date, total: toNum(i.total), balance: toNum(i.balance), branchId: i.branchId })),
  });
}
