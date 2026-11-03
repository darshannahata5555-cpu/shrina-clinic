import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getBranchScope } from "@/lib/branch";

/** Duplicate check for the lead form: existing patients and open leads with this mobile number. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !(user.permissions.has("leads.view") || user.permissions.has("leads.manage")))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const mobile = (req.nextUrl.searchParams.get("mobile") ?? "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  const exclude = req.nextUrl.searchParams.get("excludeId") ?? undefined;
  if (mobile.length !== 10) return NextResponse.json({ patients: [], leads: [] });
  const scope = await getBranchScope();
  const ids = scope.branches.map((b) => b.id);
  const [patients, leads] = await Promise.all([
    db.patient.findMany({
      where: { deletedAt: null, branchId: { in: ids }, OR: [{ mobile }, { altMobile: mobile }] },
      select: { id: true, code: true, fullName: true, branch: { select: { name: true } } },
      take: 5,
    }),
    db.lead.findMany({
      where: { deletedAt: null, mobile, status: { notIn: ["LOST", "TREATMENT_PURCHASED"] }, ...(exclude ? { id: { not: exclude } } : {}) },
      select: { id: true, code: true, name: true, status: true },
      take: 5,
    }),
  ]);
  return NextResponse.json({
    patients: patients.map((p) => ({ id: p.id, code: p.code, fullName: p.fullName, branch: p.branch.name })),
    leads,
  });
}
