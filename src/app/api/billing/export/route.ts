import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { istDateKey, toNum, fmtDate } from "@/lib/format";
import { PAYMENT_METHOD_LABEL } from "@/lib/status";
import { invoiceWhere, paymentWhere, type SP } from "@/app/(app)/billing/_lib/filters";

/**
 * Excel export of invoices (default) or payments (?type=payments) using the same filters as the list pages.
 * Requires billing.view + reports.export.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !user.permissions.has("billing.view") || !user.permissions.has("reports.export"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const scope = await getBranchScope();
  const sp: SP = Object.fromEntries(req.nextUrl.searchParams.entries());
  const type = sp.type === "payments" ? "payments" : "invoices";

  const wb = new ExcelJS.Workbook();
  wb.creator = "SHRINA Clinic";
  wb.created = new Date();
  let rowsCount = 0;

  if (type === "invoices") {
    const rows = await db.invoice.findMany({
      where: invoiceWhere(sp, scope.ids),
      include: { patient: { select: { fullName: true, code: true, mobile: true } }, branch: { select: { name: true } }, payments: { select: { method: true, kind: true } } },
      orderBy: [{ date: "asc" }, { number: "asc" }],
      take: 20000,
    });
    rowsCount = rows.length;
    const ws = wb.addWorksheet("Invoices", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = [
      { header: "Invoice no.", key: "number", width: 18 },
      { header: "Date", key: "date", width: 13 },
      { header: "Branch", key: "branch", width: 20 },
      { header: "Patient ID", key: "code", width: 13 },
      { header: "Patient", key: "patient", width: 24 },
      { header: "Mobile", key: "mobile", width: 13 },
      { header: "Subtotal", key: "subtotal", width: 12 },
      { header: "Discount", key: "discount", width: 11 },
      { header: "Taxable", key: "taxable", width: 12 },
      { header: "CGST", key: "cgst", width: 10 },
      { header: "SGST", key: "sgst", width: 10 },
      { header: "IGST", key: "igst", width: 10 },
      { header: "Round off", key: "roundOff", width: 10 },
      { header: "Total", key: "total", width: 12 },
      { header: "Paid", key: "paid", width: 12 },
      { header: "Credited", key: "credited", width: 11 },
      { header: "Balance", key: "balance", width: 12 },
      { header: "Status", key: "status", width: 12 },
      { header: "Payment methods", key: "methods", width: 22 },
    ];
    for (const r of rows) {
      ws.addRow({
        number: r.number,
        date: fmtDate(r.date),
        branch: r.branch.name,
        code: r.patient.code,
        patient: r.patient.fullName,
        mobile: r.patient.mobile,
        subtotal: toNum(r.subtotal),
        discount: toNum(r.discountTotal),
        taxable: toNum(r.taxableAmount),
        cgst: toNum(r.cgst),
        sgst: toNum(r.sgst),
        igst: toNum(r.igst),
        roundOff: toNum(r.roundOff),
        total: toNum(r.total),
        paid: toNum(r.paidAmount),
        credited: toNum(r.creditedAmount),
        balance: r.status === "CANCELLED" ? 0 : toNum(r.balance),
        status: r.status,
        methods: [...new Set(r.payments.filter((p) => p.kind === "RECEIPT").map((p) => PAYMENT_METHOD_LABEL[p.method]))].join(", "),
      });
    }
    ["subtotal", "discount", "taxable", "cgst", "sgst", "igst", "roundOff", "total", "paid", "credited", "balance"].forEach((k) => (ws.getColumn(k).numFmt = "#,##0.00"));
  } else {
    const rows = await db.payment.findMany({
      where: paymentWhere(sp, scope.ids),
      include: { patient: { select: { fullName: true, code: true } }, invoice: { select: { number: true } }, branch: { select: { name: true } } },
      orderBy: { paidAt: "asc" },
      take: 20000,
    });
    rowsCount = rows.length;
    const ws = wb.addWorksheet("Payments", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = [
      { header: "Receipt no.", key: "receipt", width: 18 },
      { header: "Date", key: "date", width: 13 },
      { header: "Branch", key: "branch", width: 20 },
      { header: "Type", key: "kind", width: 10 },
      { header: "Patient ID", key: "code", width: 13 },
      { header: "Patient", key: "patient", width: 24 },
      { header: "Invoice", key: "invoice", width: 18 },
      { header: "Method", key: "method", width: 16 },
      { header: "Reference", key: "reference", width: 22 },
      { header: "Amount", key: "amount", width: 12 },
    ];
    for (const r of rows) {
      ws.addRow({
        receipt: r.receiptNo,
        date: fmtDate(r.paidAt),
        branch: r.branch.name,
        kind: r.kind === "REFUND" ? "Refund" : r.invoiceId ? "Receipt" : "Advance",
        code: r.patient.code,
        patient: r.patient.fullName,
        invoice: r.invoice?.number ?? "",
        method: PAYMENT_METHOD_LABEL[r.method],
        reference: r.reference ?? "",
        amount: (r.kind === "REFUND" ? -1 : 1) * toNum(r.amount),
      });
    }
    ws.getColumn("amount").numFmt = "#,##0.00";
  }
  wb.worksheets[0]!.getRow(1).font = { bold: true };

  await audit(user.id, "EXPORT", type === "invoices" ? "Invoice" : "Payment", null, `Exported ${rowsCount} ${type} to Excel`, { changes: sp });
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="shrina-${type}-${istDateKey()}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
