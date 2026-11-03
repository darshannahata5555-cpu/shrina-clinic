import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { TEMPLATE_COLUMNS } from "@/app/(app)/patients/import/parse";

/** Blank patient-import template with one example row and an instructions sheet. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !user.permissions.has("patients.import")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Patients");
  ws.columns = TEMPLATE_COLUMNS.map(([key, header]) => ({ key, header, width: Math.max(14, header.length + 2) }));
  ws.getRow(1).font = { bold: true };
  ws.addRow(Object.fromEntries(TEMPLATE_COLUMNS.map(([k, , ex]) => [k, ex])));
  ws.getColumn("mobile").numFmt = "@";
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const info = wb.addWorksheet("Instructions");
  info.columns = [{ width: 110 }];
  [
    "SHRINA patient import",
    "• Fill one patient per row on the 'Patients' sheet. Delete the example row before importing.",
    "• Required: Full Name and Mobile (10-digit Indian number; +91 / leading 0 are removed automatically).",
    "• Dates: YYYY-MM-DD (e.g. 1994-06-18) or DD/MM/YYYY.",
    "• Gender: Female / Male / Other. Source: Instagram, Facebook, Google, WhatsApp, Website, Referral, Walk-in, Phone, Other.",
    "• Rows whose mobile is already registered are flagged as possible duplicates and skipped unless you choose to include them.",
    "• Old Patient ID is saved in the patient's notes so you can trace records from your previous system.",
  ].forEach((l, i) => {
    const r = info.addRow([l]);
    if (i === 0) r.font = { bold: true, size: 13 };
  });
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="shrina-patient-import-template.xlsx"',
    },
  });
}
