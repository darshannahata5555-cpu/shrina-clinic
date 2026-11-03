import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getBranchScope } from "@/lib/branch";
import { fmtDate } from "@/lib/format";

/** Global patient search: name, mobile number or Patient ID (searches all branches the user can access). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !user.permissions.has("patients.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ patients: [] });
  const scope = await getBranchScope();
  const digits = q.replace(/\D/g, "");
  const patients = await db.patient.findMany({
    where: {
      deletedAt: null,
      branchId: { in: scope.branches.map((b) => b.id) },
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ mobile: { contains: digits } }, { altMobile: { contains: digits } }] : []),
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    include: { branch: { select: { name: true } } },
    orderBy: [{ lastVisitAt: { sort: "desc", nulls: "last" } }],
    take: 8,
  });
  return NextResponse.json({
    patients: patients.map((p) => ({
      id: p.id,
      code: p.code,
      fullName: p.fullName,
      mobile: p.mobile,
      branch: p.branch.name,
      lastVisit: p.lastVisitAt ? fmtDate(p.lastVisitAt) : null,
    })),
  });
}
