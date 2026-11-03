import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ageFrom, humanize, istDateKey, toIstDateInput } from "@/lib/format";
import { buildPatientWhere, patientOrder } from "@/app/(app)/patients/query";

/** Excel export of the (filtered) patient list. Requires reports.export — bulk patient data is sensitive. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.permissions.has("reports.export") || !user.permissions.has("patients.view"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const scope = await getBranchScope();
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const where = await buildPatientWhere(sp, scope.ids);
  const medical = user.permissions.has("patients.medical");
  const patients = await db.patient.findMany({
    where,
    orderBy: patientOrder(sp.sort ?? "recent"),
    include: { branch: { select: { name: true } }, assignedDoctor: { select: { fullName: true } } },
    take: 20000,
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "SHRINA Clinic";
  const ws = wb.addWorksheet("Patients");
  ws.columns = [
    { header: "Patient ID", key: "code", width: 14 },
    { header: "Full name", key: "fullName", width: 26 },
    { header: "Mobile", key: "mobile", width: 14 },
    { header: "Alternate mobile", key: "altMobile", width: 14 },
    { header: "Email", key: "email", width: 28 },
    { header: "Date of birth", key: "dob", width: 13 },
    { header: "Age", key: "age", width: 6 },
    { header: "Gender", key: "gender", width: 9 },
    { header: "Address", key: "address", width: 30 },
    { header: "City", key: "city", width: 14 },
    { header: "Branch", key: "branch", width: 20 },
    { header: "Assigned doctor", key: "doctor", width: 20 },
    { header: "Source", key: "source", width: 12 },
    { header: "Referred by", key: "referredBy", width: 18 },
    { header: "Registered", key: "registered", width: 13 },
    { header: "First visit", key: "firstVisit", width: 13 },
    { header: "Last visit", key: "lastVisit", width: 13 },
    { header: "Skin type", key: "skinType", width: 12 },
    { header: "Allergies", key: "allergies", width: 22 },
    ...(medical ? [{ header: "Medical history", key: "medicalHistory", width: 30 }] : []),
    { header: "Marketing consent", key: "marketing", width: 10 },
    { header: "Notes", key: "notes", width: 30 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const p of patients) {
    ws.addRow({
      code: p.code,
      fullName: p.fullName,
      mobile: p.mobile,
      altMobile: p.altMobile ?? "",
      email: p.email ?? "",
      dob: toIstDateInput(p.dob),
      age: ageFrom(p.dob) ?? "",
      gender: p.gender ? humanize(p.gender) : "",
      address: p.address ?? "",
      city: p.city ?? "",
      branch: p.branch.name,
      doctor: p.assignedDoctor?.fullName ?? "",
      source: p.source ? humanize(p.source) : "",
      referredBy: p.referredBy ?? "",
      registered: toIstDateInput(p.registeredAt),
      firstVisit: toIstDateInput(p.firstVisitAt),
      lastVisit: toIstDateInput(p.lastVisitAt),
      skinType: p.skinType ?? "",
      allergies: p.allergies ?? "",
      medicalHistory: p.medicalHistory ?? "",
      marketing: p.marketingConsent ? "Yes" : "No",
      notes: p.notes ?? "",
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  await audit(user.id, "EXPORT", "Patient", null, `Exported ${patients.length} patients to Excel`, { changes: { filters: sp } });
  return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="shrina-patients-${istDateKey()}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
