import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { findMobileMatches } from "@/lib/patients";
import { fmtDate } from "@/lib/format";

/** Live duplicate check for the registration form: patients sharing a mobile number (all branches). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !(user.permissions.has("patients.create") || user.permissions.has("patients.edit")))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const mobile = req.nextUrl.searchParams.get("mobile") ?? "";
  const exclude = req.nextUrl.searchParams.get("exclude");
  const matches = await findMobileMatches(mobile, exclude);
  const accessible = new Set(user.allBranches ? matches.map((m) => m.branchId) : [user.branchId, ...user.extraBranchIds]);
  return NextResponse.json({
    matches: matches.map((m) => ({
      id: m.id,
      code: m.code,
      fullName: m.fullName,
      branch: m.branch.name,
      registered: fmtDate(m.registeredAt),
      canOpen: accessible.has(m.branchId),
    })),
  });
}
